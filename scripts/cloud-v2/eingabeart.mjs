// Remembers the last input kind (keyboard or pointer) for the Cloud window.
//
// MO-042: the 25 filter selects show the accent focus ring only for keyboard
// focus. CSS alone cannot tell: Chromium matches :focus-visible on a select
// after a mouse click as well, and a pointer focus gets no ring in Beneos
// windows (beneos-ui.css, QLT-07). So the window carries
// data-bc-input="key|pointer" and the CSS rule asks for "key".
//
// The listeners sit on the global window in the capture phase, not on the
// Cloud window element: the Tab press that moves focus from the Foundry UI
// into the Cloud window happens outside that element and still has to count
// as keyboard. They are registered once per target, so re-renders and
// reopened windows do not pile up listeners. Pure on purpose, so a node test
// can drive it without Foundry (eingabeart.test.mjs).

const wired = new WeakMap()

/**
 * @param {{type: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} ev
 * @returns {"key"|"pointer"|null}
 */
export function inputKindOf(ev) {
  if (ev.type === "pointerdown") return "pointer"
  // Shortcuts (Ctrl+F, Alt+Tab to another program) do not move focus inside
  // the window and say nothing about how the next focus will arrive.
  if (ev.type === "keydown") return ev.ctrlKey || ev.metaKey || ev.altKey ? null : "key"
  return null
}

/**
 * Registers the capture listeners once per target. `apply` runs only when the
 * kind changes. Returns the shared state, whose `kind` is null until the
 * first input.
 * @param {EventTarget} target
 * @param {(kind: "key"|"pointer") => void} apply
 * @returns {{kind: "key"|"pointer"|null}}
 */
export function wireInputKind(target, apply) {
  const known = wired.get(target)
  if (known) return known
  const state = { kind: null }
  const on = (ev) => {
    const kind = inputKindOf(ev)
    if (!kind || kind === state.kind) return
    state.kind = kind
    apply(kind)
  }
  // INTENTIONAL: page-lifetime listeners, never removed. They exist once per
  // page (WeakMap above) and serve every later open of the Cloud window; on
  // close there is nothing to release, and removing them would lose the kind
  // a reopened window needs.
  target.addEventListener("keydown", on, true)
  target.addEventListener("pointerdown", on, true)
  wired.set(target, state)
  return state
}

/**
 * Puts the remembered kind onto a freshly rendered window element. A
 * reopened window is a new element, and the listeners only write on a
 * change of kind, so the render has to carry the current kind over.
 * @param {Element|null|undefined} el
 * @param {{kind: "key"|"pointer"|null}} state
 */
export function markInputKind(el, state) {
  if (el && state.kind) el.setAttribute("data-bc-input", state.kind)
}

/**
 * The Cloud window's use: the kind goes onto the element with id `id`,
 * looked up at each change, because the window can be closed and reopened.
 * @param {EventTarget} target  the global window
 * @param {Document} doc
 * @param {string} id
 */
export function wireWindowInputKind(target, doc, id) {
  return wireInputKind(target, (kind) => doc.getElementById(id)?.setAttribute("data-bc-input", kind))
}
