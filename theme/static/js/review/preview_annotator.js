/**
 * preview_annotator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single-asset fullscreen preview with:
 *   • Drawing annotations (pen / rect / text)
 *   • Note modal with status update
 *   • Mini Player (Picture-in-Picture replacement)
 *   • Video.js integration
 *
 * Depends on:  video_controls_common.js  (must be loaded first)
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  if (!window.VideoUtils) {
    console.error('[preview_annotator] video_controls_common.js must be loaded first.');
    return;
  }
  const VU = window.VideoUtils;

  // ── Pill / minimize state ─────────────────────────────────────────────────
  let _miniPill         = null;
  // Replaces the old boolean _suppressFsChange.
  const fsGuard         = { active: false };
  let _pillMeta         = { label: 'Preview' };

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL ANNOTATION STATE
  // ─────────────────────────────────────────────────────────────────────────
  if (typeof window.annotationState === 'undefined') {
    window.annotationState = {
      isFullscreen: false,
      currentTool: null,
      annotations: [],
      drawing: false,
      startX: 0,
      startY: 0,
      canvas: null,
      ctx: null,
      mediaElement: null,
      color: '#f472b6',
      activeToolsContainer: null,
      activeTextModal: null,
      textareaFocused: false,
      noteState: {
        annotationText: null,
        pendingTextPosition: null,
        editingAnnotationId: null,
        savedNotes: [],
        noteAnnotations: [],
        wasPlayingBeforeNote: false,
      },
      videoEventListeners: [],
      _draggingAnno: null,
_dragOffsetX: 0,
_dragOffsetY: 0,
      modalInitialized: false,
    };
  }
  const annotationState = window.annotationState;

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD FULLSCREEN SHELL
  // ─────────────────────────────────────────────────────────────────────────
  function buildFullscreenShell(assetName, variantName, originalPath) {
    const label = [assetName, variantName].filter(Boolean).join(' / ')
      || (originalPath ? originalPath.split('/').pop() : '')
      || 'Preview';

    const container = document.createElement('div');
    container.className = 'pa-fullscreen-container';
    container.innerHTML = `
      <div id="fsTopBar">
        <div id="fsLabels">
          <span class="fs-label">
            <i class="fas fa-circle fs-dot-blue"></i>
            <span class="fs-label-tag fs-label-blue">Preview</span>
            <span class="fs-label-name" title="${label}">${label}</span>
          </span>
        </div>
        <div id="fsAnnoCenter"></div>
        <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
          <button id="minimizeFullscreenBtn" title="Minimize">
            <i class="fas fa-window-minimize"></i>
          </button>
          <button id="miniPreviewBtn" title="Restore">
            <i class="fas fa-clone"></i>
          </button>
          <button id="closeFullscreenBtn" title="Close preview">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div id="fsMediaArea"></div>

      <div id="unifiedControls">
        <div id="fsSeekRow">
          <span id="currentTime" class="fs-time">0:00</span>
          <div id="seekBarWrapper">
            <div class="seek-track"><div id="seekFill" style="width:0%"></div></div>
            <input id="seekBar" type="range" min="0" max="1000" value="0">
          </div>
          <span id="totalTime" class="fs-time fs-time-dim">0:00</span>
        </div>
        <div id="fsControlsRow">
          <div class="fs-ctrl-group-left">
            <button id="frameBackBtn"    class="fs-icon-btn" title="Previous frame"><i class="fas fa-step-backward"></i></button>
            <button id="playPauseBtn"    title="Play / Pause"><i id="playIcon" class="fas fa-play"></i></button>
            <button id="frameForwardBtn" class="fs-icon-btn" title="Next frame"><i class="fas fa-step-forward"></i></button>
            <div class="fs-ctrl-divider"></div>
            <button id="loopBtn"         class="fs-icon-btn" title="Toggle"><i class="fas fa-repeat"></i></button>
            <div class="fs-ctrl-divider"></div>
            <button id="muteBtn"         class="fs-icon-btn" title="Mute"><i id="volIcon" class="fas fa-volume-up"></i></button>
            <input  id="volumeBar"       type="range" min="0" max="100" value="100" class="fs-vol-slider">
          </div>
          <div class="fs-ctrl-group-right">
            <select id="speedSelect" title="Playback Speed">
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1" selected>1×</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </div>
        </div>
      </div>
    `;
    return container;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WIRE BOTTOM CONTROLS
  // ─────────────────────────────────────────────────────────────────────────
  function wireBottomControls(container) {
    const seekBar         = container.querySelector('#seekBar');
    const seekFill        = container.querySelector('#seekFill');
    const currentTimeEl   = container.querySelector('#currentTime');
    const totalTimeEl     = container.querySelector('#totalTime');
    const playPauseBtn    = container.querySelector('#playPauseBtn');
    const playIcon        = container.querySelector('#playIcon');
    const frameBackBtn    = container.querySelector('#frameBackBtn');
    const frameForwardBtn = container.querySelector('#frameForwardBtn');
    const loopBtn         = container.querySelector('#loopBtn');
    const muteBtn         = container.querySelector('#muteBtn');
    const volIcon         = container.querySelector('#volIcon');
    const volumeBar       = container.querySelector('#volumeBar');
    const speedSelect     = container.querySelector('#speedSelect');
    const miniPreviewBtn          = container.querySelector('#miniPreviewBtn');

    // ── VJS / raw-video accessors ─────────────────────────────────────────
    function vjsPlayer() { return annotationState.videojsPlayer || null; }
    function videoEl()   { return annotationState.mediaElement; }

    function currentTime() {
      const p = vjsPlayer();
      if (p && typeof p.currentTime === 'function') return p.currentTime() || 0;
      const v = videoEl(); return v ? (v.currentTime || 0) : 0;
    }
    function duration() {
      const p = vjsPlayer();
      if (p && typeof p.duration === 'function') return p.duration() || 0;
      const v = videoEl(); return v ? (v.duration || 0) : 0;
    }
    function setTime(t) {
      const clamped = Math.max(0, Math.min(t, duration() || Infinity));
      const p = vjsPlayer();
      if (p && typeof p.currentTime === 'function') { p.currentTime(clamped); return; }
      const v = videoEl(); if (v && v.readyState >= 1) v.currentTime = clamped;
    }
    function isPaused() {
      const p = vjsPlayer();
      if (p && typeof p.paused === 'function') return p.paused();
      const v = videoEl(); return v ? v.paused : true;
    }
    function playMedia() {
      const p = vjsPlayer();
      if (p && typeof p.play === 'function') { p.play().catch(() => {}); return; }
      videoEl()?.play().catch(() => {});
    }
    function pauseMedia() {
      const p = vjsPlayer();
      if (p && typeof p.pause === 'function') { p.pause(); return; }
      videoEl()?.pause();
    }

    // ── Seek-bar update (VideoUtils) ──────────────────────────────────────
    function updateSeekUI() {
      const raw = { currentTime: currentTime(), duration: duration() };
      VU.updateSeekBar({ primary: raw.duration ? raw : null, seekBar, seekFill, currentTimeEl });
    }

    container._updateSeekUI   = updateSeekUI;
    container._updatePlayIcon = () => { playIcon.className = isPaused() ? 'fas fa-play' : 'fas fa-pause'; };
    container._totalTimeEl    = totalTimeEl;

    // ── Play / Pause ──────────────────────────────────────────────────────
    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isPaused() ? playMedia() : pauseMedia();
      setTimeout(container._updatePlayIcon, 50);
    });

    // ── Seek bar ──────────────────────────────────────────────────────────
    seekBar.addEventListener('input', () => {
      const dur = duration(); if (!dur) return;
      setTime((seekBar.value / 1000) * dur);
      seekFill.style.width      = (seekBar.value / 10) + '%';
      currentTimeEl.textContent = VU.fmtTime((seekBar.value / 1000) * dur);
    });

    // ── Frame step (VideoUtils.seekByFrames) ──────────────────────────────
    function seekFrame(delta) {
      const v = videoEl(); if (!v || v.tagName !== 'VIDEO') return;
      const fps = VU.getFrameRate(v);
      setTime(Math.max(0, Math.min(currentTime() + delta / fps, duration() || Infinity)));
      setTimeout(() => { updateSeekUI(); redrawAnnotations(); }, 50);
    }
    container._seekFrame = seekFrame;

    frameBackBtn.addEventListener('click',    (e) => { e.stopPropagation(); seekFrame(-1); });
    frameForwardBtn.addEventListener('click', (e) => { e.stopPropagation(); seekFrame(1); });

    // ── Loop (VideoUtils.createLoopController) ────────────────────────────
    const loopCtrl = VU.createLoopController({
      getVideos: () => { const v = videoEl(); return v ? [v] : []; },
      btn: loopBtn,
    });
    container._setLoop        = loopCtrl.setLoop;
    container._getLoopEnabled = loopCtrl.isEnabled;

    // ── Volume / Mute (VideoUtils.createVolumeController) ─────────────────
    VU.createVolumeController({
      getPrimary: () => { const v = videoEl(); return v ? [v] : []; },
      slider:  volumeBar,
      muteBtn: muteBtn,
      volIcon: volIcon,
    });

    // ── Playback speed (VideoUtils.wireSpeedSelect) ───────────────────────
    container._speedSelect = speedSelect;
    VU.wireSpeedSelect(speedSelect, videoEl, null);

    // ── Mini Player (custom PiP) ──────────────────────────────────────────
    if (miniPreviewBtn) {
      miniPreviewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (document.getElementById('paMiniPlayer')) { closeFullscreen(); return; }

        const sources = annotationState._fullscreenSources || [];
        const p  = annotationState.videojsPlayer;
        const ct = p && typeof p.currentTime === 'function'
          ? p.currentTime()
          : (videoEl()?.currentTime || 0);

        if (p && typeof p.pause === 'function') p.pause();
        else videoEl()?.pause();

        _createPaMiniPlayer(sources, ct, videoEl()?.dataset?.assetName || 'Preview');
        setTimeout(() => closeFullscreen(), 80);

        miniPreviewBtn.querySelector('i').className = 'fas fa-compress-alt';
        miniPreviewBtn.style.color = '#10b981';
      });
    }

    container._playPauseBtn = playPauseBtn;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BIND VJS EVENTS TO BOTTOM CONTROLS
  // ─────────────────────────────────────────────────────────────────────────
  function bindVJSToBottomControls(container, player) {
    const updateSeekUI   = container._updateSeekUI;
    const updatePlayIcon = container._updatePlayIcon;
    const totalTimeEl    = container._totalTimeEl;
    if (!updateSeekUI || !player) return;

    player.on('timeupdate', () => { updateSeekUI(); redrawAnnotations(); });
    player.on('play',       updatePlayIcon);
    player.on('pause',      updatePlayIcon);
    player.on('ended',      () => {
      const pi = container.querySelector('#playIcon');
      if (pi) pi.className = 'fas fa-play';
    });
    player.on('ratechange', () => {
      const sel = container._speedSelect;
      if (sel && player.playbackRate) {
        const rate = player.playbackRate();
        const opt  = sel.querySelector(`option[value="${rate}"]`);
        if (opt) sel.value = rate;
      }
    });

    if (totalTimeEl) {
      const setTotal = () => {
        if (player.duration && player.duration()) totalTimeEl.textContent = VU.fmtTime(player.duration());
      };
      player.readyState && player.readyState() >= 1 ? setTotal() : player.one('loadedmetadata', setTotal);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MINI PLAYER  (_createPaMiniPlayer)
  // Named distinctly so it doesn't shadow VU.createMiniPlayer.
  // Uses VU.makeResizable for the resize handles; keeps the right/bottom
  // drag pattern inline so coordinates stay consistent.
  // ─────────────────────────────────────────────────────────────────────────
  function _createPaMiniPlayer(videoSrc, startTime, label) {
    const existing = document.getElementById('paMiniPlayer');
    if (existing) existing.remove();

    const mini = document.createElement('div');
    mini.id = 'paMiniPlayer';
    mini.innerHTML = `
      <div class="mini-resize-handle" data-dir="n"></div>
      <div class="mini-resize-handle" data-dir="s"></div>
      <div class="mini-resize-handle" data-dir="e"></div>
      <div class="mini-resize-handle" data-dir="w"></div>
      <div class="mini-resize-handle" data-dir="nw"></div>
      <div class="mini-resize-handle" data-dir="ne"></div>
      <div class="mini-resize-handle" data-dir="sw"></div>
      <div class="mini-resize-handle" data-dir="se"></div>
      <div id="miniInner">
        <div id="miniDragHandle"></div>
        <div id="miniLabel">Mini Preview</div>
        <div id="miniVideoWrap">
          <div id="miniProgress"><div id="miniProgressFill"></div></div>
          <video id="miniVideo" playsinline webkit-playsinline></video>
          <div id="miniOverlay">
            <div id="miniPlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>
          </div>
        </div>
        <div id="miniControls">
          <button id="miniPlayBtn"><i id="miniPlayBtnIcon" class="fas fa-pause"></i></button>
          <span   id="miniTime">0:00 / 0:00</span>
          <button id="miniVolBtn"><i id="miniVolIcon" class="fas fa-volume-up"></i></button>
          <button id="miniExpandBtn"><i class="fas fa-expand"></i></button>
          <button id="miniCloseBtn"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(mini);

    const video        = mini.querySelector('#miniVideo');
    const playBtn      = mini.querySelector('#miniPlayBtn');
    const playBtnIcon  = mini.querySelector('#miniPlayBtnIcon');
    const volBtn       = mini.querySelector('#miniVolBtn');
    const volIcon      = mini.querySelector('#miniVolIcon');
    const expandBtn    = mini.querySelector('#miniExpandBtn');
    const closeBtn     = mini.querySelector('#miniCloseBtn');
    const timeEl       = mini.querySelector('#miniTime');
    const progressFill = mini.querySelector('#miniProgressFill');
    const videoWrap    = mini.querySelector('#miniVideoWrap');
    const dragHandle   = mini.querySelector('#miniDragHandle');

    // ── Load sources ──────────────────────────────────────────────────────
    if (Array.isArray(videoSrc)) {
      videoSrc.forEach(s => {
        const src = document.createElement('source');
        src.src = s.src; src.type = s.type || 'video/mp4';
        video.appendChild(src);
      });
    } else if (videoSrc) {
      video.src = videoSrc;
    }
    video.preload = 'auto';

    const onMeta = () => {
      if (startTime) video.currentTime = startTime;
      video.play().catch(() => {});
      updateMiniTime();
    };
    if (video.readyState >= 1) onMeta();
    else video.addEventListener('loadedmetadata', onMeta, { once: true });

    function updateMiniTime() {
      const cur = video.currentTime || 0, dur = video.duration || 0;
      timeEl.textContent       = `${VU.fmtTime(cur)} / ${VU.fmtTime(dur)}`;
      progressFill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
      playBtnIcon.className    = video.paused ? 'fas fa-play' : 'fas fa-pause';
      const pi = mini.querySelector('#miniPlayIcon i');
      if (pi) { pi.className = video.paused ? 'fas fa-play' : 'fas fa-pause'; pi.style.marginLeft = video.paused ? '2px' : '0'; }
    }
    video.addEventListener('timeupdate', updateMiniTime);
    video.addEventListener('play',  () => { playBtnIcon.className = 'fas fa-pause'; });
    video.addEventListener('pause', () => { playBtnIcon.className = 'fas fa-play'; });

    videoWrap.addEventListener('click', (e) => {
      if (e.target === dragHandle) return;
      video.paused ? video.play().catch(() => {}) : video.pause();
    });
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.paused ? video.play().catch(() => {}) : video.pause();
    });

    // ── Volume / Mute (VideoUtils) ────────────────────────────────────────
    VU.createVolumeController({
      getPrimary: () => [video],
      slider:  null,
      muteBtn: volBtn,
      volIcon: volIcon,
    });

    // ── Expand ────────────────────────────────────────────────────────────
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const curTime    = video.currentTime;
      const wasPlaying = !video.paused;
      _destroyPaMiniPlayer();
      const origEl = window._miniPlayerOriginalElement;
      if (origEl) {
        try {
          if (window.previewVideoPlayer && typeof window.previewVideoPlayer.currentTime === 'function') {
            window.previewVideoPlayer.currentTime(curTime);
            if (!wasPlaying) window.previewVideoPlayer.pause();
          } else {
            origEl.currentTime = curTime;
          }
        } catch (_) {}
        window.openFullscreen(origEl);
      }
    });

    // ── Close ─────────────────────────────────────────────────────────────
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _destroyPaMiniPlayer(); });

    // ── Drag  (right/bottom coordinate system) ────────────────────────────
    let isDragging = false, dragStartX = 0, dragStartY = 0, initRight = 24, initBottom = 24;

    dragHandle.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initRight  = window.innerWidth  - rect.right;
      initBottom = window.innerHeight - rect.bottom;
      mini.classList.add('mini-dragging');
      e.preventDefault();
    });

    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      mini.style.right  = Math.max(8, Math.min(initRight  - dx, window.innerWidth  - mini.offsetWidth  - 8)) + 'px';
      mini.style.bottom = Math.max(8, Math.min(initBottom - dy, window.innerHeight - mini.offsetHeight - 8)) + 'px';
    }
    function onDragUp() {
      if (isDragging) { isDragging = false; mini.classList.remove('mini-dragging'); }
    }
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragUp);

    // ── Resize  (VideoUtils.makeResizable) ───────────────────────────────
    const resizer = VU.makeResizable(mini, {
      minW: 200, minH: 150,
      resizingClass:  'mini-resizing',
      handleSelector: '.mini-resize-handle',
    });

    // Store cleanup on the element so destroyPaMiniPlayer can call it
    mini._destroy = () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup',   onDragUp);
      resizer.destroy();
      video.pause(); video.src = '';
    };

    requestAnimationFrame(() => requestAnimationFrame(() => mini.classList.add('mini-visible')));
    annotationState.miniView = mini;
    return mini;
  }

  function _destroyPaMiniPlayer() {
    const mini = document.getElementById('paMiniPlayer');
    if (!mini) return;
    if (typeof mini._destroy === 'function') mini._destroy();
    mini.classList.remove('mini-visible');
    setTimeout(() => { if (mini.parentNode) mini.remove(); }, 300);
    if (annotationState.miniView === mini) annotationState.miniView = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OPEN FULLSCREEN
  // ─────────────────────────────────────────────────────────────────────────
  window.openFullscreen = function (element) {
    if (element.tagName === 'AUDIO') return;
    if (window._fullscreenContainer) {
      cleanupFullscreen();
    }

    _removePill();
    _destroyPaMiniPlayer();

    annotationState.modalInitialized = false;
    annotationState.activeTextModal  = null;

    const origEl = element;
    let originalPath = '', assetName = '', variantName = '', dataMode = '', dataStatus = '', jsonPath = '';

    assetName   = origEl.dataset.assetName  || origEl.getAttribute('data-asset-name') || '';
    variantName = origEl.dataset.variant     || origEl.getAttribute('data-variant')    || '';
    dataMode    = origEl.dataset.mode        || origEl.getAttribute('data-mode')       || 'Asset';
    dataStatus  = origEl.dataset.status      || origEl.getAttribute('data-status')     || 'No Status';
    jsonPath    = origEl.dataset.jsonPath    || origEl.getAttribute('data-json-path')  || '';

    if      (origEl.dataset.originalPath) originalPath = origEl.dataset.originalPath;
    else if (origEl.dataset.originalSrc)  originalPath = origEl.dataset.originalSrc;
    else if (origEl.dataset.src)          originalPath = origEl.dataset.src;
    else if (origEl.dataset.path)         originalPath = origEl.dataset.path;
    else if (origEl.src) {
      originalPath = origEl.src.includes('/media/')
        ? origEl.src.substring(origEl.src.indexOf('/media/'))
        : origEl.src;
    }
    if (!originalPath && origEl.tagName === 'IMG') {
      const p = origEl.closest('[data-path]');
      if (p) originalPath = p.dataset.path;
    }

    window._miniPlayerOriginalElement = origEl;

    const container = buildFullscreenShell(assetName, variantName, originalPath);
    container.dataset.debugOriginalPath = originalPath;
    document.body.appendChild(container);

    const mediaArea = container.querySelector('#fsMediaArea');
    const isVideo   = origEl.tagName === 'VIDEO';
    const isImage   = origEl.tagName === 'IMG';
    const isIframe  = origEl.tagName === 'IFRAME';

    // Wire top-bar buttons once only (fresh container each call)
    const _onMinimize = (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      _minimizeAnnotator();
    };
    const _onClose = (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      _hardDestroyAnnotator();
    };
    container.querySelector('#closeFullscreenBtn')?.addEventListener('click', _onClose,    { once: true });
    container.querySelector('#minimizeFullscreenBtn')?.addEventListener('click', _onMinimize, { once: true });

    if (!isVideo) {
      const miniPreviewBtn = container.querySelector('#miniPreviewBtn');
      if (miniPreviewBtn) miniPreviewBtn.style.display = 'none';
    }

    _pillMeta.label = [assetName, variantName].filter(Boolean).join(' / ') || 'Preview';
    let mediaClone;

    if (isVideo) {
      let sourceCurrentTime = 0, sourceWasPaused = true;
      if (window.previewVideoPlayer && typeof window.previewVideoPlayer.currentTime === 'function') {
        sourceCurrentTime = window.previewVideoPlayer.currentTime();
        sourceWasPaused   = window.previewVideoPlayer.paused();
      } else {
        sourceCurrentTime = origEl.currentTime;
        sourceWasPaused   = origEl.paused;
      }
      if (window.previewVideoPlayer && typeof window.previewVideoPlayer.pause === 'function') {
        window.previewVideoPlayer.pause();
      } else { origEl.pause(); }

      const sources = [];
      origEl.querySelectorAll('source').forEach(s => {
        if (s.src) sources.push({ src: s.src, type: s.type || 'video/mp4' });
      });
      if (!sources.length && origEl.src) sources.push({ src: origEl.src, type: 'video/mp4' });

      mediaClone = document.createElement('video');
      mediaClone.id        = 'fullscreenMedia';
      mediaClone.className = 'video-js vjs-default-skin vjs-big-play-centered';
      mediaClone.setAttribute('playsinline', '');
      mediaClone.setAttribute('webkit-playsinline', '');

      Array.from(origEl.attributes).forEach(attr => {
        if (attr.name.startsWith('data-')) mediaClone.setAttribute(attr.name, attr.value);
      });
      if (originalPath)  mediaClone.dataset.originalPath = originalPath;
      if (assetName)     mediaClone.dataset.assetName     = assetName;
      if (variantName)   mediaClone.dataset.variant       = variantName;
      if (dataMode)      mediaClone.dataset.mode          = dataMode;
      if (dataStatus)    mediaClone.dataset.status        = dataStatus;
      if (jsonPath)      mediaClone.dataset.jsonPath      = jsonPath;
      mediaClone._restoreInfo = { originalElement: origEl, sourceCurrentTime, sourceWasPaused };

      annotationState._fullscreenSources     = sources;
      annotationState._fullscreenStartTime   = sourceCurrentTime;
      annotationState._fullscreenStartPaused = sourceWasPaused;
      annotationState._createdVideojsForFullscreen = true;

    } else if (isImage) {
      mediaClone = origEl.cloneNode(false);
      mediaClone.id = 'fullscreenMedia';
      if (originalPath) mediaClone.dataset.originalPath = originalPath;
      ['asset-name', 'variant', 'mode', 'status'].forEach(a => {
        const v = origEl.getAttribute('data-' + a); if (v) mediaClone.setAttribute('data-' + a, v);
      });
    } else if (isIframe) {
      mediaClone = document.createElement('iframe');
      mediaClone.id  = 'fullscreenMedia';
      mediaClone.src = origEl.src;
      mediaClone.style.border = 'none';
      if (originalPath) mediaClone.dataset.originalPath = originalPath;
      ['asset-name', 'variant', 'mode', 'status'].forEach(a => {
        const v = origEl.getAttribute('data-' + a); if (v) mediaClone.setAttribute('data-' + a, v);
      });
    } else {
      mediaClone = origEl.cloneNode(true);
      mediaClone.id = 'fullscreenMedia';
      if (originalPath) mediaClone.dataset.originalPath = originalPath;
    }

    mediaArea.appendChild(mediaClone);

    const canvas = document.createElement('canvas');
    canvas.id = 'fsCanvas';
    mediaArea.appendChild(canvas);

    if (!isVideo) container.querySelector('#unifiedControls')?.style.setProperty('display', 'none');

    if (isVideo) {
      let lastClick = 0;
      mediaArea.addEventListener('click', function (e) {
        if (e.target.closest(
          '#fsAnnoCenter,#textInputModalClone,#fsCanvas,.vjs-control-bar,.vjs-big-play-button,#unifiedControls,#fsTopBar'
        )) return;
        const modal = annotationState.activeTextModal;
        if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') return;
        if (annotationState.currentTool) return;
        const now = Date.now();
        if (now - lastClick < 300) return;
        lastClick = now;
        e.preventDefault(); e.stopPropagation();
        const p = annotationState.videojsPlayer;
        if (p) p.paused() ? p.play().catch(() => {}) : p.pause();
      }, true);
    }

    const annoCenter    = container.querySelector('#fsAnnoCenter');
    const toolsTemplate = document.getElementById('fullscreenAnnotationTools');
    if (toolsTemplate && annoCenter) {
      const clone = toolsTemplate.cloneNode(true);
      clone.id    = 'fullscreenAnnotationToolsClone';
      const inner = clone.querySelector('.annotation-tools-overlay');
      if (inner) { annoCenter.appendChild(inner); annotationState.activeToolsContainer = inner; }
      else        { annoCenter.appendChild(clone); annotationState.activeToolsContainer = clone; }
    }

    const textModalTemplate = document.getElementById('textInputModal');
    if (textModalTemplate) {
      const textModal = textModalTemplate.cloneNode(true);
      textModal.id = 'textInputModalClone';
      textModal.classList.add('hidden');
      textModal.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;display:none;align-items:center;justify-content:center;z-index:10001;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);';
      container.appendChild(textModal);
      annotationState.activeTextModal  = textModal;
      annotationState.modalInitialized = false;
    }

    annotationState.mediaElement = mediaClone;
    annotationState.canvas       = canvas;
    annotationState.ctx          = canvas.getContext('2d');
    annotationState.isFullscreen = true;
    window._fullscreenContainer  = container;

    if (isVideo) wireBottomControls(container);

    setTimeout(() => resizeCanvas(),        100);
    setTimeout(() => initAnnotationTools(), 200);

    // CSS fullscreen — primary mechanism (works everywhere incl. iOS)
    _applyCSSFullscreen(container);

    // Native fullscreen — best-effort enhancement (desktop only)
    _tryNativeFullscreen(container);

    if (isVideo) {
      setTimeout(() => {
        const player = initFullscreenVideoJS(
          mediaClone,
          annotationState._fullscreenSources,
          annotationState._fullscreenStartTime,
          !annotationState._fullscreenStartPaused
        );
        if (player) {
          annotationState.videojsPlayer = player;
          player.ready(() => bindVJSToBottomControls(container, player));
          player.on('timeupdate', () => redrawAnnotations());
        }
      }, 150);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // CSS FULLSCREEN
  // ─────────────────────────────────────────────────────────────────────────
  function _applyCSSFullscreen(container) {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    Object.assign(container.style, {
      position:   'fixed', top: '0', left: '0',
      width:      '100vw', height: '100vh',
      zIndex:     '2147483647',
      display:    'flex', flexDirection: 'column',
      background: '#0a0a0a',
      margin: '0', padding: '0', boxSizing: 'border-box',
    });
    container.dataset.cssFs = '1';
  }

  function _removeCSSFullscreen(container) {
    if (!container) return;
    container.style.cssText = '';
    delete container.dataset.cssFs;
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  // Best-effort native fullscreen via VideoUtils.enterFullscreen.
  // Never calls cleanupFullscreen on failure; CSS layer is already active.
  function _tryNativeFullscreen(container) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) return;
    // Pass an empty afterFn — CSS layer is already live; we don't need the callback here.
    VU.enterFullscreen(container, () => {});
  }

  function resizeCanvas() {
    if (!annotationState.canvas || !annotationState.mediaElement) return;
    const area = annotationState.canvas.parentElement;
    if (!area) return;
    annotationState.canvas.width  = area.clientWidth;
    annotationState.canvas.height = area.clientHeight;
    redrawAnnotations();
  }

  function redrawAnnotations() {
    if (!annotationState.ctx || !annotationState.canvas) return;
    annotationState.ctx.clearRect(0, 0, annotationState.canvas.width, annotationState.canvas.height);

    let currentFrame = null;
    if (annotationState.mediaElement && annotationState.mediaElement.tagName === 'VIDEO') {
      currentFrame = VU.getCurrentFrame(annotationState.mediaElement);
    }

    annotationState.annotations.forEach(anno => {
      if (anno.frame != null && currentFrame != null) {
        if (currentFrame === anno.frame) drawAnnotation(anno);
      } else if (anno.timestamp != null && currentFrame != null) {
        const fps = VU.getFrameRate(annotationState.mediaElement);
        if (currentFrame === Math.floor(anno.timestamp * fps)) drawAnnotation(anno);
      } else {
        drawAnnotation(anno);
      }
    });
  }

  function drawAnnotation(anno) {
    const ctx = annotationState.ctx; if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = anno.color || annotationState.color;
    ctx.fillStyle   = anno.color || annotationState.color;
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (anno.type === 'pen' && anno.points) {
      ctx.beginPath(); ctx.moveTo(anno.points[0].x, anno.points[0].y);
      for (let i = 1; i < anno.points.length; i++) ctx.lineTo(anno.points[i].x, anno.points[i].y);
      ctx.stroke();
    } else if (anno.type === 'rect') {
      ctx.strokeRect(anno.x, anno.y, anno.width, anno.height);
    } else if (anno.type === 'text') {
      ctx.font = 'bold 20px Arial';
      const m = ctx.measureText(anno.text), pad = 8, th = 24;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(anno.x - pad, anno.y - th, m.width + pad * 2, th + pad);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeText(anno.text, anno.x, anno.y);
      ctx.fillStyle = anno.color || annotationState.color;
      ctx.fillText(anno.text, anno.x, anno.y);
    }
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INIT VIDEO.JS
  // ─────────────────────────────────────────────────────────────────────────
  function initFullscreenVideoJS(videoEl, sources, startTime, shouldAutoplay) {
    if (typeof videojs === 'undefined') return null;
    const player = videojs(videoEl, {
      controls: false, autoplay: false, preload: 'auto',
      fluid: false, fill: true, bigPlayButton: false,
      sources,
      userActions: { doubleClick: false, click: false },
    });
    player.ready(() => {
      const doSeek = () => {
        player.currentTime(startTime);
        if (shouldAutoplay) player.play().catch(() => {});
      };
      player.readyState() >= 1 ? doSeek() : player.one('loadedmetadata', doSeek);
    });
    annotationState.videojsPlayer = player;
    return player;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NOTE / MEDIA PAUSE HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  function pauseMediaForNote() {
    if (!annotationState.mediaElement || annotationState.mediaElement.tagName !== 'VIDEO') {
      annotationState.noteState.wasPlayingBeforeNote = false; return;
    }
    const p       = annotationState.videojsPlayer;
    const playing = p && typeof p.paused === 'function' ? !p.paused() : !annotationState.mediaElement.paused;
    if (playing) {
      annotationState.noteState.wasPlayingBeforeNote = true;
      p && typeof p.pause === 'function' ? p.pause() : annotationState.mediaElement.pause();
    } else { annotationState.noteState.wasPlayingBeforeNote = false; }
  }

  function resumeMediaAfterNote() {
    if (!annotationState.mediaElement || !annotationState.noteState.wasPlayingBeforeNote) return;
    if (annotationState.mediaElement.tagName === 'VIDEO') {
      const p = annotationState.videojsPlayer;
      try {
        p && typeof p.play === 'function'
          ? p.play().catch(() => annotationState.mediaElement.play().catch(() => {}))
          : annotationState.mediaElement.play().catch(() => {});
      } catch (_) {}
    }
    annotationState.noteState.wasPlayingBeforeNote = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INIT ANNOTATION TOOLS
  // ─────────────────────────────────────────────────────────────────────────
  function initAnnotationTools() {
    const tc = annotationState.activeToolsContainer; if (!tc) return;

    if (annotationState.mediaElement && annotationState.mediaElement.tagName === 'VIDEO') {
      const listener = () => redrawAnnotations();
      annotationState.mediaElement.addEventListener('timeupdate', listener);
      annotationState.videoEventListeners.push({ event: 'timeupdate', listener });
    }

    if (!annotationState.modalInitialized || !annotationState.activeTextModal) initFullscreenNoteModal();

    tc.querySelectorAll('.tooltip-btn[data-tool]').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        tc.querySelectorAll('.tooltip-btn').forEach(b => b.classList.remove('active'));
        newBtn.classList.add('active');
        annotationState.currentTool = newBtn.dataset.tool;
        if (annotationState.currentTool === 'text') {
          if (annotationState.canvas) {
            annotationState.noteState.pendingTextPosition = {
              x: annotationState.canvas.width  / 2,
              y: annotationState.canvas.height / 2,
            };
          }
          showTextInputModalForFullscreen();
        }
        updateCursor();
      });
    });

    if (annotationState.canvas) {
      annotationState.canvas.removeEventListener('mousedown', handleMouseDown);
    annotationState.canvas.removeEventListener('mousemove', handleMouseMove);
    annotationState.canvas.removeEventListener('mouseup',   handleMouseUp);
      annotationState.canvas.addEventListener('mousedown', handleMouseDown);
      annotationState.canvas.addEventListener('mousemove', handleMouseMove);
      annotationState.canvas.addEventListener('mouseup',   handleMouseUp);
    }

    const colorPicker  = tc.querySelector('#fsColorPicker');
    const colorPreview = tc.querySelector('#colorPreview');
    if (colorPicker && colorPreview) {
      colorPicker.value = annotationState.color;
      colorPreview.style.backgroundColor = annotationState.color;
      colorPicker.addEventListener('input', (e) => {
        e.stopPropagation();
        annotationState.color = e.target.value;
        colorPreview.style.backgroundColor = annotationState.color;
      });
      colorPicker.addEventListener('click', (e) => e.stopPropagation());
    }

    const clearBtn = tc.querySelector('#fsAnnoClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (annotationState.annotations.length || annotationState.noteState.noteAnnotations.length) {
  annotationState.annotations = [];
  annotationState.noteState.noteAnnotations = [];
  redrawAnnotations();
}  });
    }

    const saveBtn = tc.querySelector('#fsAnnoSave');
if (saveBtn) {
  saveBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (!confirm('Save annotation to feedback folder?')) return;
    saveAnnotation();
  });
}

    const _label = annotationState.mediaElement
      ? ([annotationState.mediaElement.dataset.assetName, annotationState.mediaElement.dataset.variant]
          .filter(Boolean).join(' / ') || 'Preview')
      : 'Preview';
    _pillMeta.label = _label;

    document.addEventListener('keydown', handleKeyboardShortcuts);
    window.addEventListener('resize', resizeCanvas);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS UPDATE
  // ─────────────────────────────────────────────────────────────────────────
  function updateStatusInJSON(status, comment, mediaPath, assetName, variant, mode, jsonPath) {
    const STATUS_MAP = {
      'Internal Approved': { cls:'bg-emerald-600 text-white',  icon:'fa-check-circle'   },
      'Internal Review':   { cls:'bg-amber-500 text-black',    icon:'fa-hourglass-half' },
      'Internal Retake':   { cls:'bg-rose-500 text-white',     icon:'fa-undo'           },
      'Client Approved':   { cls:'bg-emerald-800 text-white',  icon:'fa-thumbs-up'      },
      'Client Review':     { cls:'bg-amber-600 text-black',    icon:'fa-eye'            },
      'Client Retake':     { cls:'bg-rose-600 text-white',     icon:'fa-sync'           },
      'Work In Progress':  { cls:'bg-sky-600 text-white',      icon:'fa-spinner'        },
      'No Status':         { cls:'bg-slate-600 text-white',    icon:'fa-question'       },
    };
    function getStatusBadge(text) {
      const t = (text || 'No Status').trim() || 'No Status';
      return { text: t, ...(STATUS_MAP[t] || STATUS_MAP['No Status']) };
    }
    function slugify(text) {
      return text.toString().toLowerCase()
        .replace(/\s+/g,'-').replace(/[^\w\-]+/g,'').replace(/\-\-+/g,'-')
        .replace(/^-+/,'').replace(/-+$/,'');
    }

    const formData = new FormData();
    formData.append('status', status);        formData.append('comment',    comment);
    formData.append('media_path', mediaPath); formData.append('asset_name', assetName);
    formData.append('variant', variant||'');  formData.append('mode',       mode);
    formData.append('json_path', jsonPath);
    if (window.Toast) Toast.info('Updating status...','Please Wait');

    fetch('/update-preview-status/', { method:'POST', body:formData, headers:{'X-CSRFToken':getCsrfToken()} })
    .then(r => r.json()).then(data => {
      if (data.success) {
        if (window.Toast) Toast.success(`Status updated to ${status}`, 'Status Updated');
        if (annotationState.mediaElement) annotationState.mediaElement.dataset.status = status;
        document.querySelectorAll(`[data-asset-name="${assetName}"][data-variant="${variant||''}"][data-mode="${mode}"]`).forEach(el => {
          if (el !== annotationState.mediaElement) el.dataset.status = status;
        });
        if (data.updated_index !== undefined) {
          const uid = `${slugify(jsonPath)}-${slugify(assetName)}-${data.updated_index}`;
          const statusCell = document.getElementById(`statusCell-${uid}`);
          if (statusCell) {
            const badge = getStatusBadge(status);
            const newSpan = document.createElement('span');
            newSpan.className = `inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${badge.cls} shadow-sm cursor-pointer hover:opacity-80 transition-opacity`;
            newSpan.setAttribute('hx-get',  '/status-form/');
            newSpan.setAttribute('hx-vals', `js:{uid:"${uid}",path:this.closest("[data-context-path]").dataset.contextPath,mode:this.closest("[data-context-path]").dataset.contextMode,name:this.closest("[data-context-path]").dataset.contextName,variant:this.closest("[data-context-path]").dataset.contextVariant,index:"${data.updated_index}"}`);
            newSpan.setAttribute('hx-target', `#statusPortal-${uid}`);
            newSpan.setAttribute('hx-swap',  'innerHTML');
            newSpan.setAttribute('hx-trigger','click');
            newSpan.setAttribute('onclick',   'event.stopPropagation();');
            const icon = document.createElement('i'); icon.className = `fas ${badge.icon}`;
            const span = document.createElement('span'); span.textContent = badge.text;
            newSpan.appendChild(icon); newSpan.appendChild(span);
            statusCell.innerHTML = ''; statusCell.appendChild(newSpan);
            if (typeof htmx !== 'undefined') htmx.process(statusCell);
          }
        }
        const mc = document.getElementById('metadataCard');
        if (mc) {
          const sb = mc.querySelector('.inline-flex.items-center.gap-1.px-2.py-1.rounded-lg.font-medium');
          if (sb) { const b = getStatusBadge(status); sb.className = `ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${b.cls} shadow-sm align-middle`; sb.innerHTML = `<i class="fas ${b.icon}"></i><span>${b.text}</span>`; }
          if (comment) mc.querySelectorAll('tbody tr').forEach(row => {
            const fc = row.querySelector('td:first-child');
            if (fc && fc.textContent.trim() === 'PublishComment') { const sc = row.querySelector('td:nth-child(2)'); if (sc) sc.textContent = comment; }
          });
        }
      } else { if (window.Toast) Toast.error(data.error || 'Failed to update status', 'Update Failed'); }
    }).catch(() => { if (window.Toast) Toast.error('Network error while updating status', 'Error'); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NOTE MODAL
  // ─────────────────────────────────────────────────────────────────────────
  function initFullscreenNoteModal() {
    const modal = annotationState.activeTextModal; if (!modal) return;
    if (annotationState.modalInitialized && modal.dataset.initialized === 'true') return;

    const nc = modal.querySelector('#textInputConfirm')?.cloneNode(true);
    const nb = modal.querySelector('#textInputCancel')?.cloneNode(true);
    const nt = modal.querySelector('#textInputArea')?.cloneNode(true);
    if (!nc || !nb || !nt) return;

    modal.querySelector('#textInputConfirm').replaceWith(nc);
    modal.querySelector('#textInputCancel').replaceWith(nb);
    modal.querySelector('#textInputArea').replaceWith(nt);

    nc.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      const text = nt.value.trim();
      if (!text) { modal.classList.add('hidden'); modal.style.display='none'; resumeMediaAfterNote(); return; }
      let timestamp = null, frame = null;
      if (annotationState.mediaElement && annotationState.mediaElement.tagName === 'VIDEO') {
        timestamp = annotationState.mediaElement.currentTime;
        frame     = VU.getCurrentFrame(annotationState.mediaElement);
      }
      const noteAnnotation = {
        type: 'text', text, color: annotationState.color, timestamp, frame, id: Date.now(),
        x: annotationState.noteState.pendingTextPosition?.x || (annotationState.canvas?.width  / 2 || 100),
        y: annotationState.noteState.pendingTextPosition?.y || (annotationState.canvas?.height / 2 || 100),
      };
      annotationState.annotations.push(noteAnnotation);
      annotationState.noteState.noteAnnotations.push(noteAnnotation);
      redrawAnnotations();

      const statusSelect = modal.querySelector('#noteStatusSelect');
      if (statusSelect?.value && annotationState.mediaElement) {
        updateStatusInJSON(
          statusSelect.value, text,
          annotationState.mediaElement.dataset.originalPath || '',
          annotationState.mediaElement.dataset.assetName   || '',
          annotationState.mediaElement.dataset.variant     || '',
          annotationState.mediaElement.dataset.mode        || 'Asset',
          annotationState.mediaElement.dataset.jsonPath    || ''
        );
      }

      modal.classList.add('hidden'); modal.style.display='none'; nt.value='';
      annotationState.noteState.pendingTextPosition = null;
      annotationState.activeToolsContainer?.querySelectorAll('.tooltip-btn').forEach(b => b.classList.remove('active'));
      annotationState.currentTool = null; updateCursor(); resumeMediaAfterNote();
    });

    nb.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      modal.classList.add('hidden'); modal.style.display='none'; nt.value='';
      annotationState.noteState.pendingTextPosition = null; resumeMediaAfterNote();
    });

    nt.addEventListener('keydown', (e) => {
      e.stopPropagation(); e.stopImmediatePropagation();
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); nc.click(); }
      else if (e.key === 'Escape')        { e.preventDefault(); nb.click(); }
    });
    nt.addEventListener('focus', () => { annotationState.textareaFocused = true;  });
    nt.addEventListener('blur',  () => { annotationState.textareaFocused = false; });

    modal.addEventListener('keydown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
    modal.addEventListener('click',   (e) => {
      if (e.target === modal) { modal.classList.add('hidden'); modal.style.display='none'; nt.value=''; annotationState.noteState.pendingTextPosition=null; resumeMediaAfterNote(); }
      e.stopPropagation();
    });

    annotationState.modalInitialized = true;
    modal.dataset.initialized = 'true';
  }

  function showTextInputModalForFullscreen() {
    const modal = annotationState.activeTextModal; if (!modal) return;
    if (!annotationState.modalInitialized) initFullscreenNoteModal();
    const textarea = modal.querySelector('#textInputArea'); if (!textarea) return;
    pauseMediaForNote();
    if (annotationState.canvas) {
      annotationState.noteState.pendingTextPosition = {
        x: annotationState.canvas.width  / 2,
        y: annotationState.canvas.height / 2,
      };
    }
    modal.classList.remove('hidden');
    modal.style.cssText += ';display:flex;visibility:visible;opacity:1;';
    textarea.value = '';
    const statusSelect = modal.querySelector('#noteStatusSelect');
    if (statusSelect && annotationState.mediaElement) statusSelect.value = annotationState.mediaElement.dataset.status || 'No Status';
    setTimeout(() => textarea.focus(), 50);
  }
function getTextAnnotationAt(x, y) {
  if (!annotationState.ctx) return null;
  annotationState.ctx.font = 'bold 20px Arial';
  const pad = 8, th = 24;
  for (let i = annotationState.annotations.length - 1; i >= 0; i--) {
    const anno = annotationState.annotations[i];
    if (anno.type !== 'text') continue;
    const w = annotationState.ctx.measureText(anno.text).width;
    if (x >= anno.x - pad && x <= anno.x - pad + w + pad * 2 &&
        y >= anno.y - th  && y <= anno.y - th + th + pad) {
      return anno;
    }
  }
  return null;
}
  // ─────────────────────────────────────────────────────────────────────────
  // MOUSE HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
function handleMouseDown(e) {
  if (!annotationState.canvas) return;
  const rect = annotationState.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const hitAnno = getTextAnnotationAt(mx, my);
  if (hitAnno) {
    annotationState._draggingAnno = hitAnno;
    annotationState._dragOffsetX  = mx - hitAnno.x;
    annotationState._dragOffsetY  = my - hitAnno.y;
    annotationState.canvas.style.cursor = 'grabbing';
    return;
  }

  if (!annotationState.currentTool) return;
  annotationState.startX  = mx;
  annotationState.startY  = my;
  annotationState.drawing = true;
  let timestamp = null, frame = null;
  if (annotationState.mediaElement && annotationState.mediaElement.tagName === 'VIDEO') {
    timestamp = annotationState.mediaElement.currentTime;
    frame     = VU.getCurrentFrame(annotationState.mediaElement);
  }
  if (annotationState.currentTool === 'pen') {
    annotationState.annotations.push({ type: 'pen', points: [{ x: mx, y: my }], color: annotationState.color, timestamp, frame });
  } else if (annotationState.currentTool === 'rect') {
    annotationState.annotations.push({ type: 'rect', x: mx, y: my, width: 0, height: 0, color: annotationState.color, timestamp, frame });
  }
}

function handleMouseMove(e) {
  if (!annotationState.canvas) return;
  const rect = annotationState.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (annotationState._draggingAnno) {
    annotationState._draggingAnno.x = mx - annotationState._dragOffsetX;
    annotationState._draggingAnno.y = my - annotationState._dragOffsetY;
    redrawAnnotations();
    return;
  }

  if (!annotationState.currentTool && !annotationState.drawing) {
    annotationState.canvas.style.cursor = getTextAnnotationAt(mx, my) ? 'grab' : 'default';
  }

  if (!annotationState.drawing || annotationState.currentTool === 'text' || !annotationState.currentTool) return;
  const last = annotationState.annotations[annotationState.annotations.length - 1];
  if (annotationState.currentTool === 'pen')  last.points.push({ x: mx, y: my });
  if (annotationState.currentTool === 'rect') { last.width = mx - annotationState.startX; last.height = my - annotationState.startY; }
  redrawAnnotations();
}
function handleMouseUp() {
  if (annotationState._draggingAnno) {
    annotationState._draggingAnno = null;
    updateCursor();
    return;
  }
  annotationState.drawing = false;
  if (annotationState.currentTool === 'pen' || annotationState.currentTool === 'rect') {
    annotationState.activeToolsContainer?.querySelectorAll('.tooltip-btn').forEach(b => b.classList.remove('active'));
    annotationState.currentTool = null;
    updateCursor();
  }
}
function updateCursor() {
  if (!annotationState.canvas) return;
  annotationState.canvas.classList.remove('pen-mode', 'rect-mode', 'text-mode', 'move-mode');
  const hasDraggable = annotationState.annotations.some(a => a.type === 'text');
  annotationState.canvas.style.pointerEvents = (annotationState.currentTool || hasDraggable) ? 'auto' : 'none';
  switch (annotationState.currentTool) {
    case 'pen':  annotationState.canvas.classList.add('pen-mode');  annotationState.canvas.style.cursor = 'crosshair'; break;
    case 'rect': annotationState.canvas.classList.add('rect-mode'); annotationState.canvas.style.cursor = 'crosshair'; break;
    case 'text': annotationState.canvas.classList.add('text-mode'); annotationState.canvas.style.cursor = 'default';   break;
    default:     annotationState.canvas.style.cursor = 'default';
  }
}

  // ─────────────────────────────────────────────────────────────────────────
  // SAVE ANNOTATIONS
  // ─────────────────────────────────────────────────────────────────────────
  function saveAnnotation() {
    if (!annotationState.mediaElement || !annotationState.canvas) return;
    const mediaEl      = annotationState.mediaElement;
    const originalPath = (mediaEl.dataset.originalPath || '').replace(/\\/g, '/');
    if (!originalPath) { if (window.Toast) Toast.error('Cannot determine file path','Error'); return; }
    const assetName     = mediaEl.dataset.assetName || '';
    const variant       = mediaEl.dataset.variant   || '';
    const mode          = mediaEl.dataset.mode      || 'Asset';
    const currentStatus = mediaEl.dataset.status    || 'No Status';
    mediaEl.tagName === 'VIDEO'
      ? saveVideoWithAnnotations(originalPath, assetName, variant, mode, currentStatus)
      : saveImageWithAnnotations(originalPath, assetName, variant, mode, currentStatus);
  }

  function saveImageWithAnnotations(originalPath, assetName, variant, mode, currentStatus) {
    const mediaEl = annotationState.mediaElement;
    const cc      = document.createElement('canvas');
    cc.width  = mediaEl.naturalWidth  || annotationState.canvas.width;
    cc.height = mediaEl.naturalHeight || annotationState.canvas.height;
    const cctx = cc.getContext('2d');
    cctx.drawImage(mediaEl, 0, 0, cc.width, cc.height);
    cctx.save();
    cctx.scale(cc.width / annotationState.canvas.width, cc.height / annotationState.canvas.height);
    annotationState.annotations.forEach(a => drawAnnotationOnContext(cctx, a));
    cctx.restore();
    cc.toBlob(blob => {
      if (!blob) { if (window.Toast) Toast.error('Failed to create image','Error'); return; }
      const reader = new FileReader();
      reader.onloadend = function () {
        const formData = new FormData();
        formData.append('image_data',      reader.result);
        formData.append('annotation_data', JSON.stringify({ currentAnnotations: annotationState.annotations, noteAnnotations: annotationState.noteState.noteAnnotations }));
        formData.append('media_path',  originalPath); formData.append('asset_name', assetName);
        formData.append('variant',     variant);      formData.append('mode',       mode);
        formData.append('status',      currentStatus);formData.append('is_video',   'false');
        if (window.Toast) Toast.info('Saving annotated image...','Processing');
        fetch('/save-annotation/', { method:'POST', body:formData, headers:{'X-CSRFToken':getCsrfToken()} })
        .then(r => r.json()).then(data => {
         if (data.success) {
  if (window.Toast) Toast.success('Image saved to feedback folder', 'Success');
  if (data.feedback_src) injectFeedbackIntoHistoryPanel(data.feedback_src, 'image');
} else {
  if (window.Toast) Toast.error(data.error || 'Failed to save', 'Error');
} }).catch(() => { if (window.Toast) Toast.error('Network error','Error'); });
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  }

  function saveVideoWithAnnotations(originalPath, assetName, variant, mode, currentStatus) {
    const mediaEl    = annotationState.mediaElement;
    if (!mediaEl.paused) mediaEl.pause();
    const fps          = VU.getFrameRate(mediaEl);
    const currentFrame = VU.getCurrentFrame(mediaEl);

    const annotationData = {
      timeRangeAnnotations: annotationState.annotations.map(a => ({
        ...a,
        timestamp:    a.timestamp || 0,
        frame:        a.frame ?? Math.round((a.timestamp || 0) * fps),
        video_x:      a.x      ? (a.x      / annotationState.canvas.width)  * 100 : undefined,
        video_y:      a.y      ? (a.y      / annotationState.canvas.height) * 100 : undefined,
        video_width:  a.width  ? (a.width  / annotationState.canvas.width)  * 100 : undefined,
        video_height: a.height ? (a.height / annotationState.canvas.height) * 100 : undefined,
        video_points: a.points ? a.points.map(p => ({
          x: (p.x / annotationState.canvas.width)  * 100,
          y: (p.y / annotationState.canvas.height) * 100,
        })) : undefined,
      })),
      noteAnnotations: annotationState.noteState.noteAnnotations,
      videoDuration: mediaEl.duration, videoWidth: mediaEl.videoWidth, videoHeight: mediaEl.videoHeight,
      frameRate: fps, totalFrames: VU.getTotalFrames(mediaEl), currentFrame,
    };

    const pc = document.createElement('canvas');
    pc.width  = mediaEl.videoWidth  || annotationState.canvas.width;
    pc.height = mediaEl.videoHeight || annotationState.canvas.height;
    const pctx = pc.getContext('2d');
    pctx.drawImage(mediaEl, 0, 0, pc.width, pc.height);
    pctx.save();
    pctx.scale(pc.width / annotationState.canvas.width, pc.height / annotationState.canvas.height);
    annotationState.annotations.forEach(a => {
      const af = a.frame ?? Math.round((a.timestamp || 0) * fps);
      if (Math.abs(currentFrame - af) <= 1) drawAnnotationOnContext(pctx, a);
    });
    pctx.restore();

    const formData = new FormData();
    formData.append('annotation_data', JSON.stringify(annotationData));
    formData.append('media_path',  originalPath); formData.append('asset_name', assetName);
    formData.append('variant',     variant);      formData.append('mode',       mode);
    formData.append('status',      currentStatus);formData.append('is_video',   'true');
    formData.append('frame_data',  pc.toDataURL('image/png'));
    if (window.Toast) Toast.info('Processing video annotations...','Please Wait');
    fetch('/save-annotation/', { method:'POST', body:formData, headers:{'X-CSRFToken':getCsrfToken()} })
    .then(r => r.json()).then(data => {
      if (data.success) {
  if (window.Toast) Toast.success('Video annotations saved', 'Success');
  if (data.feedback_src) injectFeedbackIntoHistoryPanel(data.feedback_src, 'video');
} else {
  if (window.Toast) Toast.error(data.error || 'Failed to save', 'Error');
}}).catch(() => { if (window.Toast) Toast.error('Network error','Error'); });
  }

  function drawAnnotationOnContext(ctx, anno) {
    ctx.save();
    ctx.strokeStyle = anno.color || annotationState.color;
    ctx.fillStyle   = anno.color || annotationState.color;
    ctx.lineWidth   = 3; ctx.lineCap='round'; ctx.lineJoin='round';
    if (anno.type === 'pen' && anno.points) {
      ctx.beginPath(); ctx.moveTo(anno.points[0].x, anno.points[0].y);
      for (let i=1; i<anno.points.length; i++) ctx.lineTo(anno.points[i].x, anno.points[i].y);
      ctx.stroke();
    } else if (anno.type === 'rect') {
      ctx.strokeRect(anno.x, anno.y, anno.width, anno.height);
    } else if (anno.type === 'text') {
      ctx.font = 'bold 20px Arial';
      const m = ctx.measureText(anno.text), pad=8, th=24;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(anno.x-pad, anno.y-th, m.width+pad*2, th+pad);
      ctx.strokeStyle='#000'; ctx.lineWidth=4; ctx.strokeText(anno.text, anno.x, anno.y);
      ctx.fillStyle = anno.color || annotationState.color; ctx.fillText(anno.text, anno.x, anno.y);
    }
    ctx.restore();
  }

  function getCsrfToken() {
    let v = null;
    if (document.cookie) document.cookie.split(';').forEach(c => {
      const t = c.trim();
      if (t.startsWith('csrftoken=')) v = decodeURIComponent(t.substring('csrftoken='.length));
    });
    return v;
  }

function initHistoryVersionLabels() {
  const historyPanel = document.getElementById('panelHistory');
  if (!historyPanel) return;

  const grid = historyPanel.querySelector(
    ':scope > div[style*="display: grid"], :scope > div[style*="display:grid"]'
  );
  if (!grid) return;

  // ── 1. Wrap any bare (unwrapped) cards ───────────────────────────────────
  Array.from(grid.children)
    .filter(el => !el.classList.contains('feedback-card-wrapper'))
    .forEach(card => {
      // Remove the fullscreen overlay div (contains fa-expand) if present
      card.querySelectorAll('div').forEach(div => {
        if (div.querySelector('.fa-expand, [class*="fa-expand"]')) div.remove();
      });

      const wrapper = document.createElement('div');
      wrapper.className = 'feedback-card-wrapper';
      grid.insertBefore(wrapper, card);
      wrapper.appendChild(card);
      const lbl = document.createElement('div');
      lbl.className = 'feedback-version-label';
      wrapper.appendChild(lbl);
    });

  const wrappers = Array.from(grid.querySelectorAll(':scope > .feedback-card-wrapper'));
  if (!wrappers.length) return;

  // ── 2. Reverse DOM so Django's last child (newest) becomes first ──────────
  //    Only do this ONCE — guard with a flag on the grid element
  if (!grid.dataset.versionsInitialized) {
    wrappers.reverse().forEach(w => grid.appendChild(w));
    grid.dataset.versionsInitialized = 'true';
  }

  // ── 3. Number top → bottom: top card = vTotal (newest), bottom = v1 ──────
  //    Hide labels entirely when there is only one item.
  const all = Array.from(grid.querySelectorAll(':scope > .feedback-card-wrapper'));
  const total = all.length;
  all.forEach((wrapper, idx) => {
    const version = total - idx;
    const lbl = wrapper.querySelector('.feedback-version-label');
    if (!lbl) return;
    if (total === 1) {
      lbl.style.display = 'none';
    } else {
      lbl.style.display = '';
      lbl.innerHTML = `<i class="fas fa-layer-group"></i> v${version}`;
    }
  });
}

// ── Run on page load ──────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHistoryVersionLabels);
} else {
  setTimeout(initHistoryVersionLabels, 0);
}

// ── Re-run after HTMX swaps (e.g. switching asset) ───────────────────────────
document.addEventListener('htmx:afterSwap', (evt) => {
  if (evt.detail.target.id === 'previewCard') {
    setTimeout(initHistoryVersionLabels, 120);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// injectFeedbackIntoHistoryPanel
// Prepends a newly saved card and re-numbers ALL wrappers to stay in sync.
// ─────────────────────────────────────────────────────────────────────────────

function injectFeedbackIntoHistoryPanel(src, mediaType) {
  const historyPanel = document.getElementById('panelHistory');
  if (!historyPanel) return;

  const emptyState = historyPanel.querySelector('.empty-media, .empty-state');
  if (emptyState) {
    const mc = emptyState.closest('.media-container');
    mc ? mc.remove() : emptyState.remove();
  }

  let grid = historyPanel.querySelector(
    ':scope > div[style*="display: grid"], :scope > div[style*="display:grid"]'
  );
  if (!grid) {
    grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
      gap: 6px;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      align-content: start;
    `;
    // Mark as already initialized so initHistoryVersionLabels won't reverse again
    grid.dataset.versionsInitialized = 'true';
    historyPanel.appendChild(grid);
  }

  const existingCount = grid.children.length;
  const newTotal      = existingCount + 1;

  // ── Build media card ──────────────────────────────────────────────────────
  const card = document.createElement('div');

  if (mediaType === 'video') {
    card.style.cssText = `
      position: relative; aspect-ratio: 16/9; background: #000;
      border-radius: 6px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      transition: border-color 0.2s, box-shadow 0.2s;
    `;
    card.innerHTML = `
      <video controls preload="metadata" playsinline webkit-playsinline
        style="width:100%;height:100%;display:block;">
        <source src="${src}" type="video/mp4"/>
      </video>
    `;
  } else {
    card.style.cssText = `
      position: relative; aspect-ratio: 16/9; background: #000;
      border-radius: 6px; overflow: hidden; cursor: pointer;
      border: 1px solid rgba(255,255,255,0.08);
      transition: border-color 0.2s, box-shadow 0.2s;
    `;
    card.title = 'Click to view fullscreen';
    card.innerHTML = `
      <img src="${src}" alt="Feedback" loading="lazy"
        style="width:100%;height:100%;display:block;"/>
    `;
    card.addEventListener('mouseover', () => {
      card.style.borderColor = 'rgba(192,38,211,0.55)';
      card.style.boxShadow   = '0 0 0 1px rgba(192,38,211,0.3)';
    });
    card.addEventListener('mouseout', () => {
      card.style.borderColor = 'rgba(255,255,255,0.08)';
      card.style.boxShadow   = 'none';
    });
    card.addEventListener('click', () => {
      const img = card.querySelector('img');
      if (img) window.openFullscreen(img);
    });
  }

  // ── Wrapper + label ───────────────────────────────────────────────────────
  const versionLabel = document.createElement('div');
  versionLabel.className = 'feedback-version-label';

  const cardWrapper = document.createElement('div');
  cardWrapper.className = 'feedback-card-wrapper';
  cardWrapper.appendChild(card);
  cardWrapper.appendChild(versionLabel);

  // Prepend — newest always at top
  grid.insertBefore(cardWrapper, grid.firstChild);

  // ── Re-number ALL wrappers: top = vNewTotal … bottom = v1 ────────────────
  //    Hide labels entirely when there is only one item.
  Array.from(grid.querySelectorAll(':scope > .feedback-card-wrapper')).forEach((w, idx) => {
    const lbl = w.querySelector('.feedback-version-label');
    if (!lbl) return;
    if (newTotal === 1) {
      lbl.style.display = 'none';
    } else {
      lbl.style.display = '';
      lbl.innerHTML = `<i class="fas fa-layer-group"></i> v${newTotal - idx}`;
    }
  });

  // ── Grid layout ───────────────────────────────────────────────────────────
  if (newTotal === 1) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows   = '1fr';
    grid.style.height              = '100%';
    grid.style.overflow            = 'hidden';
    grid.style.paddingTop          = '0';
    grid.style.paddingBottom       = '0';
    cardWrapper.style.height       = '100%';
    cardWrapper.style.overflow     = 'hidden';
    cardWrapper.style.minHeight    = '0';
    card.style.aspectRatio         = 'unset';
    card.style.height              = '100%';
    card.style.maxHeight           = '100%';
    card.style.overflow            = 'hidden';
  } else {
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.style.gridTemplateRows   = 'auto';
    grid.style.height              = 'auto';
    grid.style.overflow            = 'visible';
    grid.style.paddingTop          = '8px';
    grid.style.paddingBottom       = '8px';
    grid.style.boxSizing           = 'border-box';

    if (existingCount === 1) {
      const prevWrapper = grid.children[1];
      if (prevWrapper) {
        prevWrapper.style.height    = '';
        prevWrapper.style.maxHeight = '';
        prevWrapper.style.overflow  = 'hidden';
        const prevCard = prevWrapper.querySelector('div');
        if (prevCard) {
          prevCard.style.height      = '';
          prevCard.style.maxHeight   = '';
          prevCard.style.aspectRatio = '16/9';
        }
      }
    }
  }

  // ── History tab badge ─────────────────────────────────────────────────────
  const badge = document.querySelector('.history-tab-badge');
  if (badge) {
    badge.textContent = parseInt(badge.textContent || '0') + 1;
  } else {
    const histTab = document.getElementById('tabHistory');
    if (histTab) {
      const newBadge = document.createElement('span');
      newBadge.className   = 'history-tab-badge';
      newBadge.textContent = '1';
      histTab.appendChild(newBadge);
    }
  }

  if (typeof switchPreviewTab === 'function') switchPreviewTab('history');
}
 // KEYBOARD SHORTCUTS
  // ─────────────────────────────────────────────────────────────────────────
  function handleKeyboardShortcuts(e) {
    if (!annotationState.isFullscreen)          return;
    if (annotationState.textareaFocused)         return;
    if (document.activeElement?.id === 'speedSelect') return;
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

    const container = window._fullscreenContainer;
    const tc        = annotationState.activeToolsContainer;

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        if (annotationState.mediaElement?.tagName === 'VIDEO') {
          e.preventDefault(); e.stopPropagation();
          container?.querySelector('#playPauseBtn')?.click();
        }
        return;

      case 'ArrowLeft': case ',': case 'j': case 'J':
        e.preventDefault(); container?._seekFrame?.(-1); return;

      case 'ArrowRight': case '.': case 'l': case 'L':
        e.preventDefault(); container?._seekFrame?.(1); return;

      case 'o': case 'O':
        e.preventDefault();
        if (container?._setLoop && container?._getLoopEnabled) {
          container._setLoop(!container._getLoopEnabled());
        }
        return;
    }

    if (!tc) return;

    switch (e.key) {
      case 'p': case 'P': e.preventDefault(); tc.querySelector('[data-tool="pen"]')?.click(); break;
      case 'r': case 'R': e.preventDefault(); tc.querySelector('[data-tool="rect"]')?.click(); break;
      case 't': case 'T': e.preventDefault(); tc.querySelector('[data-tool="text"]')?.click(); break;
      case 'c': case 'C': if (!e.ctrlKey) { e.preventDefault(); tc.querySelector('#fsColorPicker')?.click(); } break;}

    if (e.ctrlKey && e.key === 's') { e.preventDefault(); e.stopPropagation(); saveAnnotation(); return; }

    if (e.key === 'Delete') {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (annotationState.annotations.length) {
  annotationState.annotations = [];
  annotationState.noteState.noteAnnotations = [];
  redrawAnnotations();
}
      return;
    }

    if (e.key === 'Escape') {
      const modal = annotationState.activeTextModal;
      if (!modal || modal.classList.contains('hidden')) _minimizeAnnotator();
      return;
    }

    if (e.ctrlKey && e.key === 'Enter') {
      const modal = annotationState.activeTextModal;
      if (modal && !modal.classList.contains('hidden')) { e.preventDefault(); modal.querySelector('#textInputConfirm')?.click(); }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────────────
  function cleanupFullscreen() {
    _removeCSSFullscreen(window._fullscreenContainer);

    annotationState.modalInitialized = false;
    annotationState.activeTextModal  = null;

    if (annotationState.videoEventListeners && annotationState.mediaElement) {
      annotationState.videoEventListeners.forEach(({ event, listener }) => {
        try { annotationState.mediaElement.removeEventListener(event, listener); } catch (_) {}
      });
      annotationState.videoEventListeners = [];
    }

    if (annotationState._createdVideojsForFullscreen && annotationState.videojsPlayer) {
      try {
        const fsPlayer    = annotationState.videojsPlayer;
        const restoreInfo = annotationState.mediaElement?._restoreInfo;
        let lastTime = 0, wasPlaying = false;
        try { lastTime = fsPlayer.currentTime() || 0; wasPlaying = !fsPlayer.paused(); } catch (_) {}
        if (typeof fsPlayer.dispose === 'function') fsPlayer.dispose();
        if (restoreInfo?.originalElement) {
          const orig = restoreInfo.originalElement;
          setTimeout(() => {
            try {
              if (window.previewVideoPlayer && typeof window.previewVideoPlayer.currentTime === 'function') {
                window.previewVideoPlayer.currentTime(lastTime);
                if (wasPlaying) window.previewVideoPlayer.play().catch(() => {});
              } else {
                orig.currentTime = lastTime;
                if (wasPlaying) orig.play().catch(() => {});
              }
            } catch (_) {}
          }, 150);
        }
      } catch (e) { console.warn('Error disposing fullscreen VJS:', e); }
      annotationState._createdVideojsForFullscreen = false;
    }

    Object.assign(annotationState, {
  isFullscreen: false, currentTool: null, annotations: [],
  canvas: null, ctx: null, activeToolsContainer: null, activeTextModal: null,
  mediaElement: null, videojsPlayer: null,
  _draggingAnno: null, _dragOffsetX: 0, _dragOffsetY: 0,
});
    if (annotationState.noteState) {
      Object.assign(annotationState.noteState, { pendingTextPosition:null, editingAnnotationId:null, wasPlayingBeforeNote:false });
    }

    document.removeEventListener('keydown', handleKeyboardShortcuts);
    window.removeEventListener('resize', resizeCanvas);

    if (window._fullscreenContainer) { window._fullscreenContainer.remove(); delete window._fullscreenContainer; }
    document.querySelectorAll('.pa-fullscreen-container').forEach(el => el.remove());

    const t1 = document.getElementById('fullscreenAnnotationTools');
    if (t1) { t1.classList.add('hidden'); t1.style.display='none'; }
    const t2 = document.getElementById('textInputModal');
    if (t2) { t2.classList.add('hidden'); t2.style.display='none'; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PILL
  // ─────────────────────────────────────────────────────────────────────────
  function _rebuildPill() {
  const existing = document.getElementById('paMiniPill');
  if (existing) existing.remove();
  if (_miniPill) {
    if (typeof _miniPill._destroyDrag === 'function') _miniPill._destroyDrag();
    _miniPill = null;
  }

  // Check if current media is a video
  const isVideo = annotationState.mediaElement?.tagName === 'VIDEO';

  const pill = document.createElement('div');
  pill.id = 'paMiniPill';
  pill.innerHTML = `
    <div class="pa-pill-icon"><i class="fas fa-eye"></i></div>
    <div class="pa-pill-info">
      <div class="pa-pill-title">${_pillMeta.label}</div>
      <div class="pa-pill-sub">Paused · click to restore</div>
    </div>
    <div class="pa-pill-actions">
      ${isVideo ? `
        <button class="pa-pill-mini" id="paPillMiniBtn" title="Mini preview">
          <i class="fas fa-clone"></i>
        </button>
      ` : ''}
      <button class="pa-pill-restore" id="paPillRestoreBtn" title="Restore fullscreen">
        <i class="fas fa-expand"></i>
      </button>
      <button class="pa-pill-close" id="paPillCloseBtn" title="Close">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  document.body.appendChild(pill);
  _miniPill = pill;

  pill.addEventListener('click', e => {
    if (e.target.closest('#paPillRestoreBtn') || e.target.closest('#paPillCloseBtn')) return;
    if (pill._wasDragged) { pill._wasDragged = false; return; }
    _restoreAnnotator();
  });

  // Only add mini button event listener if it exists
  const miniBtn = pill.querySelector('#paPillMiniBtn');
  if (miniBtn) {
    miniBtn.addEventListener('click', e => {
      e.stopPropagation();
      const sources = annotationState._fullscreenSources || [];
      let curTime = 0;
      try {
        const p = annotationState.videojsPlayer;
        curTime = p && typeof p.currentTime === 'function'
          ? p.currentTime()
          : (annotationState.mediaElement?.currentTime || 0);
      } catch (_) {}
      _removePill();
      _createPaMiniPlayer(sources, curTime, _pillMeta.label);
    });
  }

  pill.querySelector('#paPillRestoreBtn').addEventListener('click', e => {
    e.stopPropagation();
    _restoreAnnotator();
  });

  pill.querySelector('#paPillCloseBtn').addEventListener('click', e => {
    e.stopPropagation(); _hardDestroyAnnotator();
  });

  // ── Pill drag (left/top coordinate system) ────────────────────────────
  let isDragging = false, dragStartX = 0, dragStartY = 0;
  let baseLeft = 0, baseTop = 0;
  const DRAG_THRESHOLD = 4;
  let movedDistance = 0;

  pill.addEventListener('mousedown', e => {
    if (e.target.closest('.pa-pill-actions')) return;
    isDragging    = true;
    movedDistance = 0;
    pill._wasDragged = false;
    dragStartX = e.clientX; dragStartY = e.clientY;
    const rect = pill.getBoundingClientRect();
    baseLeft   = rect.left; baseTop    = rect.top;
    pill.style.right  = 'auto';
    pill.style.bottom = 'auto';
    pill.style.left   = baseLeft + 'px';
    pill.style.top    = baseTop  + 'px';
    e.preventDefault();
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    movedDistance = Math.max(movedDistance, Math.abs(dx) + Math.abs(dy));
    if (movedDistance > DRAG_THRESHOLD) { pill.classList.add('pill-dragging'); pill._wasDragged = true; }
    pill.style.left = Math.max(8, Math.min(baseLeft + dx, window.innerWidth  - pill.offsetWidth  - 8)) + 'px';
    pill.style.top  = Math.max(8, Math.min(baseTop  + dy, window.innerHeight - pill.offsetHeight - 8)) + 'px';
  }
  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    pill.classList.remove('pill-dragging');
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  pill._destroyDrag = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  };
}
  function _removePill() {
    document.querySelectorAll('#paMiniPill').forEach(el => el.remove());
    if (_miniPill) {
      if (typeof _miniPill._destroyDrag === 'function') _miniPill._destroyDrag();
      _miniPill = null;
    }
  }

  function _minimizeAnnotator() {
    const container = window._fullscreenContainer;
    if (!container) return;
    if (document.getElementById('paMiniPill')) return;

    fsGuard.active = true;

    const doMinimize = () => {
      const p = annotationState.videojsPlayer;
      try { p && typeof p.pause === 'function' ? p.pause() : annotationState.mediaElement?.pause(); } catch (_) {}
      container.style.display = 'none';
      fsGuard.active = false;
      _rebuildPill();
    };

    // Only call exitFullscreen if native fullscreen is actually active
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      VU.exitFullscreen(doMinimize);
    } else {
      doMinimize();
    }
  }

  function _restoreAnnotator() {
    const origEl = window._miniPlayerOriginalElement;
    if (!origEl) return;

    let curTime = 0, wasPlaying = false;
    try {
      const p = annotationState.videojsPlayer;
      curTime    = p && typeof p.currentTime === 'function' ? p.currentTime() : (annotationState.mediaElement?.currentTime || 0);
      wasPlaying = p && typeof p.paused    === 'function' ? !p.paused()      : !(annotationState.mediaElement?.paused ?? true);
    } catch (_) {}

    _removePill();

    try {
      if (window.previewVideoPlayer && typeof window.previewVideoPlayer.currentTime === 'function') {
        window.previewVideoPlayer.currentTime(curTime);
        if (!wasPlaying) window.previewVideoPlayer.pause();
      } else if (origEl.currentTime !== undefined) {
        origEl.currentTime = curTime;
      }
    } catch (_) {}

    closeFullscreen();
    setTimeout(() => window.openFullscreen(origEl), 80);
  }

  function _hardDestroyAnnotator() {
    _removePill();
    closeFullscreen();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLOSE FULLSCREEN
  // ─────────────────────────────────────────────────────────────────────────
  function closeFullscreen() {
    fsGuard.active = true;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    const doClean = () => { fsGuard.active = false; cleanupFullscreen(); };
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      VU.exitFullscreen(doClean);
    } else {
      doClean();
    }
  }

  // Registered once via VU.onFullscreenChange — no manual event loop needed.
  VU.onFullscreenChange(function () {
    if (fsGuard.active) return;
    if (!VU.isInFullscreen() && window._fullscreenContainer) {
      requestAnimationFrame(() => {
        if (fsGuard.active) return;
        _minimizeAnnotator();
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PREVIEW PLAYER (standard page-level Video.js instance)
  // ─────────────────────────────────────────────────────────────────────────
  (function () {
    let previewPlayer = null;

    function initPreviewVideoJS() {
      const videoEl = document.getElementById('pvVideo');
      if (!videoEl || typeof videojs === 'undefined') return;
      try {
        if (previewPlayer) { try { previewPlayer.dispose(); } catch (_) {} }
        previewPlayer = videojs(videoEl, {
          controls: true, preload: 'metadata', fluid: true, responsive: true,
          controlBar: { volumePanel:{ inline:false }, remainingTimeDisplay:true, pictureInPictureToggle:true, fullscreenToggle:true },
          playbackRates: [0.25, 0.5, 1, 1.25, 1.5, 2],
          userActions: { doubleClick: false, click: false },
        });

        const wrapper = videoEl.parentElement;
        if (wrapper) {
          wrapper.style.cursor = 'pointer';
          if (wrapper._fsClickHandler) wrapper.removeEventListener('click', wrapper._fsClickHandler);
          const clickHandler = function (e) {
            if (e.target.closest('.vjs-control-bar,.vjs-big-play-button,.vjs-progress-control,.vjs-slider,.vjs-play-progress,.vjs-load-progress,.vjs-volume-panel,.vjs-control,.vjs-play-control,.vjs-pause-control,.vjs-current-time,.vjs-time-divider,.vjs-duration,.vjs-remaining-time,.vjs-playback-rate,.vjs-mute-control,.vjs-volume-control,.vjs-fullscreen-control')) return;
            e.preventDefault(); e.stopPropagation();
            videoEl.paused ? videoEl.play().catch(() => {}) : videoEl.pause();
          };
          wrapper._fsClickHandler = clickHandler;
          wrapper.addEventListener('click', clickHandler);
        }

        previewPlayer.ready(() => {
          const fsBtn = previewPlayer.controlBar.getChild('fullscreenToggle');
          if (fsBtn) {
            fsBtn.off('click');
            fsBtn.on('click', (e) => { e.preventDefault(); e.stopPropagation(); window.openFullscreen(videoEl); });
          }
          previewPlayer.requestFullscreen = () => { window.openFullscreen(videoEl); return Promise.resolve(); };
          previewPlayer.exitFullscreen    = () => document.exitFullscreen ? document.exitFullscreen() : Promise.resolve();

          try {
            const Button = videojs.getComponent('Button');
            class RewindButton extends Button {
              constructor(p, o) { super(p, o); this.controlText('Previous frame'); this.el().title='Previous frame'; this.el().innerHTML='<span class="vjs-icon-placeholder"><i class="fas fa-backward"></i></span>'; }
              handleClick() { const fps = VU.getFrameRate(this.player().el()); this.player().currentTime(Math.max(0, this.player().currentTime() - 1/fps)); }
            }
            class ForwardButton extends Button {
              constructor(p, o) { super(p, o); this.controlText('Next frame'); this.el().title='Next frame'; this.el().innerHTML='<span class="vjs-icon-placeholder"><i class="fas fa-forward"></i></span>'; }
              handleClick() { const fps = VU.getFrameRate(this.player().el()); const dur = this.player().duration() || Infinity; this.player().currentTime(Math.min(dur, this.player().currentTime() + 1/fps)); }
            }
            videojs.registerComponent('RewindButton',  RewindButton);
            videojs.registerComponent('ForwardButton', ForwardButton);
            const rw = previewPlayer.controlBar.addChild('RewindButton',  {});
            const fw = previewPlayer.controlBar.addChild('ForwardButton', {});
            const pt = previewPlayer.controlBar.getChild('playToggle');
            if (pt && rw?.el() && fw?.el()) {
              pt.el().parentNode.insertBefore(rw.el(), pt.el());
              pt.el().parentNode.insertBefore(fw.el(), pt.el().nextSibling);
            }
          } catch (e) { console.warn('Skip buttons failed:', e); }
        });

        videoEl.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); });
        videoEl.addEventListener('keydown',  (e) => { if (e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopPropagation(); window.openFullscreen(videoEl); } });
        window.previewVideoPlayer = previewPlayer;
      } catch (err) { console.error('Failed to init preview VJS:', err); }
    }

    function cleanupPreviewPlayer() { if (previewPlayer) { try { previewPlayer.dispose(); } catch (_) {} previewPlayer = null; } }

    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', initPreviewVideoJS)
      : setTimeout(initPreviewVideoJS, 100);

    document.addEventListener('htmx:afterSwap', (evt) => {
      if (evt.detail.target.id === 'previewCard') setTimeout(initPreviewVideoJS, 100);
    });
    window.addEventListener('beforeunload', cleanupPreviewPlayer);
  })();

  // Global 'f' key shortcut to open fullscreen from anywhere on the page.
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const target = document.getElementById('pvVideo')
        || document.getElementById('pvImage')
        || document.getElementById('pvDocument')
        || document.getElementById('pvEmbed');
      if (target) window.openFullscreen(target);
    }
  });

})();