// Counts the active filters of one Cloud tab.
//
// MO-040: in a narrow Cloud window the filters sit behind a "Filters (n)"
// button. Two counts live here:
//
// - countActiveFilters decides whether any filter is active
//   (BeneosCloudWindowV2#hasActiveFilter, which steers the "Update" group of
//   the result list and the switch from Releases to Individual Maps). Its
//   rules are the ones that method used before MO-040 and must not change.
// - countShownFilters is the n on the button. It adds the filters the first
//   count leaves out on purpose: hidden sources on the Loot and Spells tabs,
//   and the Show filter on the Maps tab.
//
// filterStateOf maps the window onto the input of both, so a node test can
// drive the same mapping the window uses (filter-zaehler.test.mjs). Pure on
// purpose: the window module pulls in Foundry globals and cannot be loaded
// under node, this one can.
//
// Counting rules: the text search counts 1, a range (CR, gold) counts 1 no
// matter whether one or both ends moved, hidden sources count 1, every biome
// chip counts on its own, every dropdown with a value other than "any"
// counts 1. A dropdown whose element is missing (value undefined) is skipped.

/**
 * @param {object} win   the Cloud window (or any object with its fields)
 * @param {object} o
 * @param {number}   o.crNoLimit          the "no upper CR limit" value
 * @param {() => number}  o.maxItemPrice  scans all items, called only when needed
 * @param {() => boolean} o.hiddenSourceInTab  whether a hidden source has
 *   entries in the current tab, called only when needed
 * @param {?{querySelector: Function}} o.root  the window element
 * @param {Array<{types?: string[], selector: string}>} o.defs  dropdown definitions
 */
export function filterStateOf(win, { crNoLimit, maxItemPrice, hiddenSourceInTab, root, defs }) {
  return {
    textFilter: win._textFilter,
    crMin: win.crMin,
    crMax: win.crMax,
    crNoLimit,
    sourceHiddenSize: win.sourceHidden.size,
    biomeCount: win.biomeFilters.size,
    goldMin: win.goldMin,
    goldMax: win.goldMax,
    maxItemPrice,
    hiddenSourceInTab,
    bmapBiomeCount: win.bmapBiomeFilters.size,
    showFilter: win.showFilter,
    dropdowns: root
      ? defs.map(def => ({ types: def.types, value: root.querySelector("#" + def.selector)?.value }))
      : [],
  }
}

/**
 * @param {string} type  "token" | "item" | "spell" | "bmap"
 * @param {ReturnType<typeof filterStateOf>} s
 * @returns {number}
 */
export function countActiveFilters(type, s) {
  let n = 0
  if (s.textFilter) n++
  if (type === "token") {
    if (s.crMin > 0 || s.crMax < s.crNoLimit) n++
    if (s.sourceHiddenSize > 0) n++
    n += s.biomeCount
  }
  if (type === "item") {
    if (s.goldMin > 0 || (s.goldMax != null && s.goldMax < s.maxItemPrice())) n++
  }
  if (type === "bmap") n += s.bmapBiomeCount
  for (const d of s.dropdowns) {
    if (d.types && !d.types.includes(type)) continue
    const v = d.value
    if (v && v.toLowerCase() !== "any") n++
  }
  return n
}

/**
 * The n on the "Filters (n)" button.
 * @param {string} type
 * @param {ReturnType<typeof filterStateOf>} s
 * @returns {number}
 */
export function countShownFilters(type, s) {
  let n = countActiveFilters(type, s)
  // Loot and Spells apply the source checkboxes too (cloud-window-v2.mjs,
  // #applySourceFilter), but a source hidden on another tab may have no
  // entry here, so it only counts when it narrows this tab.
  if ((type === "item" || type === "spell") && s.sourceHiddenSize > 0 && s.hiddenSourceInTab()) n++
  // Maps apply the Show filter from the instance; its select is typed for
  // the other tabs only and is therefore not among the dropdowns here.
  if (type === "bmap" && s.showFilter && s.showFilter.toLowerCase() !== "any") n++
  return n
}
