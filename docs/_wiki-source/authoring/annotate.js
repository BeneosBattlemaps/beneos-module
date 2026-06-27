/* Beneos Wiki screenshot annotator.
 *
 * Injected into the live page (Foundry or webshop) via Playwright
 * browser_evaluate, then called as window.__bnz(specs, opts). It overlays a
 * gold-on-dark marker layer (numbered circle + arrow + micro-label, optional
 * ring) matching the wiki design, and returns the crop rectangle (CSS px) to
 * feed to `ffmpeg -vf crop=w:h:x:y` so the final webp is tight on the area.
 *
 * specs: [{ sel | rect, n, label, side, ring }]
 *   sel    CSS selector of the target control (rect taken from it)
 *   rect   {left,top,width,height} alternative to sel
 *   n      number shown in the marker chip
 *   label  2-3 word micro caption (optional)
 *   side   'left' | 'right' | 'top' | 'bottom' where the chip sits (default left)
 *   ring   false to suppress the highlight ring (default true)
 * opts: { cropSel | cropRect, pad }  area to crop to (unioned with markers)
 *
 * Returns { x, y, w, h } in CSS px, clamped to the viewport. */
window.__bnz = function (specs, opts) {
  opts = opts || {};
  document.getElementById("bnz-annot")?.remove();
  const layer = document.createElement("div");
  layer.id = "bnz-annot";
  Object.assign(layer.style, { position: "fixed", left: 0, top: 0, width: "100%", height: "100%", zIndex: 2147483647, pointerEvents: "none" });
  document.body.appendChild(layer);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  Object.assign(svg.style, { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" });
  svg.innerHTML = '<defs><marker id="bnzah" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#e2ba6f"/></marker></defs>';
  layer.appendChild(svg);

  const rects = [];
  const push = (x, y, w, h) => rects.push({ x, y, w, h });

  if (opts.cropRect) push(opts.cropRect.x, opts.cropRect.y, opts.cropRect.w, opts.cropRect.h);
  if (opts.cropSel) { const e = document.querySelector(opts.cropSel); if (e) { const r = e.getBoundingClientRect(); push(r.left, r.top, r.width, r.height); } }

  (specs || []).forEach((s) => {
    let r = s.rect;
    if (!r && s.sel) { const el = document.querySelector(s.sel); if (el) r = el.getBoundingClientRect(); }
    if (!r) return;
    push(r.left, r.top, r.width, r.height);

    if (s.ring !== false) {
      const ring = document.createElement("div");
      Object.assign(ring.style, { position: "absolute", left: (r.left - 4) + "px", top: (r.top - 4) + "px", width: (r.width + 8) + "px", height: (r.height + 8) + "px", border: "2.5px solid #e2ba6f", borderRadius: "8px", boxShadow: "0 0 0 2px rgba(0,0,0,.55), 0 0 14px rgba(226,186,111,.55)" });
      layer.appendChild(ring);
    }

    const side = s.side || "left";
    const cx = side === "left" ? r.left - 48 : side === "right" ? r.left + r.width + 48 : r.left + r.width / 2;
    const cy = side === "top" ? r.top - 48 : side === "bottom" ? r.top + r.height + 48 : r.top + r.height / 2;
    const tx = side === "left" ? r.left - 6 : side === "right" ? r.left + r.width + 6 : r.left + r.width / 2;
    const ty = side === "top" ? r.top - 6 : side === "bottom" ? r.top + r.height + 6 : r.top + r.height / 2;

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", cx); line.setAttribute("y1", cy); line.setAttribute("x2", tx); line.setAttribute("y2", ty);
    line.setAttribute("stroke", "#e2ba6f"); line.setAttribute("stroke-width", "3"); line.setAttribute("marker-end", "url(#bnzah)");
    svg.appendChild(line);

    const chip = document.createElement("div");
    chip.textContent = s.n;
    Object.assign(chip.style, { position: "absolute", left: (cx - 16) + "px", top: (cy - 16) + "px", width: "32px", height: "32px", borderRadius: "50%", background: "linear-gradient(180deg,#cda45f,#9a753c)", color: "#1c1509", font: "700 17px Signika, Arial, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,.6)", border: "2px solid #f4d493" });
    layer.appendChild(chip);
    push(cx - 16, cy - 16, 32, 32);

    if (s.label) {
      const lab = document.createElement("div");
      lab.textContent = s.label;
      const w = s.label.length * 7.6 + 16;
      const left = side === "right" ? cx + 22 : side === "left" ? cx - 22 - w : cx - w / 2;
      const top = side === "bottom" ? cy + 22 : side === "top" ? cy - 22 - 24 : cy - 13;
      Object.assign(lab.style, { position: "absolute", top: top + "px", left: Math.max(4, left) + "px", background: "rgba(15,16,20,.93)", color: "#f3e9d3", font: "600 13px Signika, Arial, sans-serif", padding: "3px 8px", borderRadius: "5px", border: "1px solid rgba(198,154,92,.6)", whiteSpace: "nowrap" });
      layer.appendChild(lab);
      push(Math.max(4, left), top, w, 24);
    }
  });

  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  rects.forEach((r) => { minx = Math.min(minx, r.x); miny = Math.min(miny, r.y); maxx = Math.max(maxx, r.x + r.w); maxy = Math.max(maxy, r.y + r.h); });
  const pad = opts.pad != null ? opts.pad : 16;
  minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad);
  maxx = Math.min(window.innerWidth, maxx + pad); maxy = Math.min(window.innerHeight, maxy + pad);
  return { x: Math.round(minx), y: Math.round(miny), w: Math.round(maxx - minx), h: Math.round(maxy - miny) };
};
window.__bnzClear = function () { document.getElementById("bnz-annot")?.remove(); };
