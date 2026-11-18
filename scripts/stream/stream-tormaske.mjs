/**
 * stream-tormaske.mjs
 *
 * Toradressen im freien Text finden und schluesselfrei machen. Gemeinsam fuer
 * den Export (`stream-export.mjs`) und das Textnetz (`stream-html.mjs`,
 * stre-T-142 B2); ein eigenes Modul, weil der Export das HTML-Netz importiert
 * und ein Import in die Gegenrichtung einen Zyklus baute.
 *
 * Rein bis auf das Lesen der Einstellungen. Ohne Schluessel laesst
 * `schluesselfreiAdresse` jede Adresse stehen; `maskiere` greift auch ohne
 * Schluessel, aber nur unter einem Host der Zone.
 */
import { schluesselfreiAdresse, erlaubteBasis, STREAM_RAUM_BUCHSTABE } from "./stream-settings.mjs"

const RAEUME = Object.values(STREAM_RAUM_BUCHSTABE).join("|")

/*
 * Eine Adresse mit Raumbuchstabe an erster Stelle, unter jedem Host. Ob sie
 * unsere ist, entscheiden danach `schluesselfreiAdresse` (heutiger Host) und
 * `erlaubteBasis` (Zone). Endet an Leerraum, Anfuehrungszeichen und spitzer
 * Klammer, wie die Textmaske in `stream-report.mjs`.
 */
export const TOR_IM_TEXT = new RegExp(`https?://[^/\\s"'<>]+/(?:${RAEUME})/[^\\s"'<>]+`, "gi")
export const SCHLUESSELSTUECK = new RegExp(`^(https?://([^/\\s"'<>]+))/(${RAEUME})/([^/\\s"'<>?#]+)`, "i")

/** Steht die Toradresse unter einem Host der Zone? */
export function unterZone(adresse) {
  const t = SCHLUESSELSTUECK.exec(adresse)
  return !!t && !!erlaubteBasis(`https://${t[2]}`)
}

/** Das Schluesselstueck einer Toradresse unter einem Host der Zone wird `-`. */
export function maskiere(adresse) {
  const t = SCHLUESSELSTUECK.exec(adresse)
  if (!t || t[4] === "-") return adresse
  if (!erlaubteBasis(`https://${t[2]}`)) return adresse
  return `${t[1]}/${t[3]}/-${adresse.slice(t[0].length)}`
}

export function wandle(adresse) {
  const frei = schluesselfreiAdresse(adresse)
  return frei !== adresse ? frei : maskiere(adresse)
}

/** Ist das Schluesselstueck einer Toradresse schon `-`? */
export function istMaskiert(adresse) {
  const t = SCHLUESSELSTUECK.exec(adresse)
  return !!t && t[4] === "-"
}
