/**
 * Prueft tools/pruefe-beta-zip.mjs ohne Netz (stre-T-028).
 *
 * Das ZIP baut dieser Satz selbst, gepackt (Verfahren 8) und ungepackt
 * (Verfahren 0), mit einem Ordner wie GitHub ihn packt. `holen` ist eine
 * Attrappe fuer fetch, die je Adresse Status und Rumpf liefert.
 *
 * Lauf:  node tools/pruefe-beta-zip.test.mjs
 */

import { deflateRawSync } from "node:zlib"
import { messe } from "./pruefe-beta-zip.mjs"
import { pruefstand } from "./lib/foundry-attrappe.mjs"

const BASIS = "https://github.com/BeneosBattlemaps/beneos-module"
const MANIFEST = "https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json"
const tagZip = (v) => `${BASIS}/archive/refs/tags/${v}.zip`

function zip(dateien, packen = true) {
  const teile = [], zentral = []
  let pos = 0
  for (const [name, inhalt] of Object.entries(dateien)) {
    const roh = Buffer.from(inhalt)
    const daten = packen ? deflateRawSync(roh) : roh
    const n = Buffer.from(name)
    const kopf = Buffer.alloc(30)
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(packen ? 8 : 0, 8)
    kopf.writeUInt32LE(daten.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(n.length, 26)
    const z = Buffer.alloc(46)
    z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(packen ? 8 : 0, 10)
    z.writeUInt32LE(daten.length, 20); z.writeUInt32LE(roh.length, 24); z.writeUInt16LE(n.length, 28); z.writeUInt32LE(pos, 42)
    teile.push(kopf, n, daten)
    zentral.push(z, n)
    pos += 30 + n.length + daten.length
  }
  const zb = Buffer.concat(zentral)
  const ende = Buffer.alloc(22)
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(Object.keys(dateien).length, 8); ende.writeUInt16LE(Object.keys(dateien).length, 10)
  ende.writeUInt32LE(zb.length, 12); ende.writeUInt32LE(pos, 16)
  return Buffer.concat([...teile, zb, ende])
}

const modul = (v, extra = {}) => JSON.stringify({ id: "beneos-module", version: v, manifest: MANIFEST, download: tagZip(v), esmodules: ["scripts/a.mjs"], styles: ["css/a.css"], languages: [{ lang: "en", path: "lang/en.json" }], ...extra })
function paket(v, { ohne = [], packen = true, inZip = modul(v), ordner = `beneos-module-${v}/` } = {}) {
  const d = { [`${ordner}module.json`]: inZip, [`${ordner}scripts/a.mjs`]: "x", [`${ordner}css/a.css`]: "x", [`${ordner}lang/en.json`]: "{}" }
  for (const o of ohne) delete d[`${ordner}${o}`]
  return zip(d, packen)
}
function attrappe(antworten) {
  return async (url) => {
    const a = antworten[url]
    if (!a) return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) }
    if (a.wirf) throw new Error(a.wirf)
    const rumpf = typeof a.rumpf === "string" ? Buffer.from(a.rumpf) : a.rumpf
    return { ok: a.status < 400, status: a.status, text: async () => rumpf.toString("utf8"), arrayBuffer: async () => rumpf.buffer.slice(rumpf.byteOffset, rumpf.byteOffset + rumpf.length) }
  }
}
const lauf = (antworten, opt = {}) => messe({ manifest: MANIFEST, holen: attrappe(antworten), ...opt })

const p = pruefstand("pruefe-beta-zip: Tag-ZIP der Beta erreichbar und ladbar (stre-T-028)")
const V = "14.5.0-beta.12"

{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V) } })
  p.gleich("Tag-ZIP erreichbar, gleiche Version, alle Dateien: Austritt 0", r.rc, 0)
  p.gleich("die Ausgabe nennt den HTTP-Status des ZIP", r.zeilen.some((z) => z.startsWith("info  ZIP ") && z.includes("-> HTTP 200")), true)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V, { packen: false }) } })
  p.gleich("ungepacktes ZIP wird gelesen", r.rc, 0)
}
{
  // Der Rumpf ist ein gueltiges ZIP: allein der Status muss den Befund tragen.
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 404, rumpf: paket(V) } })
  p.gleich("Tag-ZIP fehlt (404): Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V, { download: `${BASIS}/archive/refs/heads/stream-beta.zip` }) }, [`${BASIS}/archive/refs/heads/stream-beta.zip`]: { status: 200, rumpf: paket(V) } })
  p.gleich("download auf dem Zweig-ZIP: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V, { inZip: modul("14.5.0-beta.11") }) } })
  p.gleich("andere Version im ZIP: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V, { inZip: modul(V, { id: "fremd" }) }) } })
  p.gleich("andere id im ZIP: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V, { ohne: ["css/a.css"] }) } })
  p.gleich("fehlende Ladedatei im ZIP: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V, { ohne: ["module.json"] }) } })
  p.gleich("ZIP ohne module.json: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: Buffer.from("kein zip") } })
  p.gleich("kein ZIP: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V) } }, { erwarte: "14.5.0-beta.13" })
  p.gleich("Manifest noch auf alter Version (--erwarte): Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 500, rumpf: modul(V) }, [tagZip(V)]: { status: 200, rumpf: paket(V) } })
  p.gleich("Manifest nicht erreichbar: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { wirf: "getaddrinfo ENOTFOUND" } })
  p.gleich("kein Netz: nicht messbar", r.rc, 2)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: "{ kaputt" } })
  p.gleich("Manifest erreichbar, aber kein JSON: Befund", r.rc, 1)
}
{
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V) }, [tagZip(V)]: { wirf: "ECONNRESET" } })
  p.gleich("ZIP-Abruf scheitert ohne Befund davor: nicht messbar", r.rc, 2)
}
{
  const zweig = `${BASIS}/archive/refs/heads/stream-beta.zip`
  const r = await lauf({ [MANIFEST]: { status: 200, rumpf: modul(V, { download: zweig }) }, [zweig]: { wirf: "ECONNRESET" } })
  p.gleich("ZIP-Abruf scheitert nach einem Befund: der Befund bleibt", r.rc, 1)
}

p.ende()
