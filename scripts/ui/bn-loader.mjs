/* ============================================================
   Beneos loader ring for module windows (design standard MUS-05).
   Logic follows the CI master component loader.js.
   That file watches one fixed root; Foundry opens and closes windows at any
   time, so this copy watches document.body and only acts on media inside the
   module roots listed in ROOTS. Core UI images are never touched.

   Every large image and every video that is meant to play shows a small ring
   at its bottom edge until it has loaded, so a slow line does not look broken.
   Images under 120px wide (icons, logos) get none. Styling: css/beneos-ui.css.
   ============================================================ */

const MIN_WIDTH = 120;
const ROOTS = ".beneos-cloud-app, .bci-root, .beneos-codex, .beneos-wiki";

function inRoot(el) {
  return !!(el.closest && el.closest(ROOTS));
}

function ring(host) {
  let b = host.querySelector(":scope > .bn-loader");
  if (b) return b;
  b = document.createElement("span");
  b.className = "bn-loader";
  b.setAttribute("aria-hidden", "true");
  if (getComputedStyle(host).position === "static") host.classList.add("bn-loadhost");
  host.appendChild(b);
  return b;
}

// Several images can share one parent. The ring stays until the last of
// them has loaded, so the count of pending media lives on the host.
function show(el) {
  const host = el.parentElement;
  if (!host || el.__bnRing) return;
  host.__bnPending = (host.__bnPending || 0) + 1;
  el.__bnRing = ring(host);
}

function hide(el) {
  const b = el.__bnRing;
  if (!b) return;
  el.__bnRing = null;
  const host = b.parentElement;
  if (!host) return;
  host.__bnPending = Math.max(0, (host.__bnPending || 1) - 1);
  if (host.__bnPending) return;
  b.remove();
  host.classList.remove("bn-loadhost");
}

// Decision kept pure so it can be checked without a DOM.
export function bigEnough(renderedWidth, attrWidth) {
  return (renderedWidth || attrWidth || 0) >= MIN_WIDTH;
}

// Reads (layout) and writes (ring) are split into one frame: a render with
// many cards would otherwise force one synchronous layout per image.
let queue = new Set();
let frame = 0;
function flush() {
  frame = 0;
  const items = [...queue];
  queue = new Set();
  const due = items.filter(img => !(img.complete && img.naturalWidth) &&
    bigEnough(img.getBoundingClientRect().width, parseInt(img.getAttribute("width"), 10)));
  for (const img of due) show(img);
}
function checkImg(img) {
  if (img.complete && img.naturalWidth) { hide(img); return; }
  queue.add(img);
  if (!frame) frame = requestAnimationFrame(flush);
}

function watchImg(img) {
  if (img.__bnWatched) return;
  img.__bnWatched = true;
  img.addEventListener("load", () => { queue.delete(img); hide(img); });
  img.addEventListener("error", () => { queue.delete(img); hide(img); });
  checkImg(img);
}

function watchVideo(v) {
  if (v.__bnWatched) return;
  v.__bnWatched = true;
  const ready = () => hide(v);
  // Only a video meant to play now shows the ring: one that only fetches
  // metadata never reaches canplay and would keep its ring for good.
  const wantsPlay = () => v.autoplay || !v.paused || v.getAttribute("preload") === "auto";
  v.addEventListener("loadstart", () => { if (v.readyState < 3 && wantsPlay()) show(v); });
  v.addEventListener("waiting", () => show(v));
  for (const e of ["canplay", "playing", "error", "emptied"]) v.addEventListener(e, ready);
  if (v.readyState < 3 && wantsPlay() && (v.currentSrc || v.getAttribute("src") || v.querySelector("source"))) show(v);
}

function watch(el) {
  if (!inRoot(el)) return;
  if (el.tagName === "VIDEO") watchVideo(el); else watchImg(el);
}

function scan(node) {
  if (node.matches?.("img, video")) { watch(node); return; }
  node.querySelectorAll?.("img, video").forEach(watch);
}

let observer = null;
export function startBeneosLoader() {
  if (observer || !("MutationObserver" in window)) return;
  document.querySelectorAll(ROOTS).forEach(scan);
  observer = new MutationObserver(list => {
    for (const r of list) {
      if (r.type === "attributes") {
        const t = r.target;
        if (t.tagName === "IMG" && t.__bnWatched) checkImg(t);
        continue;
      }
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        // Cheap filter first: most added nodes (chat, canvas UI) are not ours.
        if (!(n.matches?.(ROOTS) || inRoot(n) || n.querySelector?.(ROOTS))) continue;
        scan(n);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
}

export function stopBeneosLoader() {
  observer?.disconnect();
  observer = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  queue.clear();
}

Hooks.once("ready", startBeneosLoader);
