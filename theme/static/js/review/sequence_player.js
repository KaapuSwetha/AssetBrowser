//sequence_branch
(function () {
  'use strict';

  // ── Pull everything needed from the shared utility namespace ──────────────
  const {
    seekByFrames, createLoopController, createVolumeController,
    setPlaying, updateSeekBar, fmtTime,
    isInFullscreen, enterFullscreen, exitFullscreen,
    onFullscreenChange, makeResizable,
  } = window.VideoUtils;

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────
  let activeMenu  = null;
  let playerState = null;
  let sbsState    = null;
  // Replaces the old boolean _suppressFsChange. Setting .active = true before
  // a programmatic fullscreen enter/exit prevents the fullscreenchange listener
  // from reacting to that change.
  const fsGuard   = { active: false };
  let miniPill    = null;

  // ─────────────────────────────────────────────────────────────────────────
  // CONTEXT MENU
  // ─────────────────────────────────────────────────────────────────────────
  function closeMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
    document.removeEventListener('click',   closeMenu);
    document.removeEventListener('keydown', menuKeydown);
  }
  function menuKeydown(e) { if (e.key === 'Escape') closeMenu(); }

  document.addEventListener('click', function (e) {
    const row = e.target.closest('.seq-dept-row');
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    _showDeptMenu(e.clientX, e.clientY, row);
  });

  function _showDeptMenu(x, y, row) {
    closeMenu();
    const project = row.dataset.project;
    const seqName = row.dataset.seqName;
    const dept    = row.dataset.dept;
    const hasSbs  = row.dataset.hasSbs === 'true';

    const menu = document.createElement('div');
    menu.className = 'seq-context-menu';
    menu.innerHTML = `
      <div class="seq-ctx-header"><i class="fas fa-film"></i><span>${dept} — ${seqName}</span></div>
      <div class="seq-ctx-item" data-action="play-continuous"><i class="fas fa-film"></i><span>Play Continuous</span></div>
      ${hasSbs ? `<div class="seq-ctx-item" data-action="side-by-side"><i class="fas fa-columns"></i><span>Side by Side</span></div>` : ''}
    `;
    menu.style.left = '-9999px'; menu.style.top = '-9999px';
    document.body.appendChild(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth  - mw - 8) + 'px';
    menu.style.top  = Math.min(y, window.innerHeight - mh - 8) + 'px';
    activeMenu = menu;

    menu.querySelectorAll('.seq-ctx-item').forEach(item => {
      item.addEventListener('click', ev => {
        ev.stopPropagation(); closeMenu();
        if (item.dataset.action === 'play-continuous') launchContinuous(project, seqName, dept);
        if (item.dataset.action === 'side-by-side')    launchSideBySide(project, seqName, dept);
      });
    });
    setTimeout(() => {
      document.addEventListener('click',   closeMenu);
      document.addEventListener('keydown', menuKeydown);
    }, 50);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TREE BINDING
  // ─────────────────────────────────────────────────────────────────────────
  function attachSeqContextMenus(root) {
    root = root || document;
    root.querySelectorAll('.seq-summary[data-project]').forEach(el => { if (el._seqCtxBound) return; el._seqCtxBound = true; });
    root.querySelectorAll('[data-seq-name][data-project]').forEach(el => { if (el._seqCtxBound) return; el._seqCtxBound = true; });
  }
  document.addEventListener('htmx:afterSwap', () => attachSeqContextMenus());
  document.addEventListener('DOMContentLoaded', () => attachSeqContextMenus());
  if (document.readyState !== 'loading') attachSeqContextMenus();

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  async function fetchCompareClips(project, seqName, dept) {
    let url = `/sequence-clips/?project=${encodeURIComponent(project)}&sequence=${encodeURIComponent(seqName)}&mode=compare`;
    if (dept) url += `&dept=${encodeURIComponent(dept)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEQ MINI PLAYER
  // ─────────────────────────────────────────────────────────────────────────
  function openSeqMiniPlayer() {
    if (!playerState || !playerState.video) return;
    if (document.getElementById('seqMiniPlayer')) return;

    if (miniPill) miniPill.style.display = 'none';

    const src       = playerState.video.src;
    const startTime = playerState.video.currentTime || 0;

    const mini = document.createElement('div');
    mini.id = 'seqMiniPlayer';
    mini.innerHTML = `
      <div class="seq-resize-handle" data-dir="n"></div>
      <div class="seq-resize-handle" data-dir="s"></div>
      <div class="seq-resize-handle" data-dir="e"></div>
      <div class="seq-resize-handle" data-dir="w"></div>
      <div class="seq-resize-handle" data-dir="nw"></div>
      <div class="seq-resize-handle" data-dir="ne"></div>
      <div class="seq-resize-handle" data-dir="sw"></div>
      <div class="seq-resize-handle" data-dir="se"></div>
      <div id="seqMiniInner">
        <div id="seqMiniDragHandle"></div>
        <div id="seqMiniLabel">Mini Preview</div>
        <div id="seqMiniVideoWrap">
          <div id="seqMiniProgress"><div id="seqMiniProgressFill"></div></div>
          <video id="seqMiniVideo" playsinline webkit-playsinline></video>
          <div id="seqMiniOverlay">
            <div id="seqMiniPlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>
          </div>
        </div>
        <div id="seqMiniControls">
          <button id="seqMiniPlayBtn"><i id="seqMiniPlayBtnIcon" class="fas fa-pause"></i></button>
          <span   id="seqMiniTime">0:00 / 0:00</span>
          <button id="seqMiniVolBtn"><i id="seqMiniVolIcon" class="fas fa-volume-up"></i></button>
          <button id="seqMiniExpandBtn"><i class="fas fa-expand"></i></button>
          <button id="seqMiniCloseBtn"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(mini);

    const video        = mini.querySelector('#seqMiniVideo');
    const playBtnIcon  = mini.querySelector('#seqMiniPlayBtnIcon');
    const volBtn       = mini.querySelector('#seqMiniVolBtn');
    const volIconEl    = mini.querySelector('#seqMiniVolIcon');
    const expandBtn    = mini.querySelector('#seqMiniExpandBtn');
    const closeBtn     = mini.querySelector('#seqMiniCloseBtn');
    const timeEl       = mini.querySelector('#seqMiniTime');
    const progressFill = mini.querySelector('#seqMiniProgressFill');
    const videoWrap    = mini.querySelector('#seqMiniVideoWrap');
    const dragHandle   = mini.querySelector('#seqMiniDragHandle');
    const playBtn      = mini.querySelector('#seqMiniPlayBtn');

    video.src     = src;
    video.preload = 'auto';
    video.volume  = playerState.volume || 1;
    video.loop    = playerState.loopEnabled || false;

    createVolumeController({
      getPrimary: () => [video],
      slider:  null,
      muteBtn: volBtn,
      volIcon: volIconEl,
    });

    const onMeta = () => {
      video.currentTime = startTime;
      video.play().catch(() => {});
      updateMiniTime();
    };
    if (video.readyState >= 1) onMeta();
    else video.addEventListener('loadedmetadata', onMeta, { once: true });

    function updateMiniTime() {
      const cur = video.currentTime || 0, dur = video.duration || 0;
      timeEl.textContent       = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      progressFill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
      playBtnIcon.className    = video.paused ? 'fas fa-play' : 'fas fa-pause';
      const pi = mini.querySelector('#seqMiniPlayIcon i');
      if (pi) { pi.className = video.paused ? 'fas fa-play' : 'fas fa-pause'; pi.style.marginLeft = video.paused ? '2px' : '0'; }
    }

    video.addEventListener('timeupdate', updateMiniTime);
    video.addEventListener('play',  () => { playBtnIcon.className = 'fas fa-pause'; });
    video.addEventListener('pause', () => { playBtnIcon.className = 'fas fa-play'; });

    function togglePlay() {
      video.paused ? video.play().catch(() => {}) : video.pause();
    }
    videoWrap.addEventListener('click', e => { if (e.target === dragHandle) return; togglePlay(); });
    playBtn.addEventListener('click',   e => { e.stopPropagation(); togglePlay(); });

    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      const ct = video.currentTime;
      destroySeqMiniPlayer();
      if (playerState && playerState.video) playerState.video.currentTime = ct;
      restorePlayer();
    });

    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      destroySeqMiniPlayer();
      if (miniPill) miniPill.style.display = '';
    });

    // ── Drag  (right/bottom coordinate system) ───────────────────────────────
    let isDragging = false, dragStartX = 0, dragStartY = 0, initRight = 24, initBottom = 24;

    dragHandle.addEventListener('mousedown', e => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initRight  = window.innerWidth  - rect.right;
      initBottom = window.innerHeight - rect.bottom;
      mini.classList.add('seq-mini-dragging');
      e.preventDefault();
    });

    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      mini.style.right  = Math.max(8, Math.min(initRight  - dx, window.innerWidth  - mini.offsetWidth  - 8)) + 'px';
      mini.style.bottom = Math.max(8, Math.min(initBottom - dy, window.innerHeight - mini.offsetHeight - 8)) + 'px';
    }
    function onDragUp() {
      if (isDragging) { isDragging = false; mini.classList.remove('seq-mini-dragging'); }
    }
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragUp);

    // ── Resize  (VideoUtils.makeResizable) ───────────────────────────────────
    const resizer = makeResizable(mini, {
      minW: 200, minH: 150,
      resizingClass:  'seq-mini-resizing',
      handleSelector: '.seq-resize-handle',
    });

    mini._destroy = () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup',   onDragUp);
      resizer.destroy();
      video.pause(); video.src = '';
    };

    requestAnimationFrame(() => requestAnimationFrame(() => mini.classList.add('seq-mini-visible')));
  }

  function destroySeqMiniPlayer() {
    const mini = document.getElementById('seqMiniPlayer');
    if (!mini) return;
    if (typeof mini._destroy === 'function') mini._destroy();
    mini.classList.remove('seq-mini-visible');
    setTimeout(() => { if (mini.parentNode) mini.remove(); }, 300);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SBS MINI PLAYER
  // ─────────────────────────────────────────────────────────────────────────
  function openSBSMiniPlayer() {
    if (!sbsState) return;
    if (document.getElementById('sbsMiniPlayer')) return;

    if (miniPill) miniPill.style.display = 'none';

    const v1src     = sbsState.v1 ? (sbsState.v1.src || '') : '';
    const v2src     = sbsState.v2 ? (sbsState.v2.src || '') : '';
    const startTime = sbsState.v2 ? sbsState.v2.currentTime : (sbsState.v1 ? sbsState.v1.currentTime : 0);

    const mini = document.createElement('div');
    mini.id = 'sbsMiniPlayer';
    mini.innerHTML = `
      <div class="seq-resize-handle" data-dir="n"></div>
      <div class="seq-resize-handle" data-dir="s"></div>
      <div class="seq-resize-handle" data-dir="e"></div>
      <div class="seq-resize-handle" data-dir="w"></div>
      <div class="seq-resize-handle" data-dir="nw"></div>
      <div class="seq-resize-handle" data-dir="ne"></div>
      <div class="seq-resize-handle" data-dir="sw"></div>
      <div class="seq-resize-handle" data-dir="se"></div>
      <div id="sbsMiniInner">
        <div id="sbsMiniDragHandle"></div>
        <div id="sbsMiniLabel">SBS Preview</div>
        <div id="sbsMiniVideoWrap">
          <div id="sbsMiniProgress"><div id="sbsMiniProgressFill"></div></div>
          <div class="sbs-mini-panel" id="sbsMiniPanel1">
            <span class="sbs-mini-badge sbs-mini-badge-left">Left</span>
          </div>
          <div class="sbs-mini-panel" id="sbsMiniPanel2">
            <span class="sbs-mini-badge sbs-mini-badge-right">Right</span>
          </div>
          <div id="sbsMiniOverlay">
            <div id="sbsMiniPlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>
          </div>
        </div>
        <div id="sbsMiniControls">
          <button id="sbsMiniPlayBtn"><i id="sbsMiniPlayBtnIcon" class="fas fa-pause"></i></button>
          <span   id="sbsMiniTime">0:00 / 0:00</span>
          <button id="sbsMiniVolBtn"><i id="sbsMiniVolIcon" class="fas fa-volume-up"></i></button>
          <button id="sbsMiniExpandBtn"><i class="fas fa-expand"></i></button>
          <button id="sbsMiniCloseBtn"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(mini);

    const panel1       = mini.querySelector('#sbsMiniPanel1');
    const panel2       = mini.querySelector('#sbsMiniPanel2');
    const playBtn      = mini.querySelector('#sbsMiniPlayBtn');
    const playBtnIcon  = mini.querySelector('#sbsMiniPlayBtnIcon');
    const volBtn       = mini.querySelector('#sbsMiniVolBtn');
    const volIconEl    = mini.querySelector('#sbsMiniVolIcon');
    const expandBtn    = mini.querySelector('#sbsMiniExpandBtn');
    const closeBtn     = mini.querySelector('#sbsMiniCloseBtn');
    const timeEl       = mini.querySelector('#sbsMiniTime');
    const progressFill = mini.querySelector('#sbsMiniProgressFill');
    const videoWrap    = mini.querySelector('#sbsMiniVideoWrap');
    const dragHandle   = mini.querySelector('#sbsMiniDragHandle');

    function makeVid(src, panel, muted) {
      if (!src) return null;
      const v = document.createElement('video');
      v.src = src; v.preload = 'auto'; v.muted = muted;
      v.setAttribute('playsinline', '');
      panel.appendChild(v);
      return v;
    }

    const mv1     = makeVid(v1src, panel1, true);
    const mv2     = makeVid(v2src, panel2, false);
    const primary = mv2 || mv1;

    createVolumeController({
      getPrimary: () => primary ? [primary] : [],
      slider:  null,
      muteBtn: volBtn,
      volIcon: volIconEl,
    });

    function updateTime() {
      if (!primary) return;
      const cur = primary.currentTime || 0, dur = primary.duration || 0;
      timeEl.textContent       = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      progressFill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
      playBtnIcon.className    = primary.paused ? 'fas fa-play' : 'fas fa-pause';
      const pi = mini.querySelector('#sbsMiniPlayIcon i');
      if (pi) { pi.className = primary.paused ? 'fas fa-play' : 'fas fa-pause'; pi.style.marginLeft = primary.paused ? '2px' : '0'; }
      if (mv1 && mv1 !== primary && Math.abs(mv1.currentTime - primary.currentTime) > 0.15) {
        mv1.currentTime = primary.currentTime;
      }
    }

    if (primary) {
      const onMeta = () => {
        primary.currentTime = startTime;
        if (mv1 && mv1 !== primary) mv1.currentTime = startTime;
        primary.play().catch(() => {});
        if (mv1 && mv1 !== primary) mv1.play().catch(() => {});
        updateTime();
      };
      if (primary.readyState >= 1) onMeta();
      else primary.addEventListener('loadedmetadata', onMeta, { once: true });

      primary.addEventListener('timeupdate', updateTime);
      primary.addEventListener('play',  () => {
        playBtnIcon.className = 'fas fa-pause';
        if (mv1 && mv1 !== primary) mv1.play().catch(() => {});
      });
      primary.addEventListener('pause', () => {
        playBtnIcon.className = 'fas fa-play';
        if (mv1 && mv1 !== primary) mv1.pause();
      });
      primary.addEventListener('seeked', () => {
        if (mv1 && mv1 !== primary) mv1.currentTime = primary.currentTime;
      });
    }

    function togglePlay() {
      if (!primary) return;
      if (primary.paused) {
        primary.play().catch(() => {});
        if (mv1 && mv1 !== primary) mv1.play().catch(() => {});
      } else {
        primary.pause();
        if (mv1 && mv1 !== primary) mv1.pause();
      }
    }
    videoWrap.addEventListener('click', e => { if (e.target === dragHandle) return; togglePlay(); });
    playBtn.addEventListener('click',   e => { e.stopPropagation(); togglePlay(); });

    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      const ct = primary ? primary.currentTime : 0;
      destroySBSMiniPlayer();
      if (sbsState) {
        if (sbsState.v1) sbsState.v1.currentTime = ct;
        if (sbsState.v2) sbsState.v2.currentTime = ct;
      }
      restorePlayer();
    });

    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      destroySBSMiniPlayer();
      if (miniPill) miniPill.style.display = '';
    });

    // ── Drag  (right/bottom coordinate system) ───────────────────────────────
    let isDragging = false, dragStartX = 0, dragStartY = 0, initRight = 24, initBottom = 24;

    dragHandle.addEventListener('mousedown', e => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initRight  = window.innerWidth  - rect.right;
      initBottom = window.innerHeight - rect.bottom;
      mini.classList.add('sbs-mini-dragging');
      e.preventDefault();
    });

    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      mini.style.right  = Math.max(8, Math.min(initRight  - dx, window.innerWidth  - mini.offsetWidth  - 8)) + 'px';
      mini.style.bottom = Math.max(8, Math.min(initBottom - dy, window.innerHeight - mini.offsetHeight - 8)) + 'px';
    }
    function onDragUp() {
      if (isDragging) { isDragging = false; mini.classList.remove('sbs-mini-dragging'); }
    }
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragUp);

    // ── Resize  (VideoUtils.makeResizable) ───────────────────────────────────
    const resizer = makeResizable(mini, {
      minW: 300, minH: 150,
      resizingClass:  'sbs-mini-resizing',
      handleSelector: '.seq-resize-handle',
    });

    mini._destroy = () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup',   onDragUp);
      resizer.destroy();
      if (mv1) { mv1.pause(); mv1.src = ''; }
      if (mv2) { mv2.pause(); mv2.src = ''; }
    };

    requestAnimationFrame(() => requestAnimationFrame(() => mini.classList.add('sbs-mini-visible')));
  }

  function destroySBSMiniPlayer() {
    const mini = document.getElementById('sbsMiniPlayer');
    if (!mini) return;
    if (typeof mini._destroy === 'function') mini._destroy();
    mini.classList.remove('sbs-mini-visible');
    setTimeout(() => { if (mini.parentNode) mini.remove(); }, 300);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PILL
  // ═══════════════════════════════════════════════════════════════════════════
  function _rebuildPill() {
    document.querySelectorAll('#seqMiniPill').forEach(el => el.remove());
    if (miniPill) {
      if (typeof miniPill._destroyDrag === 'function') miniPill._destroyDrag();
      miniPill = null;
    }
    if (!playerState && !sbsState) return;

    const state     = playerState || sbsState;
    const isSBS     = !playerState && !!sbsState;
    const label     = isSBS
      ? `${sbsState.project} / ${sbsState.seqName} — SBS`
      : `${state.project} / ${state.seqName}${state.dept && state.dept !== 'SBS' ? ' / ' + state.dept : ''}`;
    const isMerging = !state.video;

    const pill = document.createElement('div');
    pill.id = 'seqMiniPill';
    if (isMerging) pill.classList.add('pill-merging');

    pill.innerHTML = `
      <div class="pill-icon">
        <i class="fas ${isSBS ? 'fa-columns' : 'fa-film'}"></i>
      </div>
      <div class="pill-info">
        <div class="pill-title">${label}</div>
        <div class="pill-sub" id="pillSub">${isMerging ? 'Merging in background…' : 'Paused · click to restore'}</div>
        ${isMerging ? `<div class="pill-bar-track"><div class="pill-bar-fill" id="pillBarFill"></div></div>` : ''}
      </div>
      <div class="pill-actions">
        ${!isMerging ? `
        <button class="pill-mini-btn" id="pillMiniBtn" title="Mini preview">
          <i class="fas fa-clone"></i>
        </button>` : ''}
        <button class="pill-restore-btn" id="pillRestoreBtn" title="Restore fullscreen">
          <i class="fas fa-expand"></i>
        </button>
        <button class="pill-close-btn" id="pillCloseBtn" title="Cancel &amp; close">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    document.body.appendChild(pill);
    miniPill = pill;
    state._miniPill = pill;

    pill.addEventListener('click', e => {
      if (e.target.closest('.pill-actions')) return;
      if (pill._wasDragged) { pill._wasDragged = false; return; }
      if (isMerging) { restorePlayer(); return; }
      isSBS ? openSBSMiniPlayer() : openSeqMiniPlayer();
    });

    const miniBtn = pill.querySelector('#pillMiniBtn');
    if (miniBtn) {
      miniBtn.addEventListener('click', e => {
        e.stopPropagation();
        isSBS ? openSBSMiniPlayer() : openSeqMiniPlayer();
      });
    }

    pill.querySelector('#pillRestoreBtn').addEventListener('click', e => {
      e.stopPropagation();
      restorePlayer();
    });

    pill.querySelector('#pillCloseBtn').addEventListener('click', e => {
      e.stopPropagation();
      _hardDestroy();
    });

    // ── Pill drag (left/top coordinate system) ────────────────────────────────
    let isDragging = false, dragStartX = 0, dragStartY = 0;
    let baseLeft = 0, baseTop = 0;
    const DRAG_THRESHOLD = 4;
    let movedDistance = 0;

    pill.addEventListener('mousedown', e => {
      if (e.target.closest('.pill-actions')) return;
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
      if (movedDistance > DRAG_THRESHOLD) { pill.classList.add('seq-pill-dragging'); pill._wasDragged = true; }
      pill.style.left = Math.max(8, Math.min(baseLeft + dx, window.innerWidth  - pill.offsetWidth  - 8)) + 'px';
      pill.style.top  = Math.max(8, Math.min(baseTop  + dy, window.innerHeight - pill.offsetHeight - 8)) + 'px';
    }
    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      pill.classList.remove('seq-pill-dragging');
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    pill._destroyDrag = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
  }

  function _removePill() {
    document.querySelectorAll('#seqMiniPill').forEach(el => el.remove());
    if (miniPill) {
      if (typeof miniPill._destroyDrag === 'function') miniPill._destroyDrag();
      miniPill = null;
    }
    if (playerState) playerState._miniPill = null;
    if (sbsState)    sbsState._miniPill    = null;
  }

  function minimizePlayer() {
    if (!playerState) return;
    if (playerState.minimized) return;
    if (miniPill || document.getElementById('seqMiniPill')) return;

    fsGuard.active = true;

    const doMinimize = () => {
      if (!playerState) { fsGuard.active = false; return; }
      if (playerState.video) { try { playerState.video.pause(); } catch (_) {} }
      playerState.shell.style.display = 'none';
      playerState.minimized = true;
      fsGuard.active = false;
      _rebuildPill();
    };

    if (isInFullscreen()) {
      exitFullscreen(doMinimize);
    } else {
      doMinimize();
    }
  }

// ─────────────────────────────────────────────────────────────────────────
// _hardDestroy  –  single place that owns cancel logic
// ─────────────────────────────────────────────────────────────────────────
function _hardDestroy() {
  // 1. Stop client-side polling immediately via the closure ref
  if (playerState && typeof playerState._cancel === 'function') {
    playerState._cancel();
  }

  // 2. Tell the server to kill the FFmpeg job ONLY if merge is not yet complete.
  //    If the job is already done (video is loaded/playing), skip deletion.
  const jobId       = playerState && playerState._jobId;
  const mergeIsDone = playerState && !!playerState.video; // video exists = merge completed

  if (jobId && !mergeIsDone) {
    // Merge was still in progress — ask server to cancel + delete partial file
    fetch(`/merge-output/cancel/${jobId}/`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {});
  }
  // If mergeIsDone === true, we intentionally skip the cancel call,
  // so the server keeps the completed output file intact.

  _removePill();
  fsGuard.active = true;
  if (isInFullscreen()) {
    exitFullscreen(() => { destroyPlayer(); fsGuard.active = false; });
  } else {
    destroyPlayer(); fsGuard.active = false;
  }
}
 // ─────────────────────────────────────────────────────────────────────────
// _destroyAndDelete  –  close AND always delete the output file
// ─────────────────────────────────────────────────────────────────────────
function _destroyAndDelete() {
  if (playerState && typeof playerState._cancel === 'function') {
    playerState._cancel();
  }

  const jobId = playerState && playerState._jobId;

  const doDestroy = () => {
    _removePill();
    fsGuard.active = true;
    if (isInFullscreen()) {
      exitFullscreen(() => { destroyPlayer(); fsGuard.active = false; });
    } else {
      destroyPlayer(); fsGuard.active = false;
    }
  };

  if (jobId) {
    // Call the dedicated delete endpoint — removes file even if merge was complete
    fetch(`/merge-output/delete/${jobId}/`, {
      method: 'POST',
      keepalive: true,
    })
      .then(r => r.json())
      .then(data => {
        if (data.deleted && window.Toast) {
          Toast.success('Merged clip deleted from server.', 'Deleted');
        }
      })
      .catch(() => {
        if (window.Toast) Toast.error('Could not delete file from server.', 'Delete Failed');
      })
      .finally(() => doDestroy());
  } else {
    // No job id (merge never started) — just close
    doDestroy();
  }
}
// ─────────────────────────────────────────────────────────────────────────
// _destroyKeepFile  –  close the player but leave the output file intact
// ─────────────────────────────────────────────────────────────────────────
function _destroyKeepFile() {
  if (playerState && typeof playerState._cancel === 'function') {
    playerState._cancel();
  }
  // Intentionally skip the cancel fetch — file is preserved on server
  _removePill();
  fsGuard.active = true;
  if (isInFullscreen()) {
    exitFullscreen(() => { destroyPlayer(); fsGuard.active = false; });
  } else {
    destroyPlayer(); fsGuard.active = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// _showDeleteConfirm  –  styled dialog: "Delete merged clip?"
// onDelete → called if user picks Yes / onKeep → called if user picks No
// ─────────────────────────────────────────────────────────────────────────
function _showDeleteConfirm(onDelete, onKeep,onCancel) {
  // Remove any stale instance
  document.getElementById('seqDeleteConfirmOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'seqDeleteConfirmOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.72); backdrop-filter: blur(4px);
    animation: seqFadeIn .15s ease;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes seqFadeIn  { from { opacity:0; transform:scale(.95) } to { opacity:1; transform:scale(1) } }
      @keyframes seqSlideIn { from { opacity:0; translateY(12px) }    to { opacity:1; translateY(0) }      }
      #seqDeleteConfirmBox {
        background: #1a1d23;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 14px;
        padding: 28px 32px 24px;
        width: 360px;
        box-shadow: 0 24px 64px rgba(0,0,0,.6);
        animation: seqSlideIn .18s ease;
        font-family: inherit;
      }
      #seqDeleteConfirmBox .dcb-icon {
        width: 48px; height: 48px; border-radius: 50%;
        background: rgba(239,68,68,.15);
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 16px;
        font-size: 20px; color: #f87171;
      }
      #seqDeleteConfirmBox h3 {
        margin: 0 0 8px; text-align: center;
        font-size: 16px; font-weight: 600; color: #f1f5f9;
      }
      #seqDeleteConfirmBox p {
        margin: 0 0 24px; text-align: center;
        font-size: 13px; color: #94a3b8; line-height: 1.5;
      }
      #seqDeleteConfirmBox .dcb-actions {
        display: flex; gap: 10px;
      }
      #seqDeleteConfirmBox button {
        flex: 1; padding: 10px 0; border-radius: 8px;
        font-size: 13px; font-weight: 600; cursor: pointer;
        border: none; transition: opacity .15s, transform .1s;
      }
      #seqDeleteConfirmBox button:hover  { opacity: .88; }
      #seqDeleteConfirmBox button:active { transform: scale(.97); }
      #seqDcbYes {
        background: #ef4444; color: #fff;
      }
      #seqDcbNo {
        background: rgba(255,255,255,.08);
        color: #cbd5e1;
        border: 1px solid rgba(255,255,255,.1) !important;
      }
      #seqDcbCancel {
  background: rgba(239,68,68,.12);
  color: #f87171;
  border: 1px solid rgba(239,68,68,.25) !important;
}
    </style>
    <div id="seqDeleteConfirmBox">
      <div class="dcb-icon"><i class="fas fa-trash-alt"></i></div>
      <h3>Delete merged clip?</h3>
      <p>The merged video file will be permanently removed from the server.<br>This cannot be undone.</p>
      <div class="dcb-actions">
        <button id="seqDcbYes"><i class="fas fa-trash-alt" style="margin-right:6px"></i>Delete clip</button>
        <button id="seqDcbNo"><i class="fas fa-save" style="margin-right:6px"></i>Continue</button>
        <button id="seqDcbCancel"><i class="fas fa-ban" style="margin-right:6px"></i>Cancel</button>

      </div>
    </div>
  `;

  const mountTarget = document.fullscreenElement || document.body;
  mountTarget.appendChild(overlay);

  const cleanup = () => {
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity .15s';
  setTimeout(() => {
    if (overlay.parentNode) overlay.remove();
  }, 160);
};

  overlay.querySelector('#seqDcbYes').addEventListener('click', () => {
    cleanup();
    onDelete();
  });

  overlay.querySelector('#seqDcbNo').addEventListener('click', () => {
  cleanup();
  onKeep();
});

overlay.querySelector('#seqDcbCancel').addEventListener('click', () => {
  cleanup();
  onCancel();
});

// backdrop and escape = keep
overlay.addEventListener('click', e => {
  if (e.target === overlay) { cleanup(); onKeep(); }
});
const onEsc = e => {
  if (e.key === 'Escape') {
    document.removeEventListener('keydown', onEsc);
    cleanup(); onKeep();
  }
};
  document.addEventListener('keydown', onEsc);
}

  function restorePlayer() {
    if (!playerState || !playerState.minimized) return;
    _removePill();
    playerState.minimized = false;
    playerState.shell.style.display = '';
    fsGuard.active = true;
    enterFullscreen(playerState.shell, () => { fsGuard.active = false; });
  }
// ─────────────────────────────────────────────────────────────────────────
// CONTINUOUS PLAYER  –  launchContinuous
// ─────────────────────────────────────────────────────────────────────────
function launchContinuous(project, seqName, dept) {
  if (sbsState)    { fsGuard.active = true; destroySBS(); }
  if (playerState) { fsGuard.active = true; destroyPlayer(); }

  const shell = _buildMergedShell(project, seqName, dept);
  document.body.appendChild(shell);

  // Use a ref-object so ANY code path (X btn, Escape, pill close, .mo-cancel)
  // that calls _hardDestroy will stop the polling via isCancelled().
  const cancelRef = { value: false };
  const isCancelled = () => cancelRef.value;

  playerState = {
    mode: 'merged', shell, video: null,
    loopEnabled: false, volume: 1,
    project, seqName, dept,
    minimized: false, _miniPill: null,
    _jobId: null,
    // Called by _hardDestroy so every close path cancels cleanly
    _cancel: () => { cancelRef.value = true; },
  };

  // .mo-cancel just delegates — _hardDestroy owns the cancel logic
  shell.querySelector('.mo-cancel').addEventListener('click', () => _hardDestroy());

  shell.querySelector('.mo-minimize').addEventListener('click', () => minimizePlayer());
  shell.querySelector('#seqMinimizeBtn').addEventListener('click', e => {
    e.stopPropagation(); minimizePlayer();
  });
  shell.querySelector('#seqCloseBtn').addEventListener('click', e => {
  e.stopPropagation();
  _showDeleteConfirm(
    () => _destroyAndDelete(),        // Delete  → delete file + close player
    () => { /* do nothing */ },       // Keep it → close dialog, merge continues
    () => _hardDestroy()              // Cancel  → stop merge, close player, no delete
  );
});
  shell.querySelector('#seqMiniPreviewBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (!playerState || !playerState.video) return;
    fsGuard.active = true;
    const doMini = () => {
      playerState.video.pause();
      shell.style.display = 'none';
      playerState.minimized = true;
      fsGuard.active = false;
      _removePill();
      _rebuildPill();
      if (miniPill) miniPill.style.display = 'none';
      openSeqMiniPlayer();
    };
    if (isInFullscreen()) exitFullscreen(doMini);
    else doMini();
  });
  document.addEventListener('keydown', handleKeyboard);
  fsGuard.active = false;

  enterFullscreen(shell, () => _startMergeJob(project, seqName, dept, shell, isCancelled));
}
  function _startMergeJob(project, seqName, dept, shell, isCancelled) {
  _setMergeStatus(shell, 0, 0, 0, `Requesting merge for ${seqName}…`);
  const fd = new FormData();
  fd.append('project', project);
  fd.append('sequence', seqName);
  fd.append('dept', dept || '');

  fetch('/merge-sequence-clips/', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(({ job_id, error }) => {
      if (isCancelled()) return;
      if (!job_id) { _showMergeError(shell, error || 'Could not start merge job.'); return; }
      // Store immediately so _hardDestroy can cancel it
      if (playerState) playerState._jobId = job_id;
      _pollJob(job_id, shell, isCancelled);
    })
    .catch(err => {
      if (!isCancelled()) _showMergeError(shell, `Network error: ${err.message}`);
    });
  }

  function _pollJob(job_id, shell, isCancelled) {
    if (isCancelled()) return;
    fetch(`/merge-sequence-clips/status/?job_id=${encodeURIComponent(job_id)}`)
      .then(r => r.json())
      .then(job => {
        if (isCancelled()) return;
        _setMergeStatus(shell, job.progress || 0, job.clips_done || 0, job.clips_total || 0, _mergeStatusLabel(job));
        if (job.status === 'done')   { _loadMergedVideo(shell, job.output_web); return; }
        if (job.status === 'failed') { _showMergeError(shell, job.error || 'Merge failed.'); return; }
        setTimeout(() => _pollJob(job_id, shell, isCancelled), 800);
      })
      .catch(err => { if (!isCancelled()) _showMergeError(shell, `Poll error: ${err.message}`); });
  }

  function _mergeStatusLabel(job) {
    if (job.status === 'queued')  return 'Queued…';
    if (job.status === 'running') {
      const done = job.clips_done || 0, total = job.clips_total || 0, pct = job.progress || 0;
      return total > 0 ? `Merging clip ${done} / ${total}  (${pct}%)` : `Merging clips… ${pct}%`;
    }
    return '';
  }

  function _setMergeStatus(shell, pct, done, total, label) {
    const overlay = shell.querySelector('#mergingOverlay');
    if (overlay) {
      const fill  = overlay.querySelector('.mo-bar-fill');
      const stat  = overlay.querySelector('.mo-status');
      const clips = overlay.querySelector('.mo-clips');
      if (fill)  fill.style.width = Math.min(pct, 100) + '%';
      if (stat)  stat.textContent = label;
      if (clips) clips.innerHTML  = total > 0
        ? `<i class="fas fa-film"></i> ${done} / ${total} clips processed`
        : `<i class="fas fa-cog fa-spin"></i> Analyzing sequence…`;
    }
    if (playerState && playerState._miniPill) {
      const pill     = playerState._miniPill;
      const pillFill = pill.querySelector('#pillBarFill');
      const pillSub  = pill.querySelector('#pillSub');
      if (pillFill) pillFill.style.width = Math.min(pct, 100) + '%';
      if (pillSub)  pillSub.textContent  = label || (total > 0 ? `${done} / ${total} clips — ${pct}%` : 'Merging in background…');
    }
  }

  function _showMergeError(shell, msg) {
    const overlay = shell.querySelector('#mergingOverlay');
    if (overlay) {
      overlay.classList.add('mo-error');
      overlay.querySelector('.mo-icon').innerHTML = '<i class="fas fa-exclamation-circle"></i>';
      overlay.querySelector('.mo-title').textContent = 'Merge Failed';
      overlay.querySelector('.mo-status').textContent = msg;
      overlay.querySelector('.mo-clips').innerHTML = '';
      const cancelBtn = overlay.querySelector('.mo-cancel');
      if (cancelBtn) cancelBtn.textContent = 'Close';
    }
    if (playerState && playerState._miniPill) {
      const pill    = playerState._miniPill;
      pill.classList.remove('pill-merging');
      pill.style.borderColor = 'rgba(239,68,68,.4)';
      const pillSub  = pill.querySelector('#pillSub');
      const pillFill = pill.querySelector('#pillBarFill');
      if (pillSub)  { pillSub.style.color = '#f87171'; pillSub.textContent = '✕ Merge failed — click to view'; }
      if (pillFill) { pillFill.style.background = 'rgba(239,68,68,.6)'; pillFill.style.width = '100%'; }
    }
    if (window.Toast) Toast.error(msg, 'Merge Error');
  }

  function _loadMergedVideo(shell, src) {
    const overlay   = shell.querySelector('#mergingOverlay');
    const mediaArea = shell.querySelector('#seqMediaArea');
    const nameEl    = shell.querySelector('#seqClipName');

    if (overlay) overlay.remove();
    if (nameEl) nameEl.textContent = `${playerState.project} / ${playerState.seqName}${playerState.dept ? ' / ' + playerState.dept : ''}`;

    // ── Inject Download button into the top bar ───────────────────────────
    const jobId = playerState && playerState._jobId;
    if (jobId) {
        const existingDl = shell.querySelector('#seqDownloadBtn');
        if (!existingDl) {
            const actions = shell.querySelector('.seq-topbar-actions');
            if (actions) {
                const dlBtn = document.createElement('button');
                dlBtn.id = 'seqDownloadBtn';
                dlBtn.title = 'Download merged clip';
                dlBtn.innerHTML = '<i class="fas fa-download"></i>';
                // Insert before the first action button
                actions.insertBefore(dlBtn, actions.firstChild);

                dlBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    // Trigger browser Save-As by opening the download URL
                    const a = document.createElement('a');
                    a.href = `/merge-output/${jobId}/?download=1`;
                    a.download = '';   // lets the server-supplied filename take effect
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    if (window.Toast) Toast.success('Download started!', 'Saving to your drive');
                });
            }
        }
    }
    if (playerState && playerState._miniPill) {
      const pill      = playerState._miniPill;
      const pillSub   = pill.querySelector('#pillSub');
      const pillBarEl = pill.querySelector('.pill-bar-track');
      const pillIcon  = pill.querySelector('.pill-icon i');
      pill.classList.remove('pill-merging');
      if (pillSub)   { pillSub.style.color = '#6ee7b7'; pillSub.textContent = '✓ Merge complete — click to watch'; }
      if (pillBarEl) pillBarEl.remove();
      if (pillIcon)  { pillIcon.style.color = '#6ee7b7'; }
      if (window.Toast) Toast.success(`${playerState.seqName} merge complete! Click pill to watch.`, '✓ Ready');
    }

    const loadingEl = shell.querySelector('#seqLoadingOverlay');
    if (loadingEl) loadingEl.style.display = 'flex';

    const video = document.createElement('video');
    video.id = 'seqVideo'; video.preload = 'auto'; video.playsInline = true;
    video.src    = src;
    video.volume = playerState ? playerState.volume : 1;
    video.loop   = playerState ? playerState.loopEnabled : false;

    const seekBar  = shell.querySelector('#seekBar');
    const seekFill = shell.querySelector('#seekFill');

    video.addEventListener('loadedmetadata', () => {
      if (loadingEl) loadingEl.style.display = 'none';
      shell.querySelector('#totalTime').textContent = fmtTime(video.duration);
      seekBar.value = 0;
      seekFill.style.width = '0%';
      if (playerState && !playerState.minimized) {
        video.play().catch(() => {});
        shell.querySelector('#playIcon').className = 'fas fa-pause';
      }
    }, { once: true });

    video._seekUntil = 0;

    video.addEventListener('timeupdate', () => {
      if (Date.now() < video._seekUntil) return;
      updateSeekBar({
        primary:       video,
        seekBar,
        seekFill,
        currentTimeEl: shell.querySelector('#currentTime'),
      });
    });

    video.addEventListener('ended', () => {
      video._seekUntil  = Date.now() + 300;
      video.currentTime = video.duration - 0.05;
      shell.querySelector('#playIcon').className = 'fas fa-play';
      if (window.Toast) Toast.success('Sequence complete!', '✓ Done');
    });

    mediaArea.insertBefore(video, mediaArea.firstChild);
    if (playerState) playerState.video = video;
    _wireMergedControls(shell);
  }

  function _wireMergedControls(shell) {
    if (shell._controlsWired) return;
    shell._controlsWired = true;

    const vid      = () => playerState && playerState.video;
    const ppBtn    = shell.querySelector('#playPauseBtn');
    const playIcon = shell.querySelector('#playIcon');
    const seekBar  = shell.querySelector('#seekBar');
    const seekFill = shell.querySelector('#seekFill');
    const ctEl     = shell.querySelector('#currentTime');
    const fbBtn    = shell.querySelector('#frameBackBtn');
    const ffBtn    = shell.querySelector('#frameForwardBtn');
    const loopBtn  = shell.querySelector('#loopToggleBtn');
    const muteBtn  = shell.querySelector('#muteBtn');
    const volIcon  = shell.querySelector('#volIcon');
    const volBar   = shell.querySelector('#volumeBar');
    const media    = shell.querySelector('#seqMediaArea');

    const loopCtrl = createLoopController({
      getVideos:   () => { const v = vid(); return v ? [v] : []; },
      btn:         loopBtn,
      activeColor: '#10b981',
    });
    loopBtn.addEventListener('click', () => {
      if (playerState) playerState.loopEnabled = loopCtrl.isEnabled();
    });

    createVolumeController({
      getPrimary: () => { const v = vid(); return v ? [v] : []; },
      slider:     volBar,
      muteBtn,
      volIcon,
    });

    function seekFrame(delta) {
      const v = vid();
      if (!v || !v.duration || v.readyState < 1) return;
      v._seekUntil = Date.now() + 300;
      seekByFrames(delta, [v]);
      const next = v.currentTime;
      const pct  = (next / v.duration) * 100;
      seekBar.removeEventListener('input', onSeekInput);
      seekBar.value        = (pct / 100) * 1000;
      seekFill.style.width = pct + '%';
      ctEl.textContent     = fmtTime(next);
      seekBar.addEventListener('input', onSeekInput);
    }

    ppBtn.addEventListener('click', e => {
      e.stopPropagation();
      const v = vid(); if (!v) return;
      if (v.paused) {
        if (v.ended) {
          v.currentTime = 0;
        } else {
          const savedTime = parseFloat(v.currentTime) || 0;
          if (savedTime > 0.1) {
            const onPlaying = () => {
              v.removeEventListener('playing', onPlaying);
              if (v.currentTime < savedTime - 0.3) v.currentTime = savedTime;
            };
            v.addEventListener('playing', onPlaying);
          }
        }
        v.play().catch(() => {});
        playIcon.className = 'fas fa-pause';
      } else {
        v.pause();
        playIcon.className = 'fas fa-play';
      }
    });

    media.addEventListener('click', e => {
      if (e.target === media || e.target.tagName === 'VIDEO') ppBtn.click();
    });

    function onSeekInput() {
      const v = vid(); if (!v || !v.duration) return;
      const t = (seekBar.value / 1000) * v.duration;
      v._seekUntil = Date.now() + 300;
      v.currentTime = t;
      seekFill.style.width = (seekBar.value / 10) + '%';
      ctEl.textContent     = fmtTime(t);
    }
    seekBar.addEventListener('input', onSeekInput);

    fbBtn.addEventListener('click', e => { e.stopPropagation(); seekFrame(-1); });
    ffBtn.addEventListener('click', e => { e.stopPropagation(); seekFrame(+1); });
  }

  function _buildMergedShell(project, seqName, dept) {
    const shell = document.createElement('div');
    shell.className = 'seq-player-shell';
    shell.innerHTML = `
      <div id="fsTopBar">
        <div id="fsLabels">
          <span class="fs-label">
            <i class="fas fa-circle fs-dot-violet"></i>
            <span class="fs-label-tag seq-label-violet">Sequence</span>
            <span class="fs-label-tag seq-label-green" style="margin-left:4px;">Merged</span>
            <span class="seq-label-name">${project} / ${seqName}${dept ? ' / ' + dept : ''}</span>
          </span>
        </div>
        <span id="seqClipName"></span>
        <div class="seq-topbar-actions">
          <button id="seqMinimizeBtn" title="Minimize to pill">
            <i class="fas fa-window-minimize"></i>
          </button>
          <button id="seqMiniPreviewBtn" title="Mini preview">
            <i class="fas fa-clone"></i>
          </button>
          <button id="seqCloseBtn" title="Minimize (use pill ✕ to fully close)">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div id="seqMediaArea">
        <div id="mergingOverlay">
          <div class="mo-icon"><i class="fas fa-film"></i></div>
          <div class="mo-title">Merging ${seqName} clips…</div>
          <div class="mo-bar-track"><div class="mo-bar-fill"></div></div>
          <div class="mo-status">Starting…</div>
          <div class="mo-clips"><i class="fas fa-cog fa-spin"></i> Analyzing sequence…</div>
          <div class="mo-actions">
            <button class="mo-minimize"><i class="fas fa-arrow-down"></i> Minimize</button>
            <button class="mo-cancel">Cancel</button>
          </div>
        </div>
        <div id="seqLoadingOverlay" style="display:none;">
          <i class="fas fa-spinner fa-spin"></i>
          <span>Loading merged video…</span>
        </div>
      </div>

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
          <div class="fs-ctrl-group">
            <button id="frameBackBtn"    class="fs-icon-btn" title="Prev frame "><i class="fas fa-step-backward"></i></button>
            <button id="playPauseBtn"    title="Play/Pause"><i id="playIcon" class="fas fa-play"></i></button>
            <button id="frameForwardBtn" class="fs-icon-btn" title="Next frame"><i class="fas fa-step-forward"></i></button>
            <div class="fs-ctrl-divider"></div>
            <button id="loopToggleBtn"   class="fs-icon-btn" title="Loop "><i class="fas fa-repeat"></i></button>
            <div class="fs-ctrl-divider"></div>
            <button id="muteBtn"         class="fs-icon-btn" title="Mute "><i id="volIcon" class="fas fa-volume-up"></i></button>
            <input id="volumeBar" type="range" min="0" max="100" value="100" class="fs-vol-slider">
          </div>
        </div>
      </div>
    `;
    return shell;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function handleKeyboard(e) {
    if (!playerState || playerState.mode !== 'merged') return;
    if (playerState.minimized) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const shell = playerState.shell;
    const v     = playerState.video;

    function kbSeekFrame(delta) {
      if (!v || !v.duration || v.readyState < 1) return;
      v._seekUntil = Date.now() + 300;
      seekByFrames(delta, [v]);
      const next     = v.currentTime;
      const seekBar  = shell.querySelector('#seekBar');
      const seekFill = shell.querySelector('#seekFill');
      const ctEl     = shell.querySelector('#currentTime');
      if (seekBar && seekFill && ctEl) {
        const pct        = (next / v.duration) * 100;
        seekBar.value        = (pct / 100) * 1000;
        seekFill.style.width = pct + '%';
        ctEl.textContent     = fmtTime(next);
      }
    }

    switch (e.key) {
      case ' ':
      case 'Spacebar':  e.preventDefault(); shell.querySelector('#playPauseBtn').click(); break;
      case 'ArrowLeft':
      case ',':
      case '<':         e.preventDefault(); kbSeekFrame(-1); break;
      case 'ArrowRight':
      case '.':
      case '>':         e.preventDefault(); kbSeekFrame(+1); break;
      case 'l':
      case 'L':         e.preventDefault(); shell.querySelector('#loopToggleBtn').click(); break;
      case 'm':
      case 'M':         e.preventDefault(); shell.querySelector('#muteBtn').click(); break;
      case 'Escape':    e.preventDefault(); _hardDestroy(); break;
    }
  }

  function destroyPlayer() {
    if (!playerState) return;
    const { shell, video } = playerState;
    if (video) { video.pause(); video.src = ''; video.remove(); }
    document.removeEventListener('keydown', handleKeyboard);
    shell.remove();
    playerState = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIDE-BY-SIDE PLAYER
  // ═══════════════════════════════════════════════════════════════════════════
  function launchSideBySide(project, seqName, dept) {
    if (window.Toast) Toast.info(`Loading ${seqName} for SBS merge…`, 'Side by Side');
    fetchCompareClips(project, seqName, dept)
      .then(pairs => {
        if (!pairs || !pairs.length) { if (window.Toast) Toast.error('No comparison data found.', 'Empty'); return; }
        _launchSBSMerged(project, seqName, dept, pairs);
      })
      .catch(err => { console.error('[SBS]', err); if (window.Toast) Toast.error('Could not load comparison clips.', 'Error'); });
  }

 // ─────────────────────────────────────────────────────────────────────────
// SBS PLAYER  –  _launchSBSMerged
// ─────────────────────────────────────────────────────────────────────────
function _launchSBSMerged(project, seqName, dept, pairs) {
  if (playerState) { fsGuard.active = true; destroyPlayer(); }
  if (sbsState)    { fsGuard.active = true; destroySBS(); }

  const shell = _buildMergedShell(project, seqName, 'SBS');
  document.body.appendChild(shell);
  shell.querySelector('.seq-label-green').textContent = 'SBS Merged';

  const cancelRef = { value: false };
  const isCancelled = () => cancelRef.value;

  playerState = {
    mode: 'merged', shell, video: null,
    loopEnabled: false, volume: 1,
    project, seqName, dept: 'SBS',
    minimized: false, _miniPill: null,
    _jobId: null,
    _cancel: () => { cancelRef.value = true; },
  };

  shell.querySelector('.mo-cancel').addEventListener('click', () => _hardDestroy());
  shell.querySelector('.mo-minimize').addEventListener('click', () => minimizePlayer());
  shell.querySelector('#seqMinimizeBtn').addEventListener('click', e => { e.stopPropagation(); minimizePlayer(); });
  shell.querySelector('#seqCloseBtn').addEventListener('click', e => {
  e.stopPropagation();
  _showDeleteConfirm(
    () => _destroyAndDelete(),
    () => _destroyKeepFile()
  );
});shell.querySelector('#seqMiniPreviewBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    fsGuard.active = true;
    const doMini = () => {
      if (playerState && playerState.video) playerState.video.pause();
      shell.style.display = 'none';
      if (playerState) playerState.minimized = true;
      fsGuard.active = false;
      _removePill();
      _rebuildPill();
      if (miniPill) miniPill.style.display = 'none';
      openSeqMiniPlayer();
    };
    if (isInFullscreen()) exitFullscreen(doMini);
    else doMini();
  });
  document.addEventListener('keydown', handleKeyboard);
  fsGuard.active = false;

  const titleEl = shell.querySelector('.mo-title');
  if (titleEl) titleEl.textContent = `Merging ${pairs.length} SBS shots…`;

  enterFullscreen(shell, () => _mergeAllSBSPairs(pairs, shell, project, seqName, isCancelled));
}
// ─────────────────────────────────────────────────────────────────────────
// Store _jobId for SBS too  –  _mergeAllSBSPairs
// ─────────────────────────────────────────────────────────────────────────
function _mergeAllSBSPairs(pairs, shell, project, seqName, isCancelled) {
  if (isCancelled()) return;
  _setMergeStatus(shell, 0, 0, pairs.length, `Sending ${pairs.length} shot pairs for SBS merge…`);
  const fd = new FormData();
  fd.append('project', project); fd.append('sequence', seqName); fd.append('label', seqName);
  pairs.forEach(pair => {
    fd.append('left[]',  pair.first ? pair.first.path : pair.path);
    fd.append('right[]', pair.last  ? pair.last.path  : pair.path);
  });
  fetch('/merge-sbs-clips/', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(({ job_id, error }) => {
      if (isCancelled()) return;
      if (!job_id) { _showMergeError(shell, error || 'Could not start SBS merge.'); return; }
      // ← Store job_id so _hardDestroy can cancel the server job
      if (playerState) playerState._jobId = job_id;
      _pollSBSJob(job_id, pairs, 0, shell, isCancelled);
    })
    .catch(err => { if (!isCancelled()) _showMergeError(shell, `Network error: ${err.message}`); });
}
  function _pollSBSJob(job_id, pairs, index, shell, isCancelled) {
    if (isCancelled()) return;
    fetch(`/merge-sbs-clips/status/?job_id=${encodeURIComponent(job_id)}`)
      .then(r => r.json())
      .then(job => {
        if (isCancelled()) return;
        _setMergeStatus(shell, job.progress || 0, index + 1, pairs.length,
          job.status === 'running' ? `Merging SBS shot ${index + 1} / ${pairs.length}… ${job.progress || 0}%`
          : job.status === 'queued' ? 'Queued…' : '');
        if (job.status === 'done')   { _loadMergedVideo(shell, job.output_web); return; }
        if (job.status === 'failed') { _showMergeError(shell, job.error || 'SBS merge failed.'); return; }
        setTimeout(() => _pollSBSJob(job_id, pairs, index, shell, isCancelled), 800);
      })
      .catch(err => { if (!isCancelled()) _showMergeError(shell, `Poll error: ${err.message}`); });
  }

  function sbsTimeUpdate(master) {
    if (!sbsState || sbsState.syncing) return;
    const other = (master === sbsState.v2) ? sbsState.v1 : sbsState.v2;
    const shell = sbsState.shell;
    if (!master.duration) return;
    const pct = (master.currentTime / master.duration) * 100;
    shell.querySelector('#seekBar').value = pct;
    shell.querySelector('#seekFill').style.width = pct + '%';
    shell.querySelector('#currentTime').textContent = fmtTime(master.currentTime);
    if (other && Math.abs(other.currentTime - master.currentTime) > 0.15) {
      sbsState.syncing = true; other.currentTime = master.currentTime; sbsState.syncing = false;
    }
  }

  function sbsOnEnded() {
    if (!sbsState) return;
    if (sbsState.loopEnabled) return;
    const { currentIndex, pairs } = sbsState;
    if (currentIndex >= pairs.length - 1) {
      sbsState.shell.querySelector('#playIcon').className = 'fas fa-play';
      if (window.Toast) Toast.success('Sequence complete!', '✓ Done'); return;
    }
    sbsJumpTo(currentIndex + 1);
  }

  function sbsJumpTo(index) {
    if (!sbsState || index < 0 || index >= sbsState.pairs.length) return;
    sbsLoadPair(index);
  }

  function sbsLoadPair(index) {
    if (!sbsState) return;
    const state = sbsState, { shell, pairs } = state;
    const pair = pairs[index]; if (!pair) return;
    state.currentIndex = index;
    if (shell.querySelector('#sbsCounterText')) shell.querySelector('#sbsCounterText').textContent = `${index+1} / ${pairs.length}`;
    shell.querySelector('#seqClipName').textContent = pair.name || `Shot ${index+1}`;
    shell.querySelector('#seekBar').value = 0; shell.querySelector('#seekFill').style.width = '0%';
    shell.querySelector('#currentTime').textContent = '0:00'; shell.querySelector('#totalTime').textContent = '0:00';
    shell.querySelector('#playIcon').className = 'fas fa-play';
    if (state.v1) { state.v1.pause(); state.v1.src = ''; state.v1.remove(); state.v1 = null; }
    if (state.v2) { state.v2.pause(); state.v2.src = ''; state.v2.remove(); state.v2 = null; }
    const pane1 = shell.querySelector('#sbsPane1'), pane2 = shell.querySelector('#sbsPane2');
    const sp1   = shell.querySelector('#sbsSpinner1'), sp2 = shell.querySelector('#sbsSpinner2');
    if (sp1) sp1.style.display = 'flex'; if (sp2) sp2.style.display = 'flex';
    let v1Ready=false,v2Ready=false,v1Failed=false,v2Failed=false,localV1=null,localV2=null;
    const capturedIndex = index;
    function onBothReady() {
      if (!v1Ready||!v2Ready) return;
      if (sbsState!==state||state.currentIndex!==capturedIndex) return;
      if (sp1) sp1.style.display='none'; if (sp2) sp2.style.display='none';
      const dur = Math.max((!v1Failed&&localV1&&localV1.duration)||0,(!v2Failed&&localV2&&localV2.duration)||0);
      shell.querySelector('#totalTime').textContent = fmtTime(dur);
      if (!v1Failed&&localV1&&localV1.parentNode) localV1.play().catch(()=>{});
      if (!v2Failed&&localV2&&localV2.parentNode) localV2.play().catch(()=>{});
      if (!v2Failed||!v1Failed) shell.querySelector('#playIcon').className='fas fa-pause';
    }
    function makeVid(src,pane,spinner,onReady,isMain,markFailed) {
      const v = document.createElement('video');
      v.src=src; v.preload='auto'; v.playsInline=true;
      v.volume=isMain?state.volume:0; v.muted=!isMain; v.loop=state.loopEnabled;
      v.onloadedmetadata=()=>{onReady();onBothReady();};
      v.onerror=()=>{ if(spinner)spinner.style.display='none'; if(markFailed)markFailed(); onReady(); onBothReady(); };
      if(isMain){v.ontimeupdate=()=>{if(sbsState===state)sbsTimeUpdate(v);}; v.onended=()=>{if(sbsState===state&&state.currentIndex===capturedIndex)sbsOnEnded();};}
      pane.insertBefore(v,spinner||null); return v;
    }
    localV1 = makeVid(pair.first?pair.first.src:pair.src,pane1,sp1,()=>{v1Ready=true;},false,()=>{v1Failed=true;});
    localV2 = makeVid(pair.last?pair.last.src:pair.src,pane2,sp2,()=>{v2Ready=true;},true,()=>{v2Failed=true;});
    state.v1=localV1; state.v2=localV2;
  }

  function destroySBS() {
    if (!sbsState) return;
    const { shell, v1, v2 } = sbsState;
    if (v1) { v1.pause(); v1.src=''; v1.remove(); }
    if (v2) { v2.pause(); v2.src=''; v2.remove(); }
    document.removeEventListener('keydown', handleSBSKeyboard);
    shell.remove(); sbsState = null;
  }

  function sbsExitAndDestroy() {
    fsGuard.active = true;
    if (isInFullscreen()) {
      exitFullscreen(() => { destroySBS(); fsGuard.active = false; });
    } else {
      destroySBS(); fsGuard.active = false;
    }
  }

  function handleSBSKeyboard(e) {
    if (!sbsState) return;
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    const shell = sbsState.shell;
    const m = () => sbsState.v2||sbsState.v1;
    const seekBoth = t => {
      sbsState.syncing=true;
      [sbsState.v1,sbsState.v2].filter(Boolean).forEach(v=>{ if(v.readyState>=1) v.currentTime=t; });
      sbsState.syncing=false;
    };
    switch (e.key) {
      case ' ': case 'Spacebar': e.preventDefault(); shell.querySelector('#playPauseBtn').click(); break;
      case 'ArrowLeft':  e.preventDefault(); if(e.shiftKey) sbsJumpTo(sbsState.currentIndex-1); else{ const v=m(); if(v) seekBoth(Math.max(0,v.currentTime-1)); } break;
      case 'ArrowRight': e.preventDefault(); if(e.shiftKey) sbsJumpTo(sbsState.currentIndex+1); else{ const v=m(); if(v) seekBoth(Math.min(v.duration||Infinity,v.currentTime+1)); } break;
      case ',': case '<': e.preventDefault(); { const v=m(); if(v) seekBoth(Math.max(0,v.currentTime-1)); } break;
      case '.': case '>': e.preventDefault(); { const v=m(); if(v) seekBoth(Math.min(v.duration||Infinity,v.currentTime+1)); } break;
      case 'l': case 'L': e.preventDefault(); shell.querySelector('#loopToggleBtn').click(); break;
      case 'Escape': e.preventDefault(); sbsExitAndDestroy(); break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FULLSCREEN CHANGE — always minimize, never destroy
  // Registered once via VU.onFullscreenChange; no manual event loop needed.
  // ─────────────────────────────────────────────────────────────────────────
  onFullscreenChange(() => {
    if (fsGuard.active) return;
    if (!isInFullscreen()) {
      if (playerState) minimizePlayer();
      if (sbsState)    sbsExitAndDestroy();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────
  window.sequencePlayer = {
    launch:     launchContinuous,
    launchSBS:  launchSideBySide,
    destroy:    _hardDestroy,
    destroySBS: sbsExitAndDestroy,
    minimize:   minimizePlayer,
    restore:    restorePlayer,
  };

})();