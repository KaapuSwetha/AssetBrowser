//  // static/js/review/review_ui.js

// // --- CSRF: robust cookie reader (fixes 403) ---
// function getCsrfFromCookie() {
//   const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
//   return m ? decodeURIComponent(m[1]) : "";
// }

// // --- Utility: parse the media JSON that is scoped to a previewCard ---
// function readMediaJson(card) {
//   try {
//     const scripts = card.querySelectorAll('script[type="application/json"][data-media-json]');
//     const el = scripts.length ? scripts[scripts.length - 1] : null;
//     return el ? JSON.parse(el.textContent || "{}") : {};
//   } catch (e) {
//     return {};
//   }
// }

// // --- Render media into the preview card content area ---
// function renderPreview(card, media) {
//   const content = card.querySelector(".flex-1.flex.items-center.justify-center.p-6");
//   if (!content) return;

//   if (media.pending) {
//     content.innerHTML = `
//       <div class="text-center text-slate-500 text-sm flex flex-col items-center justify-center space-y-2">
//         <i class="fas fa-spinner fa-spin fa-2x mb-1 text-slate-500"></i>
//         <p class="text-slate-400">Preparing preview…</p>
//       </div>`;
//     setTimeout(() => {
//       if (window.htmx) {
//         htmx.ajax("GET", window.location.href, { target: card, swap: "outerHTML" });
//       } else {
//         window.location.reload();
//       }
//     }, 900);
//     return;
//   }

//   if (media.type === "video") {
//     content.innerHTML = `
//       <video controls preload="metadata" id="pvVideo"
//              class="max-h-full max-w-full rounded-xl border border-slate-800 shadow-md bg-black">
//         <source src="${media.src}" type="video/mp4"/>
//         Your browser does not support the video tag.
//       </video>`;
//   } else if (media.type === "image") {
//     content.innerHTML = `
//       <div class="relative group">
//         <img src="${media.src}" alt="Preview" id="pvImage"
//              class="max-h-[80vh] max-w-full rounded-xl border border-slate-800 shadow-md object-contain"/>
//         <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-xl transition"></div>
//       </div>`;
//   } else if (media.type === "sequence" && Array.isArray(media.frames) && media.frames.length) {
//     content.innerHTML = `
//       <div id="seqViewport" class="relative w-full h-full max-h-[calc(100vh-260px)] flex flex-col">
//         <div class="relative flex-1 overflow-hidden bg-black rounded-xl border border-slate-800 shadow-md">
//           <img id="seqImg" src="${media.frames[0]}" class="absolute inset-0 m-auto max-w-none select-none"
//                style="transform: translate(-50%, -50%) scale(1); top: 50%; left: 50%;">
//         </div>
//         <div class="mt-3 border-t border-slate-800/60 bg-slate-900/70 px-3 py-2 flex items-center gap-3 text-xs rounded-b-xl">
//           <button id="btnPlay"  class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">Play</button>
//           <button id="btnPause" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">Pause</button>
//           <button id="btnPrev"  class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">◀︎</button>
//           <button id="btnNext"  class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">▶︎</button>
//           <label>FPS <input id="fps" type="number" value="${media.fps || 24}" min="1" max="120"
//                  class="ml-1 w-16 bg-slate-800/70 border border-slate-700 rounded px-1 py-0.5"></label>
//           <label>Ping-pong <input id="pingpong" type="checkbox" class="ml-1"></label>
//           <label>Loop <input id="loop" type="checkbox" checked class="ml-1"></label>
//           <input id="scrub" type="range" min="0" max="${media.frames.length - 1}" value="0" step="1" class="flex-1 mx-2">
//           <span id="frameLabel" class="tabular-nums">1 / ${media.frames.length}</span>
//         </div>
//       </div>`;

//     const img = document.getElementById("seqImg");
//     const viewport = card.querySelector("#seqViewport .relative.flex-1");
//     if (!img || !viewport) return;

