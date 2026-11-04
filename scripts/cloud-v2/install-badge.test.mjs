/**
 * install-badge.test.mjs
 *
 * Gegenprobe zu `install-badge.mjs`, ohne Foundry:
 *
 *   node scripts/cloud-v2/install-badge.test.mjs
 *
 * Die Uebersetzung kommt aus lang/en.json, damit Schluessel und Platzhalter
 * mitgeprueft werden. Rueckgabewert 0 heisst alle Faelle gruen.
 */
import { readFileSync } from "node:fs"
import { staleInstallTooltip } from "./install-badge.mjs"

const en = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"))
const format = (key, data) => {
  const raw = en[key]
  if (raw === undefined) return key
  return raw.replace(/\{(\w+)\}/g, (m, k) => (k in data ? data[k] : m))
}

const cases = [
  ["2026-09-15T10:00:00Z", "en", "Updated since installation (Sep 15, 2026)"],
  [null, "en", "Updated since installation"],
  ["kein Datum", "en", "Updated since installation"],
  ["2026-09-15T10:00:00Z", "xx-invalid-locale-!!", "Updated since installation (Sep 15, 2026)"],
]

let red = 0
for (const [iso, lang, want] of cases) {
  const got = staleInstallTooltip(iso, format, lang)
  const ok = got === want
  if (!ok) red++
  console.log(`${ok ? "gruen" : "ROT  "} | soll ${JSON.stringify(want)} | ist ${JSON.stringify(got)}`)
}
console.log(`${cases.length - red} von ${cases.length} gruen`)
process.exit(red ? 1 : 0)
