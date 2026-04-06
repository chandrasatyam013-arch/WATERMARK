// ─────────────────────────────────────────────────────────
//  WatermarkRemover AI — Backend Server
// ─────────────────────────────────────────────────────────
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve the frontend static files
app.use(express.static(path.join(__dirname)));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Helper: Convert file to base64 data URI ─────────────
function fileToDataURI(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

// ── Helper: Save base64 data URI to file ────────────────
function saveBase64ToFile(base64Data, outputPath) {
  const matches = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
  if (matches) {
    fs.writeFileSync(outputPath, Buffer.from(matches[1], 'base64'));
  } else {
    fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
  }
}

// ── Route: POST /remove-watermark ───────────────────────
// Accepts: image file + mask (base64 data URI in body)
// Uses Replicate LaMa inpainting model
app.post('/remove-watermark', upload.single('image'), async (req, res) => {
  try {
    const apiToken = process.env.REPLICATE_API_TOKEN;

    if (!apiToken || apiToken === 'your_replicate_api_token_here') {
      // ── FALLBACK: Canvas-based inpainting (no API key) ──
      console.log('⚠ No Replicate API key — using local canvas inpainting fallback');
      return handleLocalInpainting(req, res);
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const maskData = req.body.mask;
    if (!maskData) {
      return res.status(400).json({ error: 'No mask data provided. Please paint over the watermark area.' });
    }

    const imagePath = req.file.path;
    const imageDataURI = fileToDataURI(imagePath);

    // Save the mask to a file then convert to data URI
    const maskPath = path.join(uploadsDir, 'mask-' + req.file.filename.replace(/\.\w+$/, '.png'));
    saveBase64ToFile(maskData, maskPath);
    const maskDataURI = fileToDataURI(maskPath);

    console.log('🚀 Sending to Replicate LaMa inpainting model...');

    // ── Call Replicate API ──
    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // LaMa inpainting model
        version: 'e3de65e4e871e686faf5ee62475e788e04d25f28a9d8e98e22b07c4b690c5f1b',
        input: {
          image: imageDataURI,
          mask: maskDataURI,
        }
      })
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.error('Replicate create error:', err);
      return res.status(500).json({ error: 'Failed to start processing. Check API key.' });
    }

    const prediction = await createRes.json();
    console.log('📋 Prediction created:', prediction.id);

    // ── Poll for completion ──
    let result = prediction;
    let attempts = 0;
    const maxAttempts = 60; // Max 60 seconds

    while (result.status !== 'succeeded' && result.status !== 'failed' && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(result.urls.get, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      result = await pollRes.json();
      attempts++;

      if (attempts % 5 === 0) {
        console.log(`⏳ Processing... (${attempts}s, status: ${result.status})`);
      }
    }

    if (result.status === 'failed') {
      console.error('❌ Replicate failed:', result.error);
      return res.status(500).json({ error: 'AI processing failed: ' + (result.error || 'Unknown error') });
    }

    if (result.status !== 'succeeded') {
      return res.status(504).json({ error: 'Processing timed out. Please try a smaller image.' });
    }

    // ── Download the result image ──
    const outputUrl = result.output;
    console.log('✅ Processing complete! Downloading result...');

    const imgRes = await fetch(outputUrl);
    const imgBuffer = await imgRes.buffer();
    const resultFilename = 'result-' + req.file.filename;
    const resultPath = path.join(uploadsDir, resultFilename);
    fs.writeFileSync(resultPath, imgBuffer);

    // Cleanup input files after a delay
    setTimeout(() => {
      [imagePath, maskPath].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    }, 60000);

    // Schedule result cleanup after 1 hour
    setTimeout(() => {
      try { fs.unlinkSync(resultPath); } catch(e) {}
    }, 3600000);

    res.json({
      success: true,
      resultUrl: `/uploads/${resultFilename}`,
      message: 'Watermark removed successfully!'
    });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ── Local Canvas Inpainting Fallback ────────────────────
// Uses a simple pixel-averaging algorithm when no API key is set.
// This provides a basic but functional watermark removal without external APIs.
async function handleLocalInpainting(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    const maskData = req.body.mask;
    if (!maskData) {
      return res.status(400).json({ error: 'No mask data provided' });
    }

    // For local mode, we return the mask info and let the client do canvas-based inpainting
    // This avoids needing sharp/canvas native modules
    const imagePath = req.file.path;
    const resultFilename = 'result-' + req.file.filename;

    // Copy original as the "result" — the real inpainting happens client-side
    fs.copyFileSync(imagePath, path.join(uploadsDir, resultFilename));

    setTimeout(() => {
      [imagePath, path.join(uploadsDir, resultFilename)].forEach(f => {
        try { fs.unlinkSync(f); } catch(e) {}
      });
    }, 3600000);

    res.json({
      success: true,
      resultUrl: `/uploads/${resultFilename}`,
      useClientInpainting: true,
      message: 'Processing with local inpainting (no API key configured)'
    });
  } catch (err) {
    console.error('Local inpainting error:', err);
    res.status(500).json({ error: 'Local processing failed: ' + err.message });
  }
}

// ── Health check ────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN !== 'your_replicate_api_token_here'
  });
});

// ── Start server ────────────────────────────────────────
app.listen(PORT, () => {
  const hasKey = process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_API_TOKEN !== 'your_replicate_api_token_here';
  console.log(`\n✦ WatermarkRemover AI Server running on http://localhost:${PORT}`);
  console.log(`  Mode: ${hasKey ? '🤖 Replicate AI (LaMa model)' : '🎨 Client-side inpainting (no API key)'}`);
  if (!hasKey) {
    console.log('  → To use AI: add your Replicate API token to .env file');
    console.log('  → Get a token at: https://replicate.com/account/api-tokens\n');
  }
});