//     // zoom/pan with guards
//     (function enableZoomPan(imgEl, vpEl){
//       if (!(imgEl && vpEl)) return;
//       let scale=1, min=0.2, max=8, ox=0.5, oy=0.5, dragging=false, sx=0, sy=0, bx=0, by=0;
//       const apply=()=>{ imgEl.style.transform=`translate(${ox*vpEl.clientWidth - vpEl.clientWidth/2}px, ${oy*vpEl.clientHeight - vpEl.clientHeight/2}px) scale(${scale})`; };
//       try {
//         const ro = new ResizeObserver(apply);
//         ro.observe(vpEl);
//       } catch(_) {}
//       apply();
//       vpEl.addEventListener("wheel", e=>{
//         e.preventDefault();
//         const old=scale; scale=Math.min(max,Math.max(min,scale + Math.sign(e.deltaY)*-0.1));
//         const r=vpEl.getBoundingClientRect(), cx=(e.clientX-r.left)/r.width, cy=(e.clientY-r.top)/r.height;
//         const k=old?scale/old:1; ox=cx - (cx-ox)*k; oy=cy - (cy-oy)*k; apply();
//       }, {passive:false});
//       vpEl.addEventListener("mousedown", e=>{ if(e.button!==0)return; dragging=true; sx=e.clientX; sy=e.clientY; bx=ox; by=oy;});
//       window.addEventListener("mouseup", ()=> dragging=false);
//       window.addEventListener("mousemove", e=>{ if(!dragging)return; ox=Math.max(0,Math.min(1,bx + (e.clientX-sx)/vpEl.clientWidth)); oy=Math.max(0,Math.min(1,by + (e.clientY-sy)/vpEl.clientHeight)); apply();});
//     })(img, viewport);

//     // playback
//     const scrub = document.getElementById("scrub");
//     const fps   = document.getElementById("fps");
//     const ping  = document.getElementById("pingpong");
//     const loop  = document.getElementById("loop");
//     const prevB = document.getElementById("btnPrev");
//     const nextB = document.getElementById("btnNext");
//     const playB = document.getElementById("btnPlay");
//     const pauseB= document.getElementById("btnPause");
//     const label = document.getElementById("frameLabel");

//     let i=0, dir=1, handle=null;
//     function render(){ img.src = media.frames[i]; label.textContent = (i+1) + " / " + media.frames.length; }
//     function step(n){
//       i = i + n;
//       if (ping.checked){
//         if (i >= media.frames.length) { i = media.frames.length - 2; dir = -1; }
//         if (i < 0)                    { i = 1;                      dir =  1; }
//       } else {
//         if (loop.checked) i = (i + media.frames.length) % media.frames.length;
//         else i = Math.max(0, Math.min(media.frames.length-1, i));
//       }
//       if (scrub) scrub.value = i;
//       render();
//     }
//     if (scrub) scrub.addEventListener("input", ()=>{ i=parseInt(scrub.value,10)||0; render(); });
//     if (prevB) prevB.addEventListener("click", ()=> step(-1));
//     if (nextB) nextB.addEventListener("click", ()=> step(+1));
//     if (playB) playB.addEventListener("click", ()=> { if(handle) return; const tick=()=>{ step(dir); handle=setTimeout(tick, 1000/Math.max(1,parseInt(fps.value,10)||24)); }; tick(); });
//     if (pauseB) pauseB.addEventListener("click", ()=> { if(handle){ clearTimeout(handle); handle=null; }});
//     window.__CURRENT_FRAME__ = () => i;
//     render();
//   } else {
//     content.innerHTML = `
//       <div class="text-center text-slate-500 text-sm flex flex-col items-center justify-center space-y-2">
//         <i class="fas fa-photo-video fa-3x mb-1 text-slate-600"></i>
//         <p class="text-slate-400">${media.message || "Select an item to preview"}</p>
//       </div>`;
//   }
// }

// // --- Lightweight in-card annotator (pen/rect + save as note) ---
// function enableAnnotator(card) {
//   if (!card) return;
//   if (!card.classList.contains("relative")) card.classList.add("relative");

//   const overlay = document.createElement("canvas");
//   overlay.id = "annoCanvas";
//   overlay.className = "pointer-events-auto absolute inset-0 w-full h-full";
//   overlay.style.position = "absolute";
//   overlay.style.inset = "0";
//   card.appendChild(overlay);

//   /*
//   const toolbar = document.createElement("div");
//   toolbar.id = "annoToolbar";
//   toolbar.className = "absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-gray-900/80 border border-gray-700 rounded-full px-3 py-1 text-xs text-slate-300 shadow-lg";
//   toolbar.innerHTML = `
//     <button data-tool="pen"   class="anno-tool px-2 py-1 hover:text-fuchsia-400">✏️</button>
//     <button data-tool="rect"  class="anno-tool px-2 py-1 hover:text-fuchsia-400">⬛</button>
//     <button data-tool="move"  class="anno-tool px-2 py-1 hover:text-fuchsia-400">🖐️</button>
//     <button id="annoSave"     class="px-2 py-1 hover:text-green-400">💾</button>
//     <button id="annoClear"    class="px-2 py-1 hover:text-red-400">🗑️</button>
//   `;
//   card.appendChild(toolbar);
//   */

