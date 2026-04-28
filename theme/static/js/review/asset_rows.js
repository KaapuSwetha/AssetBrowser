//asset_rows.js

(function () {
  'use strict';

  if (!window.VideoUtils) {
    console.error('[asset_rows] video_controls_common.js must be loaded first.');
    return;
  }
  const VU = window.VideoUtils;

  const table = document.getElementById('resizableTable');
  if (!table) return;
  let _miniPill     = null;
  let _overlayState = null;
  const fsGuard     = { active: false };
  const resizers = table.querySelectorAll('.column-resizer');
  let currentResizer = null, currentTh = null, startX = 0, startWidth = 0;

  resizers.forEach(resizer => {
    resizer.addEventListener('mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      currentResizer = this;
      currentTh      = this.parentElement;
      startX         = e.pageX;
      startWidth     = currentTh.offsetWidth;
      currentResizer.classList.add('resizing');
      table.classList.add('resizing');
      document.addEventListener('mousemove', handleColMouseMove);
      document.addEventListener('mouseup',   handleColMouseUp);
    });
  });

  function handleColMouseMove(e) {
    if (!currentResizer) return;
    const minWidth = parseInt(getComputedStyle(currentTh).minWidth) || 100;
    const newWidth = startWidth + (e.pageX - startX);
    if (newWidth >= minWidth) currentTh.style.width = newWidth + 'px';
  }

  function handleColMouseUp() {
    if (currentResizer) {
      currentResizer.classList.remove('resizing');
      table.classList.remove('resizing');
    }
    currentResizer = null; currentTh = null;
    document.removeEventListener('mousemove', handleColMouseMove);
    document.removeEventListener('mouseup',   handleColMouseUp);
  }
  (function initColReorder() {
    const thead     = table.querySelector('thead');
    const headerRow = thead ? thead.querySelector('tr') : null;
    if (!headerRow) return;
    const ths = () => Array.from(headerRow.querySelectorAll('th'));

    let dragSrcIdx = null;  
    let dropIdx    = null;  
    let ghost      = null;  
    let indicator  = null; 
    function swapColumns(from, to) {
      if (from === to) return;
      const rows = table.rows;
      for (let r = 0; r < rows.length; r++) {
        const cells = rows[r].cells;
        if (from >= cells.length || to >= cells.length) continue;
        const moving = cells[from];
        const ref    = cells[to];
        if (from < to) ref.after(moving);
        else           ref.before(moving);
      }
    }
    function ensureGhost() {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'col-reorder-ghost';
        document.body.appendChild(ghost);
      }
      return ghost;
    }
    function showGhost(label, x, y) {
      const g = ensureGhost();
      g.textContent   = label;
      g.style.left    = x + 'px';
      g.style.top     = y + 'px';
      g.style.display = 'block';
    }
    function moveGhost(x, y) {
      if (ghost) { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; }
    }
    function hideGhost() { if (ghost) ghost.style.display = 'none'; }
    function ensureIndicator() {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'col-reorder-indicator';
        document.body.appendChild(indicator);
      }
      return indicator;
    }
    function showIndicator(th, side) {
      const ind  = ensureIndicator();
      const rect = th.getBoundingClientRect();
      const x    = (side === 'left' ? rect.left : rect.right) + window.scrollX;
      ind.style.left    = (x - 1) + 'px';
      ind.style.top     = (rect.top + window.scrollY) + 'px';
      ind.style.height  = rect.height + 'px';
      ind.style.display = 'block';
    }
    function hideIndicator() { if (indicator) indicator.style.display = 'none'; }
    function wireHeader(th) {
      const labelSpan = th.querySelector('span:not(.column-resizer)');
      if (!labelSpan) return;

      th.setAttribute('draggable', 'true');
      th.classList.add('col-draggable');

      th.addEventListener('dragstart', e => {
        if (e.target.classList.contains('column-resizer')) {
          e.preventDefault(); return;
        }

        dragSrcIdx = ths().indexOf(th);
        dropIdx    = null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragSrcIdx));
        const blank = document.createElement('canvas');
        blank.width = blank.height = 1;
        document.body.appendChild(blank);
        e.dataTransfer.setDragImage(blank, 0, 0);
        setTimeout(() => blank.remove(), 0);

        showGhost(labelSpan.textContent.trim(), e.clientX, e.clientY);
        requestAnimationFrame(() => th.classList.add('col-dragging'));
      });

      th.addEventListener('drag', e => {
        if (e.clientX || e.clientY) moveGhost(e.clientX, e.clientY);
      });

      th.addEventListener('dragover', e => {
        if (dragSrcIdx === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const currentThs  = ths();
        const targetIdx   = currentThs.indexOf(th);
        if (targetIdx === dragSrcIdx) { hideIndicator(); return; }

        const rect = th.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
        showIndicator(th, side);
        dropIdx = (side === 'right') ? targetIdx : targetIdx;

        ths().forEach(t => t.classList.remove('col-drag-over'));
        th.classList.add('col-drag-over');
      });

      th.addEventListener('dragleave', () => {
        th.classList.remove('col-drag-over');
      });

      th.addEventListener('drop', e => {
        e.preventDefault(); 
      });

      th.addEventListener('dragend', () => {
        th.classList.remove('col-dragging');
        ths().forEach(t => t.classList.remove('col-drag-over'));
        hideGhost();
        hideIndicator();
        if (dragSrcIdx !== null && dropIdx !== null && dragSrcIdx !== dropIdx) {
          swapColumns(dragSrcIdx, dropIdx);
        }

        dragSrcIdx = null;
        dropIdx    = null;
      });
    }

    ths().forEach(wireHeader);
  })();
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const rowCheckboxes     = table.querySelectorAll('.row-checkbox');
  let selectedRows = [];

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function () {
      rowCheckboxes.forEach(cb => { cb.checked = this.checked; updateRowSelection(cb); });
    });
  }

  rowCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function () {
      updateRowSelection(this);
      const allChecked  = Array.from(rowCheckboxes).every(cb => cb.checked);
      const someChecked = Array.from(rowCheckboxes).some(cb => cb.checked);
      if (selectAllCheckbox) {
        selectAllCheckbox.checked       = allChecked;
        selectAllCheckbox.indeterminate = someChecked && !allChecked;
      }
      const checkedList = Array.from(rowCheckboxes).filter(cb => cb.checked);
      if (checkedList.length > 2) {
        checkedList[0].checked = false;
        updateRowSelection(checkedList[0]);
      }
    });
  });

  function updateRowSelection(checkbox) {
    const row     = checkbox.closest('tr');
    const rowData = {
      index:    row.dataset.index,
      filename: row.dataset.filename,
      path:     row.dataset.rowPath,
      mode:     row.dataset.rowMode,
      name:     row.dataset.rowName,
      variant:  row.dataset.rowVariant || '',
    };
    if (checkbox.checked) {
      row.classList.add('selected');
      if (!selectedRows.find(r => r.index === rowData.index)) selectedRows.push(rowData);
    } else {
      row.classList.remove('selected');
      selectedRows = selectedRows.filter(r => r.index !== row.dataset.index);
    }
    if (selectedRows.length > 2) selectedRows = selectedRows.slice(-2);
    updateCompareButton();
  }
  const compareBtn = document.createElement('div');
  compareBtn.id = 'floatingCompareBtn';
  compareBtn.innerHTML = `
    <button class="compare-action">
      <i class="fas fa-expand-arrows-alt"></i>
      <span>Compare</span>
    </button>
    <button class="compare-clear" id="floatingClearBtn" title="Clear selection">
      <i class="fas fa-times"></i>
    </button>
  `;
  document.body.appendChild(compareBtn);

  const compareActionBtn = compareBtn.querySelector('.compare-action');
  const compareClearBtn  = compareBtn.querySelector('.compare-clear');
  compareActionBtn.addEventListener('click', openComparisonFullscreen);
  compareClearBtn.addEventListener('click',  clearSelection);

  function updateCompareButton() {
    const count = Array.from(rowCheckboxes).filter(cb => cb.checked).length;
    compareBtn.classList.toggle('visible', count === 2);
  }

  function setCompareBusy(busy) {
    compareActionBtn.disabled = busy;
    compareClearBtn.disabled  = busy;
    compareActionBtn.style.opacity = busy ? '0.5' : '';
    compareActionBtn.style.cursor  = busy ? 'not-allowed' : '';
    compareClearBtn.style.opacity  = busy ? '0.5' : '';
    compareClearBtn.style.cursor   = busy ? 'not-allowed' : '';
    const ctxItem = document.getElementById('openComparisonFullscreen');
    if (ctxItem) ctxItem.style.pointerEvents = busy ? 'none' : '';
  }
  let contextMenu = null;

  table.querySelectorAll('.comparison-row').forEach(row => {
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (Array.from(rowCheckboxes).filter(cb => cb.checked).length === 2) {
        showComparisonContextMenu(e.pageX, e.pageY);
      }
    });
  });

  function showComparisonContextMenu(x, y) {
    if (contextMenu) contextMenu.remove();
    contextMenu = document.createElement('div');
    contextMenu.className = 'comparison-context-menu';
    contextMenu.innerHTML = `
      <div class="comparison-context-menu-item" id="openComparisonFullscreen">
        <i class="fas fa-expand-arrows-alt"></i><span>Open Comparison in Fullscreen</span>
      </div>
      <div class="comparison-context-menu-item" id="clearSelection">
        <i class="fas fa-times-circle"></i><span>Clear Selection</span>
      </div>
    `;
    contextMenu.style.left = x + 'px';
    contextMenu.style.top  = y + 'px';
    document.body.appendChild(contextMenu);
    document.getElementById('openComparisonFullscreen').addEventListener('click', openComparisonFullscreen);
    document.getElementById('clearSelection').addEventListener('click', clearSelection);
    setTimeout(() => document.addEventListener('click', closeContextMenu), 100);
  }

  function closeContextMenu() {
    if (contextMenu) { contextMenu.remove(); contextMenu = null; }
    document.removeEventListener('click', closeContextMenu);
  }
  function _allVids(overlay) {
    return ['cv1', 'cv2', 'sv1', 'sv2']
      .map(c => overlay.querySelector('.' + c))
      .filter(el => el && el.tagName === 'VIDEO');
  }

  function _rowLabel(row) {
    return [row.name, row.variant].filter(Boolean).join(' / ')
      || (row.path ? row.path.split('\\').pop() : '')
      || 'Preview';
  }

  function loadingSpinner(label) {
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:#6b7280;">
      <i class="fas fa-spinner fa-spin" style="font-size:22px;color:#60a5fa;"></i>
      <span style="font-size:12px;">${label}</span>
    </div>`;
  }
  function _rebuildPill() {
    document.querySelectorAll('#cmpMiniPill').forEach(el => el.remove());
    if (_miniPill) {
      if (typeof _miniPill._destroyDrag === 'function') _miniPill._destroyDrag();
      _miniPill = null;
    }
    if (!_overlayState) return;

    const baseName = _rowLabel(_overlayState.rowsData[0]);
    const overName = _rowLabel(_overlayState.rowsData[1]);

    const pill = document.createElement('div');
    pill.id = 'cmpMiniPill';
    pill.innerHTML = `
      <div class="cmp-pill-icon"><i class="fas fa-layer-group"></i></div>
      <div class="cmp-pill-info">
        <div class="cmp-pill-title">Comparison · paused</div>
        <div class="cmp-pill-labels">
          <i class="fas fa-circle cmp-pill-dot cmp-pill-dot-blue"></i>
          <span class="cmp-pill-name" title="${baseName}">${baseName}</span>
          <span class="cmp-pill-sep">vs</span>
          <i class="fas fa-circle cmp-pill-dot cmp-pill-dot-orange"></i>
          <span class="cmp-pill-name" title="${overName}">${overName}</span>
        </div>
      </div>
      <div class="cmp-pill-actions">
        <button class="cmp-pill-restore" id="cmpPillMiniBtn" title="Mini preview">
          <i class="fas fa-clone"></i>
        </button>
        <button class="cmp-pill-expand" id="cmpPillExpandBtn" title="Restore fullscreen"
          style="width:28px;height:28px;border-radius:8px;background:rgba(59,130,246,.2);
                 border:1px solid rgba(59,130,246,.35);color:#60a5fa;cursor:pointer;
                 display:flex;align-items:center;justify-content:center;font-size:11px;transition:all .2s;">
          <i class="fas fa-expand"></i>
        </button>
        <button class="cmp-pill-close" id="cmpPillCloseBtn" title="Close comparison">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;

    document.body.appendChild(pill);
    _miniPill = pill;

    pill.querySelector('#cmpPillMiniBtn').addEventListener('click',   e => { e.stopPropagation(); _openMiniPlayer(); });
    pill.querySelector('#cmpPillExpandBtn').addEventListener('click', e => { e.stopPropagation(); _restoreOverlay(); });
    pill.querySelector('#cmpPillCloseBtn').addEventListener('click',  e => { e.stopPropagation(); _hardDestroy(); });

    pill.addEventListener('click', e => {
      if (e.target.closest('.cmp-pill-actions')) return;
      if (pill._wasDragged) { pill._wasDragged = false; return; }
      _openMiniPlayer();
    });

    let isDragging = false, dragStartX = 0, dragStartY = 0;
    let baseLeft = 0, baseTop = 0;
    const DRAG_THRESHOLD = 4;
    let movedDistance = 0;

    pill.addEventListener('mousedown', e => {
      if (e.target.closest('.cmp-pill-actions')) return;
      isDragging       = true;
      movedDistance    = 0;
      pill._wasDragged = false;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = pill.getBoundingClientRect();
      baseLeft   = rect.left; baseTop = rect.top;
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
      if (movedDistance > DRAG_THRESHOLD) { pill.classList.add('cmp-pill-dragging'); pill._wasDragged = true; }
      pill.style.left = Math.max(8, Math.min(baseLeft + dx, window.innerWidth  - pill.offsetWidth  - 8)) + 'px';
      pill.style.top  = Math.max(8, Math.min(baseTop  + dy, window.innerHeight - pill.offsetHeight - 8)) + 'px';
    }
    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      pill.classList.remove('cmp-pill-dragging');
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    pill._destroyDrag = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };
  }

  function _removePill() {
    document.querySelectorAll('#cmpMiniPill').forEach(el => el.remove());
    if (_miniPill) {
      if (typeof _miniPill._destroyDrag === 'function') _miniPill._destroyDrag();
      _miniPill = null;
    }
  }

  function _minimizeOverlay() {
    if (!_overlayState || _overlayState.minimized) return;
    if (_miniPill || document.getElementById('cmpMiniPill')) return;

    fsGuard.active = true;

    const doMinimize = () => {
      if (!_overlayState) { fsGuard.active = false; return; }
      _allVids(_overlayState.overlay).forEach(v => { try { v.pause(); } catch (_) {} });
      _overlayState.overlay.style.display = 'none';
      _overlayState.minimized = true;
      fsGuard.active = false;
      _rebuildPill();
    };

    if (VU.isInFullscreen()) {
      VU.exitFullscreen(doMinimize);
    } else {
      doMinimize();
    }
  }

  function _restoreOverlay() {
    if (!_overlayState || !_overlayState.minimized) return;
    _removePill();
    _overlayState.minimized = false;
    _overlayState.overlay.style.display = '';
    fsGuard.active = true;
    VU.enterFullscreen(_overlayState.overlay, () => { fsGuard.active = false; });
  }

  function _hardDestroy() {
    fsGuard.active = true;
    _removePill();
    _destroyCmpMiniPlayer();
    if (!_overlayState) { fsGuard.active = false; return; }

    const overlay = _overlayState.overlay;
    _overlayState = null;

    const finish = () => {
      cleanupFsChangeListener();
      setCompareBusy(false);
      overlay.remove();
      fsGuard.active = false;
    };

    if (VU.isInFullscreen()) {
      VU.exitFullscreen(finish);
    } else {
      finish();
    }
  }
  function _openMiniPlayer() {
    if (!_overlayState) return;
    if (document.getElementById('cmpMiniPlayer')) return;

    if (_miniPill) _miniPill.style.display = 'none';

    const overlay  = _overlayState.overlay;
    const hiddenV1  = overlay.querySelector('.cv1') || overlay.querySelector('.sv1');
    const startTime = (hiddenV1 && hiddenV1.tagName === 'VIDEO') ? hiddenV1.currentTime : 0;

    function getSrc(cls) {
      const el = overlay.querySelector('.' + cls);
      if (!el) return null;
      if (el.tagName === 'VIDEO') {
        const src = el.querySelector('source')?.src || el.src;
        return src ? { type: 'video', src } : null;
      }
      if (el.tagName === 'IMG') return { type: 'img', src: el.src };
      return null;
    }

    const src1 = getSrc('cv1');
    const src2 = getSrc('cv2');

    const mini = document.createElement('div');
    mini.id = 'cmpMiniPlayer';
    mini.innerHTML = `
      <div class="cmp-resize-handle" data-dir="n"></div>
      <div class="cmp-resize-handle" data-dir="s"></div>
      <div class="cmp-resize-handle" data-dir="e"></div>
      <div class="cmp-resize-handle" data-dir="w"></div>
      <div class="cmp-resize-handle" data-dir="nw"></div>
      <div class="cmp-resize-handle" data-dir="ne"></div>
      <div class="cmp-resize-handle" data-dir="sw"></div>
      <div class="cmp-resize-handle" data-dir="se"></div>
      <div id="cmpMiniInner">
        <div id="cmpMiniDragHandle"></div>
        <div id="cmpMiniLabel">Mini Compare</div>
        <div id="cmpMiniVideoWrap">
          <div id="cmpMiniProgress"><div id="cmpMiniProgressFill"></div></div>
          <div class="cmp-mini-panel" id="cmpMiniPanel1">
            <span class="cmp-mini-badge cmp-mini-badge-blue">Base</span>
          </div>
          <div class="cmp-mini-panel" id="cmpMiniPanel2">
            <span class="cmp-mini-badge cmp-mini-badge-orange">Over</span>
          </div>
          <div id="cmpMiniOverlay">
            <div id="cmpMiniPlayIcon"><i class="fas fa-play" style="margin-left:2px"></i></div>
          </div>
        </div>
        <div id="cmpMiniControls">
          <button id="cmpMiniPlayBtn"><i id="cmpMiniPlayBtnIcon" class="fas fa-pause"></i></button>
          <span   id="cmpMiniTime">0:00 / 0:00</span>
          <button id="cmpMiniVolBtn"><i id="cmpMiniVolIcon" class="fas fa-volume-up"></i></button>
          <button id="cmpMiniExpandBtn"><i class="fas fa-expand"></i></button>
          <button id="cmpMiniCloseBtn"><i class="fas fa-times"></i></button>
        </div>
      </div>
    `;
    document.body.appendChild(mini);

    const panel1       = mini.querySelector('#cmpMiniPanel1');
    const panel2       = mini.querySelector('#cmpMiniPanel2');
    const playBtn      = mini.querySelector('#cmpMiniPlayBtn');
    const playBtnIcon  = mini.querySelector('#cmpMiniPlayBtnIcon');
    const volBtn       = mini.querySelector('#cmpMiniVolBtn');
    const volIconEl    = mini.querySelector('#cmpMiniVolIcon');
    const expandBtn    = mini.querySelector('#cmpMiniExpandBtn');
    const closeBtn     = mini.querySelector('#cmpMiniCloseBtn');
    const timeEl       = mini.querySelector('#cmpMiniTime');
    const progressFill = mini.querySelector('#cmpMiniProgressFill');
    const videoWrap    = mini.querySelector('#cmpMiniVideoWrap');
    const dragHandle   = mini.querySelector('#cmpMiniDragHandle');

    function buildPanel(panel, srcInfo) {
      if (!srcInfo) return null;
      if (srcInfo.type === 'video') {
        const v = document.createElement('video');
        v.src = srcInfo.src; v.preload = 'auto';
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        panel.appendChild(v);
        return v;
      }
      if (srcInfo.type === 'img') {
        const img = document.createElement('img');
        img.src = srcInfo.src;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        panel.appendChild(img);
        return null;
      }
      return null;
    }

    const video1   = buildPanel(panel1, src1);
    const video2   = buildPanel(panel2, src2);
    const primaryV = video1 || video2;

    function updateMiniTime() {
      if (!primaryV) return;
      const cur = primaryV.currentTime || 0, dur = primaryV.duration || 0;
      timeEl.textContent       = VU.fmtTime(cur) + ' / ' + VU.fmtTime(dur);
      progressFill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
      playBtnIcon.className    = primaryV.paused ? 'fas fa-play' : 'fas fa-pause';
      const pi = mini.querySelector('#cmpMiniPlayIcon i');
      if (pi) {
        pi.className        = primaryV.paused ? 'fas fa-play' : 'fas fa-pause';
        pi.style.marginLeft = primaryV.paused ? '2px' : '0';
      }
      if (video2 && video2 !== primaryV && video2.tagName === 'VIDEO') {
        if (Math.abs(video2.currentTime - primaryV.currentTime) > 0.15) {
          video2.currentTime = primaryV.currentTime;
        }
      }
    }

    if (primaryV) {
      const onMeta = () => {
        primaryV.currentTime = startTime;
        if (video2 && video2 !== primaryV) video2.currentTime = startTime;
        primaryV.play().catch(() => {});
        if (video2 && video2 !== primaryV) { video2.muted = true; video2.play().catch(() => {}); }
        updateMiniTime();
      };
      if (primaryV.readyState >= 1) onMeta();
      else primaryV.addEventListener('loadedmetadata', onMeta, { once: true });

      primaryV.addEventListener('timeupdate', updateMiniTime);
      primaryV.addEventListener('play', () => {
        playBtnIcon.className = 'fas fa-pause';
        if (video2 && video2 !== primaryV) video2.play().catch(() => {});
      });
      primaryV.addEventListener('pause', () => {
        playBtnIcon.className = 'fas fa-play';
        if (video2 && video2 !== primaryV) video2.pause();
      });
      primaryV.addEventListener('seeked', () => {
        if (video2 && video2 !== primaryV) video2.currentTime = primaryV.currentTime;
      });
    }

    function togglePlay() {
      if (!primaryV) return;
      if (primaryV.paused) {
        primaryV.play().catch(() => {});
        if (video2 && video2 !== primaryV) video2.play().catch(() => {});
      } else {
        primaryV.pause();
        if (video2 && video2 !== primaryV) video2.pause();
      }
    }

    videoWrap.addEventListener('click', e => { if (e.target === dragHandle) return; togglePlay(); });
    playBtn.addEventListener('click',   e => { e.stopPropagation(); togglePlay(); });

    VU.createVolumeController({
      getPrimary: () => [primaryV].filter(Boolean),
      slider:  null,
      muteBtn: volBtn,
      volIcon: volIconEl,
    });

    expandBtn.addEventListener('click', e => {
      e.stopPropagation();
      const ct = primaryV ? primaryV.currentTime : 0;
      _destroyCmpMiniPlayer();
      if (_overlayState) _allVids(_overlayState.overlay).forEach(v => { v.currentTime = ct; });
      _restoreOverlay();
    });

    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      _destroyCmpMiniPlayer();
      if (_miniPill) _miniPill.style.display = '';
    });

    let isDragging = false, dragStartX = 0, dragStartY = 0, initRight = 24, initBottom = 24;

    dragHandle.addEventListener('mousedown', e => {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initRight  = window.innerWidth  - rect.right;
      initBottom = window.innerHeight - rect.bottom;
      mini.classList.add('cmp-mini-dragging');
      e.preventDefault();
    });

    function onDragMove(e) {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
      mini.style.right  = Math.max(8, Math.min(initRight  - dx, window.innerWidth  - mini.offsetWidth  - 8)) + 'px';
      mini.style.bottom = Math.max(8, Math.min(initBottom - dy, window.innerHeight - mini.offsetHeight - 8)) + 'px';
    }
    function onDragUp() {
      if (isDragging) { isDragging = false; mini.classList.remove('cmp-mini-dragging'); }
    }
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragUp);

    const resizer = VU.makeResizable(mini, {
      minW: 300, minH: 150,
      resizingClass:  'cmp-mini-resizing',
      handleSelector: '.cmp-resize-handle',
    });

    mini._destroy = () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup',   onDragUp);
      resizer.destroy();
      if (primaryV) { primaryV.pause(); primaryV.src = ''; }
      if (video2 && video2 !== primaryV) { video2.pause(); video2.src = ''; }
    };

    requestAnimationFrame(() => requestAnimationFrame(() => mini.classList.add('cmp-mini-visible')));
  }

  function _destroyCmpMiniPlayer() {
    const mini = document.getElementById('cmpMiniPlayer');
    if (!mini) return;
    if (typeof mini._destroy === 'function') mini._destroy();
    mini.classList.remove('cmp-mini-visible');
    setTimeout(() => { if (mini.parentNode) mini.remove(); }, 300);
  }
  function buildOverlayShell(rowsData) {
    const baseLabel = _rowLabel(rowsData[0]);
    const overLabel = _rowLabel(rowsData[1]);

    const overlay = document.createElement('div');
    overlay.id = 'comparisonFullscreen';

    overlay.innerHTML = `
      <div id="fsTopBar">
        <div id="fsLabels">
          <span class="fs-label">
            <i class="fas fa-circle fs-dot-blue"></i>
            <span class="fs-label-tag fs-label-blue">Base</span>
            <span class="fs-label-name" title="${baseLabel}">${baseLabel}</span>
          </span>
          <span class="fs-label">
            <i class="fas fa-circle fs-dot-orange"></i>
            <span class="fs-label-tag fs-label-orange">Over</span>
            <span class="fs-label-name" title="${overLabel}">${overLabel}</span>
          </span>
        </div>

        <div id="viewModeDropdownWrap">
          <button id="viewModeDropdownBtn" title="Change view mode">
            <i class="fas fa-layer-group" id="viewModeIcon"></i>
            <span id="viewModeLabel">Overlay</span>
            <i class="fas fa-chevron-down" id="viewModeChevron"></i>
          </button>
          <div id="viewModeMenu">
            <div class="vmMenuItem vmMenuItem--active" data-mode="overlay">
              <span class="vmMenuIcon"><i class="fas fa-layer-group"></i></span>
              <div class="vmMenuText">
                <span class="vmMenuTitle">Overlay</span>
                <span class="vmMenuDesc">Stack media with opacity control</span>
              </div>
              <i class="fas fa-check vmMenuCheck"></i>
            </div>
            <div class="vmMenuItem" data-mode="sidebyside">
              <span class="vmMenuIcon"><i class="fas fa-columns"></i></span>
              <div class="vmMenuText">
                <span class="vmMenuTitle">Side by Side</span>
                <span class="vmMenuDesc">View media panels simultaneously</span>
              </div>
              <i class="fas fa-check vmMenuCheck"></i>
            </div>
          </div>
        </div>

        <div id="fsTopBarRight" style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <button id="minimizeComparisonBtn" title="Minimize to pill">
            <i class="fas fa-window-minimize"></i>
          </button>
          <button id="miniPreviewBtn" title="Mini preview">
            <i class="fas fa-clone"></i>
          </button>
          <button id="closeComparisonBtn" title="Minimize">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <div id="opacityBadge">Overlay: <span id="opacityValue">100</span>%</div>

      <div id="stackContainer">
        <div id="layer1">${loadingSpinner('Loading base...')}</div>
        <div id="layer2" style="opacity:1;">${loadingSpinner('Loading overlay...')}</div>
      </div>

      <div id="sbsContainer">
        <div class="sbsPane" id="sbsPane1">
          <div class="sbsPaneMedia" id="sbsMedia1">${loadingSpinner('Loading base...')}</div>
        </div>
        <div id="sbsDivider"></div>
        <div class="sbsPane" id="sbsPane2">
          <div class="sbsPaneMedia" id="sbsMedia2">${loadingSpinner('Loading overlay...')}</div>
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
            <button id="frameBackBtn"    class="fs-icon-btn" title="Previous frame">
              <i class="fas fa-step-backward"></i>
            </button>
            <button id="playPauseBtn" title="Play / Pause">
              <i id="playIcon" class="fas fa-play"></i>
            </button>
            <button id="frameForwardBtn" class="fs-icon-btn" title="Next frame">
              <i class="fas fa-step-forward"></i>
            </button>
              <div class="fs-divider"></div>
            <button id="loopToggleBtn"   class="fs-icon-btn" title="Toggle loop">
              <i class="fas fa-repeat"></i>
            </button>
              <div class="fs-divider"></div>
            <button id="muteBtn"         class="fs-icon-btn" title="Mute">
              <i id="volIcon" class="fas fa-volume-up"></i>
            </button>
            <input id="volumeBar" type="range" min="0" max="100" value="100" class="fs-vol-slider">
          </div>
          <div class="fs-ctrl-group" id="overlayOnlyControls">
            <i class="fas fa-circle fs-dot-blue fs-dot-sm"></i>
            <input id="opacitySlider" type="range" min="0" max="100" value="100" class="fs-opacity-slider">
            <i class="fas fa-circle fs-dot-orange fs-dot-sm"></i>
            <div class="fs-divider"></div>
            <button id="swapMediaBtn" class="fs-icon-btn" title="Swap layers">
              <i class="fas fa-exchange-alt"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    return overlay;
  }
  function parseMediaFromHtml(html, index) {
    const cleanHtml   = html.replace(/\s*hx-swap-oob="true"/g, '');
    const doc         = new DOMParser().parseFromString(cleanHtml, 'text/html');
    const previewCard = doc.querySelector('#previewCard');
    if (!previewCard) { console.warn(`[Comparison] No #previewCard in response ${index}`); return null; }

    const sourceEl = previewCard.querySelector('video source');
    const videoEl  = previewCard.querySelector('video');
    const imgEl    = previewCard.querySelector('img');

    let mediaType = null, rawSrc = null, rawPoster = null;

    if (sourceEl) {
      mediaType = 'video'; rawSrc = sourceEl.getAttribute('src');
      rawPoster = videoEl ? videoEl.getAttribute('poster') : null;
    } else if (videoEl?.getAttribute('src')) {
      mediaType = 'video'; rawSrc = videoEl.getAttribute('src');
      rawPoster = videoEl.getAttribute('poster');
    } else if (imgEl) {
      mediaType = 'img'; rawSrc = imgEl.getAttribute('src');
    }

    if (!rawSrc) { console.warn(`[Comparison] No src in response ${index}`); return null; }

    let mediaSrc;
    try { mediaSrc = new URL(rawSrc, window.location.origin).href; }
    catch { mediaSrc = window.location.origin + rawSrc; }

    let poster = null;
    if (rawPoster) {
      try { poster = new URL(rawPoster, window.location.origin).href; }
      catch { poster = window.location.origin + rawPoster; }
    }

    return { type: mediaType, src: mediaSrc, poster };
  }
  function createMediaElement(mediaInfo, cls) {
    if (mediaInfo.type === 'video') {
      const pa = mediaInfo.poster ? `poster="${mediaInfo.poster}"` : '';
      return `<video class="cmpVideo ${cls}" preload="metadata" ${pa}
        style="max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;display:block;">
        <source src="${mediaInfo.src}"></video>`;
    }
    if (mediaInfo.type === 'img') {
      return `<img src="${mediaInfo.src}" class="cmpVideo ${cls}"
        style="max-width:100%;max-height:100%;object-fit:contain;display:block;" alt="">`;
    }
    return `<div style="color:#6b7280;font-size:13px;">No media available</div>`;
  }
  function openComparisonFullscreen() {
    closeContextMenu();
    if (selectedRows.length !== 2) {
      if (window.Toast) Toast.error('Please select exactly 2 rows for comparison', 'Selection Error');
      return;
    }
    setCompareBusy(true);

    Promise.all(
      selectedRows.map(rowData =>
        fetch('/row-metadata/?' + new URLSearchParams(rowData)).then(r => r.text())
      )
    )
    .then(async htmlResponses => {
      const mediaData = htmlResponses
        .map((html, i) => parseMediaFromHtml(html, i))
        .filter(d => d && d.src);

      if (mediaData.length !== 2) {
        if (window.Toast) Toast.error('Could not load media for comparison', 'Error');
        setCompareBusy(false); return;
      }

      const [media1, media2] = mediaData;

      if (media1.type === 'video' && media2.type === 'video') {
        let dur1, dur2;
        try {
          [dur1, dur2] = await Promise.all([
            VU.getVideoDuration(media1.src),
            VU.getVideoDuration(media2.src),
          ]);
        } catch {
          if (window.Toast) Toast.error('Could not read video duration.', 'Error');
          setCompareBusy(false); return;
        }
        if (!VU.durationsMatch(dur1, dur2)) {
          if (window.Toast) Toast.error(
            'Video frames do not match. Please select two clips of the same length.',
            'Frames Mismatch'
          );
          setCompareBusy(false); return;
        }
      }

      const overlay = buildOverlayShell(selectedRows);
      document.body.appendChild(overlay);

      _overlayState = { overlay, rowsData: [...selectedRows], minimized: false };

      VU.enterFullscreen(overlay, () => {});
      setupComparisonControls(overlay, selectedRows, media1, media2);

      overlay.querySelector('#layer1').innerHTML    = createMediaElement(media1, 'cv1');
      overlay.querySelector('#layer2').innerHTML    = createMediaElement(media2, 'cv2');
      overlay.querySelector('#sbsMedia1').innerHTML = createMediaElement(media1, 'sv1');
      overlay.querySelector('#sbsMedia2').innerHTML = createMediaElement(media2, 'sv2');

      overlay._ctrl.bindEvents();
    })
    .catch(err => {
      console.error('Error loading comparison data:', err);
      if (window.Toast) Toast.error('Failed to load comparison data', 'Error');
      setCompareBusy(false);
    });
  }
  function setupComparisonControls(overlay, rowsData, media1, media2) {
    let viewMode = 'overlay';

    const stackContainer   = overlay.querySelector('#stackContainer');
    const sbsContainer     = overlay.querySelector('#sbsContainer');
    const overlayOnlyCtrls = overlay.querySelector('#overlayOnlyControls');
    const layer2           = overlay.querySelector('#layer2');
    const opacitySlider    = overlay.querySelector('#opacitySlider');
    const playPauseBtn     = overlay.querySelector('#playPauseBtn');
    const playIcon         = overlay.querySelector('#playIcon');
    const frameBackBtn     = overlay.querySelector('#frameBackBtn');
    const frameForwardBtn  = overlay.querySelector('#frameForwardBtn');
    const seekBar          = overlay.querySelector('#seekBar');
    const seekFill         = overlay.querySelector('#seekFill');
    const currentTimeEl    = overlay.querySelector('#currentTime');
    const totalTimeEl      = overlay.querySelector('#totalTime');
    const volumeBar        = overlay.querySelector('#volumeBar');
    const muteBtn          = overlay.querySelector('#muteBtn');
    const volIcon          = overlay.querySelector('#volIcon');
    const swapBtn          = overlay.querySelector('#swapMediaBtn');
    const minimizeBtn      = overlay.querySelector('#minimizeComparisonBtn');
    const closeBtn         = overlay.querySelector('#closeComparisonBtn');
    const miniPreviewBtn   = overlay.querySelector('#miniPreviewBtn');
    const dropdownWrap     = overlay.querySelector('#viewModeDropdownWrap');
    const dropdownBtn      = overlay.querySelector('#viewModeDropdownBtn');
    const dropdownMenu     = overlay.querySelector('#viewModeMenu');
    const viewModeLabel    = overlay.querySelector('#viewModeLabel');
    const viewModeIcon     = overlay.querySelector('#viewModeIcon');
    const viewModeChevron  = overlay.querySelector('#viewModeChevron');
    const menuItems        = overlay.querySelectorAll('.vmMenuItem');

    function getV() {
      return viewMode === 'sidebyside'
        ? { v1: overlay.querySelector('.sv1'), v2: overlay.querySelector('.sv2') }
        : { v1: overlay.querySelector('.cv1'), v2: overlay.querySelector('.cv2') };
    }

    function allVids() { return _allVids(overlay); }

    const hasVideo = media1.type === 'video' || media2.type === 'video';

    if (!hasVideo) {
      const seekRow = overlay.querySelector('#fsSeekRow');
      if (seekRow) seekRow.style.display = 'none';
      const playbackGroup = overlay.querySelector('#fsControlsRow .fs-ctrl-group');
      if (playbackGroup) playbackGroup.style.display = 'none';
    }

    const loopCtrl = VU.createLoopController({
      getVideos: allVids,
      btn: overlay.querySelector('#loopToggleBtn'),
    });

    VU.createVolumeController({
      getPrimary: () => ['cv1', 'sv1']
        .map(c => overlay.querySelector('.' + c))
        .filter(el => el && el.tagName === 'VIDEO'),
      slider:  volumeBar,
      muteBtn: muteBtn,
      volIcon: volIcon,
    });

    function updateSeekUI() {
      const { v1 } = getV();
      VU.updateSeekBar({ primary: v1, seekBar, seekFill, currentTimeEl });
    }

    playPauseBtn.addEventListener('click', () => {
      const { v1 } = getV();
      if (!v1 || v1.tagName !== 'VIDEO') return;
      VU.setPlaying(v1.paused, allVids(), playIcon);
    });

    stackContainer.addEventListener('click', () => playPauseBtn.click());
    sbsContainer.addEventListener('click',   () => playPauseBtn.click());

    frameBackBtn.addEventListener('click', e => {
      e.stopPropagation(); VU.seekByFrames(-1, allVids()); updateSeekUI();
    });
    frameForwardBtn.addEventListener('click', e => {
      e.stopPropagation(); VU.seekByFrames(1, allVids()); updateSeekUI();
    });

    seekBar.addEventListener('input', () => {
      const { v1 } = getV();
      if (!v1 || !v1.duration) return;
      const t = (seekBar.value / 1000) * v1.duration;
      allVids().forEach(v => { v.currentTime = t; });
      seekFill.style.width = (seekBar.value / 10) + '%';
    });

    opacitySlider?.addEventListener('input', function () {
      if (layer2) layer2.style.opacity = this.value / 100;
      const badge = overlay.querySelector('#opacityBadge');
      const valEl = overlay.querySelector('#opacityValue');
      if (valEl) valEl.textContent = this.value;
      if (badge) {
        badge.style.opacity = '1';
        clearTimeout(badge._t);
        badge._t = setTimeout(() => { badge.style.opacity = '0'; }, 1400);
      }
    });

    swapBtn?.addEventListener('click', () => {
      const { v1 } = getV();
      const paused = v1 ? v1.paused : true;
      const ct     = v1 ? v1.currentTime : 0;

      const l1 = overlay.querySelector('#layer1');
      const l2 = overlay.querySelector('#layer2');
      const tmp = l1.innerHTML; l1.innerHTML = l2.innerHTML; l2.innerHTML = tmp;
      const nl1v = l1.querySelector('video');
      const nl2v = l2.querySelector('video');
      if (nl1v) { nl1v.classList.replace('cv2', 'cv1'); nl1v.currentTime = ct; }
      if (nl2v) { nl2v.classList.replace('cv1', 'cv2'); nl2v.currentTime = ct; }

      const sm1 = overlay.querySelector('#sbsMedia1');
      const sm2 = overlay.querySelector('#sbsMedia2');
      const tmpS = sm1.innerHTML; sm1.innerHTML = sm2.innerHTML; sm2.innerHTML = tmpS;
      const ns1v = sm1.querySelector('video');
      const ns2v = sm2.querySelector('video');
      if (ns1v) { ns1v.classList.replace('sv2', 'sv1'); ns1v.currentTime = ct; }
      if (ns2v) { ns2v.classList.replace('sv1', 'sv2'); ns2v.currentTime = ct; }

      if (opacitySlider) { opacitySlider.value = 100; if (layer2) layer2.style.opacity = 1; }
      bindEvents();
      loopCtrl.syncVideos();
      if (!paused) VU.setPlaying(true, allVids(), playIcon);
    });

    let menuOpen = false;
    function openMenu() {
      menuOpen = true;
      dropdownMenu.classList.add('vmMenu--open');
      viewModeChevron.style.transform = 'rotate(180deg)';
      setTimeout(() => overlay.addEventListener('click', onOutsideClick), 0);
    }
    function closeMenu() {
      menuOpen = false;
      dropdownMenu.classList.remove('vmMenu--open');
      viewModeChevron.style.transform = '';
      overlay.removeEventListener('click', onOutsideClick);
    }
    function onOutsideClick(e) { if (!dropdownWrap.contains(e.target)) closeMenu(); }

    dropdownBtn.addEventListener('click', e => { e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); });

    const modes = {
      overlay:    { label: 'Overlay',      icon: 'fas fa-layer-group' },
      sidebyside: { label: 'Side by Side', icon: 'fas fa-columns'     },
    };

    function switchMode(mode) {
      closeMenu();
      if (mode === viewMode) return;
      viewMode = mode;
      const isSbs = mode === 'sidebyside';
      viewModeLabel.textContent = modes[mode].label;
      viewModeIcon.className    = modes[mode].icon;
      menuItems.forEach(item =>
        item.classList.toggle('vmMenuItem--active', item.dataset.mode === mode)
      );
      stackContainer.style.display   = isSbs ? 'none' : '';
      sbsContainer.style.display     = isSbs ? 'flex' : 'none';
      overlayOnlyCtrls.style.display = isSbs ? 'none' : '';

      const fromV = overlay.querySelector(isSbs ? '.cv1' : '.sv1');
      if (fromV && fromV.tagName === 'VIDEO') {
        const ct = fromV.currentTime, wasPlaying = !fromV.paused;
        allVids().forEach(v => { v.currentTime = ct; });
        if (wasPlaying) VU.setPlaying(true, allVids(), playIcon);
      }
      bindEvents();
      loopCtrl.syncVideos();
    }

    menuItems.forEach(item => {
      item.addEventListener('click', e => { e.stopPropagation(); switchMode(item.dataset.mode); });
    });

    function bindEvents() {
      const { v1, v2 } = getV();
      if (!v1 || v1.tagName !== 'VIDEO') return;
      if (v2 && v2.tagName === 'VIDEO') v2.muted = true;
      loopCtrl.syncVideos();

      v1.onloadedmetadata = () => {
        if (totalTimeEl) totalTimeEl.textContent = VU.fmtTime(v1.duration);
      };
      v1.ontimeupdate = () => {
        updateSeekUI();
        [v2, ...allVids().filter(v => v !== v1 && v !== v2)].forEach(v => {
          if (v && v.tagName === 'VIDEO') {
            const tol = v === v2 ? 0.15 : 0.3;
            if (Math.abs(v.currentTime - v1.currentTime) > tol) v.currentTime = v1.currentTime;
          }
        });
      };
      v1.onended  = () => { playIcon.className = 'fas fa-play'; };
      v1.onplay   = () => { if (v2 && v2.tagName === 'VIDEO') v2.play().catch(() => {}); };
      v1.onpause  = () => { if (v2 && v2.tagName === 'VIDEO') v2.pause(); };
      v1.onseeked = () => { if (v2 && v2.tagName === 'VIDEO') v2.currentTime = v1.currentTime; };
    }

    overlay._ctrl = { bindEvents };

    minimizeBtn?.addEventListener('click', e => { e.stopPropagation(); _minimizeOverlay(); });
    closeBtn?.addEventListener('click', e => { e.stopPropagation(); _hardDestroy();  });

    miniPreviewBtn?.addEventListener('click', e => {
      e.stopPropagation();
      _allVids(overlay).forEach(v => { try { v.pause(); } catch (_) {} });
      fsGuard.active = true;
      const doMini = () => {
        overlay.style.display = 'none';
        if (_overlayState) _overlayState.minimized = true;
        fsGuard.active = false;
        _removePill();
        if (!_overlayState) _overlayState = { overlay, rowsData: [...selectedRows], minimized: true };
        _rebuildPill();
        if (_miniPill) _miniPill.style.display = 'none';
        _openMiniPlayer();
      };
      if (VU.isInFullscreen()) {
        VU.exitFullscreen(doMini);
      } else {
        doMini();
      }
    });

    overlay.setAttribute('tabindex', '0');
    overlay.focus();

    overlay.addEventListener('keydown', e => {
      if (_overlayState && _overlayState.minimized) return;
      switch (e.code) {
        case 'Space':
          if (hasVideo) { e.preventDefault(); playPauseBtn.click(); }
          break;
        case 'ArrowLeft':
          if (hasVideo) { e.preventDefault(); VU.seekByFrames(-1, allVids()); updateSeekUI(); }
          break;
        case 'ArrowRight':
          if (hasVideo) { e.preventDefault(); VU.seekByFrames(1, allVids()); updateSeekUI(); }
          break;
        case 'KeyO':
          if (hasVideo) { e.preventDefault(); loopCtrl.setLoop(!loopCtrl.isEnabled()); }
          break;
        case 'Escape':
          e.preventDefault();
          closeMenu();
          _minimizeOverlay();
          break;
      }
    });
  }
  const cleanupFsChangeListener = VU.onFullscreenChange(function _onFsChange() {
    if (fsGuard.active) return;
    if (!VU.isInFullscreen() && _overlayState && !_overlayState.minimized) {
      _minimizeOverlay();
    }
  });
  function clearSelection() {
    closeContextMenu();
    rowCheckboxes.forEach(cb => { cb.checked = false; updateRowSelection(cb); });
    if (selectAllCheckbox) {
      selectAllCheckbox.checked       = false;
      selectAllCheckbox.indeterminate = false;
    }
    updateCompareButton();
  }

})();