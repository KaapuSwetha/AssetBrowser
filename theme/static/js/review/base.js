/* ======================== base.js (HaloHues standard) ======================== */

/* ════════════════════════════════════════════════════════
   HTMX CURSOR PROGRESS
════════════════════════════════════════════════════════ */
document.body.addEventListener("htmx:request", () =>
  document.body.classList.add("cursor-progress"),
);
document.body.addEventListener("htmx:afterSwap", () =>
  document.body.classList.remove("cursor-progress"),
);
document.body.addEventListener("htmx:responseError", () =>
  document.body.classList.remove("cursor-progress"),
);

/* ════════════════════════════════════════════════════════
   TOAST SYSTEM
════════════════════════════════════════════════════════ */
document.body.addEventListener("showToast", function (event) {
  const detail = event.detail;
  if (window.Toast && detail) {
    window.Toast.show({
      title: detail.title || "Notification",
      message: detail.message || "",
      type: detail.type || "info",
      duration: 4000,
    });
  }
});

class Toast {
  static show({ title = "", message = "", type = "info", duration = 4000 }) {
    const container = document.getElementById("toast-container");
    const template = document.getElementById("toastTemplate");
    const toast = template.content.cloneNode(true);
    const toastEl = toast.querySelector(".animate-slideInDown");
    toastEl.classList.add("toast");

    toastEl.querySelector(".toast-title").textContent = title;
    toastEl.querySelector(".toast-message").textContent = message;

    const types = {
      success: {
        icon: "fa-check-circle",
        bg: "bg-emerald-900/90",
        border: "border-emerald-600/60",
        text: "text-emerald-50",
      },
      error: {
        icon: "fa-exclamation-circle",
        bg: "bg-rose-900/90",
        border: "border-rose-600/60",
        text: "text-rose-50",
      },
      warning: {
        icon: "fa-exclamation-triangle",
        bg: "bg-amber-900/90",
        border: "border-amber-600/60",
        text: "text-amber-50",
      },
      info: {
        icon: "fa-info-circle",
        bg: "bg-sky-900/90",
        border: "border-sky-600/60",
        text: "text-sky-50",
      },
    };
    const cfg = types[type] || types.info;
    toastEl.classList.add(cfg.bg, cfg.border, cfg.text);
    toastEl.querySelector(".toast-icon").classList.add(cfg.icon);

    container.appendChild(toast);
    updateSearchResultsPosition();

    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.style.opacity = "0";
        toastEl.style.transform = "translateY(-12px)";
        setTimeout(() => {
          toastEl.remove();
          updateSearchResultsPosition();
        }, 300);
      }
    }, duration);
  }
  static success(msg, title = "Success") {
    this.show({ title, message: msg, type: "success" });
  }
  static error(msg, title = "Error") {
    this.show({ title, message: msg, type: "error" });
  }
  static warning(msg, title = "Warning") {
    this.show({ title, message: msg, type: "warning" });
  }
  static info(msg, title = "Info") {
    this.show({ title, message: msg, type: "info" });
  }
}
window.Toast = Toast;

function updateSearchResultsPosition() {
  const tc = document.getElementById("toast-container");
  const sr = document.getElementById("searchResults");
  if (!tc || !sr) return;
  const h = tc.offsetHeight;
  sr.style.top =
    h > 0
      ? `calc(100% + 0.5rem + ${h}px + 0.5rem)`
      : "calc(100% + 0.5rem)";
}