//   const ctx = overlay.getContext("2d");
//   /*
//   const tools = toolbar.querySelectorAll("[data-tool]");
//   const saveBtn = toolbar.querySelector("#annoSave");
//   const clearBtn= toolbar.querySelector("#annoClear");
//   */
//   let tool="pen", drawing=false, start=null;

//   function resize(){
//     const header = card.querySelector(".px-4.py-3");
//     const rect = card.getBoundingClientRect();
//     overlay.width = rect.width;
//     overlay.height = rect.height - (header ? header.getBoundingClientRect().height : 0);
//   }
//   try {
//     const ro = new ResizeObserver(resize);
//     ro.observe(card);
//   } catch(_) {}
//   resize();

//   /*
//   tools.forEach(b=>b.addEventListener("click", ()=> {
//     tools.forEach(x=>x.classList.remove("text-fuchsia-400"));
//     b.classList.add("text-fuchsia-400"); tool=b.dataset.tool;
//     overlay.style.pointerEvents = (tool==="move") ? "none" : "auto";
//   }));
//   */

//   overlay.addEventListener("mousedown", e=>{ if(tool==="move")return; drawing=true; start={x:e.offsetX,y:e.offsetY}; if(tool==="pen"){ ctx.beginPath(); ctx.moveTo(e.offsetX,e.offsetY); }});
//   overlay.addEventListener("mousemove", e=>{ if(!drawing)return; if(tool==="pen"){ ctx.lineTo(e.offsetX,e.offsetY); ctx.strokeStyle="#f472b6"; ctx.lineWidth=2; ctx.stroke(); }});
//   overlay.addEventListener("mouseup",   e=>{ if(!drawing)return; drawing=false; if(tool==="rect"&&start){ ctx.strokeStyle="#f472b6"; ctx.lineWidth=2; ctx.strokeRect(start.x,start.y,e.offsetX-start.x,e.offsetY-start.y); }});

//   /*
//   clearBtn && clearBtn.addEventListener("click", ()=> ctx.clearRect(0,0,overlay.width,overlay.height));

//   // Save -> create thread -> attach PNG
//   saveBtn && saveBtn.addEventListener("click", async ()=>{
//     const png = overlay.toDataURL("image/png");
//     // version/media context (if you render hidden data attrs, read them here)
//     const versionId = card.getAttribute("data-version-id") || "0";
//     const mediaId   = card.getAttribute("data-media-id") || "0";
//     const frame = (typeof window.__CURRENT_FRAME__==="function") ? window.__CURRENT_FRAME__() : 0;
//     const time  = (document.getElementById("pvVideo")?.currentTime || 0);

//     const fd = new FormData();
//     fd.set("version_id", versionId);
//     fd.set("media_id", mediaId);
//     fd.set("frame", frame);
//     fd.set("time", time.toString());
//     fd.set("body", "Annotation");

//     const csrf = getCsrfFromCookie();

//     const r1 = await fetch("/review/thread/create/", {
//       method: "POST",
//       body: fd,
//       headers: {"X-CSRFToken": csrf},
//       credentials: "same-origin",
//     });
//     if (!r1.ok) { alert("Failed to create note"); return; }
//     const html = await r1.text();
//     const list = document.getElementById("threadList");
//     if (list) list.insertAdjacentHTML("afterbegin", html);
//     const just = list ? list.firstElementChild : null;
//     const idEl = just ? just.querySelector("[id^=messages-]") : null;
//     const threadId = idEl ? parseInt(idEl.id.replace("messages-",""),10) : null;

//     if (threadId){
//       await fetch(`/review/annotation/${threadId}/save/`, {
//         method: "POST",
//         headers: {"X-CSRFToken": csrf, "Content-Type": "application/json"},
//         body: JSON.stringify({ image: png }),
//         credentials: "same-origin",
//       });
//       alert("Annotation saved");
//     }
//   });
//   */
// }

// // --- Bootstrapping on load and HTMX swaps ---
// function mountPreviewIfAny(root) {
//   const card = (root && root.id === "previewCard") ? root : document.getElementById("previewCard");
//   if (!card) return;
//   const media = readMediaJson(card);
//   renderPreview(card, media);
//   enableAnnotator(card);
// }

// document.addEventListener("DOMContentLoaded", () => mountPreviewIfAny(document.getElementById("previewCard")));
// document.addEventListener("htmx:afterSwap", (e) => {
//   const tgt = e.detail && e.detail.target;
//   if (!tgt) return;
//   if (tgt.id === "previewCard" || tgt.querySelector?.("#previewCard")) {
//     mountPreviewIfAny(tgt.id === "previewCard" ? tgt : tgt.querySelector("#previewCard"));
//   }
// });
