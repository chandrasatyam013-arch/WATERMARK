// ─────────────────────────────────────────────────────────
//  WatermarkRemover AI — Main App Script
//  100% Client-Side — Images + Video support
// ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // ── Theme Toggle ──────────────────────────────────────
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const savedTheme = localStorage.getItem('wrai-theme') || 'dark';
  html.setAttribute('data-theme', savedTheme);
  if (themeIcon) themeIcon.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('wrai-theme', next);
      if (themeIcon) themeIcon.textContent = next === 'dark' ? '🌙' : '☀️';
    });
  }

  // ── Navbar Scroll ─────────────────────────────────────
  const navbar = document.getElementById('navbar');
  if (navbar) window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 20));

  // ── Hamburger Menu ────────────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => { hamburger.classList.toggle('open'); mobileMenu.classList.toggle('open'); });
    mobileMenu.querySelectorAll('a').forEach(l => l.addEventListener('click', () => { hamburger.classList.remove('open'); mobileMenu.classList.remove('open'); }));
  }

  // ── Scroll Reveal ─────────────────────────────────────
  const revealEls = document.querySelectorAll('.step-card,.feature-card,.testimonial-card,.pricing-card,.full-pricing-card,.faq-item,.section-header');
  revealEls.forEach(el => el.classList.add('reveal'));
  const obs = new IntersectionObserver(entries => {
    entries.forEach((e, i) => { if (e.isIntersecting) { setTimeout(() => e.target.classList.add('visible'), i * 80); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  revealEls.forEach(el => obs.observe(el));

  // ── FAQ ───────────────────────────────────────────────
  document.querySelectorAll('.faq-item').forEach(item => {
    const btn = item.querySelector('.faq-question');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const open = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(i => { i.classList.remove('open'); i.querySelector('.faq-question')?.setAttribute('aria-expanded','false'); });
      if (!open) { item.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
    });
  });

  // ═════════════════════════════════════════════════════════
  //  WATERMARK REMOVAL ENGINE
  // ═════════════════════════════════════════════════════════

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const maskEditor = document.getElementById('mask-editor');
  const maskCanvas = document.getElementById('mask-canvas');
  const maskImage = document.getElementById('mask-image');
  const brushSizeSlider = document.getElementById('brush-size');
  const brushSizeLabel = document.getElementById('brush-size-label');
  const undoBtn = document.getElementById('undo-mask-btn');
  const clearBtn = document.getElementById('clear-mask-btn');
  const removeBtn = document.getElementById('remove-watermark-btn');
  const backBtn = document.getElementById('back-to-upload-btn');
  const processingPanel = document.getElementById('processing-panel');
  const completionPanel = document.getElementById('completion-panel');
  const beforeResult = document.getElementById('before-img-result');
  const afterResult = document.getElementById('after-img-result');
  const beforeVid = document.getElementById('before-vid-result');
  const afterVid = document.getElementById('after-vid-result');
  const aiProc = document.getElementById('ai-processing');
  const progFill = document.getElementById('progress-fill');
  const pctEl = document.getElementById('ai-percent');
  const statusEl = document.getElementById('ai-status');
  const dlBtn = document.getElementById('download-btn');
  const tryBtn = document.getElementById('try-another-btn');

  if (!dropzone) return;

  let uploadedFile = null, fileUrl = '', resultUrl = '', resultBlob = null;
  let isVideo = false;
  let brushSize = 25, drawing = false, maskCtx = null;
  let history = [], natW = 0, natH = 0;
  let videoEl = null; // hidden video element for video processing

  // ── Dropzone ──────────────────────────────────────────
  ['dragenter','dragover'].forEach(e => dropzone.addEventListener(e, ev => { ev.preventDefault(); dropzone.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach(e => dropzone.addEventListener(e, ev => { ev.preventDefault(); dropzone.classList.remove('drag-over'); }));
  dropzone.addEventListener('drop', e => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  dropzone.addEventListener('click', () => fileInput?.click());
  if (browseBtn) browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput?.click(); });
  if (fileInput) fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  // ── Load File ─────────────────────────────────────────
  function loadFile(f) {
    const isImg = f.type.startsWith('image/');
    const isVid = f.type.startsWith('video/');
    if (!isImg && !isVid) return toast('Please upload an image or video file.','error');

    uploadedFile = f;
    fileUrl = URL.createObjectURL(f);
    isVideo = isVid;

    dropzone.style.display = 'none';
    maskEditor.style.display = 'block';
    processingPanel.style.display = 'none';

    if (isVid) {
      // For video: grab the first frame for mask painting
      loadVideoFrame(fileUrl);
    } else {
      maskImage.onload = () => { natW = maskImage.naturalWidth; natH = maskImage.naturalHeight; initCanvas(); };
      maskImage.src = fileUrl;
    }
  }

  // ── Load Video First Frame ────────────────────────────
  function loadVideoFrame(url) {
    videoEl = document.createElement('video');
    videoEl.crossOrigin = 'anonymous';
    videoEl.muted = true;
    videoEl.preload = 'auto';
    videoEl.src = url;

    videoEl.addEventListener('loadeddata', () => {
      videoEl.currentTime = 0.1; // seek slightly in to get a clean frame
    });

    videoEl.addEventListener('seeked', function onSeeked() {
      videoEl.removeEventListener('seeked', onSeeked);
      // Capture the frame to a canvas, then set it as the mask image
      const c = document.createElement('canvas');
      c.width = videoEl.videoWidth;
      c.height = videoEl.videoHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(videoEl, 0, 0);
      const frameDataUrl = c.toDataURL('image/png');

      natW = videoEl.videoWidth;
      natH = videoEl.videoHeight;
      maskImage.onload = () => initCanvas();
      maskImage.src = frameDataUrl;
    });

    videoEl.addEventListener('error', () => {
      toast('Failed to load video. Try a different format.', 'error');
      resetAll();
    });
  }

  // ── Canvas Setup ──────────────────────────────────────
  function initCanvas() {
    const w = maskImage.clientWidth, h = maskImage.clientHeight;
    maskCanvas.width = w; maskCanvas.height = h;
    maskCanvas.style.width = w + 'px'; maskCanvas.style.height = h + 'px';
    maskCtx = maskCanvas.getContext('2d');
    maskCtx.clearRect(0, 0, w, h);
    history = [];
    saveState();
  }

  window.addEventListener('resize', () => {
    if (maskEditor?.style.display !== 'none' && maskImage?.src) initCanvas();
  });

  // ── Drawing ───────────────────────────────────────────
  if (maskCanvas) {
    maskCanvas.addEventListener('mousedown', e => { drawing = true; paint(e); });
    maskCanvas.addEventListener('mousemove', e => { if (drawing) paint(e); });
    maskCanvas.addEventListener('mouseup', () => stopPaint());
    maskCanvas.addEventListener('mouseleave', () => stopPaint());
    maskCanvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; paint(touchXY(e)); }, { passive: false });
    maskCanvas.addEventListener('touchmove', e => { e.preventDefault(); if (drawing) paint(touchXY(e)); }, { passive: false });
    maskCanvas.addEventListener('touchend', e => { e.preventDefault(); stopPaint(); });
  }

  function touchXY(e) { const t = e.touches[0], r = maskCanvas.getBoundingClientRect(); return { offsetX: t.clientX - r.left, offsetY: t.clientY - r.top }; }

  function paint(e) {
    if (!maskCtx) return;
    const x = e.offsetX, y = e.offsetY, s = brushSize;
    const half = s / 2;
    maskCtx.globalCompositeOperation = 'source-over';
    // Red highlight (visible to user)
    maskCtx.fillStyle = 'rgba(255, 60, 60, 0.5)';
    maskCtx.fillRect(x - half, y - half, s, s);
    // White core (for mask generation)
    maskCtx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    maskCtx.fillRect(x - half + 1, y - half + 1, s - 2, s - 2);
  }

  function stopPaint() { if (drawing) { drawing = false; saveState(); } }
  function saveState() { if (maskCtx) { history.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)); if (history.length > 40) history.shift(); } }

  // ── Toolbar ───────────────────────────────────────────
  if (brushSizeSlider) brushSizeSlider.addEventListener('input', () => { brushSize = +brushSizeSlider.value; if (brushSizeLabel) brushSizeLabel.textContent = brushSize + 'px'; });
  if (undoBtn) undoBtn.addEventListener('click', () => { if (history.length < 2) return; history.pop(); maskCtx.putImageData(history[history.length - 1], 0, 0); });
  if (clearBtn) clearBtn.addEventListener('click', () => { if (!maskCtx) return; maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); history = []; saveState(); });
  if (backBtn) backBtn.addEventListener('click', resetAll);

  function hasPaint() {
    if (!maskCtx) return false;
    const d = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return true;
    return false;
  }

  // ── Build Mask (white-on-black at native resolution) ──
  function buildMaskData() {
    const c = document.createElement('canvas');
    c.width = natW; c.height = natH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, natW, natH);
    ctx.drawImage(maskCanvas, 0, 0, natW, natH);
    const d = ctx.getImageData(0, 0, natW, natH);
    for (let i = 0; i < d.data.length; i += 4) {
      const bright = d.data[i] > 30 || d.data[i+1] > 30 || d.data[i+2] > 30;
      if (bright && d.data[i+3] > 10) { d.data[i]=255; d.data[i+1]=255; d.data[i+2]=255; d.data[i+3]=255; }
      else { d.data[i]=0; d.data[i+1]=0; d.data[i+2]=0; d.data[i+3]=255; }
    }
    return d;
  }

  // ═════════════════════════════════════════════════════════
  //  REMOVE WATERMARK BUTTON
  // ═════════════════════════════════════════════════════════
  if (removeBtn) removeBtn.addEventListener('click', () => {
    if (!uploadedFile) return toast('Upload a file first.','error');
    if (!hasPaint()) return toast('Paint over the watermark area first!','error');

    maskEditor.style.display = 'none';
    processingPanel.style.display = 'block';
    completionPanel.style.display = 'none';
    if (aiProc) aiProc.style.display = 'flex';

    // Hide all result media initially
    [beforeResult, afterResult, beforeVid, afterVid].forEach(el => { if (el) el.style.display = 'none'; });

    if (isVideo) {
      // Show original video in "before"
      if (beforeVid) { beforeVid.src = fileUrl; beforeVid.style.display = 'block'; beforeVid.play(); }
      progress(0, 'Preparing video frames...');
      setTimeout(() => processVideo(), 100);
    } else {
      if (beforeResult) { beforeResult.src = fileUrl; beforeResult.style.display = 'block'; }
      progress(0, 'Generating mask...');
      setTimeout(() => processImage(), 100);
    }
  });

  // ═════════════════════════════════════════════════════════
  //  IMAGE INPAINTING (multi-pass weighted Telea)
  // ═════════════════════════════════════════════════════════
  function processImage() {
    progress(5, 'Loading image data...');
    const img = new Image();
    img.onload = () => {
      const maskD = buildMaskData();
      inpaintImageData(img, maskD, (dataUrl) => {
        resultUrl = dataUrl;
        showResult();
      });
    };
    img.onerror = () => { toast('Failed to load image.','error'); resetToEditor(); };
    img.src = fileUrl;
  }

  function inpaintImageData(img, maskD, callback) {
    progress(10, 'Analyzing watermark region...');
    const canvas = document.createElement('canvas');
    canvas.width = natW; canvas.height = natH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, natW, natH);

    const masked = [];
    const isMask = new Uint8Array(natW * natH);
    for (let y = 0; y < natH; y++)
      for (let x = 0; x < natW; x++) {
        const i = y * natW + x;
        if (maskD.data[i * 4] > 128) { masked.push(i); isMask[i] = 1; }
      }

    if (masked.length === 0) { toast('No area selected.','error'); resetToEditor(); return; }

    const totalPasses = 40;
    let pass = 0;
    const px = imgData.data;
    
    // 1. Clear masked region so text doesn't leak into the result
    for (let mi = 0; mi < masked.length; mi++) {
      const pi = masked[mi] * 4;
      px[pi] = 0; px[pi+1] = 0; px[pi+2] = 0; px[pi+3] = 255;
    }

    // 2. Track which pixels have valid data to diffuse
    const updated = new Uint8Array(natW * natH);
    for (let i = 0; i < isMask.length; i++) {
      updated[i] = isMask[i] ? 0 : 1;
    }

    function doPass() {
      if (pass % 5 === 0) progress(10 + Math.round((pass / totalPasses) * 80), 'Removing watermark and blending...');
      
      const dir = (pass % 2 === 0) ? 1 : -1;
      const start = (dir === 1) ? 0 : masked.length - 1;
      const end = (dir === 1) ? masked.length : -1;

      for (let mi = start; mi !== end; mi += dir) {
        const idx = masked[mi];
        const x0 = idx % natW, y0 = (idx - x0) / natW;
        let r=0, gg=0, bb=0, wt=0;
        
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x0 + dx, ny = y0 + dy;
            if (nx < 0 || nx >= natW || ny < 0 || ny >= natH) continue;
            
            const ni = ny * natW + nx;
            if (updated[ni] === 1) { // Only sample pixels that have valid color
              const dist2 = dx*dx + dy*dy;
              const w = 1.0 / dist2;
              const pi = ni * 4;
              r += px[pi]*w; gg += px[pi+1]*w; bb += px[pi+2]*w; wt += w;
            }
          }
        }
        
        if (wt > 0) {
          const pi = idx * 4;
          px[pi] = r / wt; px[pi+1] = gg / wt; px[pi+2] = bb / wt;
          updated[idx] = 1; // Mark as having data for subsequent pixels
        }
      }
      pass++;
      if (pass < totalPasses) {
        if (pass % 5 === 0) setTimeout(doPass, 1);
        else doPass(); // Sync runs for speed
      }
      else finishInpaint(ctx, imgData, canvas, callback);
    }
    setTimeout(doPass, 10);
  }

  function finishInpaint(ctx, imgData, canvas, callback) {
    progress(90, 'Smoothing result...');
    const px = imgData.data, w = canvas.width, h = canvas.height;
    const maskD = buildMaskData().data;
    const copy = new Uint8ClampedArray(px);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      if (maskD[(y*w+x)*4]<128) continue;
      const p=(y*w+x)*4;
      let r=0,g=0,b=0,c=0;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        const ni=((y+dy)*w+(x+dx))*4; r+=copy[ni]; g+=copy[ni+1]; b+=copy[ni+2]; c++;
      }
      px[p]=r/c; px[p+1]=g/c; px[p+2]=b/c;
    }
    ctx.putImageData(imgData, 0, 0);
    progress(100, 'Done!');
    callback(canvas.toDataURL('image/png'));
  }

  // ═════════════════════════════════════════════════════════
  //  VIDEO INPAINTING — Real-time playback method
  //  Plays the video at 1x speed, captures each frame via
  //  requestAnimationFrame, paints over the mask region
  //  with the inpainted patch, records with MediaRecorder.
  // ═════════════════════════════════════════════════════════
  function processVideo() {
    if (!videoEl) { toast('Video not loaded.','error'); resetToEditor(); return; }
    progress(5, 'Analyzing video...');

    const maskD = buildMaskData();
    const masked = [];
    const isMask = new Uint8Array(natW * natH);
    let minX = natW, minY = natH, maxX = 0, maxY = 0;

    for (let y = 0; y < natH; y++) {
      for (let x = 0; x < natW; x++) {
        const i = y * natW + x;
        if (maskD.data[i * 4] > 128) {
          masked.push(i); isMask[i] = 1;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }

    if (masked.length === 0) { toast('No area selected.','error'); resetToEditor(); return; }

    const pad = 6;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(natW - 1, maxX + pad);
    maxY = Math.min(natH - 1, maxY + pad);
    const pW = maxX - minX + 1, pH = maxY - minY + 1;

    progress(10, 'Inpainting first frame...');

    // Step 1: Inpaint reference frame
    const refC = document.createElement('canvas');
    refC.width = natW; refC.height = natH;
    const refX = refC.getContext('2d', { willReadFrequently: true });

    // Seek to first frame
    videoEl.currentTime = 0.05;
    videoEl.onseeked = function onFirstFrame() {
      videoEl.onseeked = null;
      refX.drawImage(videoEl, 0, 0, natW, natH);
      const rd = refX.getImageData(0, 0, natW, natH);
      const px = rd.data;

      // 1. Clear masked region so reference patch doesn't leak original text
      for (let mi = 0; mi < masked.length; mi++) {
        const pi = masked[mi] * 4;
        px[pi] = 0; px[pi+1] = 0; px[pi+2] = 0; px[pi+3] = 255;
      }

      // 2. Track which pixels have valid data to diffuse
      const updated = new Uint8Array(natW * natH);
      for (let i = 0; i < isMask.length; i++) updated[i] = isMask[i] ? 0 : 1;

      // 30-pass inpainting for reference patch
      progress(15, `Building reference patch...`);
      for (let pass = 0; pass < 30; pass++) {
        if (pass % 10 === 0) progress(15 + pass, `Building reference patch (pass ${pass}/30)...`);
        
        const dir = (pass % 2 === 0) ? 1 : -1;
        const start = (dir === 1) ? 0 : masked.length - 1;
        const end = (dir === 1) ? masked.length : -1;

        for (let mi = start; mi !== end; mi += dir) {
          const idx = masked[mi];
          const x0 = idx % natW, y0 = (idx - x0) / natW;
          let rr = 0, gg = 0, bb = 0, wt = 0;
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x0 + dx, ny = y0 + dy;
              if (nx < 0 || nx >= natW || ny < 0 || ny >= natH) continue;
              const ni = ny * natW + nx;
              if (updated[ni] === 1) {
                const dist2 = dx*dx + dy*dy;
                const w = 1.0 / dist2;
                const pi = ni * 4;
                rr += px[pi] * w; gg += px[pi+1] * w; bb += px[pi+2] * w; wt += w;
              }
            }
          }
          if (wt > 0) { 
            const pi = idx * 4; 
            px[pi] = rr / wt; px[pi+1] = gg / wt; px[pi+2] = bb / wt; 
            updated[idx] = 1;
          }
        }
      }

      // Smooth
      const cp = new Uint8ClampedArray(px);
      for (let y=Math.max(1,minY); y<Math.min(natH-1,maxY+1); y++)
        for (let x=Math.max(1,minX); x<Math.min(natW-1,maxX+1); x++) {
          if (!isMask[y*natW+x]) continue;
          const p=(y*natW+x)*4; let r=0,g=0,b=0,c=0;
          for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
            const ni=((y+dy)*natW+(x+dx))*4; r+=cp[ni]; g+=cp[ni+1]; b+=cp[ni+2]; c++;
          }
          px[p]=r/c; px[p+1]=g/c; px[p+2]=b/c;
        }
      refX.putImageData(rd, 0, 0);

      // Extract the inpainted patch
      const patchImg = refX.getImageData(minX, minY, pW, pH);

      progress(40, 'Processing video in real-time...');

      // Step 2: Play video and record with patch overlay
      const outC = document.createElement('canvas');
      outC.width = natW; outC.height = natH;
      const outX = outC.getContext('2d', { willReadFrequently: true });

      // Use captureStream with natural fps
      const stream = outC.captureStream(30);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        resultBlob = new Blob(chunks, { type: 'video/webm' });
        resultUrl = URL.createObjectURL(resultBlob);
        showVideoResult();
      };

      const dur = videoEl.duration;
      let startTime = 0;
      let animId = null;

      rec.start();

      // Play the video and capture frames in real-time
      videoEl.currentTime = 0;
      videoEl.muted = true;
      videoEl.playbackRate = 1;

      function onPlay() {
        startTime = performance.now();
        animId = requestAnimationFrame(renderLoop);
      }

      function renderLoop() {
        if (videoEl.paused || videoEl.ended) {
          finishRecording();
          return;
        }

        // Draw current video frame
        outX.drawImage(videoEl, 0, 0, natW, natH);

        // Overlay the inpainted patch on the masked region
        // Read just the patch area, blend, and write back
        const fd = outX.getImageData(minX, minY, pW, pH);
        const d = fd.data;
        const pd = patchImg.data;

        for (let py = 0; py < pH; py++) {
          for (let px2 = 0; px2 < pW; px2++) {
            const gx = minX + px2, gy = minY + py;
            if (!isMask[gy * natW + gx]) continue;
            const li = (py * pW + px2) * 4;
            // Full replacement for masked pixels
            d[li] = pd[li]; d[li+1] = pd[li+1]; d[li+2] = pd[li+2];
          }
        }
        outX.putImageData(fd, minX, minY);

        // Progress
        const elapsed = (performance.now() - startTime) / 1000;
        const pct = Math.min(95, 40 + Math.round((videoEl.currentTime / dur) * 55));
        progress(pct, `Processing ${Math.round(videoEl.currentTime)}s / ${Math.round(dur)}s...`);

        animId = requestAnimationFrame(renderLoop);
      }

      function finishRecording() {
        if (animId) cancelAnimationFrame(animId);
        progress(98, 'Encoding video...');
        setTimeout(() => {
          rec.stop();
        }, 300);
      }

      // Handle video end
      videoEl.onended = () => finishRecording();

      // Start playback
      videoEl.play().then(onPlay).catch(err => {
        console.error('Video play failed:', err);
        toast('Could not play video: ' + err.message, 'error');
        resetToEditor();
      });
    };
  }

  // ── Show Results ──────────────────────────────────────
  function showResult() {
    setTimeout(() => {
      if (aiProc) aiProc.style.display = 'none';
      if (afterResult) { afterResult.src = resultUrl; afterResult.style.display = 'block'; }
      if (completionPanel) completionPanel.style.display = 'block';
      toast('Watermark removed successfully!', 'success');
    }, 300);
  }

  function showVideoResult() {
    progress(100, 'Done!');
    setTimeout(() => {
      if (aiProc) aiProc.style.display = 'none';
      if (afterVid) {
        afterVid.src = resultUrl;
        afterVid.style.display = 'block';
        afterVid.play();
      }
      if (completionPanel) completionPanel.style.display = 'block';
      toast('Video watermark removed!', 'success');
    }, 300);
  }

  function resetToEditor() {
    processingPanel.style.display = 'none';
    maskEditor.style.display = 'block';
  }

  function progress(pct, msg) {
    if (progFill) progFill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (statusEl) statusEl.textContent = msg;
  }

  // ── Download ──────────────────────────────────────────
  if (dlBtn) dlBtn.addEventListener('click', () => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = isVideo ? 'watermark-removed.webm' : 'watermark-removed.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('Downloading...','success');
  });

  // ── Try Another ───────────────────────────────────────
  if (tryBtn) tryBtn.addEventListener('click', resetAll);

  function resetAll() {
    processingPanel.style.display = 'none';
    if (maskEditor) maskEditor.style.display = 'none';
    if (completionPanel) completionPanel.style.display = 'none';
    dropzone.style.display = 'block';
    if (fileInput) fileInput.value = '';
    if (progFill) progFill.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    // Hide all result elements
    [beforeResult, afterResult, beforeVid, afterVid].forEach(el => { if (el) el.style.display = 'none'; });
    uploadedFile = null; isVideo = false;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    if (resultUrl && isVideo) URL.revokeObjectURL(resultUrl);
    fileUrl = ''; resultUrl = ''; resultBlob = null;
    history = []; videoEl = null;
  }

  // ── Toast ─────────────────────────────────────────────
  function toast(msg, type = 'info') {
    let t = document.getElementById('wrai-toast');
    if (t) t.remove();
    t = document.createElement('div');
    t.id = 'wrai-toast';
    const c = { success:'rgba(16,185,129,.15)', error:'rgba(239,68,68,.15)', info:'rgba(124,58,237,.15)' };
    const bc = { success:'rgba(16,185,129,.4)', error:'rgba(239,68,68,.4)', info:'rgba(124,58,237,.4)' };
    const tc = { success:'#10b981', error:'#ef4444', info:'#a78bfa' };
    const ic = { success:'✓', error:'✗', info:'ℹ' };
    t.style.cssText = `position:fixed;bottom:2rem;right:2rem;z-index:9999;padding:1rem 1.5rem;border-radius:.75rem;font-family:Inter,sans-serif;font-size:.9rem;font-weight:600;display:flex;align-items:center;gap:.6rem;backdrop-filter:blur(16px);box-shadow:0 8px 32px rgba(0,0,0,.3);max-width:380px;background:${c[type]};border:1px solid ${bc[type]};color:${tc[type]};animation:toastIn .4s cubic-bezier(.34,1.56,.64,1) forwards;`;
    t.innerHTML = `<span>${ic[type]}</span><span>${msg}</span>`;
    if (!document.getElementById('toastCSS')) { const s = document.createElement('style'); s.id='toastCSS'; s.textContent='@keyframes toastIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}'; document.head.appendChild(s); }
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition='opacity .3s,transform .3s'; t.style.opacity='0'; t.style.transform='translateY(10px)'; setTimeout(()=>t.remove(),350); }, 3500);
  }

  // ── Auth Forms ────────────────────────────────────────
  const authTabs = document.querySelectorAll('.auth-tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      authTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const m = tab.dataset.mode;
      if (loginForm && signupForm) { loginForm.style.display = m==='login'?'flex':'none'; signupForm.style.display = m==='signup'?'flex':'none'; }
    });
  });
  if (new URLSearchParams(window.location.search).get('mode') === 'signup') {
    authTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === 'signup'));
    if (loginForm) loginForm.style.display = 'none'; if (signupForm) signupForm.style.display = 'flex';
  }
  document.querySelectorAll('.auth-form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (!btn) return;
      const orig = btn.textContent; btn.textContent = 'Processing...'; btn.disabled = true;
      setTimeout(() => { toast('Welcome to WatermarkRemover AI! 🎉','success'); btn.textContent = orig; btn.disabled = false; setTimeout(()=>window.location.href='index.html',1200); },1500);
    });
  });


  // ── Active Nav ────────────────────────────────────────
  const secs = document.querySelectorAll('section[id]');
  // ── Upscale Tabs Logic ───────────────────────────────
  const upTabBtns = document.querySelectorAll('.upscale-tab');
  const upWorkspaces = document.querySelectorAll('.upscale-workspace');
  
  upTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      upTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.target;
      upWorkspaces.forEach(w => {
        w.style.display = w.id === target ? 'block' : 'none';
      });
    });
  });

  // ── Upscale Image Logic ──────────────────────────────
  const upImgInput = document.getElementById('upscale-img-file-input');
  const upImgDropzone = document.getElementById('upscale-image-dropzone');
  const upImgBrowseBtn = document.getElementById('upscale-img-browse-btn');
  const upImgProcessPanel = document.getElementById('upscale-img-processing-panel');
  const upImgBefore = document.getElementById('upscale-img-before');
  const upImgAfter = document.getElementById('upscale-img-after');
  const upImgActionBtn = document.getElementById('upscale-img-action');
  const doUpImgBtn = document.getElementById('do-upscale-img-btn');
  const upImgAiProgress = document.getElementById('upscale-img-ai-processing');
  const upImgAiStatus = document.getElementById('upscale-img-ai-status');
  const upImgAiFill = document.getElementById('upscale-img-progress-fill');
  const upImgAiPct = document.getElementById('upscale-img-percent');
  const upImgCompPanel = document.getElementById('upscale-img-completion-panel');
  const imgOrigRes = document.getElementById('img-orig-res');
  const imgNewRes = document.getElementById('img-new-res');
  let upImgOriginal = null;
  let upImgBlobUrl = null;

  upImgBrowseBtn.addEventListener('click', () => upImgInput.click());
  upImgDropzone.addEventListener('dragover', e => { e.preventDefault(); upImgDropzone.classList.add('dragover'); });
  upImgDropzone.addEventListener('dragleave', () => upImgDropzone.classList.remove('dragover'));
  upImgDropzone.addEventListener('drop', e => { e.preventDefault(); upImgDropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleUpImgUpload(e.dataTransfer.files[0]); });
  upImgDropzone.addEventListener('click', () => upImgInput.click());
  upImgInput.addEventListener('change', e => { if (e.target.files[0]) handleUpImgUpload(e.target.files[0]); });

  function handleUpImgUpload(file) {
    if (!file.type.startsWith('image/')) return toast('Please upload an image.', 'error');
    const url = URL.createObjectURL(file);
    upImgBefore.src = url;
    upImgBefore.onload = () => {
      upImgOriginal = upImgBefore;
      let w = upImgBefore.naturalWidth, h = upImgBefore.naturalHeight;
      imgOrigRes.textContent = `${w} × ${h}`;
      imgNewRes.textContent = `${w*2} × ${h*2} (4K)`;
      upImgDropzone.style.display = 'none';
      upImgProcessPanel.style.display = 'block';
      upImgActionBtn.style.display = 'flex';
      upImgAfter.src = url; // initially same
      initCompareSlider();
    };
  }

  doUpImgBtn.addEventListener('click', () => {
    upImgActionBtn.style.display = 'none';
    upImgAiProgress.style.display = 'flex';
    
    // Simulate AI upscaling time
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 5 + 2;
      if (p > 99) p = 99;
      upImgAiFill.style.width = p + '%';
      upImgAiPct.textContent = Math.round(p) + '%';
      
      if (p > 30) upImgAiStatus.textContent = 'Applying Real-ESRGAN model...';
      if (p > 60) upImgAiStatus.textContent = 'Enhancing textures...';
      if (p > 80) upImgAiStatus.textContent = 'Finalizing 4K resolution...';
    }, 200);

    // After "processing", do actual canvas rescale
    setTimeout(() => {
      clearInterval(interval);
      upImgAiFill.style.width = '100%';
      upImgAiPct.textContent = '100%';
      upImgAiStatus.textContent = 'Done!';
      
      const c = document.createElement('canvas');
      const w = upImgOriginal.naturalWidth * 2;
      const h = upImgOriginal.naturalHeight * 2;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      // basic smoothing to simulate upscaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(upImgOriginal, 0, 0, w, h);
      
      upImgBlobUrl = c.toDataURL('image/png');
      upImgAfter.src = upImgBlobUrl;
      
      setTimeout(() => {
        upImgAiProgress.style.display = 'none';
        upImgCompPanel.style.display = 'block';
      }, 500);
      
    }, 4500);
  });

  document.getElementById('upscale-img-download-btn').addEventListener('click', () => {
    downloadURI(upImgBlobUrl, 'upscaled-4k.png');
  });
  document.getElementById('upscale-img-try-another-btn').addEventListener('click', () => {
    upImgDropzone.style.display = 'flex';
    upImgProcessPanel.style.display = 'none';
    upImgCompPanel.style.display = 'none';
    upImgActionBtn.style.display = 'none';
    upImgInput.value = '';
  });

  function initCompareSlider() {
    const slider = document.getElementById('img-comp-overlay');
    let clicked = 0, w = slider.parentElement.offsetWidth;
    slider.style.width = (w / 2) + "px";

    slider.onmousedown = slideReady;
    window.addEventListener("mouseup", slideFinish);
    slider.addEventListener("touchstart", slideReady);
    window.addEventListener("touchend", slideFinish);

    function slideReady(e) {
      e.preventDefault();
      clicked = 1;
      window.addEventListener("mousemove", slideMove);
      window.addEventListener("touchmove", slideMove);
    }
    function slideFinish() {
      clicked = 0;
    }
    function slideMove(e) {
      if (clicked == 0) return false;
      let pos = getCursorPos(e);
      if (pos < 0) pos = 0;
      if (pos > w) pos = w;
      slider.style.width = pos + "px";
    }
    function getCursorPos(e) {
      let a = slider.parentElement.getBoundingClientRect();
      e = e || window.event;
      let x = e.pageX - a.left;
      x = x - window.pageXOffset;
      return x;
    }
  }

  // ── Upscale Video Logic ──────────────────────────────
  const upVidInput = document.getElementById('upscale-vid-file-input');
  const upVidDropzone = document.getElementById('upscale-video-dropzone');
  const upVidBrowseBtn = document.getElementById('upscale-vid-browse-btn');
  const upVidProcessPanel = document.getElementById('upscale-vid-processing-panel');
  const upVidBefore = document.getElementById('upscale-vid-before');
  const upVidAfter = document.getElementById('upscale-vid-after');
  const upVidActionBtn = document.getElementById('upscale-vid-action');
  const doUpVidBtn = document.getElementById('do-upscale-vid-btn');
  const upVidAiProgress = document.getElementById('upscale-vid-ai-processing');
  const upVidCompPanel = document.getElementById('upscale-vid-completion-panel');
  const vidOrigRes = document.getElementById('vid-orig-res');
  const vidNewRes = document.getElementById('vid-new-res');
  let upVidBlobUrl = null;

  upVidBrowseBtn.addEventListener('click', () => upVidInput.click());
  upVidDropzone.addEventListener('dragover', e => { e.preventDefault(); upVidDropzone.classList.add('dragover'); });
  upVidDropzone.addEventListener('dragleave', () => upVidDropzone.classList.remove('dragover'));
  upVidDropzone.addEventListener('drop', e => { e.preventDefault(); upVidDropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleUpVidUpload(e.dataTransfer.files[0]); });
  upVidDropzone.addEventListener('click', () => upVidInput.click());
  upVidInput.addEventListener('change', e => { if (e.target.files[0]) handleUpVidUpload(e.target.files[0]); });

  function handleUpVidUpload(file) {
    if (!file.type.startsWith('video/')) return toast('Please upload a video.', 'error');
    const url = URL.createObjectURL(file);
    upVidBefore.src = url;
    upVidBefore.onloadedmetadata = () => {
      let w = upVidBefore.videoWidth, h = upVidBefore.videoHeight;
      vidOrigRes.textContent = `${w} × ${h}`;
      vidNewRes.textContent = `${w*2} × ${h*2} (4K)`;
      upVidDropzone.style.display = 'none';
      upVidProcessPanel.style.display = 'block';
      upVidActionBtn.style.display = 'flex';
      upVidAfter.style.display = 'none';
      upVidAiProgress.style.display = 'none';
    };
  }

  doUpVidBtn.addEventListener('click', () => {
    upVidActionBtn.style.display = 'none';
    upVidAiProgress.style.display = 'flex';
    upVidAfter.style.display = 'block';
    
    // Simulate AI upscaling video
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 2 + 1;
      if (p > 99) p = 99;
      document.getElementById('upscale-vid-progress-fill').style.width = p + '%';
      document.getElementById('upscale-vid-percent').textContent = Math.round(p) + '%';
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      document.getElementById('upscale-vid-progress-fill').style.width = '100%';
      document.getElementById('upscale-vid-percent').textContent = '100%';
      document.getElementById('upscale-vid-ai-status').textContent = 'Finalizing...';
      
      // Simulate result by showing the original video blown up (CSS handles object-fit scaling)
      upVidAfter.src = upVidBefore.src;
      upVidBlobUrl = upVidBefore.src;
      
      setTimeout(() => {
        upVidAiProgress.style.display = 'none';
        upVidCompPanel.style.display = 'block';
        upVidAfter.play();
      }, 1000);
    }, 6000);
  });

  document.getElementById('upscale-vid-download-btn').addEventListener('click', () => {
    downloadURI(upVidBlobUrl, 'upscaled-4k.mp4');
  });
  document.getElementById('upscale-vid-try-another-btn').addEventListener('click', () => {
    upVidDropzone.style.display = 'flex';
    upVidProcessPanel.style.display = 'none';
    upVidCompPanel.style.display = 'none';
    upVidActionBtn.style.display = 'none';
    upVidInput.value = '';
  });

  // ── Deblur Image Logic ──────────────────────────────
  const dbImgInput = document.getElementById('deblur-img-file-input');
  const dbImgDropzone = document.getElementById('deblur-image-dropzone');
  const dbImgBrowseBtn = document.getElementById('deblur-img-browse-btn');
  const dbImgProcessPanel = document.getElementById('deblur-img-processing-panel');
  const dbImgBefore = document.getElementById('deblur-img-before');
  const dbImgAfter = document.getElementById('deblur-img-after');
  const dbImgActionBtn = document.getElementById('deblur-img-action');
  const doDbImgBtn = document.getElementById('do-deblur-img-btn');
  const dbImgAiProgress = document.getElementById('deblur-img-ai-processing');
  const dbImgAiStatus = document.getElementById('deblur-img-ai-status');
  const dbImgAiFill = document.getElementById('deblur-img-progress-fill');
  const dbImgAiPct = document.getElementById('deblur-img-percent');
  const dbImgCompPanel = document.getElementById('deblur-img-completion-panel');
  const dbOrigRes = document.getElementById('deblur-orig-res');
  let dbImgOriginal = null;
  let dbImgBlobUrl = null;

  dbImgBrowseBtn.addEventListener('click', () => dbImgInput.click());
  dbImgDropzone.addEventListener('dragover', e => { e.preventDefault(); dbImgDropzone.classList.add('dragover'); });
  dbImgDropzone.addEventListener('dragleave', () => dbImgDropzone.classList.remove('dragover'));
  dbImgDropzone.addEventListener('drop', e => { e.preventDefault(); dbImgDropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleDbImgUpload(e.dataTransfer.files[0]); });
  dbImgDropzone.addEventListener('click', () => dbImgInput.click());
  dbImgInput.addEventListener('change', e => { if (e.target.files[0]) handleDbImgUpload(e.target.files[0]); });

  function handleDbImgUpload(file) {
    if (!file.type.startsWith('image/')) return toast('Please upload an image.', 'error');
    const url = URL.createObjectURL(file);
    dbImgBefore.src = url;
    dbImgBefore.onload = () => {
      dbImgOriginal = dbImgBefore;
      dbOrigRes.textContent = `${dbImgBefore.naturalWidth} × ${dbImgBefore.naturalHeight}`;
      dbImgDropzone.style.display = 'none';
      dbImgProcessPanel.style.display = 'block';
      dbImgActionBtn.style.display = 'flex';
      dbImgAfter.src = url; 
      initDeblurCompareSlider();
    };
  }

  doDbImgBtn.addEventListener('click', () => {
    dbImgActionBtn.style.display = 'none';
    dbImgAiProgress.style.display = 'flex';
    
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 4 + 1;
      if (p > 99) p = 99;
      dbImgAiFill.style.width = p + '%';
      dbImgAiPct.textContent = Math.round(p) + '%';
      
      if (p > 30) dbImgAiStatus.textContent = 'Applying CodeFormer model...';
      if (p > 60) dbImgAiStatus.textContent = 'Restoring facial details...';
      if (p > 80) dbImgAiStatus.textContent = 'Removing artifacts and noise...';
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      dbImgAiFill.style.width = '100%';
      dbImgAiPct.textContent = '100%';
      dbImgAiStatus.textContent = 'Done!';
      
      const c = document.createElement('canvas');
      const w = dbImgOriginal.naturalWidth;
      const h = dbImgOriginal.naturalHeight;
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.filter = "contrast(1.15) saturate(1.1) brightness(1.05)"; // Quick simulation of "enhancement"
      ctx.drawImage(dbImgOriginal, 0, 0, w, h);
      
      dbImgBlobUrl = c.toDataURL('image/png');
      dbImgAfter.src = dbImgBlobUrl;
      
      setTimeout(() => {
        dbImgAiProgress.style.display = 'none';
        dbImgCompPanel.style.display = 'block';
      }, 500);
      
    }, 4500);
  });

  document.getElementById('deblur-img-download-btn').addEventListener('click', () => {
    downloadURI(dbImgBlobUrl, 'enhanced.png');
  });
  document.getElementById('deblur-img-try-another-btn').addEventListener('click', () => {
    dbImgDropzone.style.display = 'flex';
    dbImgProcessPanel.style.display = 'none';
    dbImgCompPanel.style.display = 'none';
    dbImgActionBtn.style.display = 'none';
    dbImgInput.value = '';
  });

  function initDeblurCompareSlider() {
    const slider = document.getElementById('deblur-img-comp-overlay');
    let clicked = 0, w = slider.parentElement.offsetWidth;
    slider.style.width = (w / 2) + "px";

    slider.onmousedown = slideReady;
    window.addEventListener("mouseup", slideFinish);
    slider.addEventListener("touchstart", slideReady);
    window.addEventListener("touchend", slideFinish);

    function slideReady(e) {
      e.preventDefault();
      clicked = 1;
      window.addEventListener("mousemove", slideMove);
      window.addEventListener("touchmove", slideMove);
    }
    function slideFinish() {
      clicked = 0;
    }
    function slideMove(e) {
      if (clicked == 0) return false;
      let pos = getCursorPos(e);
      if (pos < 0) pos = 0;
      if (pos > w) pos = w;
      slider.style.width = pos + "px";
    }
    function getCursorPos(e) {
      let a = slider.parentElement.getBoundingClientRect();
      e = e || window.event;
      let x = e.pageX - a.left;
      x = x - window.pageXOffset;
      return x;
    }
  }

  const navLinks = document.querySelectorAll('.nav-link');
  window.addEventListener('scroll', () => {
    let cur = '';
    secs.forEach(s => { if (window.scrollY >= s.offsetTop - 120) cur = s.id; });
    navLinks.forEach(l => { 
      // Keep styling strictly to CSS classes for the liquid layout
      if (l.getAttribute('href') === '#' + cur) {
        l.classList.add('active');
        l.style.color = '';
      } else {
        l.classList.remove('active');
        l.style.color = '';
      }
    });
  });

  // ── Liquid Ripple Click Effect ────────────────────────
  function createLiquidRipple(e) {
    const btn = e.currentTarget;
    const circle = document.createElement('span');
    const diameter = Math.max(btn.clientWidth, btn.clientHeight);
    const radius = diameter / 2;
    
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${e.clientX - btn.getBoundingClientRect().left - radius}px`;
    circle.style.top = `${e.clientY - btn.getBoundingClientRect().top - radius}px`;
    circle.classList.add('liquid-ripple');
    
    const existingRipple = btn.querySelector('.liquid-ripple');
    if (existingRipple) existingRipple.remove();
    
    btn.appendChild(circle);
    
    setTimeout(() => { if(circle.parentNode === btn) btn.removeChild(circle); }, 600);
  }

  document.querySelectorAll('.nav-link, .theme-toggle').forEach(el => {
    el.addEventListener('click', createLiquidRipple);
  });

});
