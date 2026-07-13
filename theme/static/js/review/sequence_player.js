//sequence_branch
(function () {
  "use strict";

  const {
    seekByFrames,
    createLoopController,
    createVolumeController,
    setPlaying,
    updateSeekBar,
    fmtTime,
    isInFullscreen,
    enterFullscreen,
    exitFullscreen,
    onFullscreenChange,
    makeResizable,
  } = window.VideoUtils;

  // ─────────────────────────────────────────────────────────────────────────
  // STATE  —  pool-based: one entry per active merge/player
  // ─────────────────────────────────────────────────────────────────────────
  let activeMenu  = null;
  let activeState = null;
  const playerPool = [];
  const fsGuard = { active: false };

  function _poolAdd(state)    { playerPool.push(state); _repositionPills(); }
  function _poolRemove(state) { const i = playerPool.indexOf(state); if (i !== -1) playerPool.splice(i, 1); _repositionPills(); }

  function _repositionPills() {
    let bottom = 24;
    [...playerPool].reverse().forEach((s) => {
      const pill = s._miniPill;
      if (!pill) return;
      if (s._pillDragged) { bottom += (s._pillHeight || 56) + 8; return; }
      const prev = pill.style.transition;
      pill.style.transition = "none";
      pill.style.left   = "auto";
      pill.style.top    = "auto";
      pill.style.right  = "24px";
      pill.style.bottom = bottom + "px";
      void pill.offsetHeight;
      pill.style.transition = prev;
      bottom += (s._pillHeight || 56) + 8;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONTEXT MENU
  // ─────────────────────────────────────────────────────────────────────────
  function closeMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
    document.removeEventListener("click",   closeMenu);
    document.removeEventListener("keydown", menuKeydown);
  }
  function menuKeydown(e) { if (e.key === "Escape") closeMenu(); }

  document.addEventListener("click", function (e) {
    const row = e.target.closest(".seq-dept-row");
    if (!row) return;
    e.preventDefault(); e.stopPropagation();
    _showDeptMenu(e.clientX, e.clientY, row);
  });

  function _showDeptMenu(x, y, row) {
    closeMenu();
    const project = row.dataset.project;
    const seqName = row.dataset.seqName;
    const dept    = row.dataset.dept;
    const hasSbs  = row.dataset.hasSbs === "true";
    const menu = document.createElement("div");
    menu.className = "seq-context-menu";
    menu.innerHTML = `
      <div class="seq-ctx-header"><i class="fas fa-film"></i><span>${dept} — ${seqName}</span></div>
      <div class="seq-ctx-item" data-action="play-continuous"><i class="fas fa-film"></i><span>Play Continuous</span></div>
      ${hasSbs ? `<div class="seq-ctx-item" data-action="side-by-side"><i class="fas fa-columns"></i><span>Side by Side</span></div>` : ""}
    `;
    menu.style.left = "-9999px"; menu.style.top = "-9999px";
    document.body.appendChild(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth  - mw - 8) + "px";
    menu.style.top  = Math.min(y, window.innerHeight - mh - 8) + "px";
    activeMenu = menu;
    menu.querySelectorAll(".seq-ctx-item").forEach((item) => {
      item.addEventListener("click", (ev) => {
        ev.stopPropagation(); closeMenu();
        if (item.dataset.action === "play-continuous") launchContinuous(project, seqName, dept);
        if (item.dataset.action === "side-by-side")    launchSideBySide(project, seqName, dept);
      });
    });
    setTimeout(() => {
      document.addEventListener("click",   closeMenu);
      document.addEventListener("keydown", menuKeydown);
    }, 50);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TREE BINDING
  // ─────────────────────────────────────────────────────────────────────────
  function attachSeqContextMenus(root) {
    root = root || document;
    root.querySelectorAll(".seq-summary[data-project]").forEach((el) => { if (el._seqCtxBound) return; el._seqCtxBound = true; });
    root.querySelectorAll("[data-seq-name][data-project]").forEach((el) => { if (el._seqCtxBound) return; el._seqCtxBound = true; });
  }
  document.addEventListener("htmx:afterSwap", () => attachSeqContextMenus());
  document.addEventListener("DOMContentLoaded", () => attachSeqContextMenus());
  if (document.readyState !== "loading") attachSeqContextMenus();

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
  // MINI PLAYER POSITIONING HELPERS
  // Convert right/bottom to left/top so makeResizable works correctly.
  // makeResizable resizes by adjusting width/height and left/top, which only
  // works when the element is positioned with left/top, not right/bottom.
  // ─────────────────────────────────────────────────────────────────────────
  function _miniInitialPosition(mini) {
    // Place at bottom-right using left/top so resize handles work in natural directions
    const w = mini.offsetWidth  || 340;
    const h = mini.offsetHeight || 260;
    mini.style.right  = "auto";
    mini.style.bottom = "auto";
    mini.style.left   = (window.innerWidth  - w - 24) + "px";
    mini.style.top    = (window.innerHeight - h - 24) + "px";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEQ MINI PLAYER
  // ─────────────────────────────────────────────────────────────────────────
  function openSeqMiniPlayer(state) {
    state = state || activeState;
    if (!state || !state.video) return;
    if (state._miniVideoEl) return;

    const src       = state.video.src;
    const startTime = state.video.currentTime || 0;

    const mini = document.createElement("div");
    mini.className = "seqMiniPlayerInstance";
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
        <div class="seqMiniDragHandle"></div>
        <div class="seqMiniLabel">${state.project} / ${state.seqName}${state.dept && state.dept !== "SBS" ? " / " + state.dept : ""}</div>
        <div class="seqMiniVideoWrap">
          <div class="seqMiniProgress"><div class="seqMiniProgressFill"></div></div>
          <video class="seqMiniVideo" playsinline webkit-playsinline></video>
          <div class="seqMiniOverlay">
            <div class="seqMiniPlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>
          </div>
        </div>
        <div class="seqMiniControls">
          <button class="seqMiniPlayBtn"><i class="fas fa-pause seqMiniPlayBtnIcon"></i></button>
          <span   class="seqMiniTime">0:00 / 0:00</span>
          <button class="seqMiniVolBtn"><i class="fas fa-volume-up seqMiniVolIcon"></i></button>
          <button class="seqMiniExpandBtn"><i class="fas fa-expand"></i></button>
          <button class="seqMiniCloseBtn"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(mini);
    state._miniVideoEl = mini;

    // BUG FIX: position with left/top so makeResizable directions are correct
    _miniInitialPosition(mini);
    mini.style.position = "fixed";
    mini.style.zIndex   = "99990";

    const video        = mini.querySelector(".seqMiniVideo");
    // BUG FIX: reference icon by its SECOND class, not by className assignment
    // Use a data attribute to avoid touching the fa- classes
    const playBtnIcon  = mini.querySelector(".seqMiniPlayBtnIcon");
    const volBtn       = mini.querySelector(".seqMiniVolBtn");
    const volIconEl    = mini.querySelector(".seqMiniVolIcon");
    const expandBtn    = mini.querySelector(".seqMiniExpandBtn");
    const closeBtn     = mini.querySelector(".seqMiniCloseBtn");
    const timeEl       = mini.querySelector(".seqMiniTime");
    const progressFill = mini.querySelector(".seqMiniProgressFill");
    const videoWrap    = mini.querySelector(".seqMiniVideoWrap");
    const dragHandle   = mini.querySelector(".seqMiniDragHandle");
    const playBtn      = mini.querySelector(".seqMiniPlayBtn");

    video.src     = src;
    video.preload = "auto";
    video.volume  = state.volume || 1;
    video.loop    = state.loopEnabled || false;

    createVolumeController({ getPrimary: () => [video], slider: null, muteBtn: volBtn, volIcon: volIconEl });

    const onMeta = () => { video.currentTime = startTime; video.play().catch(() => {}); updateMiniTime(); };
    if (video.readyState >= 1) onMeta();
    else video.addEventListener("loadedmetadata", onMeta, { once: true });

    // BUG FIX: toggle only the fa-play/fa-pause class, preserve seqMiniPlayBtnIcon
    function setPlayIcon(paused) {
      playBtnIcon.classList.toggle("fa-play",  paused);
      playBtnIcon.classList.toggle("fa-pause", !paused);
      const pi = mini.querySelector(".seqMiniPlayIcon i");
      if (pi) {
        pi.classList.toggle("fa-play",  paused);
        pi.classList.toggle("fa-pause", !paused);
        pi.style.marginLeft = paused ? "2px" : "0";
      }
    }

    function updateMiniTime() {
      const cur = video.currentTime || 0, dur = video.duration || 0;
      timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      progressFill.style.width = dur ? (cur / dur) * 100 + "%" : "0%";
      setPlayIcon(video.paused);
    }
    video.addEventListener("timeupdate", updateMiniTime);
    video.addEventListener("play",  () => setPlayIcon(false));
    video.addEventListener("pause", () => setPlayIcon(true));

    function togglePlay() { video.paused ? video.play().catch(() => {}) : video.pause(); }
    videoWrap.addEventListener("click", (e) => { if (e.target === dragHandle) return; togglePlay(); });
    playBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });

    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ct = video.currentTime;
      _destroyMiniVideo(state);
      if (state.video) state.video.currentTime = ct;
      _restoreState(state);
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _destroyMiniVideo(state);
      if (state._miniPill) state._miniPill.style.display = "";
    });

    // ── Drag (left/top system to match positioning) ──────────────────────────
    let isDragging = false, dragStartX = 0, dragStartY = 0, initLeft = 0, initTop = 0;
    dragHandle.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initLeft = rect.left; initTop = rect.top;
      mini.classList.add("seq-mini-dragging");
      e.preventDefault();
    });
    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      mini.style.left = Math.max(8, Math.min(initLeft + dx, window.innerWidth  - mini.offsetWidth  - 8)) + "px";
      mini.style.top  = Math.max(8, Math.min(initTop  + dy, window.innerHeight - mini.offsetHeight - 8)) + "px";
    }
    function onDragUp() { if (isDragging) { isDragging = false; mini.classList.remove("seq-mini-dragging"); } }
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup",   onDragUp);

    const resizer = makeResizable(mini, { minW: 200, minH: 150, resizingClass: "seq-mini-resizing", handleSelector: ".seq-resize-handle" });

    mini._destroy = () => {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup",   onDragUp);
      resizer.destroy();
      video.pause(); video.src = "";
    };

    requestAnimationFrame(() => requestAnimationFrame(() => mini.classList.add("seq-mini-visible")));
  }

  function _destroyMiniVideo(state) {
    if (!state._miniVideoEl) return;
    const el = state._miniVideoEl;
    if (typeof el._destroy === "function") el._destroy();
    el.classList.remove("seq-mini-visible", "sbs-mini-visible");
    setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
    state._miniVideoEl = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SBS MINI PLAYER
  // ─────────────────────────────────────────────────────────────────────────
  function openSBSMiniPlayer(state) {
    state = state || activeState;
    if (!state) return;
    if (state._miniVideoEl) return;

    const v1src     = state.v1 ? state.v1.src || "" : "";
    const v2src     = state.v2 ? state.v2.src || "" : "";
    const startTime = state.v2 ? state.v2.currentTime : state.v1 ? state.v1.currentTime : 0;

    const mini = document.createElement("div");
    mini.className = "sbsMiniPlayerInstance";
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
        <div class="sbsMiniDragHandle"></div>
        <div class="sbsMiniLabel">${state.project} / ${state.seqName} — SBS</div>
        <div class="sbsMiniVideoWrap">
          <div class="sbsMiniProgress"><div class="sbsMiniProgressFill"></div></div>
          <div class="sbs-mini-panel sbsMiniPanel1"><span class="sbs-mini-badge sbs-mini-badge-left">Left</span></div>
          <div class="sbs-mini-panel sbsMiniPanel2"><span class="sbs-mini-badge sbs-mini-badge-right">Right</span></div>
          <div class="sbsMiniOverlay">
            <div class="sbsMiniPlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>
          </div>
        </div>
        <div class="sbsMiniControls">
          <button class="sbsMiniPlayBtn"><i class="fas fa-pause sbsMiniPlayBtnIcon"></i></button>
          <span   class="sbsMiniTime">0:00 / 0:00</span>
          <button class="sbsMiniVolBtn"><i class="fas fa-volume-up sbsMiniVolIcon"></i></button>
          <button class="sbsMiniExpandBtn"><i class="fas fa-expand"></i></button>
          <button class="sbsMiniCloseBtn"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(mini);
    state._miniVideoEl = mini;

    // BUG FIX: left/top positioning
    _miniInitialPosition(mini);
    mini.style.position = "fixed";
    mini.style.zIndex   = "99990";

    const panel1      = mini.querySelector(".sbsMiniPanel1");
    const panel2      = mini.querySelector(".sbsMiniPanel2");
    const playBtn     = mini.querySelector(".sbsMiniPlayBtn");
    const playBtnIcon = mini.querySelector(".sbsMiniPlayBtnIcon");
    const volBtn      = mini.querySelector(".sbsMiniVolBtn");
    const volIconEl   = mini.querySelector(".sbsMiniVolIcon");
    const expandBtn   = mini.querySelector(".sbsMiniExpandBtn");
    const closeBtn    = mini.querySelector(".sbsMiniCloseBtn");
    const timeEl      = mini.querySelector(".sbsMiniTime");
    const progressFill= mini.querySelector(".sbsMiniProgressFill");
    const videoWrap   = mini.querySelector(".sbsMiniVideoWrap");
    const dragHandle  = mini.querySelector(".sbsMiniDragHandle");

    function makeVid(src, panel, muted) {
      if (!src) return null;
      const v = document.createElement("video");
      v.src = src; v.preload = "auto"; v.muted = muted;
      v.setAttribute("playsinline", "");
      panel.appendChild(v);
      return v;
    }
    const mv1 = makeVid(v1src, panel1, true);
    const mv2 = makeVid(v2src, panel2, false);
    const primary = mv2 || mv1;

    createVolumeController({ getPrimary: () => (primary ? [primary] : []), slider: null, muteBtn: volBtn, volIcon: volIconEl });

    // BUG FIX: toggle classes, don't replace className
    function setSBSPlayIcon(paused) {
      playBtnIcon.classList.toggle("fa-play",  paused);
      playBtnIcon.classList.toggle("fa-pause", !paused);
      const pi = mini.querySelector(".sbsMiniPlayIcon i");
      if (pi) {
        pi.classList.toggle("fa-play",  paused);
        pi.classList.toggle("fa-pause", !paused);
        pi.style.marginLeft = paused ? "2px" : "0";
      }
    }

    function updateTime() {
      if (!primary) return;
      const cur = primary.currentTime || 0, dur = primary.duration || 0;
      timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
      progressFill.style.width = dur ? (cur / dur) * 100 + "%" : "0%";
      setSBSPlayIcon(primary.paused);
      if (mv1 && mv1 !== primary && Math.abs(mv1.currentTime - primary.currentTime) > 0.15)
        mv1.currentTime = primary.currentTime;
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
      else primary.addEventListener("loadedmetadata", onMeta, { once: true });
      primary.addEventListener("timeupdate", updateTime);
      primary.addEventListener("play",  () => { setSBSPlayIcon(false); if (mv1 && mv1 !== primary) mv1.play().catch(() => {}); });
      primary.addEventListener("pause", () => { setSBSPlayIcon(true);  if (mv1 && mv1 !== primary) mv1.pause(); });
      primary.addEventListener("seeked", () => { if (mv1 && mv1 !== primary) mv1.currentTime = primary.currentTime; });
    }

    function togglePlay() {
      if (!primary) return;
      if (primary.paused) { primary.play().catch(() => {}); if (mv1 && mv1 !== primary) mv1.play().catch(() => {}); }
      else                { primary.pause();                 if (mv1 && mv1 !== primary) mv1.pause(); }
    }
    videoWrap.addEventListener("click", (e) => { if (e.target === dragHandle) return; togglePlay(); });
    playBtn.addEventListener("click",   (e) => { e.stopPropagation(); togglePlay(); });

    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ct = primary ? primary.currentTime : 0;
      _destroyMiniVideo(state);
      if (state.v1) state.v1.currentTime = ct;
      if (state.v2) state.v2.currentTime = ct;
      _restoreState(state);
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _destroyMiniVideo(state);
      if (state._miniPill) state._miniPill.style.display = "";
    });

    // ── Drag (left/top system) ───────────────────────────────────────────────
    let isDragging = false, dragStartX = 0, dragStartY = 0, initLeft = 0, initTop = 0;
    dragHandle.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initLeft = rect.left; initTop = rect.top;
      mini.classList.add("sbs-mini-dragging");
      e.preventDefault();
    });
    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      mini.style.left = Math.max(8, Math.min(initLeft + dx, window.innerWidth  - mini.offsetWidth  - 8)) + "px";
      mini.style.top  = Math.max(8, Math.min(initTop  + dy, window.innerHeight - mini.offsetHeight - 8)) + "px";
    }
    function onDragUp() { if (isDragging) { isDragging = false; mini.classList.remove("sbs-mini-dragging"); } }
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup",   onDragUp);

    const resizer = makeResizable(mini, { minW: 300, minH: 150, resizingClass: "sbs-mini-resizing", handleSelector: ".seq-resize-handle" });

    mini._destroy = () => {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup",   onDragUp);
      resizer.destroy();
      if (mv1) { mv1.pause(); mv1.src = ""; }
      if (mv2) { mv2.pause(); mv2.src = ""; }
    };

    requestAnimationFrame(() => requestAnimationFrame(() => mini.classList.add("sbs-mini-visible")));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PILL
  // ═══════════════════════════════════════════════════════════════════════════
  function _buildPill(state) {
    if (state._miniPill) {
      if (typeof state._miniPill._destroyDrag === "function") state._miniPill._destroyDrag();
      state._miniPill.remove();
      state._miniPill = null;
    }

    const isSBS     = state.dept === "SBS";
    const isMerging = !state.video;
    const label     = isSBS
      ? `${state.project} / ${state.seqName} — SBS`
      : `${state.project} / ${state.seqName}${state.dept ? " / " + state.dept : ""}`;

    const pill = document.createElement("div");
    pill.className = "seqMiniPillInstance" + (isMerging ? " pill-merging" : "");
    pill.innerHTML = `
      <div class="pill-icon"><i class="fas ${isSBS ? "fa-columns" : "fa-film"}"></i></div>
      <div class="pill-info">
        <div class="pill-title">${label}</div>
        <div class="pill-sub pill-sub-${state._id}">${isMerging ? "Merging in background…" : "Paused · click to restore"}</div>
        ${isMerging ? `<div class="pill-bar-track"><div class="pill-bar-fill pill-bar-fill-${state._id}"></div></div>` : ""}
      </div>
      <div class="pill-actions">
        ${!isMerging ? `<button class="pill-mini-btn" title="Mini preview"><i class="fas fa-clone"></i></button>` : ""}
        <button class="pill-restore-btn" title="Restore fullscreen"><i class="fas fa-expand"></i></button>
        <button class="pill-close-btn"   title="Close"><i class="fas fa-times"></i></button>
      </div>
    `;
    document.body.appendChild(pill);
    state._pillHeight  = pill.offsetHeight || 56;
    state._miniPill    = pill;

    pill.addEventListener("click", (e) => {
      if (e.target.closest(".pill-actions")) return;
      if (pill._wasDragged) { pill._wasDragged = false; return; }
      if (isMerging) { _restoreState(state); return; }
      isSBS ? openSBSMiniPlayer(state) : openSeqMiniPlayer(state);
    });

    const miniBtn = pill.querySelector(".pill-mini-btn");
    if (miniBtn) {
      miniBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        isSBS ? openSBSMiniPlayer(state) : openSeqMiniPlayer(state);
      });
    }

    pill.querySelector(".pill-restore-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      _destroyMiniVideo(state);
      _restoreState(state);
    });

    pill.querySelector(".pill-close-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (!!state.video) {
    _showDeleteConfirm(
      () => { _destroyMiniVideo(state); _destroyStateAndDelete(state); },  // Delete clip + remove pill
      () => {},                                                              // Continue — dismiss dialog, pill stays
      () => { _destroyMiniVideo(state); _destroyStateKeepFile(state); }    // Cancel — remove pill, keep file
    );
  } else {
    _destroyMiniVideo(state);
    _hardDestroyState(state);
  }
});

    // Pill drag
    let isDragging = false, dragStartX = 0, dragStartY = 0, baseLeft = 0, baseTop = 0;
    const DRAG_THRESHOLD = 4; let movedDistance = 0;
    pill.addEventListener("mousedown", (e) => {
      if (e.target.closest(".pill-actions")) return;
      isDragging = true; movedDistance = 0; pill._wasDragged = false;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = pill.getBoundingClientRect();
      baseLeft = rect.left; baseTop = rect.top;
      pill.style.right = "auto"; pill.style.bottom = "auto";
      pill.style.left = baseLeft + "px"; pill.style.top = baseTop + "px";
      state._pillDragged = true;
      e.preventDefault();
    });
    function onMouseMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      movedDistance = Math.max(movedDistance, Math.abs(dx) + Math.abs(dy));
      if (movedDistance > DRAG_THRESHOLD) { pill.classList.add("seq-pill-dragging"); pill._wasDragged = true; }
      pill.style.left = Math.max(8, Math.min(baseLeft + dx, window.innerWidth  - pill.offsetWidth  - 8)) + "px";
      pill.style.top  = Math.max(8, Math.min(baseTop  + dy, window.innerHeight - pill.offsetHeight - 8)) + "px";
    }
    function onMouseUp() { if (!isDragging) return; isDragging = false; pill.classList.remove("seq-pill-dragging"); }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup",   onMouseUp);
    pill._destroyDrag = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup",   onMouseUp);
    };

    _repositionPills();
    return pill;
  }

  function _removePill(state) {
    if (!state._miniPill) return;
    if (typeof state._miniPill._destroyDrag === "function") state._miniPill._destroyDrag();
    state._miniPill.remove();
    state._miniPill    = null;
    state._pillHeight  = 0;
    state._pillDragged = false;
    if (playerPool.some(s => s._miniPill)) _repositionPills();
  }

  function _updatePillProgress(state, pct, label) {
    if (!state._miniPill) return;
    const pillFill = state._miniPill.querySelector(`.pill-bar-fill-${state._id}`);
    const pillSub  = state._miniPill.querySelector(`.pill-sub-${state._id}`);
    if (pillFill) pillFill.style.width = Math.min(pct, 100) + "%";
    if (pillSub)  pillSub.textContent  = label || "Merging in background…";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MINIMIZE / RESTORE
  // ─────────────────────────────────────────────────────────────────────────
  function _minimizeState(state) {
    if (!state || state.minimized) return;
    fsGuard.active = true;
    const doMinimize = () => {
      if (!state) { fsGuard.active = false; return; }
      if (state.video) { try { state.video.pause(); } catch (_) {} }
      if (state.v1)    { try { state.v1.pause(); } catch (_) {} }
      if (state.v2)    { try { state.v2.pause(); } catch (_) {} }
      state.shell.style.display = "none";
      state.minimized = true;
      fsGuard.active = false;
      if (!state._miniPill) _buildPill(state);
      else state._miniPill.style.display = "";
      if (activeState === state) activeState = null;
    };
    if (isInFullscreen()) exitFullscreen(doMinimize);
    else doMinimize();
  }

  function _restoreState(state) {
    if (!state) return;
    if (activeState && activeState !== state) _minimizeState(activeState);
    _removePill(state);
    state.minimized = false;
    state.shell.style.display = "";
    activeState = state;
    fsGuard.active = true;
    enterFullscreen(state.shell, () => { fsGuard.active = false; });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DESTROY HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  function _hardDestroyState(state) {
    if (!state) return;
    if (typeof state._cancel === "function") state._cancel();
    const jobId = state._jobId, mergeIsDone = !!state.video;
    if (jobId && !mergeIsDone)
      fetch(`/merge-output/cancel/${jobId}/`, { method: "POST", keepalive: true }).catch(() => {});
    _destroyMiniVideo(state);
    _removePill(state);
    _poolRemove(state);
    fsGuard.active = true;
    const doDestroy = () => { _destroyStateShell(state); fsGuard.active = false; if (activeState === state) activeState = null; };
    if (isInFullscreen() && activeState === state) exitFullscreen(doDestroy);
    else doDestroy();
  }

  function _destroyStateAndDelete(state) {
    if (!state) return;
    if (typeof state._cancel === "function") state._cancel();
    const jobId = state._jobId;
    _destroyMiniVideo(state); _removePill(state); _poolRemove(state);
    const doDestroy = () => { _destroyStateShell(state); fsGuard.active = false; if (activeState === state) activeState = null; };
    if (jobId) {
      fetch(`/merge-output/delete/${jobId}/`, { method: "POST", keepalive: true })
        .then(r => r.json())
        .then(data => { if (data.deleted && window.Toast) Toast.success("Merged clip deleted.", "Deleted"); })
        .catch(() => { if (window.Toast) Toast.error("Could not delete file.", "Delete Failed"); })
        .finally(() => { fsGuard.active = true; if (isInFullscreen() && activeState === state) exitFullscreen(doDestroy); else doDestroy(); });
    } else {
      fsGuard.active = true;
      if (isInFullscreen() && activeState === state) exitFullscreen(doDestroy); else doDestroy();
    }
  }

  function _destroyStateKeepFile(state) {
    if (!state) return;
    if (typeof state._cancel === "function") state._cancel();
    _destroyMiniVideo(state); _removePill(state); _poolRemove(state);
    fsGuard.active = true;
    const doDestroy = () => { _destroyStateShell(state); fsGuard.active = false; if (activeState === state) activeState = null; };
    if (isInFullscreen() && activeState === state) exitFullscreen(doDestroy); else doDestroy();
  }

  function _destroyStateShell(state) {
    if (!state.shell) return;
    if (state.video) { state.video.pause(); state.video.src = ""; state.video.remove(); }
    if (state.v1)    { state.v1.pause(); state.v1.src = ""; state.v1.remove(); }
    if (state.v2)    { state.v2.pause(); state.v2.src = ""; state.v2.remove(); }
    document.removeEventListener("keydown", _keyboardHandler);
    state.shell.remove();
    state.shell = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE CONFIRM DIALOG
  // ─────────────────────────────────────────────────────────────────────────
  function _showDeleteConfirm(onDelete, onKeep, onCancel) {
    document.getElementById("seqDeleteConfirmOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "seqDeleteConfirmOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);backdrop-filter:blur(4px);animation:seqFadeIn .15s ease;";
    overlay.innerHTML = `
      <style>
        @keyframes seqFadeIn { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }
        #seqDeleteConfirmBox{background:#1a1d23;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:28px 32px 24px;width:360px;box-shadow:0 24px 64px rgba(0,0,0,.6);font-family:inherit;}
        #seqDeleteConfirmBox .dcb-icon{width:48px;height:48px;border-radius:50%;background:rgba(239,68,68,.15);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:20px;color:#f87171;}
        #seqDeleteConfirmBox h3{margin:0 0 8px;text-align:center;font-size:16px;font-weight:600;color:#f1f5f9;}
        #seqDeleteConfirmBox p{margin:0 0 24px;text-align:center;font-size:13px;color:#94a3b8;line-height:1.5;}
        #seqDeleteConfirmBox .dcb-actions{display:flex;gap:10px;}
        #seqDeleteConfirmBox button{flex:1;padding:10px 0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:opacity .15s,transform .1s;}
        #seqDeleteConfirmBox button:hover{opacity:.88;}
        #seqDeleteConfirmBox button:active{transform:scale(.97);}
        #seqDcbYes{background:#ef4444;color:#fff;}
        #seqDcbNo{background:rgba(255,255,255,.08);color:#cbd5e1;border:1px solid rgba(255,255,255,.1)!important;}
        #seqDcbCancel{background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25)!important;}
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
    (document.fullscreenElement || document.body).appendChild(overlay);
    const cleanup = () => { overlay.style.opacity = "0"; overlay.style.transition = "opacity .15s"; setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 160); };
    overlay.querySelector("#seqDcbYes").addEventListener("click",    () => { cleanup(); onDelete(); });
    overlay.querySelector("#seqDcbNo").addEventListener("click",     () => { cleanup(); onKeep(); });
    overlay.querySelector("#seqDcbCancel").addEventListener("click", () => { cleanup(); onCancel(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { cleanup(); onKeep(); } });
    const onEsc = (e) => { if (e.key === "Escape") { document.removeEventListener("keydown", onEsc); cleanup(); onKeep(); } };
    document.addEventListener("keydown", onEsc);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONTINUOUS PLAYER
  // ─────────────────────────────────────────────────────────────────────────
  let _stateIdCounter = 0;

  function launchContinuous(project, seqName, dept) {
    const existing = playerPool.find(s => s.project === project && s.seqName === seqName && s.dept === dept);
    if (existing) { _restoreState(existing); return; }
    if (activeState) _minimizeState(activeState);

    const shell = _buildMergedShell(project, seqName, dept);
    document.body.appendChild(shell);

    const cancelRef = { value: false };
    const isCancelled = () => cancelRef.value;
    const stateId = ++_stateIdCounter;

    const state = {
      _id: stateId, mode: "merged", shell,
      video: null, v1: null, v2: null,
      loopEnabled: false, volume: 1,
      project, seqName, dept,
      minimized: false, _miniPill: null, _miniVideoEl: null,
      _jobId: null, _pillDragged: false,
      _cancel: () => { cancelRef.value = true; },
    };

    _poolAdd(state);
    activeState = state;

    shell.querySelector(".mo-cancel").addEventListener("click",   () => _hardDestroyState(state));
    shell.querySelector(".mo-minimize").addEventListener("click", () => _minimizeState(state));
    shell.querySelector("#seqMinimizeBtn").addEventListener("click", (e) => { e.stopPropagation(); _minimizeState(state); });
    shell.querySelector("#seqCloseBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      _showDeleteConfirm(
        () => _destroyStateAndDelete(state),
        () => {},
        () => _hardDestroyState(state)
      );
    });
    shell.querySelector("#seqMiniPreviewBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.video) return;
      fsGuard.active = true;
      const doMini = () => {
        state.video.pause(); shell.style.display = "none"; state.minimized = true;
        activeState = null; fsGuard.active = false;
        if (!state._miniPill) _buildPill(state); else state._miniPill.style.display = "";
        openSeqMiniPlayer(state);
      };
      if (isInFullscreen()) exitFullscreen(doMini); else doMini();
    });

    document.removeEventListener("keydown", _keyboardHandler);
    document.addEventListener("keydown", _keyboardHandler);
    fsGuard.active = false;

    enterFullscreen(shell, () => _startMergeJob(project, seqName, dept, shell, isCancelled, state));
  }

  function _startMergeJob(project, seqName, dept, shell, isCancelled, state) {
    _setMergeStatus(shell, state, 0, 0, 0, `Requesting merge for ${seqName}…`);
    const fd = new FormData();
    fd.append("project", project); fd.append("sequence", seqName); fd.append("dept", dept || "");
    fetch("/merge-sequence-clips/", { method: "POST", body: fd })
      .then(r => r.json())
      .then(({ job_id, error }) => {
        if (isCancelled()) return;
        if (!job_id) { _showMergeError(shell, state, error || "Could not start merge job."); return; }
        state._jobId = job_id;
        _pollJob(job_id, shell, isCancelled, state);
      })
      .catch(err => { if (!isCancelled()) _showMergeError(shell, state, `Network error: ${err.message}`); });
  }

  function _pollJob(job_id, shell, isCancelled, state) {
    if (isCancelled()) return;
    fetch(`/merge-sequence-clips/status/?job_id=${encodeURIComponent(job_id)}`)
      .then(r => r.json())
      .then(job => {
        if (isCancelled()) return;
        _setMergeStatus(shell, state, job.progress||0, job.clips_done||0, job.clips_total||0, _mergeStatusLabel(job));
        if (job.status === "done")   { _loadMergedVideo(shell, job.output_web, state); return; }
        if (job.status === "failed") { _showMergeError(shell, state, job.error || "Merge failed."); return; }
        setTimeout(() => _pollJob(job_id, shell, isCancelled, state), 800);
      })
      .catch(err => { if (!isCancelled()) _showMergeError(shell, state, `Poll error: ${err.message}`); });
  }

  function _mergeStatusLabel(job) {
    if (job.status === "queued")  return "Queued…";
    if (job.status === "running") {
      const done = job.clips_done||0, total = job.clips_total||0, pct = job.progress||0;
      return total > 0 ? `Merging clip ${done} / ${total}  (${pct}%)` : `Merging clips… ${pct}%`;
    }
    return "";
  }

  function _setMergeStatus(shell, state, pct, done, total, label) {
    const overlay = shell.querySelector("#mergingOverlay");
    if (overlay) {
      const fill  = overlay.querySelector(".mo-bar-fill");
      const stat  = overlay.querySelector(".mo-status");
      const clips = overlay.querySelector(".mo-clips");
      if (fill)  fill.style.width = Math.min(pct, 100) + "%";
      if (stat)  stat.textContent = label;
      if (clips) clips.innerHTML  = total > 0
        ? `<i class="fas fa-film"></i> ${done} / ${total} clips processed`
        : `<i class="fas fa-cog fa-spin"></i> Analyzing sequence…`;
    }
    _updatePillProgress(state, pct, label || (total > 0 ? `${done} / ${total} clips — ${pct}%` : "Merging in background…"));
  }

  function _showMergeError(shell, state, msg) {
    const overlay = shell.querySelector("#mergingOverlay");
    if (overlay) {
      overlay.classList.add("mo-error");
      overlay.querySelector(".mo-icon").innerHTML = '<i class="fas fa-exclamation-circle"></i>';
      overlay.querySelector(".mo-title").textContent  = "Merge Failed";
      overlay.querySelector(".mo-status").textContent = msg;
      overlay.querySelector(".mo-clips").innerHTML    = "";
      const cancelBtn = overlay.querySelector(".mo-cancel");
      if (cancelBtn) cancelBtn.textContent = "Close";
    }
    if (state._miniPill) {
      const pill     = state._miniPill;
      const pillSub  = pill.querySelector(`.pill-sub-${state._id}`);
      const pillFill = pill.querySelector(`.pill-bar-fill-${state._id}`);
      pill.classList.remove("pill-merging");
      pill.style.borderColor = "rgba(239,68,68,.4)";
      if (pillSub)  { pillSub.style.color = "#f87171"; pillSub.textContent = "✕ Merge failed — click to view"; }
      if (pillFill) { pillFill.style.background = "rgba(239,68,68,.6)"; pillFill.style.width = "100%"; }
    }
    if (window.Toast) Toast.error(msg, "Merge Error");
  }

  function _loadMergedVideo(shell, src, state) {
    const overlay   = shell.querySelector("#mergingOverlay");
    const mediaArea = shell.querySelector("#seqMediaArea");
    const nameEl    = shell.querySelector("#seqClipName");

    if (overlay) overlay.remove();
    if (nameEl)  nameEl.textContent = `${state.project} / ${state.seqName}${state.dept && state.dept !== "SBS" ? " / " + state.dept : ""}`;

    if (state._jobId) {
      const actions = shell.querySelector(".seq-topbar-actions");
      if (actions && !shell.querySelector("#seqDownloadBtn")) {
        const dlBtn = document.createElement("button");
        dlBtn.id = "seqDownloadBtn"; dlBtn.title = "Download merged clip";
        dlBtn.innerHTML = '<i class="fas fa-download"></i>';
        actions.insertBefore(dlBtn, actions.firstChild);
       dlBtn.addEventListener("click", (e) => {
  e.stopPropagation();

  // Visual feedback while the browser is fetching the file
  const origHTML = dlBtn.innerHTML;
  dlBtn.disabled = true;
  dlBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  const url = `/merge-output/${state._jobId}/?download=1`;

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Server returned ${res.status} ${res.statusText}`);
      return res.blob();
    })
    .then((blob) => {
      // Derive a filename from Content-Disposition or fall back to a safe default
      const disposition = "";   // fetch doesn't expose C-D cross-origin; keep simple
      const filename    = `${state.project}_${state.seqName}${state.dept && state.dept !== "SBS" ? "_" + state.dept : ""}_merged.mp4`
                            .replace(/[^\w\-_.]/g, "_");

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href     = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Release the object URL shortly after the browser picks it up
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      if (window.Toast) Toast.success(`"${filename}" saved to your drive.`, "Download complete");
    })
    .catch((err) => {
      console.error("[Download]", err);
      if (window.Toast) Toast.error(`Download failed: ${err.message}`, "Download Error");
    })
    .finally(() => {
      dlBtn.disabled  = false;
      dlBtn.innerHTML = origHTML;
    });
});
      }
    }

    const existingMini = shell.querySelector("#seqMiniPreviewBtn");
    if (existingMini) existingMini.style.display = "";

    if (state._miniPill) {
      const pill      = state._miniPill;
      const pillSub   = pill.querySelector(`.pill-sub-${state._id}`);
      const pillBarEl = pill.querySelector(".pill-bar-track");
      const pillIcon  = pill.querySelector(".pill-icon i");
      pill.classList.remove("pill-merging");
      if (pillSub)   { pillSub.style.color = "#6ee7b7"; pillSub.textContent = "✓ Merge complete — click to watch"; }
      if (pillBarEl) pillBarEl.remove();
      if (pillIcon)  pillIcon.style.color = "#6ee7b7";
      const pillActions = pill.querySelector(".pill-actions");
      if (pillActions && !pill.querySelector(".pill-mini-btn")) {
        const mb = document.createElement("button");
        mb.className = "pill-mini-btn"; mb.title = "Mini preview";
        mb.innerHTML = '<i class="fas fa-clone"></i>';
        pillActions.insertBefore(mb, pillActions.firstChild);
        // BUG FIX: use correct opener based on dept
        mb.addEventListener("click", (e) => {
          e.stopPropagation();
          state.dept === "SBS" ? openSBSMiniPlayer(state) : openSeqMiniPlayer(state);
        });
      }
      if (window.Toast) Toast.success(`${state.seqName} merge complete! Click pill to watch.`, "✓ Ready");
    }

    const loadingEl = shell.querySelector("#seqLoadingOverlay");
    if (loadingEl) loadingEl.style.display = "flex";

    const video = document.createElement("video");
    video.id = "seqVideo"; video.preload = "auto"; video.playsInline = true;
    video.src = src; video.volume = state.volume; video.loop = state.loopEnabled;

    const seekBar  = shell.querySelector("#seekBar");
    const seekFill = shell.querySelector("#seekFill");

    video.addEventListener("loadedmetadata", () => {
      if (loadingEl) loadingEl.style.display = "none";
      shell.querySelector("#totalTime").textContent = fmtTime(video.duration);
      seekBar.value = 0; seekFill.style.width = "0%";
      if (!state.minimized) { video.play().catch(() => {}); shell.querySelector("#playIcon").className = "fas fa-pause"; }
    }, { once: true });

    video._seekUntil = 0;
    video.addEventListener("timeupdate", () => {
      if (Date.now() < video._seekUntil) return;
      updateSeekBar({ primary: video, seekBar, seekFill, currentTimeEl: shell.querySelector("#currentTime") });
    });
    video.addEventListener("ended", () => {
      video._seekUntil = Date.now() + 300;
      video.currentTime = video.duration - 0.05;
      shell.querySelector("#playIcon").className = "fas fa-play";
      if (window.Toast) Toast.success("Sequence complete!", "✓ Done");
    });

    mediaArea.insertBefore(video, mediaArea.firstChild);
    state.video = video;
    _wireMergedControls(shell, state);
  }

 function _wireMergedControls(shell, state) {
    if (shell._controlsWired) return;
    shell._controlsWired = true;

    const vid      = () => state.video;
    const ppBtn    = shell.querySelector("#playPauseBtn");
    const playIcon = shell.querySelector("#playIcon");
    const seekBar  = shell.querySelector("#seekBar");
    const seekFill = shell.querySelector("#seekFill");
    const ctEl     = shell.querySelector("#currentTime");
    const fbBtn    = shell.querySelector("#frameBackBtn");
    const ffBtn    = shell.querySelector("#frameForwardBtn");
    const loopBtn  = shell.querySelector("#loopToggleBtn");
    const muteBtn  = shell.querySelector("#muteBtn");
    const volIcon  = shell.querySelector("#volIcon");
    const volBar   = shell.querySelector("#volumeBar");
    const media    = shell.querySelector("#seqMediaArea");

    const loopCtrl = createLoopController({
      getVideos: () => { const v = vid(); return v ? [v] : []; },
      btn: loopBtn,
      activeColor: "#10b981"
    });
    loopBtn.addEventListener("click", () => { state.loopEnabled = loopCtrl.isEnabled(); });

    createVolumeController({
      getPrimary: () => { const v = vid(); return v ? [v] : []; },
      slider: volBar,
      muteBtn,
      volIcon
    });

    // ── Icon sync — owned exclusively by play/pause events ──────────────────
    function syncPlayIcon() {
      const v = vid();
      if (!v) return;
      playIcon.className = v.paused ? "fas fa-play" : "fas fa-pause";
    }

    // Wire up events once the video element exists on state
    function _bindVideoEvents(v) {
      v.addEventListener("play",  syncPlayIcon);
      v.addEventListener("pause", syncPlayIcon);
      v.addEventListener("ended", () => {
        v._seekUntil = Date.now() + 300;
        v.currentTime = v.duration - 0.05;
        syncPlayIcon();
        if (window.Toast) Toast.success("Sequence complete!", "✓ Done");
      });
      v.addEventListener("timeupdate", () => {
        if (Date.now() < (v._seekUntil || 0)) return;
        updateSeekBar({
          primary: v,
          seekBar,
          seekFill,
          currentTimeEl: ctEl
        });
      });
      v.addEventListener("loadedmetadata", () => {
        shell.querySelector("#totalTime").textContent = fmtTime(v.duration);
        seekBar.value = 0;
        seekFill.style.width = "0%";
        if (!state.minimized) {
          v.play().catch(() => {});
        }
      }, { once: true });
    }

    // If video is already on state (e.g. re-wire), bind immediately
    if (vid()) _bindVideoEvents(vid());

    // ── Seek input handler (defined early so seekFrame can reference it) ─────
    function onSeekInput() {
      const v = vid();
      if (!v || !v.duration) return;
      const t = (seekBar.value / 1000) * v.duration;
      v._seekUntil = Date.now() + 300;
      v.currentTime = t;
      seekFill.style.width = seekBar.value / 10 + "%";
      ctEl.textContent = fmtTime(t);
    }
    seekBar.addEventListener("input", onSeekInput);

    // ── Frame seek ───────────────────────────────────────────────────────────
    function seekFrame(delta) {
      const v = vid();
      if (!v || !v.duration || v.readyState < 1) return;
      const wasPaused = v.paused;
      v._seekUntil = Date.now() + 300;
      seekByFrames(delta, [v]);
      requestAnimationFrame(() => {
        // Restore playback if seekByFrames internally paused a playing video
        if (!wasPaused && v.paused) v.play().catch(() => {});
        // Sync seek bar position
        const next = v.currentTime;
        const pct  = (next / v.duration) * 100;
        seekBar.removeEventListener("input", onSeekInput);
        seekBar.value        = (pct / 100) * 1000;
        seekFill.style.width = pct + "%";
        ctEl.textContent     = fmtTime(next);
        seekBar.addEventListener("input", onSeekInput);
        syncPlayIcon();
      });
    }

    // ── Play/Pause button ────────────────────────────────────────────────────
    ppBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = vid();
      if (!v) return;
      if (v.paused) {
        if (v.ended) v.currentTime = 0;
        v.play().catch(() => {});
      } else {
        v.pause();
      }
      // Icon is NOT set here — play/pause events own it exclusively
    });

    media.addEventListener("click", (e) => {
      if (e.target === media || e.target.tagName === "VIDEO") ppBtn.click();
    });

    // ── Frame step buttons ───────────────────────────────────────────────────
    fbBtn.addEventListener("click", (e) => { e.stopPropagation(); seekFrame(-1); });
    ffBtn.addEventListener("click", (e) => { e.stopPropagation(); seekFrame(+1); });
  }
  function _buildMergedShell(project, seqName, dept) {
    const shell = document.createElement("div");
    shell.className = "seq-player-shell";
    shell.innerHTML = `
      <div id="fsTopBar">
        <div id="fsLabels">
          <span class="fs-label">
            <i class="fas fa-circle fs-dot-violet"></i>
            <span class="fs-label-tag seq-label-violet">Sequence</span>
            <span class="fs-label-tag seq-label-green" style="margin-left:4px;">Merged</span>
            <span class="seq-label-name">${project} / ${seqName}${dept ? " / " + dept : ""}</span>
          </span>
        </div>
        <span id="seqClipName"></span>
        <div class="seq-topbar-actions">
          <button id="seqMinimizeBtn"    title="Minimize to pill"><i class="fas fa-window-minimize"></i></button>
          <button id="seqMiniPreviewBtn" title="Mini preview" style="display:none"><i class="fas fa-clone"></i></button>
          <button id="seqCloseBtn"       title="Close"><i class="fas fa-times"></i></button>
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
          <i class="fas fa-spinner fa-spin"></i><span>Loading merged video…</span>
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
            <button id="frameBackBtn"    class="fs-icon-btn"><i class="fas fa-step-backward"></i></button>
            <button id="playPauseBtn"><i id="playIcon" class="fas fa-play"></i></button>
            <button id="frameForwardBtn" class="fs-icon-btn"><i class="fas fa-step-forward"></i></button>
            <div class="fs-ctrl-divider"></div>
            <button id="loopToggleBtn"   class="fs-icon-btn"><i class="fas fa-repeat"></i></button>
            <div class="fs-ctrl-divider"></div>
            <button id="muteBtn"         class="fs-icon-btn"><i id="volIcon" class="fas fa-volume-up"></i></button>
            <input  id="volumeBar" type="range" min="0" max="100" value="100" class="fs-vol-slider">
          </div>
        </div>
      </div>
    `;
    return shell;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD
  // ─────────────────────────────────────────────────────────────────────────
  function _keyboardHandler(e) {
    const state = activeState;
    if (!state || state.minimized) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const shell = state.shell;
    const v     = state.video;
    function kbSeekFrame(delta) {
      if (!v || !v.duration || v.readyState < 1) return;
      v._seekUntil = Date.now() + 300; seekByFrames(delta, [v]);
      const next = v.currentTime, pct = (next / v.duration) * 100;
      const sb = shell.querySelector("#seekBar"), sf = shell.querySelector("#seekFill"), ct = shell.querySelector("#currentTime");
      if (sb && sf && ct) { sb.value = (pct / 100) * 1000; sf.style.width = pct + "%"; ct.textContent = fmtTime(next); }
    }
    switch (e.key) {
      case " ": case "Spacebar": e.preventDefault(); shell.querySelector("#playPauseBtn").click(); break;
      case "ArrowLeft": case ",": case "<": e.preventDefault(); kbSeekFrame(-1); break;
      case "ArrowRight": case ".": case ">": e.preventDefault(); kbSeekFrame(+1); break;
      case "l": case "L": e.preventDefault(); shell.querySelector("#loopToggleBtn").click(); break;
      case "m": case "M": e.preventDefault(); shell.querySelector("#muteBtn").click(); break;
      case "Escape": e.preventDefault(); _hardDestroyState(state); break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIDE-BY-SIDE
  // ═══════════════════════════════════════════════════════════════════════════
  function launchSideBySide(project, seqName, dept) {
    const existing = playerPool.find(s => s.project === project && s.seqName === seqName && s.dept === "SBS");
    if (existing) { _restoreState(existing); return; }
    if (window.Toast) Toast.info(`Loading ${seqName} for SBS merge…`, "Side by Side");
    fetchCompareClips(project, seqName, dept)
      .then(pairs => {
        if (!pairs || !pairs.length) { if (window.Toast) Toast.error("No comparison data found.", "Empty"); return; }
        _launchSBSMerged(project, seqName, dept, pairs);
      })
      .catch(err => { console.error("[SBS]", err); if (window.Toast) Toast.error("Could not load comparison clips.", "Error"); });
  }

  function _launchSBSMerged(project, seqName, dept, pairs) {
    if (activeState) _minimizeState(activeState);

    const shell = _buildMergedShell(project, seqName, "SBS");
    document.body.appendChild(shell);
    shell.querySelector(".seq-label-green").textContent = "SBS Merged";

    const cancelRef = { value: false };
    const isCancelled = () => cancelRef.value;
    const stateId = ++_stateIdCounter;

    const state = {
      _id: stateId, mode: "merged", shell,
      video: null, v1: null, v2: null,
      loopEnabled: false, volume: 1,
      project, seqName, dept: "SBS",
      minimized: false, _miniPill: null, _miniVideoEl: null,
      _jobId: null, _pillDragged: false,
      _cancel: () => { cancelRef.value = true; },
    };

    _poolAdd(state);
    activeState = state;

    shell.querySelector(".mo-cancel").addEventListener("click",   () => _hardDestroyState(state));
    shell.querySelector(".mo-minimize").addEventListener("click", () => _minimizeState(state));
    shell.querySelector("#seqMinimizeBtn").addEventListener("click", (e) => { e.stopPropagation(); _minimizeState(state); });
    shell.querySelector("#seqCloseBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      _showDeleteConfirm(
        () => _destroyStateAndDelete(state),
        () => _destroyStateKeepFile(state),
        () => _hardDestroyState(state)
      );
    });
    // BUG FIX: SBS mini preview must call openSBSMiniPlayer, not openSeqMiniPlayer
    shell.querySelector("#seqMiniPreviewBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.video) return;
      fsGuard.active = true;
      const doMini = () => {
        state.video.pause(); shell.style.display = "none"; state.minimized = true;
        activeState = null; fsGuard.active = false;
        if (!state._miniPill) _buildPill(state); else state._miniPill.style.display = "";
        openSBSMiniPlayer(state);  // ← FIXED
      };
      if (isInFullscreen()) exitFullscreen(doMini); else doMini();
    });

    document.removeEventListener("keydown", _keyboardHandler);
    document.addEventListener("keydown", _keyboardHandler);
    fsGuard.active = false;

    const titleEl = shell.querySelector(".mo-title");
    if (titleEl) titleEl.textContent = `Merging ${pairs.length} SBS shots…`;

    enterFullscreen(shell, () => _mergeAllSBSPairs(pairs, shell, project, seqName, isCancelled, state));
  }

  function _mergeAllSBSPairs(pairs, shell, project, seqName, isCancelled, state) {
    if (isCancelled()) return;
    _setMergeStatus(shell, state, 0, 0, pairs.length, `Sending ${pairs.length} shot pairs for SBS merge…`);
    const fd = new FormData();
    fd.append("project", project); fd.append("sequence", seqName); fd.append("label", seqName);
    pairs.forEach(pair => {
      fd.append("left[]",  pair.first ? pair.first.path : pair.path);
      fd.append("right[]", pair.last  ? pair.last.path  : pair.path);
    });
    fetch("/merge-sbs-clips/", { method: "POST", body: fd })
      .then(r => r.json())
      .then(({ job_id, error }) => {
        if (isCancelled()) return;
        if (!job_id) { _showMergeError(shell, state, error || "Could not start SBS merge."); return; }
        state._jobId = job_id;
        _pollSBSJob(job_id, pairs, 0, shell, isCancelled, state);
      })
      .catch(err => { if (!isCancelled()) _showMergeError(shell, state, `Network error: ${err.message}`); });
  }

  function _pollSBSJob(job_id, pairs, index, shell, isCancelled, state) {
    if (isCancelled()) return;
    fetch(`/merge-sbs-clips/status/?job_id=${encodeURIComponent(job_id)}`)
      .then(r => r.json())
      .then(job => {
        if (isCancelled()) return;
        _setMergeStatus(shell, state, job.progress||0, index+1, pairs.length,
          job.status === "running" ? `Merging SBS shot ${index+1} / ${pairs.length}… ${job.progress||0}%`
          : job.status === "queued" ? "Queued…" : "");
        if (job.status === "done")   { _loadMergedVideo(shell, job.output_web, state); return; }
        if (job.status === "failed") { _showMergeError(shell, state, job.error || "SBS merge failed."); return; }
        setTimeout(() => _pollSBSJob(job_id, pairs, index, shell, isCancelled, state), 800);
      })
      .catch(err => { if (!isCancelled()) _showMergeError(shell, state, `Poll error: ${err.message}`); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FULLSCREEN CHANGE
  // ─────────────────────────────────────────────────────────────────────────
  onFullscreenChange(() => {
    if (fsGuard.active) return;
    if (!isInFullscreen() && activeState) _minimizeState(activeState);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────
  window.sequencePlayer = {
    launch:    launchContinuous,
    launchSBS: launchSideBySide,
    destroy:   () => playerPool.slice().forEach(_hardDestroyState),
    minimize:  () => { if (activeState) _minimizeState(activeState); },
    restore:   () => { const s = playerPool.find(x => x.minimized); if (s) _restoreState(s); },
    getPool:   () => playerPool,
  };
})();