/* ── Search dropdown hide/show logic ── */
(() => {
  const input = document.getElementById("globalSearch");
  const dropdown = document.getElementById("searchResults");
  const content = document.getElementById("searchResultsContent");

  const hide = () => {
    if (content) content.innerHTML = "";
    dropdown?.classList.add("pointer-events-none");
    setTimeout(() => dropdown?.classList.remove("pointer-events-none"), 120);
  };

  dropdown?.addEventListener("click", (e) => {
    if (e.target.closest("a,button,[data-search-result]")) setTimeout(hide, 0);
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  document.addEventListener("mousedown", (e) => {
    if (dropdown?.contains(e.target) || input?.contains(e.target)) return;
    hide();
  });

  const mo = new MutationObserver(() => {
    const empty = !content?.innerHTML?.trim();
    if (dropdown) dropdown.style.display = empty ? "none" : "";
    updateSearchResultsPosition();
  });
  if (content) mo.observe(content, { childList: true, subtree: true });
  updateSearchResultsPosition();
})();

/* ════════════════════════════════════════════════════════
   PROJECT TREE (localStorage accordion state)
════════════════════════════════════════════════════════ */
(() => {
  const TREE_SELECTOR = "#projectTree";
  const ACCORDION_PER_LEVEL = false;
  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function keyFor(d) {
    return d?.dataset?.key || null;
  }

  function restore(root) {
    qsa("details[data-key]", root).forEach((d) => {
      const k = keyFor(d);
      if (!k) return;
      const v = localStorage.getItem("tree:" + k);
      if (v === "1") d.setAttribute("open", "");
      if (v === "0") d.removeAttribute("open");
    });
    paint(root);
  }

  function save(d) {
    const k = keyFor(d);
    if (!k) return;
    localStorage.setItem("tree:" + k, d.open ? "1" : "0");
  }

  function paint(root) {
    qsa("details", root).forEach((d) => {
      const summary = qs("summary", d);
      if (!summary) return;
      const c = qs(".folder-closed", summary);
      const o = qs(".folder-open", summary);
      const caret = qs(".caret", summary);
      const opened = !!d.open;
      if (c && o) {
        c.style.cssText = opened
          ? "display:none!important"
          : "display:inline-block!important";
        o.style.cssText = opened
          ? "display:inline-block!important"
          : "display:none!important";
      }
      if (caret) {
        caret.style.transform = opened ? "rotate(90deg)" : "rotate(0deg)";
        caret.style.transition = "transform 0.2s ease";
      }
    });
  }

  function collapseSiblings(d) {
    if (!ACCORDION_PER_LEVEL) return;
    qsa(":scope > details", d.parentElement).forEach((x) => {
      if (x !== d) {
        x.removeAttribute("open");
        save(x);
      }
    });
  }

  function bind(root) {
    root.addEventListener(
      "toggle",
      (e) => {
        const d = e.target;
        if (!(d instanceof HTMLDetailsElement)) return;
        save(d);
        paint(root);
        if (d.open) collapseSiblings(d);
      },
      true,
    );
  }

  function init() {
    const root = qs(TREE_SELECTOR);
    if (!root) return;
    bind(root);
    restore(root);
  }

  document.addEventListener("DOMContentLoaded", init);
  document.body.addEventListener("htmx:afterSwap", (e) => {
    const t = e.detail?.target;
    if (!t) return;
    const tree = t.closest(TREE_SELECTOR) || qs(TREE_SELECTOR, t);
    if (tree) restore(tree);
  });
})();

/* ════════════════════════════════════════════════════════
   NOTIFICATION SYSTEM
════════════════════════════════════════════════════════ */
(() => {
  const btn = document.getElementById("notifButton");
  const dropdown = document.getElementById("notifDropdown");
  const badge = document.getElementById("notifCountBadge");
  const headerCount = document.getElementById("notifHeaderCount");
  const list = document.getElementById("notifList");
  const emptyState = document.getElementById("notifEmpty");
  const markAllBtn = document.getElementById("markAllReadBtn");
  const refreshBtn = document.getElementById("refreshNotifBtn");
  const bellIcon = document.getElementById("notifBellIcon");

  let isOpen = false;
  let pollInterval = null;
  const POLL_MS = 5_000;
  let activeFilter = "all";
  let activeSubFilter = "asset";

  /* ── Department / variant config maps ── */
  const SEQ_DEPT_CFG = {
    Matchmove: {
      icon: "fa-crosshairs",
      bg: "rgba(6,182,212,.18)", border: "rgba(6,182,212,.35)",
      text: "#67e8f9", dot: "#06b6d4", label: "Matchmove",
    },
    Animation: {
      icon: "fa-person-running",
      bg: "rgba(34,197,94,.18)", border: "rgba(34,197,94,.35)",
      text: "#86efac", dot: "#22c55e", label: "Animation",
    },
    Lighting: {
      icon: "fa-lightbulb",
      bg: "rgba(234,179,8,.18)", border: "rgba(234,179,8,.35)",
      text: "#fde047", dot: "#eab308", label: "Render",
    },
    Compositing: {
      icon: "fa-layer-group",
      bg: "rgba(139,92,246,.18)", border: "rgba(139,92,246,.35)",
      text: "#c4b5fd", dot: "#8b5cf6", label: "Compositing",
    },
    FX: {
      icon: "fa-fire",
      bg: "rgba(249,115,22,.18)", border: "rgba(249,115,22,.35)",
      text: "#fdba74", dot: "#f97316", label: "FX",
    },
    Roto: {
      icon: "fa-scissors",
      bg: "rgba(236,72,153,.18)", border: "rgba(236,72,153,.35)",
      text: "#f9a8d4", dot: "#ec4899", label: "Roto",
    },
    Cache: {
      icon: "fa-database",
      bg: "rgba(100,116,139,.18)", border: "rgba(100,116,139,.35)",
      text: "#94a3b8", dot: "#64748b", label: "Cache",
    },
    Previz: {
      icon: "fa-film",
      bg: "rgba(99,102,241,.18)", border: "rgba(99,102,241,.35)",
      text: "#a5b4fc", dot: "#6366f1", label: "Previz",
    },
    Layout: {
      icon: "fa-map",
      bg: "rgba(16,185,129,.18)", border: "rgba(16,185,129,.35)",
      text: "#6ee7b7", dot: "#10b981", label: "Layout",
    },
    Crowd: {
      icon: "fa-users",
      bg: "rgba(245,158,11,.18)", border: "rgba(245,158,11,.35)",
      text: "#fcd34d", dot: "#f59e0b", label: "Crowd",
    },
    Rigging: {
      icon: "fa-link",
      bg: "rgba(99,102,241,.18)", border: "rgba(99,102,241,.35)",
      text: "#a5b4fc", dot: "#6366f1", label: "Rigging",
    },
  };

  const ASSET_VARIANT_CFG = {
    anim: {
      icon: "fa-person-running",
      bg: "rgba(34,197,94,.18)", border: "rgba(34,197,94,.35)",
      text: "#86efac", dot: "#22c55e", label: "Anim",
    },
    render: {
      icon: "fa-lightbulb",
      bg: "rgba(234,179,8,.18)", border: "rgba(234,179,8,.35)",
      text: "#fde047", dot: "#eab308", label: "Render",
    },
    default: {
      icon: "fa-cube",
      bg: "rgba(59,130,246,.18)", border: "rgba(59,130,246,.35)",
      text: "#93c5fd", dot: "#3b82f6", label: "Default",
    },
  };

  const ASSET_VARIANT_FALLBACK = {
    icon: "fa-layer-group",
    bg: "rgba(100,116,139,.18)", border: "rgba(100,116,139,.35)",
    text: "#94a3b8", dot: "#64748b",
  };

  function getAssetVariantCfg(n) {
    const v = (n.variant || "default").toLowerCase();
    if (ASSET_VARIANT_CFG[v]) return ASSET_VARIANT_CFG[v];
    return { ...ASSET_VARIANT_FALLBACK, label: v };
  }

  /* ── Change-type badge config ── */
  const TYPE_BADGE_CFG = {
    status_change: {
      icon: "fa-circle-half-stroke",
      bg: "rgba(239,68,68,.15)", border: "rgba(239,68,68,.35)",
      text: "#fca5a5", dot: "#ef4444", label: "Status Changed",
    },
    new_asset: {
  icon: "fa-cube",
  bg: "rgba(124,58,237,.15)", border: "rgba(124,58,237,.35)",
  text: "#c4b5fd", dot: "#8b5cf6", label: "New Variant",
},
    new_version: {
      icon: "fa-code-branch",
      bg: "rgba(124,58,237,.15)", border: "rgba(124,58,237,.35)",
      text: "#c4b5fd", dot: "#8b5cf6", label: "New Variant",
    },
    new_variant: {
      icon: "fa-code-branch",
      bg: "rgba(124,58,237,.15)", border: "rgba(124,58,237,.35)",
      text: "#c4b5fd", dot: "#8b5cf6", label: "New Variant",
    },
    comment_change: {
      icon: "fa-comment",
      bg: "rgba(14,165,233,.15)", border: "rgba(14,165,233,.3)",
      text: "#7dd3fc", dot: "#0ea5e9", label: "Comment",
    },
    new_shot: {
  icon: "fa-clapperboard",
  bg: "rgba(16,185,129,.15)", border: "rgba(16,185,129,.35)",
  text: "#6ee7b7", dot: "#10b981", label: "New Shot",
},
    field_change: {
      icon: "fa-pen",
      bg: "rgba(100,116,139,.15)", border: "rgba(100,116,139,.3)",
      text: "#94a3b8", dot: "#64748b", label: "Update",
    },
    default: {
      icon: "fa-bell",
      bg: "rgba(99,102,241,.15)", border: "rgba(99,102,241,.3)",
      text: "#a5b4fc", dot: "#6366f1", label: "Update",
    },
  };

  function getMode(n) {
    if (!n.json_path) return "asset";
    const p = n.json_path.replace(/\\/g, "/");
    return /\/[Ss]equence\//i.test(p) ? "sequence" : "asset";
  }


function getNotifDisplayCfg(n) {
    const mode = getMode(n);
    const type = n.type || "";

    if (type === "status_change") return TYPE_BADGE_CFG.status_change;

    if (mode === "sequence") {
        // ── Show dept badge for sequence shots (Animation, Cache, Matchmove etc)
        const dept = n.dept || "";
        if (dept && SEQ_DEPT_CFG[dept]) return SEQ_DEPT_CFG[dept];
        return TYPE_BADGE_CFG.new_shot;  // fallback if dept not in config
    }

    if (mode === "asset") return getAssetVariantCfg(n);

    return TYPE_BADGE_CFG[type] || TYPE_BADGE_CFG.default;
}

function getTypePillHtml(n) {
    const type = n.type || "";
    const mode = getMode(n);
    const mainCfg = getNotifDisplayCfg(n);
    let pills = "";

    // ── Sequence (non-status_change): dept is the main badge,
    //    so render the type pill (e.g. "New Shot") alongside it
    if (mode === "sequence" && type !== "status_change") {
        const tc = TYPE_BADGE_CFG[type] || TYPE_BADGE_CFG.default;
        return `
            <span style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
                         color:${tc.text};padding:2px 6px;border-radius:4px;
                         background:${tc.bg};border:1px solid ${tc.border};white-space:nowrap;">
              <i class="fas ${tc.icon}" style="font-size:7px;margin-right:2px;"></i>${tc.label}
            </span>`;
    }

    const mainIsType    = Object.values(TYPE_BADGE_CFG).includes(mainCfg);
    const mainIsVariant = mode === "asset" && mainCfg === getAssetVariantCfg(n);

    if (!mainIsType) {
        const tc = TYPE_BADGE_CFG[type] || TYPE_BADGE_CFG.default;
        pills += `
            <span style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
                         color:${tc.text};padding:2px 6px;border-radius:4px;
                         background:${tc.bg};border:1px solid ${tc.border};white-space:nowrap;">
              <i class="fas ${tc.icon}" style="font-size:7px;margin-right:2px;"></i>${tc.label}
            </span>`;
    }

    if (mode === "sequence" && n.dept) {
        const dc = SEQ_DEPT_CFG[n.dept] || {};
        pills += `
            <span style="font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
                         color:${dc.text || "#7dd3fc"};padding:2px 6px;border-radius:4px;white-space:nowrap;
                         background:${dc.bg || "rgba(14,165,233,.1)"};border:1px solid ${dc.border || "rgba(14,165,233,.22)"};">
              <i class="fas ${dc.icon || "fa-film"}" style="font-size:7px;margin-right:2px;"></i>${escHtml(n.dept)}
            </span>`;
    }

    if (mode === "asset" && !mainIsVariant) {
        const vcfg = getAssetVariantCfg(n);
        pills += `
            <span style="font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
                         color:${vcfg.text};padding:2px 6px;border-radius:4px;
                         background:${vcfg.bg};border:1px solid ${vcfg.border};white-space:nowrap;">
              <i class="fas ${vcfg.icon}" style="font-size:7px;margin-right:2px;"></i>${vcfg.label}
            </span>`;
    }

    return pills;
}

  /* ── Tab / sub-filter style constants ── */
  const TAB_ON =
    "background:rgba(139,92,246,.25);border:1px solid rgba(139,92,246,.45);color:#c4b5fd;";
  const TAB_OFF =
    "background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#64748b;";
  const SUB_ON =
    "background:rgba(139,92,246,.2);border:1px solid rgba(139,92,246,.4);color:#c4b5fd;";
  const SUB_OFF =
    "background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);color:#475569;";

  const HIDDEN_TYPES = new Set(["new_key", "comment_change", "field_change"]);

  function applyFilter(notifications) {
    let result = notifications.filter((n) => !HIDDEN_TYPES.has(n.type));
    if (activeFilter === "3days") {
      const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
      result = result.filter(
        (n) => new Date(n.timestamp).getTime() >= cutoff,
      );
    }
    result = result.filter((n) => getMode(n) === activeSubFilter);
    return result;
  }
 function updateBadge() {
  const notifications = window._notifData || [];

  // Filter out hidden types first (same as applyFilter does)
  let filtered = notifications.filter((n) => !HIDDEN_TYPES.has(n.type));

  // Apply time filter based on activeFilter
  if (activeFilter === "3days") {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    filtered = filtered.filter(
      (n) => new Date(n.timestamp).getTime() >= cutoff,
    );
  }
  // For "all" filter, no time filtering - just hidden types removed

  // Count ALL modes (asset + sequence combined) since we're not filtering by sub-filter here
  const count = filtered.length;

  const prevCount = parseInt(badge.textContent) || 0;
  if (count > 0) {
    badge.style.display = "inline-block";
    badge.textContent = count > 99 ? "99+" : String(count);
    bellIcon.classList.replace("far", "fas");
    bellIcon.style.color = "#a78bfa";
    if (count > prevCount) {
      bellIcon.classList.remove("ringing");
      void bellIcon.offsetWidth;
      bellIcon.classList.add("ringing");
      setTimeout(() => bellIcon.classList.remove("ringing"), 800);
    }
  } else {
    badge.style.display = "none";
    badge.textContent = "0";
    bellIcon.classList.replace("fas", "far");
    bellIcon.style.color = "";
  }
}
 window.setNotifFilter = function (filter) {
  activeFilter = filter;
  document.getElementById("filterAll").style.cssText =
    filter === "all" ? TAB_ON : TAB_OFF;
  document.getElementById("filter3days").style.cssText =
    filter === "3days" ? TAB_ON : TAB_OFF;
  list.innerHTML = "";
  renderNotifications(window._notifData || []);
  updateBadge(); // ← Already present, good
};

window.setNotifSubFilter = function (sub) {
  activeSubFilter = sub;
  document.getElementById("filterAsset").style.cssText =
    sub === "asset" ? SUB_ON : SUB_OFF;
  document.getElementById("filterSequence").style.cssText =
    sub === "sequence" ? SUB_ON : SUB_OFF;
  list.innerHTML = "";
  renderNotifications(window._notifData || []);
  updateBadge(); // ← Already present, good
};
  /* ── Misc helpers ── */
  function relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  (() => {
  const TICK_MS = 30_000; // re-evaluate every 30 seconds

  function tickTimestamps() {
    document.querySelectorAll(".notif-row [data-ts]").forEach((el) => {
      const iso = el.dataset.ts;
      if (iso) el.textContent = relTime(iso);
    });
  }

  setInterval(tickTimestamps, TICK_MS);
})();

  function csrfToken() {
    return (
      document.cookie
        .split(";")
        .find((c) => c.trim().startsWith("csrftoken="))
        ?.split("=")[1] || ""
    );
  }

  function postJSON(url) {
    return fetch(url, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrfToken(),
        "Content-Type": "application/json",
      },
    });
  }

  function escHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function navigateToAsset(n) {
    if (!n.json_path) {
      console.warn("[notif] no json_path on notification", n);
      return;
    }

    const normalised = n.json_path.replace(/\\/g, "/");
    let mode = "Asset";
    if (/\/[Ss]equence\//i.test(normalised)) mode = "Sequence";

    let variant = "";
    if (mode === "Asset") {
      // For assets: variant is stored directly in n.variant
      variant = n.variant || "";
    } else {
      // For sequences: key is "SHOT_0002 / v001", extract version if needed
      if (n.key && n.key.includes(" / ")) {
        variant = n.key.split(" / ")[1].trim();
      } else {
        variant = "";
      }
    }

    const path = n.json_path;
    const name = n.asset;

    htmx.ajax(
      "GET",
      "/versions/?" + new URLSearchParams({ path, mode, name, variant }),
      { target: "#versionsTable", swap: "innerHTML" },
    );

    htmx.ajax(
      "GET",
      "/metadata/?" + new URLSearchParams({ path, mode, name, variant }),
      { target: "#metadataCard", swap: "innerHTML" },
    );

    const details = document.getElementById("detailsPanel");
    if (details)
      details.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderNotifications(notifications) {
    const visible = applyFilter(notifications);

    if (markAllBtn) {
      markAllBtn.innerHTML = `<i class="fas fa-check-double text-[9px]"></i> Mark all read`;
    }

    if (!visible.length) {
  list.innerHTML = "";
  emptyState.classList.remove("hidden");
  emptyState.classList.add("flex");
  const sub = document.getElementById("notifEmptySubtext");
  if (sub) {
    sub.textContent =
      activeSubFilter === "asset"
        ? activeFilter === "3days"
          ? "No asset notifications in last 3 days"
          : "No asset notifications"
        : activeFilter === "3days"
          ? "No sequence notifications in last 3 days"
          : "No sequence notifications";
  }
  // markAllBtn stays visible — removed hidden toggle
  headerCount.classList.add("hidden");
  headerCount.classList.remove("inline-flex");
  return;
}

    emptyState.classList.add("hidden");
    emptyState.classList.remove("flex");
    headerCount.classList.remove("hidden");
    headerCount.classList.add("inline-flex");
    document.getElementById("notifHeaderCountText").textContent =
      `${visible.length} new`;

    /* Smart diff: only add rows not already in DOM */
    const existingIds = new Set(
      Array.from(list.querySelectorAll(".notif-row")).map(
        (el) => el.dataset.id,
      ),
    );
    const visibleIds = new Set(visible.map((n) => n.id));

    existingIds.forEach((id) => {
      if (!visibleIds.has(id)) {
        const el = list.querySelector(`[data-id="${id}"]`);
        if (el) el.remove();
      }
    });

    const toAdd = visible.filter((n) => !existingIds.has(n.id));
    toAdd.reverse().forEach((n) => {
      const tmp = document.createElement("ul");
      appendNotifRow(tmp, n);
      const newRow = tmp.firstElementChild;
      list.prepend(newRow);
      _bindRowButtons(newRow);
    });

    if (existingIds.size === 0 && toAdd.length === visible.length) {
      list.querySelectorAll(".notif-row").forEach((row) => {
        row.style.animation = "none";
      });
    }

    cleanEmptySections();
  }

  function _bindRowButtons(row) {
    const id = row.dataset.id;

    const viewBtn = row.querySelector(".notif-view-btn");
    if (viewBtn) {
      viewBtn.addEventListener("click", () => {
        const notif = (window._notifData || []).find((n) => n.id === id);
        postJSON(notifUrl("read", id));
        window._notifData = (window._notifData || []).filter(
          (n) => n.id !== id,
        );
        _lastNotifSignature = (window._notifData || [])
          .map((n) => n.id)
          .join(",");
        removeRow(id);
        closeDropdown();
        if (notif) navigateToAsset(notif);
      });
    }

    const readBtn = row.querySelector(".notif-read-btn");
    if (readBtn) {
      readBtn.addEventListener("click", () => {
        postJSON(notifUrl("read", id));
        window._notifData = (window._notifData || []).filter(
          (n) => n.id !== id,
        );
        _lastNotifSignature = (window._notifData || [])
          .map((n) => n.id)
          .join(",");
        removeRow(id);
      });
    }

    const dismissBtn = row.querySelector(".notif-dismiss-btn");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", () => {
        postJSON(notifUrl("delete", id));
        window._notifData = (window._notifData || []).filter(
          (n) => n.id !== id,
        );
        _lastNotifSignature = (window._notifData || [])
          .map((n) => n.id)
          .join(",");
        removeRow(id);
      });
    }
  }

  /* ── Build and append a single notification <li> ── */
  function appendNotifRow(parent, n) {
    const cfg = getNotifDisplayCfg(n);
    const li = document.createElement("li");
    li.className = "notif-row";
    li.dataset.id = n.id;
    li.style.cssText = `
      display:flex; align-items:flex-start; gap:12px;
      padding:12px 16px;
      border-bottom:1px solid rgba(255,255,255,.05);
      cursor:default; transition:background .15s ease;
      position:relative; overflow:hidden;
    `;

    li.addEventListener("mouseenter", () => {
      li.style.background = "rgba(139,92,246,.06)";
      const db = li.querySelector(".notif-dismiss-btn");
      if (db) db.style.opacity = "1";
    });
    li.addEventListener("mouseleave", () => {
      li.style.background = "";
      const db = li.querySelector(".notif-dismiss-btn");
      if (db) db.style.opacity = "0";
    });

    /* Left accent bar */
    const accent = document.createElement("div");
    accent.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:2px;background:${cfg.dot};opacity:.7;border-radius:0 2px 2px 0;`;
    li.appendChild(accent);

    li.innerHTML += `
      <!-- Icon -->
      <div style="width:36px;height:36px;border-radius:10px;flex-shrink:0;
                  display:flex;align-items:center;justify-content:center;
                  background:${cfg.bg};border:1px solid ${cfg.border};
                  position:relative;margin-left:6px;">
        <i class="fas ${cfg.icon}" style="color:${cfg.text};font-size:13px;"></i>
      </div>

      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;flex-wrap:wrap;">
          <span style="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
                       color:${cfg.text};padding:2px 7px;border-radius:4px;
                       background:${cfg.bg};border:1px solid ${cfg.border};white-space:nowrap;">
            <i class="fas ${cfg.icon}" style="font-size:8px;margin-right:3px;"></i>${cfg.label}
          </span>
          ${getTypePillHtml(n)}
          <span data-ts="${escHtml(n.timestamp)}"
          style="font-size:10px;color:#798aa3;margin-left:auto;white-space:nowrap;">
          ${relTime(n.timestamp)}
          </span>
        </div>
        <p style="font-size:11px;line-height:1.5;margin:0 0 8px 0;">${escHtml(n.message)}</p>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
          <button class="notif-view-btn" data-id="${n.id}"
            style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;
                   color:#c4b5fd;padding:3px 10px;border-radius:8px;cursor:pointer;
                   background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.35);
                   transition:all .15s ease;"
            onmouseover="this.style.background='rgba(124,58,237,.35)'"
            onmouseout="this.style.background='rgba(124,58,237,.2)'">
            <i class="fas fa-arrow-up-right-from-square" style="font-size:8px;"></i> View
          </button>
          <button class="notif-read-btn" data-id="${n.id}"
            style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;
                   color:#6ee7b7;padding:3px 10px;border-radius:8px;cursor:pointer;
                   background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);
                   transition:all .15s ease;"
            onmouseover="this.style.background='rgba(16,185,129,.25)'"
            onmouseout="this.style.background='rgba(16,185,129,.12)'">
            <i class="fas fa-check" style="font-size:8px;"></i> Mark read
          </button>
        </div>
      </div>

      <button class="notif-dismiss-btn" data-id="${n.id}" title="Dismiss"
        style="flex-shrink:0;opacity:0;background:none;border:none;
               cursor:pointer;padding:4px;border-radius:6px;
               transition:opacity .15s,color .15s,background .15s;"
        onmouseover="this.style.color='#f1f5f9';this.style.background='rgba(255,255,255,.08)'"
        onmouseout="this.style.color='#475569';this.style.background='none'">
        <i class="fas fa-times" style="font-size:10px;"></i>
      </button>
    `;

    parent.appendChild(li);
  }

  /* ── Remove a row with slide-out animation ── */
  function removeRow(id) {
    const row = list.querySelector(`[data-id="${id}"]`);
    if (!row) return;
    row.classList.add("removing");
    setTimeout(() => {
      row.remove();
      cleanEmptySections();
      updateBadge(); // ← recomputes from active filter automatically

      const visibleCount = applyFilter(window._notifData || []).length;
if (visibleCount > 0) {
  document.getElementById("notifHeaderCountText").textContent =
    `${visibleCount} new`;
} else {
  headerCount.classList.add("hidden");
  headerCount.classList.remove("inline-flex");
  // markAllBtn stays — removed hidden toggle
}

      const domRows = list.querySelectorAll(".notif-row").length;
      if (domRows === 0) renderNotifications(window._notifData || []);
    }, 220);
  }

  function cleanEmptySections() {
    list.querySelectorAll(".notif-section-header").forEach((hdr) => {
      let next = hdr.nextElementSibling;
      let hasRows = false;
      while (next && !next.classList.contains("notif-section-header")) {
        if (next.classList.contains("notif-row")) {
          hasRows = true;
          break;
        }
        next = next.nextElementSibling;
      }
      if (!hasRows) hdr.remove();
    });
  }

  /* ── URL config — populated by Django template tags in base.html ── */
  const NOTIF_URLS = window.NOTIF_URLS || {};

  function notifUrl(key, id) {
    return (NOTIF_URLS[key] || "").replace("__ID__", id || "");
  }

  let _lastNotifSignature = "";

  async function _doFetch() {
    const res = await fetch(NOTIF_URLS.list);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.notifications || [];
  }

  async function fetchNotifications() {
    try {
      const incoming = await _doFetch();
      const signature = incoming.map((n) => n.id).join(",");

      if (signature !== _lastNotifSignature) {
        _lastNotifSignature = signature;
        window._notifData = incoming;
        if (isOpen) renderNotifications(window._notifData);
      }

      updateBadge(); // ← always recomputes from active filter
    } catch (_) {}
  }

  refreshBtn?.addEventListener("click", async function () {
    const icon = this.querySelector("i");
    icon.classList.add("fa-spin");
    this.disabled = true;

    let success = false;
    try {
      const incoming = await _doFetch();
      const signature = incoming.map((n) => n.id).join(",");

      _lastNotifSignature = signature;
      window._notifData = incoming;
      renderNotifications(window._notifData);

      updateBadge(); // ← recomputes from active filter
      success = true;

    } catch (err) {
      console.error("Notification refresh failed:", err);
    } finally {
      icon.classList.remove("fa-spin");
      this.disabled = false;

      const flashIn = success ? "fa-check" : "fa-xmark";
      const color   = success ? "#34d399"  : "#f87171";
      icon.classList.replace("fa-rotate-right", flashIn);
      this.style.color = color;

      setTimeout(() => {
        icon.classList.replace(flashIn, "fa-rotate-right");
        this.style.color = "";
      }, 1200);
    }
  });

  function openDropdown() {
    isOpen = true;
    btn.setAttribute("aria-expanded", "true");
    dropdown.classList.remove("hidden");
    renderNotifications(window._notifData || []);
  }

  function closeDropdown() {
    isOpen = false;
    btn.setAttribute("aria-expanded", "false");
    dropdown.classList.add("hidden");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? closeDropdown() : openDropdown();
  });
  document.addEventListener("mousedown", (e) => {
    if (!document.getElementById("notifWrapper")?.contains(e.target))
      closeDropdown();
  });



markAllBtn?.addEventListener("click", async () => {
  // ── 1. Loading state ──────────────────────────────────────────────────
  markAllBtn.disabled = true;
  markAllBtn.innerHTML = `<i class="fas fa-spinner fa-spin text-[9px]"></i> Marking...`;
  markAllBtn.style.opacity = "1";

  try {
    await postJSON(NOTIF_URLS.markAll);
  } catch (_) {}

  // ── 2. Brief success flash ────────────────────────────────────────────
  markAllBtn.innerHTML = `<i class="fas fa-check-double text-[9px]"></i> All read!`;
  markAllBtn.style.color = "#6ee7b7";   // emerald tint

  // ── 3. Transition to empty state after 750ms ──────────────────────────
  setTimeout(() => {
    window._notifData = [];
    _lastNotifSignature = "";
    renderNotifications([]);
    updateBadge();
    markAllBtn.disabled = false;
    markAllBtn.style.color = "";
    markAllBtn.innerHTML = `<i class="fas fa-check-double text-[9px]"></i> Mark all read`;
  }, 750);
});

  function startPolling() {
    fetchNotifications();
    pollInterval = setInterval(fetchNotifications, POLL_MS);
  }

  document.addEventListener("DOMContentLoaded", () => {
    window._notifData = [];
    if (markAllBtn) markAllBtn.style.display = "flex";
    startPolling();
  });
  document.body.addEventListener("htmx:afterSwap", () => {
    if (!pollInterval) startPolling();
  });

})();