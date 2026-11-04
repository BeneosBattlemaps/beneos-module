/* ============================================================
   Tooltip of the "!" badge on a release that changed after it was
   installed (user 2026-11-04: short, the date in brackets with the
   month abbreviated, "Sep" instead of "September"). Pure, no Foundry
   dependency: the caller passes the translate function and the locale,
   so the wording can be checked in Node.
   ============================================================ */

// format(key, data) is game.i18n.format in Foundry. lang is game.i18n.lang.
export function staleInstallTooltip(iso, format, lang = "en") {
  const d = iso ? new Date(iso) : null
  if (!d || isNaN(d.getTime())) return format("BENEOS.Cloud.Card.UpdatedSinceInstall", {})
  let date
  try {
    date = d.toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" })
  } catch (_) {
    date = d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  }
  return format("BENEOS.Cloud.Card.UpdatedSinceInstallOn", { date })
}
