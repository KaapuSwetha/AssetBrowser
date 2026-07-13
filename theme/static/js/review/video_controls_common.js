/**
 * video_controls_common.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared utilities consumed by:
 *   • sequence_branch.js
 *   • preview_annotator.js
 *   • asset_rows.js
 *
 * Exposes one global namespace:  window.VideoUtils
 *
 * SECTIONS
 *   A.  Fullscreen helpers
 *   B.  Drag helper
 *   C.  Resize helper
 *   D.  Mini-player factory
 *   E.  Floating pill factory
 *   F.  Video playback utilities
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // A.  FULLSCREEN HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.mozFullScreenElement || document.msFullscreenElement || null;
  }

  function isInFullscreen() { return !!getFullscreenElement(); }

  /**
   * Request native fullscreen on `el`, then call `afterFn()`.
   * Never rejects — always calls afterFn so callers need no error path.
   */
  function enterFullscreen(el, afterFn) {
    afterFn = afterFn || function () {};
    var req = el.requestFullscreen || el.webkitRequestFullscreen ||
              el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!req) { afterFn(); return; }
    var p = req.call(el);
    if (p && typeof p.then === 'function') {
      p.then(afterFn).catch(function (err) { console.warn('[VideoUtils] FS error:', err); afterFn(); });
    } else { afterFn(); }
  }

  /**
   * Exit native fullscreen if active, then call `afterFn()`.
   * Safe to call when not in fullscreen.
   */
  function exitFullscreen(afterFn) {
    afterFn = afterFn || function () {};
    var fn = document.exitFullscreen || document.webkitExitFullscreen ||
             document.mozCancelFullScreen || document.msExitFullscreen;
    if (!fn || !isInFullscreen()) { afterFn(); return; }
    var p = fn.call(document);
    if (p && typeof p.then === 'function') p.then(afterFn).catch(function () { afterFn(); });
    else afterFn();
  }

  /**
   * Listen for any cross-vendor fullscreenchange event.
   * @returns {Function} cleanup — call to remove all listeners.
   */
  function onFullscreenChange(handler) {
    var evts = ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange'];
    evts.forEach(function (ev) { document.addEventListener(ev, handler); });
    return function () { evts.forEach(function (ev) { document.removeEventListener(ev, handler); }); };
  }

  /**
   * Suppress-flag guard for programmatic FS enter/exit.
   *
   * Usage:
   *   const fsGuard = VideoUtils.createFsGuard();
   *   fsGuard.run(done => exitFullscreen(() => { doWork(); done(); }));
   *   // inside fullscreenchange: if (fsGuard.active) return;
   */
  function createFsGuard() {
    var g = { active: false };
    g.run = function (fn) { g.active = true; fn(function () { g.active = false; }); };
    return g;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // B.  DRAG HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Makes `el` draggable via `handleEl`.  Positions with left/top (removes
   * right/bottom).  Enforces 8 px viewport margin.
   *
   * @param {HTMLElement} el
   * @param {HTMLElement} handleEl
   * @param {object}     [opts]
   * @param {number}     [opts.threshold=4]        Pixels before drag is recognised.
   * @param {string}     [opts.draggingClass]       CSS class added while dragging.
   * @param {string}     [opts.excludeSelector]     Clicks matching this target skip drag.
   * @param {Function}   [opts.onDragStart]
   * @param {Function}   [opts.onDragEnd]           Receives (wasDragged: boolean).
   * @returns {{ destroy, wasDragged (getter), resetDragged }}
   */
  function makeDraggable(el, handleEl, opts) {
    opts = opts || {};
    var threshold     = opts.threshold    || 4;
    var draggingClass = opts.draggingClass || '';
    var isDragging    = false;
    var startX = 0, startY = 0, baseLeft = 0, baseTop = 0, moved = 0;
    var _wasDragged   = false;

    function onDown(e) {
      if (opts.excludeSelector && e.target.closest(opts.excludeSelector)) return;
      isDragging = true; _wasDragged = false; moved = 0;
      startX = e.clientX; startY = e.clientY;
      var rect = el.getBoundingClientRect();
      baseLeft = rect.left; baseTop = rect.top;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left  = baseLeft + 'px'; el.style.top = baseTop + 'px';
      if (opts.onDragStart) opts.onDragStart();
      e.preventDefault();
    }
    function onMove(e) {
      if (!isDragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      if (moved > threshold) { _wasDragged = true; if (draggingClass) el.classList.add(draggingClass); }
      var m = 8;
      el.style.left = Math.max(m, Math.min(baseLeft + dx, window.innerWidth  - el.offsetWidth  - m)) + 'px';
      el.style.top  = Math.max(m, Math.min(baseTop  + dy, window.innerHeight - el.offsetHeight - m)) + 'px';
    }
    function onUp() {
      if (!isDragging) return;
      isDragging = false;
      if (draggingClass) el.classList.remove(draggingClass);
      if (opts.onDragEnd) opts.onDragEnd(_wasDragged);
    }

    handleEl.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    return {
      get wasDragged()  { return _wasDragged; },
      resetDragged()    { _wasDragged = false; },
      destroy() {
        handleEl.removeEventListener('mousedown', onDown);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      },
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // C.  RESIZE HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Wires 8-directional resize handles inside `el`.
   * The element must already be positioned with right/bottom.
   *
   * @param {HTMLElement} el
   * @param {object}     [opts]
   * @param {number}     [opts.minW=200]
   * @param {number}     [opts.minH=150]
   * @param {string}     [opts.resizingClass]
   * @param {string}     [opts.handleSelector]  Defaults to all three resize-handle classes.
   * @returns {{ destroy }}
   */
  function makeResizable(el, opts) {
    opts = opts || {};
    var minW = opts.minW || 200, minH = opts.minH || 150;
    var resizingClass = opts.resizingClass || '';
    var selector = opts.handleSelector ||
      '.seq-resize-handle, .mini-resize-handle, .cmp-resize-handle';

    var isResizing = false, resizeDir = '', startX = 0, startY = 0;
    var initW = 0, initH = 0, initR = 0, initB = 0;
    var cleanups = [];

    el.querySelectorAll(selector).forEach(function (handle) {
      function onDown(e) {
        e.stopPropagation(); e.preventDefault();
        isResizing = true; resizeDir = handle.dataset.dir;
        startX = e.clientX; startY = e.clientY;
        var rect = el.getBoundingClientRect();
        initW = rect.width; initH = rect.height;
        initR = window.innerWidth  - rect.right;
        initB = window.innerHeight - rect.bottom;
        if (resizingClass) el.classList.add(resizingClass);
        el.style.right  = initR + 'px'; el.style.bottom = initB + 'px';
        el.style.width  = initW + 'px'; el.style.height = initH + 'px';
      }
      handle.addEventListener('mousedown', onDown);
      cleanups.push(function () { handle.removeEventListener('mousedown', onDown); });
    });

    function onMove(e) {
      if (!isResizing) return;
      var dx = e.clientX - startX, dy = e.clientY - startY, dir = resizeDir;
      var nW = initW, nH = initH, nR = initR, nB = initB, d;
      if (dir.includes('e')) nW = Math.max(minW, initW + dx);
      if (dir.includes('w')) { d = Math.min(dx, initW - minW); nW = initW - d; nR = initR + d; }
      if (dir.includes('s')) nH = Math.max(minH, initH + dy);
      if (dir.includes('n')) { d = Math.min(dy, initH - minH); nH = initH - d; nB = initB + d; }
      nW = Math.min(nW, window.innerWidth  - nR - 8); nH = Math.min(nH, window.innerHeight - nB - 8);
      el.style.width  = Math.max(minW, nW) + 'px'; el.style.height = Math.max(minH, nH) + 'px';
      el.style.right  = Math.max(8, nR)    + 'px'; el.style.bottom = Math.max(8, nB)    + 'px';
    }
    function onUp() {
      if (!isResizing) return;
      isResizing = false;
      if (resizingClass) el.classList.remove(resizingClass);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    return {
      destroy() {
        cleanups.forEach(function (fn) { fn(); });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      },
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // D.  MINI-PLAYER FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build and mount a floating mini player.
   *
   * @param {object} cfg
   * @param {string}   cfg.id               DOM id for the root element.
   * @param {string}  [cfg.labelText]        Badge label text.
   * @param {string}  [cfg.visibleClass]     CSS class applied after mount (show transition).
   * @param {string}  [cfg.draggingClass]
   * @param {string}  [cfg.resizingClass]
   * @param {string}  [cfg.handlePrefix='seq']   Prefix for resize-handle CSS class.
   * @param {string}  [cfg.innerIdPrefix]         Prefix for inner element IDs (default = cfg.id).
   * @param {number}  [cfg.minW=200]
   * @param {number}  [cfg.minH=150]
   * @param {Function} cfg.buildPanels       (panelsEl) → { primaryVideo, allVideos[] }
   * @param {Function}[cfg.onExpand]         (currentTime, wasPlaying) called on expand click.
   * @param {Function}[cfg.onClose]          Called on close click (after destroy).
   *
   * @returns {{ el: HTMLElement, destroy: function }}
   */
  function createMiniPlayer(cfg) {
    var existing = document.getElementById(cfg.id);
    if (existing) existing.remove();

    var pfx  = cfg.innerIdPrefix || cfg.id;
    var hcls = (cfg.handlePrefix || 'seq') + '-resize-handle';
    var minW = cfg.minW || 200, minH = cfg.minH || 150;

    var el = document.createElement('div');
    el.id  = cfg.id;
    el.innerHTML = [
      '<div class="' + hcls + '" data-dir="n"></div>',
      '<div class="' + hcls + '" data-dir="s"></div>',
      '<div class="' + hcls + '" data-dir="e"></div>',
      '<div class="' + hcls + '" data-dir="w"></div>',
      '<div class="' + hcls + '" data-dir="nw"></div>',
      '<div class="' + hcls + '" data-dir="ne"></div>',
      '<div class="' + hcls + '" data-dir="sw"></div>',
      '<div class="' + hcls + '" data-dir="se"></div>',
      '<div id="' + pfx + 'Inner">',
        '<div id="' + pfx + 'DragHandle"></div>',
        '<div id="' + pfx + 'Label">' + (cfg.labelText || 'Mini Preview') + '</div>',
        '<div id="' + pfx + 'VideoWrap">',
          '<div id="' + pfx + 'Progress"><div id="' + pfx + 'ProgressFill"></div></div>',
          '<div id="' + pfx + 'Panels"></div>',
          '<div id="' + pfx + 'Overlay">',
            '<div id="' + pfx + 'PlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>',
          '</div>',
        '</div>',
        '<div id="' + pfx + 'Controls">',
          '<button id="' + pfx + 'PlayBtn"><i id="' + pfx + 'PlayBtnIcon" class="fas fa-pause"></i></button>',
          '<span   id="' + pfx + 'Time">0:00 / 0:00</span>',
          '<button id="' + pfx + 'VolBtn"><i id="' + pfx + 'VolIcon" class="fas fa-volume-up"></i></button>',
          '<button id="' + pfx + 'ExpandBtn"><i class="fas fa-expand"></i></button>',
          '<button id="' + pfx + 'CloseBtn"><i class="fas fa-times"></i></button>',
        '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(el);

    var panelsEl     = el.querySelector('#' + pfx + 'Panels');
    var videoWrap    = el.querySelector('#' + pfx + 'VideoWrap');
    var playBtn      = el.querySelector('#' + pfx + 'PlayBtn');
    var playBtnIcon  = el.querySelector('#' + pfx + 'PlayBtnIcon');
    var volBtn       = el.querySelector('#' + pfx + 'VolBtn');
    var volIconEl    = el.querySelector('#' + pfx + 'VolIcon');
    var expandBtn    = el.querySelector('#' + pfx + 'ExpandBtn');
    var closeBtn     = el.querySelector('#' + pfx + 'CloseBtn');
    var timeEl       = el.querySelector('#' + pfx + 'Time');
    var progressFill = el.querySelector('#' + pfx + 'ProgressFill');
    var dragHandle   = el.querySelector('#' + pfx + 'DragHandle');

    // Panels div fills the video wrap area
    Object.assign(panelsEl.style, { position: 'absolute', inset: '0', overflow: 'hidden' });

    // Caller creates and returns media elements
    var built        = cfg.buildPanels(panelsEl);
    var primaryVideo = built.primaryVideo;
    var allVideos    = built.allVideos || [];

    function syncOthers(t) {
      allVideos.forEach(function (v) {
        if (v !== primaryVideo && v && v.tagName === 'VIDEO' && Math.abs(v.currentTime - t) > 0.15)
          v.currentTime = t;
      });
    }

    function updateTime() {
      if (!primaryVideo) return;
      var cur = primaryVideo.currentTime || 0, dur = primaryVideo.duration || 0;
      timeEl.textContent       = fmtTime(cur) + ' / ' + fmtTime(dur);
      progressFill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
      playBtnIcon.className    = primaryVideo.paused ? 'fas fa-play' : 'fas fa-pause';
      var pi = el.querySelector('#' + pfx + 'PlayIcon i');
      if (pi) { pi.className = primaryVideo.paused ? 'fas fa-play' : 'fas fa-pause'; pi.style.marginLeft = primaryVideo.paused ? '2px' : '0'; }
      syncOthers(primaryVideo.currentTime);
    }

    if (primaryVideo) {
      primaryVideo.addEventListener('timeupdate', updateTime);
      primaryVideo.addEventListener('play',  function () {
        playBtnIcon.className = 'fas fa-pause';
        allVideos.forEach(function (v) { if (v !== primaryVideo && v) v.play().catch(function () {}); });
      });
      primaryVideo.addEventListener('pause', function () {
        playBtnIcon.className = 'fas fa-play';
        allVideos.forEach(function (v) { if (v !== primaryVideo && v) v.pause(); });
      });
      primaryVideo.addEventListener('seeked', function () { syncOthers(primaryVideo.currentTime); });
    }

    function togglePlay() {
      if (!primaryVideo) return;
      if (primaryVideo.paused) {
        primaryVideo.play().catch(function () {});
        allVideos.forEach(function (v) { if (v !== primaryVideo && v) v.play().catch(function () {}); });
      } else {
        primaryVideo.pause();
        allVideos.forEach(function (v) { if (v !== primaryVideo && v) v.pause(); });
      }
    }

    videoWrap.addEventListener('click', function (e) { if (e.target === dragHandle) return; togglePlay(); });
    playBtn.addEventListener('click',   function (e) { e.stopPropagation(); togglePlay(); });

    createVolumeController({
      getPrimary: function () { return primaryVideo ? [primaryVideo] : []; },
      slider: null, muteBtn: volBtn, volIcon: volIconEl,
    });

    // Expand: pass current time AND wasPlaying so callers can restore play state
    expandBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var ct         = primaryVideo ? primaryVideo.currentTime : 0;
      var wasPlaying = primaryVideo ? !primaryVideo.paused     : false;
      destroy();
      if (cfg.onExpand) cfg.onExpand(ct, wasPlaying);
    });

    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      destroy();
      if (cfg.onClose) cfg.onClose();
    });

    var dragger = makeDraggable(el, dragHandle, { draggingClass: cfg.draggingClass || '' });
    var resizer = makeResizable(el, { minW: minW, minH: minH, resizingClass: cfg.resizingClass || '', handleSelector: '.' + hcls });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { if (cfg.visibleClass) el.classList.add(cfg.visibleClass); });
    });

    function destroy() {
      dragger.destroy();
      resizer.destroy();
      allVideos.forEach(function (v) { if (v) { v.pause(); v.src = ''; } });
      if (cfg.visibleClass) el.classList.remove(cfg.visibleClass);
      setTimeout(function () { if (el.parentNode) el.remove(); }, 300);
    }

    el._destroy = destroy;
    return { el: el, destroy: destroy };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // E.  FLOATING PILL FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build and mount a floating minimized pill.
   *
   * @param {object} cfg
   * @param {string}   cfg.id               DOM id for the pill.
   * @param {string}  [cfg.iconClass]        FontAwesome class e.g. 'fa-film'.
   * @param {string}  [cfg.title]
   * @param {string}  [cfg.subtitle]
   * @param {string}  [cfg.extraHTML]        Injected after subtitle inside .pill-info (e.g. progress bar).
   * @param {boolean} [cfg.showMiniBtn=true]
   * @param {string}  [cfg.draggingClass]
   * @param {Function} cfg.onMiniPreview
   * @param {Function} cfg.onRestore
   * @param {Function} cfg.onClose           Only this button fully destroys.
   * @param {Function}[cfg.onBodyClick]      Pill body click (defaults to onMiniPreview).
   *
   * @returns {{ el, destroy, updateSubtitle }}
   */
  function createFloatingPill(cfg) {
    var existing = document.getElementById(cfg.id);
    if (existing) existing.remove();

    var showMini = cfg.showMiniBtn !== false;
    var pill = document.createElement('div');
    pill.id  = cfg.id;
    pill.innerHTML = [
      '<div class="pill-icon"><i class="fas ' + (cfg.iconClass || 'fa-film') + '"></i></div>',
      '<div class="pill-info">',
        '<div class="pill-title">' + (cfg.title    || '')                        + '</div>',
        '<div class="pill-sub">'   + (cfg.subtitle || 'Paused · click to restore') + '</div>',
        (cfg.extraHTML || ''),
      '</div>',
      '<div class="pill-actions">',
        showMini
          ? '<button class="pill-mini-btn"    id="' + cfg.id + 'MiniBtn"    title="Mini preview"><i class="fas fa-clone"></i></button>'
          : '',
        '<button class="pill-restore-btn" id="' + cfg.id + 'RestoreBtn" title="Restore"><i class="fas fa-expand"></i></button>',
        '<button class="pill-close-btn"   id="' + cfg.id + 'CloseBtn"   title="Close"><i class="fas fa-times"></i></button>',
      '</div>',
    ].join('');
    document.body.appendChild(pill);

    var miniBtn    = pill.querySelector('#' + cfg.id + 'MiniBtn');
    var restoreBtn = pill.querySelector('#' + cfg.id + 'RestoreBtn');
    var closeBtn   = pill.querySelector('#' + cfg.id + 'CloseBtn');

    if (miniBtn) miniBtn.addEventListener('click', function (e) { e.stopPropagation(); if (cfg.onMiniPreview) cfg.onMiniPreview(); });
    restoreBtn.addEventListener('click',           function (e) { e.stopPropagation(); if (cfg.onRestore)    cfg.onRestore();    });
    closeBtn.addEventListener('click',             function (e) { e.stopPropagation(); if (cfg.onClose)      cfg.onClose();      });

    pill.addEventListener('click', function (e) {
      if (e.target.closest('.pill-actions')) return;
      if (dragger.wasDragged) { dragger.resetDragged(); return; }
      var handler = cfg.onBodyClick || cfg.onMiniPreview;
      if (handler) handler();
    });

    // Drag: excludeSelector prevents action buttons from initiating drag
    var dragger = makeDraggable(pill, pill, {
      threshold:       4,
      draggingClass:   cfg.draggingClass || '',
      excludeSelector: '.pill-actions',
    });

    function updateSubtitle(text) {
      var sub = pill.querySelector('.pill-sub');
      if (sub) sub.textContent = text;
    }

    function destroy() {
      dragger.destroy();
      if (pill.parentNode) pill.remove();
    }

    return { el: pill, destroy: destroy, updateSubtitle: updateSubtitle };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // F.  VIDEO PLAYBACK UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  function fmtTime(secs) {
    if (!isFinite(secs) || isNaN(secs)) return '0:00';
    secs = Math.max(0, Math.floor(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h
      ? h + ':' + m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0')
      : m.toString().padStart(1, '0') + ':' + s.toString().padStart(2, '0');
  }

  function getFrameRate(video) {
    if (!video) return 24;
    var src = (video.currentSrc || video.src || '').toLowerCase();
    if (src.includes('60fps') || src.includes('_60'))   return 60;
    if (src.includes('50fps') || src.includes('_50'))   return 50;
    if (src.includes('30fps') || src.includes('_30'))   return 30;
    if (src.includes('25fps') || src.includes('_25'))   return 25;
    if (src.includes('23.976') || src.includes('2397')) return 23.976;
    return 24;
  }

  function getCurrentFrame(video) {
    return !video ? 0 : Math.floor((video.currentTime || 0) * getFrameRate(video));
  }

  function getTotalFrames(video) {
    return (!video || !video.duration) ? 0 : Math.floor(video.duration * getFrameRate(video));
  }

  function seekByFrames(delta, videos) {
    if (!videos || !videos.length) return;
    var primary = videos[0];
    if (!primary || !primary.duration || primary.readyState < 1) return;
    var next = Math.max(0, Math.min(primary.currentTime + delta / getFrameRate(primary), primary.duration));
    videos.forEach(function (v) { if (v && v.readyState >= 1) { v.pause(); v.currentTime = next; } });
  }

  function getVideoDuration(src) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = function () { resolve(v.duration); v.src = ''; };
      v.onerror = function () { reject(new Error('Cannot load: ' + src)); v.src = ''; };
      v.src = src;
    });
  }

  function durationsMatch(a, b, tolerance) {
    return Math.abs(a - b) <= (tolerance != null ? tolerance : 0.5);
  }

  function updateSeekBar(opts) {
    var v = opts.primary, sb = opts.seekBar, sf = opts.seekFill;
    if (!v || !v.duration || !sb || !sf) return;
    var pct = (v.currentTime / v.duration) * 100;
    sb.value = (pct / 100) * 1000; sf.style.width = pct + '%';
    if (opts.currentTimeEl) opts.currentTimeEl.textContent = fmtTime(v.currentTime);
  }

  function setPlaying(shouldPlay, videos, playIconEl) {
    videos.forEach(function (v) {
      if (!v) return;
      shouldPlay ? v.play().catch(function () {}) : v.pause();
    });
    if (playIconEl) playIconEl.className = shouldPlay ? 'fas fa-pause' : 'fas fa-play';
  }

  function wireSpeedSelect(select, getVideoEl, getVjsPlayer) {
    if (!select) return;
    select.addEventListener('change', function () {
      var rate = parseFloat(this.value) || 1;
      var vjs  = getVjsPlayer ? getVjsPlayer() : null;
      if (vjs && typeof vjs.playbackRate === 'function') { vjs.playbackRate(rate); return; }
      var v = getVideoEl ? getVideoEl() : null;
      if (v) v.playbackRate = rate;
    });
  }

  function createLoopController(opts) {
    var enabled = opts.initialState || false;
    var btn = opts.btn, color = opts.activeColor || '#10b981';

    function syncVideos() { (opts.getVideos() || []).forEach(function (v) { if (v) v.loop = enabled; }); }

    function setLoop(state) {
      enabled = !!state;
      if (btn) {
        btn.style.color       = enabled ? color               : '';
        btn.style.background  = enabled ? 'rgba(16,185,129,0.15)' : '';
        btn.style.borderColor = enabled ? 'rgba(16,185,129,0.4)'  : '';
      }
      syncVideos();
    }

    if (btn) btn.addEventListener('click', function () { setLoop(!enabled); });
    setLoop(enabled);
    return { isEnabled: function () { return enabled; }, setLoop: setLoop, syncVideos: syncVideos };
  }

  function createVolumeController(opts) {
    var muted = false, volume = opts.initialVolume != null ? opts.initialVolume : 1;

    function getVids() { return (opts.getPrimary() || []).filter(Boolean); }

    function applyVolume(vol, isMuted) {
      getVids().forEach(function (v) { v.volume = isMuted ? 0 : vol; v.muted = isMuted; });
      if (opts.slider) opts.slider.value = Math.round(vol * 100);
      var i = opts.volIcon; if (!i) return;
      i.className = (isMuted || vol === 0) ? 'fas fa-volume-mute'
                  : vol < 0.5              ? 'fas fa-volume-down'
                  :                          'fas fa-volume-up';
    }

    function setVolume(val) { volume = Math.max(0, Math.min(1, val)); muted = (volume === 0); applyVolume(volume, muted); }
    function toggleMute()   { muted = !muted; applyVolume(volume, muted); }

    if (opts.slider) {
      opts.slider.value = Math.round(volume * 100);
      opts.slider.addEventListener('input', function () { volume = this.value / 100; muted = (volume === 0); applyVolume(volume, muted); });
    }
    if (opts.muteBtn) opts.muteBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });

    return { getVolume: function () { return muted ? 0 : volume; }, setVolume: setVolume, toggleMute: toggleMute };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  global.VideoUtils = {
    // A. Fullscreen
    getFullscreenElement, isInFullscreen, enterFullscreen, exitFullscreen,
    onFullscreenChange, createFsGuard,
    // B. Drag
    makeDraggable,
    // C. Resize
    makeResizable,
    // D. Mini player
    createMiniPlayer,
    // E. Pill
    createFloatingPill,
    // F. Playback
    fmtTime, getFrameRate, getCurrentFrame, getTotalFrames,
    seekByFrames, getVideoDuration, durationsMatch,
    updateSeekBar, setPlaying, wireSpeedSelect,
    createLoopController, createVolumeController,
  };

}(window));