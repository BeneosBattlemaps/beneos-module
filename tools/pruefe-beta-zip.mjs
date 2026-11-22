/**
 * Misst nach einer Auslieferung auf stream-beta, ob Betatester das Modul
 * wirklich bekommen (stre-T-028).
 *
 * Seit stre-T-028 zeigt `download` der Beta auf das ZIP des Tags der Version.
 * Fehlt der Tag auf GitHub, bekommt jede Neuinstallation ein 404. Liegt er auf
 * einem falschen Commit, bekommt sie einen anderen Stand als den, den das
 * Manifest ansagt. Der Push-Riegel (tools/haken/pre-push.mjs) prueft das vor
 * dem Push am Repositorium; dieses Werkzeug misst danach, was ausgeliefert ist.
 *
 * Schritte, jeder mit Ergebnis:
 *   1. Manifest abrufen (Vorgabe: raw.githubusercontent .../stream-beta/module.json),
 *      HTTP-Status, Version und download lesen.
 *   2. download muss das Tag-ZIP dieser Version sein.
 *   3. Das ZIP abrufen, HTTP-Status und Groesse.
 *   4. Im ZIP die module.json finden (ein Ordner tief, wie GitHub packt),
 *      entpacken, lesen: id beneos-module, dieselbe Version, und jede Datei
 *      aus esmodules, scripts, styles und languages liegt im ZIP.
 *
 * raw.githubusercontent haelt Antworten bis zu fuenf Minuten im Zwischenspeicher.
 * Ein frischer Push kann daher kurz die alte Version zeigen; dann mit
 * --erwarte <version> erneut messen.
 *
 * Aufruf:  node tools/pruefe-beta-zip.mjs [--manifest <url>] [--erwarte <version>]
 * Austritt 0 alles erreichbar, 1 Befund, 2 nicht messbar (kein Netz).
 */

import { inflateRawSync } from "node:zlib"

const VORGABE = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json"
const BASIS = "https://github.com/BeneosBattlemaps/beneos-module"

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }

/** Die Eintraege eines ZIP aus dem Zentralverzeichnis, ohne Abhaengigkeiten. */
export function zipEintraege(puffer) {
  const b = Buffer.from(puffer)
  let ende = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { ende = i; break }
  }
  if (ende < 0) throw new Error("kein ZIP: Endsatz fehlt")
  const anzahl = b.readUInt16LE(ende + 10)
  let pos = b.readUInt32LE(ende + 16)
  const eintraege = new Map()
  for (let n = 0; n < anzahl; n++) {
    if (b.readUInt32LE(pos) !== 0x02014b50) throw new Error("kein ZIP: Zentralverzeichnis kaputt")
    const methode = b.readUInt16LE(pos + 10)
    const gepackt = b.readUInt32LE(pos + 20)
    const lName = b.readUInt16LE(pos + 28), lExtra = b.readUInt16LE(pos + 30), lKomm = b.readUInt16LE(pos + 32)
    const kopf = b.readUInt32LE(pos + 42)
    const name = b.toString("utf8", pos + 46, pos + 46 + lName)
    eintraege.set(name, () => {
      const start = kopf + 30 + b.readUInt16LE(kopf + 26) + b.readUInt16LE(kopf + 28)
      const roh = b.subarray(start, start + gepackt)
      if (methode === 0) return roh
      if (methode === 8) return inflateRawSync(roh)
      throw new Error(`Packverfahren ${methode} unbekannt`)
    })
    pos += 46 + lName + lExtra + lKomm
  }
  return eintraege
}

export async function messe({ manifest = VORGABE, erwarte, holen = fetch } = {}) {
  const zeilen = []
  let befund = 0
  const ok = (t) => zeilen.push(`ok    ${t}`)
  const rot = (t) => { befund++; zeilen.push(`ROT   ${t}`) }

  let roh
  try {
    const r = await holen(manifest, { cache: "no-store" })
    zeilen.push(`info  Manifest ${manifest} -> HTTP ${r.status}`)
    if (!r.ok) { rot(`Manifest nicht erreichbar (HTTP ${r.status})`); return { rc: 1, zeilen } }
    roh = await r.text()
  } catch (e) {
    zeilen.push(`NICHT MESSBAR  Manifest: ${e.message}`)
    return { rc: 2, zeilen }
  }
  // Erreichbar, aber kaputt ist ein Befund, kein Netzproblem.
  let m
  try { m = JSON.parse(roh) } catch (e) { rot(`Manifest ist kein JSON: ${e.message}`); return { rc: 1, zeilen } }
  zeilen.push(`info  version ${m.version}, download ${m.download}`)
  if (erwarte && m.version !== erwarte) rot(`Manifest traegt ${m.version}, erwartet ${erwarte}`)
  const soll = `${BASIS}/archive/refs/tags/${m.version}.zip`
  if (m.download === soll) ok("download ist das Tag-ZIP der Version")
  else rot(`download ist ${m.download}, erwartet ${soll}`)

  let zip
  try {
    const r = await holen(m.download, { redirect: "follow" })
    zip = Buffer.from(await r.arrayBuffer())
    zeilen.push(`info  ZIP ${m.download} -> HTTP ${r.status}, ${zip.length} Bytes`)
    if (!r.ok) { rot(`ZIP nicht erreichbar (HTTP ${r.status})`); return { rc: 1, zeilen } }
    ok(`ZIP erreichbar (HTTP ${r.status})`)
  } catch (e) {
    zeilen.push(`NICHT MESSBAR  ZIP: ${e.message}`)
    // Ein schon gefundener Befund bleibt ein Befund.
    return { rc: befund ? 1 : 2, zeilen }
  }

  let eintraege
  try { eintraege = zipEintraege(zip) } catch (e) { rot(e.message); return { rc: 1, zeilen } }
  const pfadM = [...eintraege.keys()].find((n) => /^[^/]+\/module\.json$/.test(n) || n === "module.json")
  if (!pfadM) { rot("keine module.json im ZIP"); return { rc: 1, zeilen } }
  const ordner = pfadM.slice(0, -"module.json".length)
  let z
  try { z = JSON.parse(eintraege.get(pfadM)().toString("utf8")) } catch (e) {
    rot(`module.json im ZIP nicht lesbar: ${e.message}`)
    return { rc: 1, zeilen }
  }
  ok(`module.json im ZIP gelesen (${pfadM})`)
  if (z.id === "beneos-module") ok("id beneos-module")
  else rot(`id im ZIP ist ${z.id}`)
  if (z.version === m.version) ok(`Version im ZIP ${z.version} gleich Manifest`)
  else rot(`Version im ZIP ${z.version}, Manifest ${m.version}`)
  const dateien = [...(z.esmodules || []), ...(z.scripts || []), ...(z.styles || []), ...(z.languages || []).map((l) => l.path)]
  const fehlt = dateien.filter((d) => !eintraege.has(ordner + d))
  if (fehlt.length === 0) ok(`alle ${dateien.length} Ladedateien liegen im ZIP`)
  else rot(`${fehlt.length} Ladedateien fehlen im ZIP: ${fehlt.slice(0, 5).join(", ")}`)
  return { rc: befund ? 1 : 0, zeilen }
}

const direkt = process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("tools/pruefe-beta-zip.mjs")
if (direkt) {
  const { rc, zeilen } = await messe({ manifest: arg("--manifest") || VORGABE, erwarte: arg("--erwarte") })
  for (const z of zeilen) console.log(z)
  console.log(rc === 0 ? "ERGEBNIS erreichbar und ladbar" : rc === 1 ? "ERGEBNIS Befund" : "ERGEBNIS nicht messbar")
  process.exit(rc)
}
