/**
 * Pruefsatz fuer stream-umstellung.mjs, stre-T-064: der Kern der Umstellung
 * einer Bestandswelt von lokalen Dateien auf das Tor (nur umschreiben, E1).
 *
 * Gegen eine Attrappe fuer Dokumente, Kompendium, Einstellungen und Abruf.
 * Ohne Netz, ohne Foundry. Die Planung aus der echten Welt (Register,
 * Posenliste, Kartenvermerk) prueft stream-umstellung-plan.test.mjs.
 *
 *   node scripts/stream/stream-umstellung.test.mjs
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const hier = dirname(fileURLToPath(import.meta.url))
const U = await import("./stream-umstellung.mjs")
const { umstellen, zurueckstellen, leseprobe, dokumentPlan, FLAGGE_PFAD } = U

let gruen = 0
let rot = 0
function gleich(name, ist, soll) {
  if (JSON.stringify(ist) === JSON.stringify(soll)) { gruen++; console.log("  ok   " + name) }
  else { rot++; console.log("  ROT  " + name + "\n       soll " + JSON.stringify(soll) + "\n       ist  " + JSON.stringify(ist)) }
}
const wahr = (name, w) => gleich(name, Boolean(w), true)

// ---------------------------------------------------------------- Attrappe

const KEY = "TestSchluesselNurHier0123456789ab"
const TOR = "https://gate.beneos.stream"
const tor = (k, f) => `${TOR}/c/${KEY}/beneos_ct_${k}/${f}`
const lokal = (k, f) => `beneos_assets/cloud/tokens/${k}/${f}`

function holen(obj, pfad) {
  return pfad.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
function setzen(obj, pfad, wert) {
  const teile = pfad.split(".")
  const letzt = teile.pop()
  let o = obj
  for (const t of teile) { if (o[t] == null || typeof o[t] !== "object") o[t] = {}; o = o[t] }
  if (letzt.startsWith("-=")) delete o[letzt.slice(2)]
  else o[letzt] = wert
}

let updates = 0
let wirfBei = 0 // wirft beim n-ten update, 0 = nie
function zaehleUpdate() {
  updates++
  if (wirfBei && updates === wirfBei) throw new Error("Attrappe: update scheitert")
}

class Dok {
  constructor(data, { pack = null, embedded = {} } = {}) {
    this.data = structuredClone(data)
    this.pack = pack
    this.constructor_ = { metadata: { embedded } }
  }
  get id() { return this.data._id }
  toObject() { return structuredClone(this.data) }
  async update(aenderung) {
    zaehleUpdate()
    for (const [p, w] of Object.entries(aenderung)) setzen(this.data, p, w)
    return this
  }
  async updateEmbeddedDocuments(typ, liste) {
    zaehleUpdate()
    const feld = this.constructor_.metadata.embedded[typ]
    for (const a of liste) {
      const ziel = this.data[feld].find((e) => e._id === a._id)
      for (const [p, w] of Object.entries(a)) if (p !== "_id") setzen(ziel, p, w)
    }
    return []
  }
}
// Foundry liest das Metadatum vom Konstruktor; die Attrappe reicht es durch.
Object.defineProperty(Dok.prototype, "constructor", { get() { return this.constructor_ } })

function abrufAttrappe(sonder = {}) {
  const aufrufe = []
  const fn = async (url) => {
    aufrufe.push(url)
    const s = sonder[url]
    if (s === "wirft") throw new TypeError("Failed to fetch")
    const kopf = new Map(Object.entries(s?.kopf || {}))
    const bytes = s?.bytes ?? new Uint8Array(100).fill(7)
    return {
      ok: (s?.status ?? 200) < 400, status: s?.status ?? 200,
      headers: { get: (n) => kopf.get(n.toLowerCase()) ?? null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  fn.aufrufe = aufrufe
  return fn
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex")

function umgebung({ abruf = abrufAttrappe(), signal = null, trocken = false, register = {} } = {}) {
  const u = {
    stand: null, riegelGesetzt: false, paketOffen: false, paketAufrufe: 0,
    reg: structuredClone(register), regSchreiben: 0,
    fortschritt: { lesen: async () => structuredClone(u.stand), schreiben: async (s) => { u.stand = structuredClone(s) } },
    riegel: { nehmen: async () => (u.riegelGesetzt ? false : (u.riegelGesetzt = true)), geben: async () => { u.riegelGesetzt = false } },
    paket: { oeffnen: async () => { u.paketOffen = true; u.paketAufrufe++ }, schliessen: async () => { u.paketOffen = false } },
    register: { lesen: async () => structuredClone(u.reg), schreiben: async (r) => { u.reg = structuredClone(r); u.regSchreiben++ } },
    abruf, signal, trocken,
  }
  return u
}

// Eine Kreatur als Einheit: Kompendiumsactor, Weltactor, Szene mit Tokens.
function kreatur(k, { mitSzene = true } = {}) {
  const tok = `${k}-1-token.webp`, top = `${k}-1-top.webp`
  const map = new Map([
    [lokal(k, tok), tor(k, tok)],
    [lokal(k, top), tor(k, top)],
  ])
  const pack = new Dok({ _id: `p${k}`, img: lokal(k, `${k}-1-avatar.webp`), prototypeToken: { texture: { src: lokal(k, tok) } } }, { pack: "world.beneos_module_actors" })
  const welt = new Dok({ _id: `w${k}`, img: lokal(k, tok), prototypeToken: { texture: { src: lokal(k, top) } } })
  const dokumente = [pack, welt]
  let szene = null
  if (mitSzene) {
    szene = new Dok({
      _id: `s${k}`, background: { src: "beneos_assets/x/map.webp" },
      tokens: [
        { _id: "t1", texture: { src: lokal(k, tok) }, delta: { img: lokal(k, tok) }, flags: { x: lokal(k, tok) } },
        { _id: "t2", texture: { src: lokal(k, top) } },
      ],
    }, { embedded: { Token: "tokens" } })
    dokumente.push(szene)
  }
  return {
    einheit: { id: `kreatur:${k}`, art: "kreatur", map, proben: [{ url: tor(k, tok) }, { url: tor(k, top) }], dokumente, fullIds: [`full-${k}`] },
    pack, welt, szene,
  }
}

const allesStrings = (x) => JSON.stringify(x)
function keinSchluessel(name, wert) {
  const s = allesStrings(wert)
  let teil = 0
  for (let i = 0; i + 8 <= KEY.length; i++) if (s.includes(KEY.slice(i, i + 8))) teil++
  gleich(name, teil, 0)
}

// ======================================================= 1 Leseprobe
console.log("Leseprobe")
{
  const gif = new Uint8Array(42); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  const gut = new Uint8Array(100).fill(1)
  const a = abrufAttrappe({
    "u:abgewiesen": { kopf: { "x-beneos-denied": "1" } },
    "u:status": { status: 403 },
    "u:offline": { kopf: { "x-beneos-offline": "1" } },
    "u:stummel": { bytes: new Uint8Array(8) },
    "u:gif": { bytes: gif },
    "u:wirft": "wirft",
    "u:gut": { bytes: gut },
  })
  gleich("abgewiesen am Kopf", await leseprobe({ url: "u:abgewiesen" }, a), "abgewiesen")
  gleich("abgewiesen am Status", await leseprobe({ url: "u:status" }, a), "abgewiesen")
  gleich("offline am Kopf", await leseprobe({ url: "u:offline" }, a), "offline")
  gleich("Stummel bis 8 Byte", await leseprobe({ url: "u:stummel" }, a), "stummel")
  gleich("42-Byte-GIF ist ein Stummel", await leseprobe({ url: "u:gif" }, a), "stummel")
  gleich("Netzfehler gilt als offline", await leseprobe({ url: "u:wirft" }, a), "offline")
  gleich("gute Datei ohne Pruefsumme", await leseprobe({ url: "u:gut" }, a), "ok")
  gleich("gute Datei mit passender Pruefsumme", await leseprobe({ url: "u:gut", sha256: sha(gut) }, a), "ok")
  gleich("falsche Pruefsumme", await leseprobe({ url: "u:gut", sha256: "0".repeat(64) }, a), "falsch")
}

// ======================================================= 2 Nur benannte Felder
console.log("Nur benannte Felder")
{
  const k = "wolf", tok = `${k}-1-token.webp`
  const map = new Map([[lokal(k, tok), tor(k, tok)]])
  const actor = new Dok({
    _id: "a", img: lokal(k, tok), name: lokal(k, tok),
    prototypeToken: { texture: { src: lokal(k, tok) } },
    // Ein Feld mit erlaubtem Namen in Item und Effekt: nur NIE haelt es auf.
    items: [{ _id: "i", img: lokal(k, tok), texture: { src: lokal(k, tok) } }],
    effects: [{ _id: "e", img: lokal(k, tok), texture: { src: lokal(k, tok) } }],
    system: { details: { bild: lokal(k, tok) } },
    flags: { welt: { bild: lokal(k, tok) } },
    beschreibung: `<img src="${lokal(k, tok)}">`,
    liste: [lokal(k, tok)],
  }, { embedded: { Item: "items", ActiveEffect: "effects" } })
  const p = dokumentPlan(actor, map)
  gleich("genau ein Feld: die Prototyp-Textur", p.felder.map((f) => f.pfad), ["prototypeToken.texture.src"])
  gleich("Treffer in name und in einer losen Liste gezaehlt, nicht geschrieben", p.uebersprungen, 2)
  await umstellen([{ id: "x", map, proben: [{ url: tor(k, tok) }], dokumente: [actor], fullIds: [] }], umgebung())
  const d = actor.data
  gleich("img bleibt", d.img, lokal(k, tok))
  gleich("items[].img bleibt", d.items[0].img, lokal(k, tok))
  gleich("eingebettetes Item wird nicht betreten", d.items[0].texture.src, lokal(k, tok))
  gleich("eingebetteter Effekt wird nicht betreten", d.effects[0].texture.src, lokal(k, tok))
  gleich("system bleibt", d.system.details.bild, lokal(k, tok))
  gleich("flags bleibt", d.flags.welt.bild, lokal(k, tok))
  gleich("HTML bleibt", d.beschreibung, `<img src="${lokal(k, tok)}">`)
  gleich("lose Liste bleibt", d.liste, [lokal(k, tok)])
  gleich("Prototyp-Textur aufs Tor", d.prototypeToken.texture.src, tor(k, tok))
}

// ======================================================= 3 Normalisierung
console.log("Normalisierung wie gateAdresseFuer")
{
  const k = "wolf", tok = `${k}-1-token.webp`, pfad = lokal(k, tok)
  const map = new Map([[pfad, tor(k, tok)]])
  const formen = {
    gleich: pfad,
    schraeg: "/" + pfad,
    kodiert: pfad.replace("cloud", "cl%6Fud"),
    abfrage: pfad + "?v=2",
    voll: "https://welt.example/" + pfad,
  }
  const szene = new Dok({ _id: "s", tokens: Object.entries(formen).map(([id, src]) => ({ _id: id, texture: { src } })) }, { embedded: { Token: "tokens" } })
  await umstellen([{ id: "n", map, proben: [{ url: tor(k, tok) }], dokumente: [szene], fullIds: [] }], umgebung())
  const src = (id) => szene.data.tokens.find((t) => t._id === id).texture.src
  gleich("gleicher Pfad ersetzt", src("gleich"), tor(k, tok))
  gleich("fuehrender Schraegstrich ersetzt", src("schraeg"), tor(k, tok))
  gleich("kodiert ersetzt", src("kodiert"), tor(k, tok))
  gleich("mit Abfrage bleibt", src("abfrage"), formen.abfrage)
  gleich("volle Adresse bleibt", src("voll"), formen.voll)
  gleich("Rueckweg-Flagge haelt den Wert wie er stand", holen(szene.data.tokens.find((t) => t._id === "schraeg"), FLAGGE_PFAD)[0].lokal, "/" + pfad)
}

// ======================================================= 4 Trockenlauf
console.log("Trockenlauf")
{
  updates = 0
  const ks = ["a", "b", "c"].map((k) => kreatur(k))
  const u = umgebung({ trocken: true })
  const erg = await umstellen(ks.map((x) => x.einheit), u)
  gleich("Trockenlauf: kein update", updates, 0)
  gleich("Trockenlauf: kein Abruf", u.abruf.aufrufe.length, 0)
  gleich("Trockenlauf: Stellen gezaehlt (je Kreatur 2 Actors + 2 Tokens)", erg.stellen, 12)
  gleich("Trockenlauf: kein Fortschritt geschrieben", u.stand, null)
  gleich("Trockenlauf: Paket nicht geoeffnet", u.paketAufrufe, 0)
}

// ======================================================= 5 Abbruch und Fortsetzen
console.log("Abbruch nach 10 von 50, Fortsetzen bei 11")
{
  updates = 0
  const ks = Array.from({ length: 50 }, (_, i) => kreatur(`k${i}`))
  const ctl = new AbortController()
  const u = umgebung({ signal: ctl.signal })
  let fertig = 0
  u.nachEinheit = () => { if (++fertig === 10) ctl.abort() }
  const erg = await umstellen(ks.map((x) => x.einheit), u)
  gleich("Lauf meldet Abbruch", erg.abgebrochen, true)
  gleich("10 umgestellt", ks.filter((x) => x.welt.data.prototypeToken.texture.src.startsWith(TOR)).length, 10)
  gleich("40 lokal", ks.filter((x) => !x.welt.data.prototypeToken.texture.src.startsWith(TOR)).length, 40)
  gleich("Fortschritt haelt 10", u.stand.erledigt.length, 10)
  gleich("Paket nach Abbruch zu", u.paketOffen, false)
  gleich("Riegel nach Abbruch frei", u.riegelGesetzt, false)

  const u2 = umgebung({ abruf: abrufAttrappe() })
  u2.stand = u.stand
  const erg2 = await umstellen(ks.map((x) => x.einheit), u2)
  gleich("zweiter Lauf: Leseproben nur fuer 40 Kreaturen", u2.abruf.aufrufe.length, 80)
  gleich("zweiter Lauf: 40 umgestellt", erg2.umgestellt, 40)
  gleich("alle 50 aufs Tor", ks.filter((x) => x.szene.data.tokens.every((t) => t.texture.src.startsWith(TOR))).length, 50)
  keinSchluessel("kein Schluesselstueck im Fortschritt", u2.stand)
}

// ======================================================= 6 Abbruch mitten in einer Einheit
console.log("Halb geschriebene Einheit")
{
  updates = 0
  const x = kreatur("halb")
  wirfBei = 2 // der Weltactor scheitert, der Kompendiumsactor ist schon geschrieben
  const u = umgebung()
  let fehler = null
  try { await umstellen([x.einheit], u) } catch (e) { fehler = e }
  wirfBei = 0
  wahr("Fehler wird durchgereicht", fehler)
  gleich("Paket nach Fehler wieder zu", u.paketOffen, false)
  gleich("Riegel nach Fehler frei", u.riegelGesetzt, false)
  gleich("Einheit nicht als erledigt vermerkt", (u.stand?.erledigt || []).length, 0)
  const erg = await umstellen([x.einheit], u)
  gleich("Wiederaufnahme stellt die Einheit fertig", erg.umgestellt, 1)
  gleich("Kompendiumsactor aufs Tor", x.pack.data.prototypeToken.texture.src, tor("halb", "halb-1-token.webp"))
  gleich("Weltactor aufs Tor", x.welt.data.prototypeToken.texture.src, tor("halb", "halb-1-top.webp"))
  gleich("Flagge des Kompendiumsactors ohne Doppel", holen(x.pack.data, FLAGGE_PFAD).length, 1)
  keinSchluessel("kein Schluesselstueck in den Flaggen", [x.pack.data.flags, x.welt.data.flags, x.szene.data.tokens.map((t) => t.flags)])
}

// ======================================================= 7 Leseprobe sperrt die Einheit
console.log("Leseprobe faellt durch: nichts geschrieben")
for (const [fall, sonder] of [
  ["abgewiesen", { kopf: { "x-beneos-denied": "1" } }],
  ["stummel", { bytes: new Uint8Array(3) }],
  ["falsch", { bytes: new Uint8Array(100) }],
]) {
  updates = 0
  const x = kreatur("p")
  if (fall === "falsch") x.einheit.proben[1].sha256 = "f".repeat(64)
  const u = umgebung({ abruf: abrufAttrappe({ [tor("p", "p-1-top.webp")]: sonder }) })
  const erg = await umstellen([x.einheit], u)
  gleich(`${fall}: kein update`, updates, 0)
  gleich(`${fall}: Grund gezaehlt`, erg.gruende[fall], 1)
  gleich(`${fall}: nicht erledigt`, u.stand.erledigt.length, 0)
}
{
  updates = 0
  const a = kreatur("o1"), b = kreatur("o2")
  const u = umgebung({ abruf: abrufAttrappe({ [tor("o1", "o1-1-token.webp")]: { kopf: { "x-beneos-offline": "1" } } }) })
  const erg = await umstellen([a.einheit, b.einheit], u)
  gleich("offline: Lauf endet", erg.offline, true)
  gleich("offline: nichts geschrieben, auch nicht die zweite Einheit", updates, 0)
  gleich("offline: zweite Einheit nicht geprobt", u.abruf.aufrufe.filter((x) => x.includes("o2")).length, 0)
}

// ======================================================= 8 Beide Ansichten
console.log("Beide Ansichten derselben Variante")
{
  const x = kreatur("beide")
  await umstellen([x.einheit], umgebung())
  gleich("2.5D-Token aufs Tor", x.szene.data.tokens[0].texture.src, tor("beide", "beide-1-token.webp"))
  gleich("Draufsicht-Token aufs Tor", x.szene.data.tokens[1].texture.src, tor("beide", "beide-1-top.webp"))
  gleich("Token-delta bleibt", x.szene.data.tokens[0].delta.img, lokal("beide", "beide-1-token.webp"))
  gleich("Token-flags bleiben (ausser der Umstellungsflagge)", x.szene.data.tokens[0].flags.x, lokal("beide", "beide-1-token.webp"))
}

// ======================================================= 9 Register
console.log("Register hin und zurueck")
{
  const x = kreatur("reg")
  const reg = { "full-reg": { token: lokal("reg", "reg-1-top.webp"), topDown: lokal("reg", "reg-1-top.webp"), avatar: lokal("reg", "reg-1-avatar.webp") }, "full-anders": { token: "x" } }
  const u = umgebung({ register: reg })
  await umstellen([x.einheit], u)
  gleich("Register token aufs Tor", u.reg["full-reg"].token, tor("reg", "reg-1-top.webp"))
  gleich("Register topDown aufs Tor", u.reg["full-reg"].topDown, tor("reg", "reg-1-top.webp"))
  gleich("Register avatar bleibt", u.reg["full-reg"].avatar, lokal("reg", "reg-1-avatar.webp"))
  gleich("fremder Registereintrag bleibt", u.reg["full-anders"], { token: "x" })
  keinSchluessel("Fortschritt mit Registerwerten ohne Schluessel", u.stand)
  await zurueckstellen(x.einheit.dokumente, u)
  gleich("Register nach Rueckweg wie vorher", u.reg, reg)
}
{
  // Scheitert das Sichern des Fortschritts, darf das Register nicht schon
  // aufs Tor zeigen: sonst gaebe es keinen Rueckweg mehr.
  const x = kreatur("sicher")
  const u = umgebung({ register: { "full-sicher": { token: lokal("sicher", "sicher-1-token.webp"), topDown: null } } })
  u.fortschritt.schreiben = async () => { throw new Error("Attrappe: Fortschritt kaputt") }
  let fehler = null
  try { await umstellen([x.einheit], u) } catch (e) { fehler = e }
  gleich("Fehler beim Sichern wird durchgereicht", Boolean(fehler), true)
  gleich("Register bleibt lokal, wenn der Rueckweg nicht gesichert ist", u.reg["full-sicher"].token, lokal("sicher", "sicher-1-token.webp"))
}
{
  // Waehrend der Leseprobe schreibt ein anderer ins Register: ein neuer
  // Eintrag und eine Neuinstallation desselben Felds. Beides bleibt.
  const x = kreatur("parallel")
  const u = umgebung({ register: {
    "full-parallel": { token: lokal("parallel", "parallel-1-token.webp"), topDown: lokal("parallel", "parallel-1-top.webp") },
  } })
  const basisAbruf = u.abruf
  u.abruf = async (url, opt) => {
    u.reg["neu99"] = { token: "neu" }
    u.reg["full-parallel"].topDown = "von/anderswo.webp"
    return basisAbruf(url, opt)
  }
  u.abruf.aufrufe = basisAbruf.aufrufe
  await umstellen([x.einheit], u)
  gleich("fremder neuer Registereintrag bleibt", u.reg["neu99"], { token: "neu" })
  gleich("parallel geaendertes Feld bleibt", u.reg["full-parallel"].topDown, "von/anderswo.webp")
  gleich("eigenes unveraendertes Feld aufs Tor", u.reg["full-parallel"].token, tor("parallel", "parallel-1-token.webp"))
  gleich("Fortschritt merkt nur das geschriebene Feld", Object.keys(u.stand.register), ["full-parallel|token"])
}
{
  // Der Spielleiter installiert die Kreatur danach neu: das Register traegt
  // ein anderes Ziel. Der Rueckweg laesst diesen Wert stehen.
  const x = kreatur("neu")
  const u = umgebung({ register: { "full-neu": { token: lokal("neu", "neu-1-token.webp"), topDown: null } } })
  await umstellen([x.einheit], u)
  u.reg["full-neu"].token = tor("neu", "neu-2-token.webp")
  const erg = await zurueckstellen(x.einheit.dokumente, u)
  gleich("geaenderter Registerwert bleibt", u.reg["full-neu"].token, tor("neu", "neu-2-token.webp"))
  gleich("Registerwert als belassen gezaehlt", erg.belassen, 1)
}

// ======================================================= 10 Rueckweg
console.log("Rueckweg nur bei unveraendertem Ziel")
{
  const ks = Array.from({ length: 10 }, (_, i) => kreatur(`r${i}`))
  const u = umgebung()
  await umstellen(ks.map((x) => x.einheit), u)
  // Der Spielleiter aendert danach ein Token von Hand.
  ks[3].szene.data.tokens[0].texture.src = "eigenes/bild.webp"
  // Ohne Planung: nur die Dokumente, Szenen doppelt wie in der echten Welt.
  const erg = await zurueckstellen(ks.flatMap((x) => [...x.einheit.dokumente, x.szene]), u)
  gleich("alle Weltactors wieder lokal", ks.every((x) => !x.welt.data.prototypeToken.texture.src.startsWith(TOR)), true)
  gleich("Kompendium wieder lokal", ks.every((x) => x.pack.data.prototypeToken.texture.src === lokal(x.pack.data._id.slice(1), `${x.pack.data._id.slice(1)}-1-token.webp`)), true)
  gleich("vom SL geaendertes Token bleibt", ks[3].szene.data.tokens[0].texture.src, "eigenes/bild.webp")
  gleich("ein Feld als geaendert gezaehlt", erg.belassen, 1)
  gleich("Flaggen weg", ks.every((x) => holen(x.welt.data, FLAGGE_PFAD) === undefined), true)
  gleich("Fortschritt leer", u.stand.erledigt.length, 0)
  gleich("Paket nach Rueckweg zu", u.paketOffen, false)
}

// ======================================================= 11 Riegel
console.log("Zweiter Lauf parallel")
{
  const u = umgebung()
  u.riegelGesetzt = true
  updates = 0
  const erg = await umstellen([kreatur("z").einheit], u)
  gleich("verweigert", erg.verweigert, true)
  gleich("nichts geschrieben", updates, 0)
  gleich("fremder Riegel bleibt stehen", u.riegelGesetzt, true)
}

// ======================================================= 12 Keine Datei angefasst
console.log("Keine Datei angefasst (E1)")
{
  const code = readFileSync(join(hier, "stream-umstellung.mjs"), "utf8")
  gleich("kein upload", /upload/i.test(code), false)
  gleich("kein FilePicker", /FilePicker/.test(code), false)
  gleich("kein delete eines Dokuments", /\.delete\(|deleteEmbeddedDocuments/.test(code), false)
}

console.log(`\n${gruen} gruen, ${rot} rot`)
process.exit(rot ? 1 : 0)
