/**
 * stream-ersatzbild.test.mjs
 *
 * Prueft das Ersatzbild am echten Abrufersatz: `installStreamFetch()` wird
 * eingebaut, das Netz ist eine Attrappe, und jede Probe ruft `fetch` mit einer
 * Toradresse. Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-ersatzbild.test.mjs
 *
 * Rueckgabewert 0 heisst alle Proben gruen, 1 heisst mindestens eine rot.
 *
 * WARUM DIESER PRUEFSATZ UEBERHAUPT. Das Ersatzbild ist die einzige Stelle im
 * Streaming, an der ein Fehler GENAU SO AUSSIEHT wie der Zustand, den es
 * beheben soll. Eine Abweisung des Tores kommt als HTTP 200 mit einem
 * durchsichtigen GIF von 42 Byte: der Kunde sieht ein leeres Feld, die
 * Konsole bleibt still. Faellt das Ersatzbild aus, sieht der Kunde dasselbe
 * leere Feld. Ohne diesen Satz faellt beides niemandem auf.
 *
 * DIE WEGE, AUF DENEN ES STILL BRICHT, und jeder ist hier eine Probe am
 * laufenden Code:
 *
 *   1. Die Abweisung oder der Netzfehler fuehrt nicht mehr zum Ersatzbild.
 *   2. Die Form wird falsch erkannt: ein Token bekaeme das Breitbild.
 *   3. Die Datei zur Form fehlt. Dann faellt der Ersatz auf den Bildpunkt.
 *   4. Ein einmal misslungener Abruf setzt sich im Vorrat fest.
 *   5. Masse oder Alphakanal der gelieferten Datei passen nicht zur Rolle.
 *
 * Bis zum 14.11.2026 las dieser Satz `stream-fetch.mjs` als Text (Befund B6
 * der Stream-Inventur). Seit stre-T-017 ruft er den Code. Text liest er nur
 * noch dort, wo die Aussage selbst ein Text ist: der Kopf des Erzeugers
 * `tools/ersatzbilder.py` als Dokumentprobe (Betreiberentscheid E1 vom
 * 14.11.2026), und die Dateiliste unter `ui/` als Strukturprobe.
 *
 * WAS DIESER SATZ NICHT LEISTET. Ob das Ersatzbild im laufenden Foundry
 * erscheint, entscheidet die Reihe 8 der Abnahme. Ob die Bilder GUT aussehen,
 * sagt er nicht; ohne Decoder prueft er Kopf, Masse, Alpha und Groesse.
 *
 * Arbeitspaket `OP-PRJ-207`, dazu `OP-PRJ-128`, `OP-PRJ-129` und stre-T-017.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { pruefstand, installiereFoundry, netz, nimmAbrufe, meldungen } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, struktur, dokument, abschnitt, ende } = pruefstand("stream-ersatzbild, am echten Abrufersatz")

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, "..", "..")
const UI = join(WURZEL, "ui")
const TOR = "https://gate.beneos.stream"
const MODULPFAD = "/modules/beneos-module/ui/"

installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": "pk_pruefsatz_ersatz",
    "beneos-stream-base": TOR,
    // Ohne Vorrat: jede Probe geht durch den Abruf und nicht durch den Speicher.
    "beneos-stream-local-cache": false,
  },
})

// Was das Tor gerade tut. Ein einziger Antworter, denn `netz()` ersetzt
// `globalThis.fetch`; ein zweiter Aufruf nach dem Einbau wuerde den Ersatz
// wieder ausbauen.
let tor = "gut"
let modulFehlt = false
// Antwortet die Gesundheitsabfrage des Tores? Nach drei Fehlschlaegen in Folge
// fragt `stream-online.mjs` sie ab; antwortet sie nicht, ist die Sitzung offline.
let torStumm = false
const TORBYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])

netz((adresse) => {
  if (adresse.startsWith(MODULPFAD)) {
    const datei = join(UI, adresse.slice(MODULPFAD.length))
    if (modulFehlt || !existsSync(datei)) return new Response("fehlt", { status: 404 })
    return new Response(readFileSync(datei), { status: 200, headers: { "Content-Type": "image/webp" } })
  }
  if (adresse === `${TOR}/health`) {
    return torStumm ? { wirf: "Failed to fetch" } : new Response("ok", { status: 200 })
  }
  if (adresse.startsWith(`${TOR}/`)) {
    if (tor === "netzfehler") return { wirf: "Failed to fetch" }
    const kopf = { "Content-Type": "image/webp" }
    if (tor === "abgewiesen") kopf["x-beneos-denied"] = "1"
    return new Response(TORBYTES, { status: 200, headers: kopf })
  }
  return undefined
})

const settings = await import("./stream-settings.mjs")
const abruf = await import("./stream-fetch.mjs")
abruf.installStreamFetch()

// Ein Anfrageteil (`?v=2`) haengt hinter der Adresse; `assetUrl` wuerde das
// Fragezeichen sonst als Teil des Dateinamens kodieren.
const adresse = (name) => {
  const [pfad, anfrage] = name.split("?")
  return settings.assetUrl("beneos_cr_0001", "default", pfad) + (anfrage ? `?${anfrage}` : "")
}

/** Ruft den eingebauten Ersatz und sammelt, was ankommt. */
async function hole(name, zustand, init = undefined) {
  tor = zustand
  nimmAbrufe()
  let antwort
  let geworfen = null
  try { antwort = await globalThis.fetch(adresse(name), init) } catch (fehler) { geworfen = String(fehler) }
  // Ein Tick, damit die Gesundheitsabfrage nach einem dritten Fehlschlag fertig ist.
  await new Promise((r) => setTimeout(r, 0))
  const alle = nimmAbrufe().map((a) => a.adresse)
  const modul = alle.filter((a) => a.startsWith(MODULPFAD))
  const amTor = alle.filter((a) => a.startsWith(`${TOR}/`) && a !== `${TOR}/health`)
  if (!antwort) return { geworfen, modul, amTor }
  const bytes = new Uint8Array(await antwort.arrayBuffer())
  return {
    geworfen,
    modul,
    amTor,
    status: antwort.status,
    typ: antwort.headers.get("Content-Type"),
    ersatz: antwort.headers.get("x-beneos-ersatz"),
    offline: antwort.headers.get("x-beneos-offline"),
    denied: antwort.headers.get("x-beneos-denied"),
    bytes,
  }
}

const datei = (ursache, form) => readFileSync(join(UI, `beneos_stream_${ursache}_${form}.webp`))
// Ohne Antwort (geworfen) gibt es keine Bytes; das ist ein rotes Ergebnis, kein Absturz.
const gleicheBytes = (a, b) => Boolean(a && b) && a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Der Kopf einer WebP-Datei, gelesen aus den Bytes, die der Ersatz liefert.
 *
 * ZWEI FORMEN: Pillow schreibt VP8X fuer die verlustbehaftete und VP8L fuer
 * die verlustfreie Kodierung. Beide tragen Alpha und Masse im Kopf, nur
 * verschieden verpackt. Die erste Fassung kannte nur VP8X und wurde bei der
 * Umstellung auf verlustfrei 24 mal rot, obwohl an den Bildern nichts fehlte.
 *
 *   VP8X  Flags in Byte 20 (Bit 4 ist Alpha), Masse als zwei mal 24 Bit
 *   VP8L  Signaturbyte 0x2F, danach 32 Bit mit Breite, Hoehe, Alpha, Version
 */
function webpKopf(b) {
  const text = (von, bis) => String.fromCharCode(...b.slice(von, bis))
  if (!b || b.length < 30) return { fehler: "zu kurz" }
  if (text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") return { fehler: "kein WebP" }
  const art = text(12, 16)
  if (art === "VP8X") {
    return {
      art,
      alpha: (b[20] & 0x10) !== 0,
      breite: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
      hoehe: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    }
  }
  if (art === "VP8L" && b[20] === 0x2f) {
    // `>>>` statt `>>`, weil Bit 31 sonst das Vorzeichen setzt.
    const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
    return {
      art,
      alpha: ((v >>> 28) & 1) === 1,
      breite: (v & 0x3fff) + 1,
      hoehe: ((v >>> 14) & 0x3fff) + 1,
    }
  }
  return { fehler: `Chunk ${art} traegt keinen Alphakanal`, art }
}

// Je Form ein Dateiname, wie ihn das Modul fuer diese Rolle schreibt.
const FORMEN = {
  journal: "kreatur-journal.webp",
  card: "kreatur_front.webp",
  token: "kreatur-token.webp",
}

// ===========================================================================
abschnitt("Ein misslungener Abruf der Ersatzdatei faellt auf den Bildpunkt und setzt sich nicht fest")

// Zuerst, denn ein gelungener Abruf liegt danach im Vorrat dieser Sitzung.
modulFehlt = true
const ohneDatei = await hole(FORMEN.token, "abgewiesen")
gleich("fehlt die Ersatzdatei, kommt ein GIF statt WebP", ohneDatei.typ, "image/gif")
gleich("auch dann HTTP 200, damit PIXI kein Gefahrensymbol malt", ohneDatei.status, 200)
gleich("auch dann traegt die Antwort die Ursache", ohneDatei.ersatz, "denied")
gleich("der Bildpunkt ist das GIF von 42 Byte", ohneDatei.bytes.length, 42)
modulFehlt = false
const danach = await hole(FORMEN.token, "abgewiesen")
gleich("liegt die Datei wieder da, kommt sie beim naechsten Abruf an",
  gleicheBytes(danach.bytes, datei("denied", "token")), true)

// ===========================================================================
abschnitt("Eine Abweisung des Tores bringt je Form das Ersatzbild denied")

const geliefert = {}
for (const [form, name] of Object.entries(FORMEN)) {
  const r = await hole(name, "abgewiesen")
  geliefert[`denied/${form}`] = r.bytes
  gleich(`denied ${form}: HTTP 200`, r.status, 200)
  gleich(`denied ${form}: Inhaltstyp image/webp`, r.typ, "image/webp")
  gleich(`denied ${form}: Kopfzeile x-beneos-ersatz`, r.ersatz, "denied")
  gleich(`denied ${form}: Kopfzeile x-beneos-denied`, r.denied, "1")
  gleich(`denied ${form}: keine Kopfzeile x-beneos-offline`, r.offline, null)
  gleich(`denied ${form}: es kommen die Bytes von beneos_stream_denied_${form}.webp`,
    gleicheBytes(r.bytes, datei("denied", form)), true)
}

// ===========================================================================
abschnitt("Ein Netzfehler bringt je Form das Ersatzbild offline")

for (const [form, name] of Object.entries(FORMEN)) {
  const r = await hole(name, "netzfehler")
  geliefert[`offline/${form}`] = r.bytes
  gleich(`offline ${form}: nichts geworfen`, r.geworfen, null)
  gleich(`offline ${form}: Inhaltstyp image/webp`, r.typ, "image/webp")
  gleich(`offline ${form}: Kopfzeile x-beneos-ersatz`, r.ersatz, "offline")
  gleich(`offline ${form}: Kopfzeile x-beneos-offline`, r.offline, "1")
  gleich(`offline ${form}: keine Kopfzeile x-beneos-denied`, r.denied, null)
  gleich(`offline ${form}: es kommen die Bytes von beneos_stream_offline_${form}.webp`,
    gleicheBytes(r.bytes, datei("offline", form)), true)
}

// Der Abruf aus dem Modul geht an den Ordner ui/ und den Anfang beneos_stream_.
// Beobachtet wird er an der Attrappe; ein Abruf liegt nur vor, solange die
// Datei noch nicht im Vorrat dieser Sitzung liegt.
tor = "abgewiesen"
nimmAbrufe()
await globalThis.fetch(adresse("andere-journal.png"))
gleich("der Ersatz liegt im Vorrat: ein zweites Journalbild holt die Datei nicht neu",
  nimmAbrufe().filter((a) => a.adresse.startsWith(MODULPFAD)).length, 0)

// ===========================================================================
abschnitt("Die Form folgt dem Dateinamen der ausgefallenen Datei")

for (const [name, form] of [
  ["kreatur-back.webp", "card"],
  ["kreatur_card.jpg", "card"],
  ["kreatur-top.png", "token"],
  ["kreatur_avatar.webp", "token"],
  ["kreatur-icon.jpeg", "token"],
  ["KREATUR-TOKEN.WEBP", "token"],
  ["kreatur-token.webp?v=2", "token"],
  ["karte.webp", "journal"],
]) {
  const r = await hole(name, "abgewiesen")
  gleich(`${name} bekommt die Form ${form}`, gleicheBytes(r.bytes, datei("denied", form)), true)
}

// ===========================================================================
abschnitt("Gegenproben: wo kein Ersatz hingehoert, kommt keiner")

const normal = await hole(FORMEN.token, "gut")
gleich("ohne Abweisung und ohne Fehler: keine Kopfzeile x-beneos-ersatz", normal.ersatz, null)
gleich("ohne Abweisung und ohne Fehler: die Bytes des Tores", gleicheBytes(normal.bytes, TORBYTES), true)

const video = await hole("karte.webm", "abgewiesen")
gleich("ein abgewiesenes Video bekommt kein Ersatzbild", video.ersatz, null)
gleich("ein abgewiesenes Video behaelt die Antwort des Tores", gleicheBytes(video.bytes, TORBYTES), true)

const steuer = await hole("manifest.json", "netzfehler")
gleich("ein Netzfehler bei einer Steuerdatei wird geworfen", steuer.geworfen !== null, true)

// ===========================================================================
abschnitt("Ein Netzfehler-Ersatzbild sagt es der Spielleitung, einmal je Szene (stre-T-220)")

// Am echten Abrufersatz: der Netzfehler-Zweig ruft die Meldestelle. Die
// Attrappe uebersetzt nicht, also kommt der englische Rueckfall an. Zwischen
// zwei Netzfehlern steht ein guter Abruf, sonst kippte die Sitzung nach dem
// dritten Fehlschlag in Folge auf offline und der Netzfehler-Zweig liefe nicht.
const hinweis = await import("./stream-hinweis.mjs")
hinweis.installStreamHinweis()
const szenenwechsel = () => globalThis.Hooks.rufe("canvasInit")
// Gezaehlt ab hier: die Abschnitte davor hatten schon Netzfehler-Ersatzbilder.
const ab = meldungen.length
const netzHinweise = () => meldungen.slice(ab).filter((m) => m.art === "warn" && /could not be loaded right now/.test(m.text)).length
await szenenwechsel()
await hole("e-token.webp", "netzfehler")
gleich("Netzfehler auf einem Bild: ein Hinweis", netzHinweise(), 1)
await hole("f-token.webp", "gut")
await hole("g-token.webp", "netzfehler")
gleich("zweites Netzfehler-Ersatzbild derselben Szene: kein weiterer Hinweis", netzHinweise(), 1)
await szenenwechsel()
await hole("h-token.webp", "gut")
await hole("karte.webm", "netzfehler")
gleich("Netzfehler auf einem Video: kein Hinweis", netzHinweise(), 1)
await hole("i-token.webp", "gut")
await hole("manifest.json", "netzfehler")
gleich("Netzfehler auf einer Steuerdatei: kein Hinweis", netzHinweise(), 1)
await hole("j-token.webp", "gut")
await hole("k-token.webp", "netzfehler")
gleich("neue Szene, erstes Netzfehler-Ersatzbild: wieder ein Hinweis", netzHinweise(), 2)
await hole("l-token.webp", "gut")
await szenenwechsel()
globalThis.game.user.isGM = false
await hole("m-token.webp", "netzfehler")
globalThis.game.user.isGM = true
gleich("Spieler: kein Hinweis", netzHinweise(), 2)
await hole("n-token.webp", "gut")
await szenenwechsel()
await globalThis.game.settings.set("beneos-module", "beneos-stream-install-mode", "download")
await hole("o-token.webp", "netzfehler")
await globalThis.game.settings.set("beneos-module", "beneos-stream-install-mode", "stream")
gleich("Messmodus: kein Hinweis", netzHinweise(), 2)
await hole("p-token.webp", "gut")
await hole("q-token.webp", "netzfehler")
gleich("Gegenprobe nach dem Messmodus: derselbe Netzfehler meldet wieder", netzHinweise(), 3)
await hole("r-token.webp", "gut")
// Ueber die ganze Sitzung: die Meldung offline kommt einmal je Sitzung, also
// schon beim ersten Netzfehler-Ersatzbild weiter oben, wenn der Zweig sie riefe.
gleich("keine Meldung offline auf diesem Weg", meldungen.filter((m) => /no connection to the server/.test(m.text)).length, 0)

// ===========================================================================
abschnitt("Ein Ersatzbild wegen fehlender Verbindung wird zum Verwerfen gemerkt (stre-T-222)")

// Am echten Abrufersatz: PIXI haelt ein Ersatzbild als gueltige Textur fest,
// also muss der Abruf es dem Speicher melden. Gemerkt wird nur das Ersatzbild
// offline, nie denied, nie ein Video, nie eine Steuerdatei, nie im Messmodus.
const speicher = await import("./stream-ersatz-speicher.mjs")
const gemerkt = (name) => speicher.gemerktFuerPruefsatz().includes(adresse(name))
gleich("Netzfehler auf einem Bild: gemerkt", gemerkt("e-token.webp"), true)
gleich("ein gutes Bild: nicht gemerkt", gemerkt("f-token.webp"), false)
gleich("Netzfehler auf einem Video: nicht gemerkt", gemerkt("karte.webm"), false)
gleich("Netzfehler auf einer Steuerdatei: nicht gemerkt", gemerkt("manifest.json"), false)
gleich("Netzfehler im Messmodus: nicht gemerkt", gemerkt("o-token.webp"), false)
await hole("s-token.webp", "abgewiesen")
gleich("Abweisung (denied): nicht gemerkt", gemerkt("s-token.webp"), false)
// Ein Blatt- oder Journalbild liegt nicht in PIXI (Kalt-Review zum Diff, Befund 3).
const oberflaecheNetz = await hole("u-token.webp", "netzfehler", { beneosOberflaeche: true })
gleich("Netzfehler auf einem Oberflaechenbild: Ersatz ja, gemerkt nein",
  `${oberflaecheNetz.ersatz}|${gemerkt("u-token.webp")}`, "offline|false")

// ===========================================================================
abschnitt("Ohne Verbindung kommt das Ersatzbild offline, ohne dass das Tor gefragt wird")

// Drei Fehlschlaege in Folge und ein stummes Tor: die Sitzung ist offline.
torStumm = true
for (const name of ["a-token.webp", "b-token.webp", "c-token.webp"]) await hole(name, "netzfehler")
const offlineBild = await hole("d_front.webp", "gut")
gleich("offline: ein Bild bekommt das Ersatzbild offline", offlineBild.ersatz, "offline")
gleich("offline: es sind die Bytes von beneos_stream_offline_card.webp",
  gleicheBytes(offlineBild.bytes, datei("offline", "card")), true)
gleich("offline: das Tor wird fuer das Bild nicht gefragt", offlineBild.amTor.length, 0)
gleich("offline: das Ersatzbild wird zum Verwerfen gemerkt (stre-T-222)", gemerkt("d_front.webp"), true)
const offlineOberflaeche = await hole("g_front.webp", "gut", { beneosOberflaeche: true })
gleich("offline: ein Oberflaechenbild bekommt Ersatz, gemerkt wird es nicht (stre-T-222)",
  `${offlineOberflaeche.ersatz}|${gemerkt("g_front.webp")}`, "offline|false")
const offlineVideo = await hole("karte.webm", "gut")
gleich("offline: ein Video bekommt kein Ersatzbild", offlineVideo.ersatz, null)
gleich("offline: ein Video bekommt den Bildpunkt", offlineVideo.typ, "image/gif")
gleich("offline: ein Video wird nicht gemerkt (stre-T-222)", gemerkt("karte.webm"), false)
const offlineSteuer = await hole("manifest.json", "gut")
gleich("offline: eine Steuerdatei bekommt HTTP 503 statt eines Bildes", offlineSteuer.status, 503)

// ===========================================================================
abschnitt("Die gelieferten Bilder: WebP mit Alphakanal, Masse nach Rolle")

const masse = {}
for (const [schluessel, bytes] of Object.entries(geliefert)) {
  const k = webpKopf(bytes)
  const form = schluessel.split("/")[1]
  masse[schluessel] = [k.breite, k.hoehe]
  gleich(`${schluessel}: WebP in der Form VP8X oder VP8L`, k.art === "VP8X" || k.art === "VP8L", true)
  gleich(`${schluessel}: traegt einen Alphakanal`, k.alpha, true)
  // Eine Datei unter 1000 Byte waere das durchsichtige Pixel in neuem Kleid.
  gleich(`${schluessel}: traegt ein Bild und nicht nur einen Kopf`, (bytes?.length ?? 0) > 1000, true)
  const lage = k.breite === k.hoehe ? "token" : (k.hoehe > k.breite ? "card" : "journal")
  gleich(`${schluessel}: die Lage passt zur Rolle`, lage, form)
}
for (const form of Object.keys(FORMEN)) {
  gleich(`denied und offline ${form} haben dieselben Masse`,
    JSON.stringify(masse[`denied/${form}`]), JSON.stringify(masse[`offline/${form}`]))
}

// ===========================================================================
abschnitt("Strukturprobe: unter ui/ liegen genau die sechs Ersatzdateien")

// Eine uebrige Datei ist kein Ausfall, aber ein Hinweis darauf, dass jemand
// eine Form entfernt und ihre Datei vergessen hat. Eine Aussage ueber den
// Dateibestand, die kein Aufruf zeigen kann.
const SECHS = ["denied", "offline"].flatMap((u) => Object.keys(FORMEN).map((f) => `beneos_stream_${u}_${f}.webp`)).sort()
// M6: S, eine Aussage ueber den Dateibestand unter ui/, eine uebrige Datei aendert kein Verhalten.
struktur("es liegen genau die erwarteten Dateien und keine weitere",
  JSON.stringify(readdirSync(UI).filter((n) => n.startsWith("beneos_stream_") && n.endsWith(".webp")).sort()),
  JSON.stringify(SECHS))

// ===========================================================================
abschnitt("Dokumentprobe: der Erzeuger tools/ersatzbilder.py nennt Werte und Herkunft")

// Der Erzeuger ist kein Modulcode und laeuft hier nicht (er braucht Pillow).
// Betreiberentscheid E1: sein Kopf bleibt als Dokument geprueft. OP-PRJ-207
// entstand, weil die Bilder da waren und ihr Erzeuger nicht.
// M6: D, der Erzeuger ist Python mit Pillow und laeuft hier nicht, sein Kopf bleibt Dokumentprobe nach Betreiberentscheid E1.
const ERZEUGER = readFileSync(join(WURZEL, "tools", "ersatzbilder.py"), "utf8")
const formenBlock = ERZEUGER.match(/FORMEN = \{([\s\S]*?)\n\}/)
const sollMasse = {}
for (const z of (formenBlock ? formenBlock[1] : "").matchAll(/"([a-z]+)":\s*\((\d+),\s*(\d+)\)/g)) {
  sollMasse[z[1]] = [Number(z[2]), Number(z[3])]
}
for (const form of Object.keys(FORMEN)) {
  dokument(`die Formentabelle des Erzeugers nennt fuer ${form} die gelieferten Masse`,
    JSON.stringify(sollMasse[form]), JSON.stringify(masse[`denied/${form}`]))
}
dokument("die Formentabelle kennt genau drei Formen", Object.keys(sollMasse).length, 3)
for (const [was, muster] of [
  ["die Farben mit ihrem Token aus der Bone-Palette", /--color-bg-base/],
  ["den Rand als --color-border-strong", /--color-border-strong/],
  ["das Symbol als Nebentext und keine Zustandsfarbe", /--color-text-secondary/],
  ["den Vertrag der Dateinamen", /beneos_stream_<ursache>_<form>\.webp/],
  ["dass er eine Neuschrift und kein Fund ist", /NEUSCHRIFT/],
]) {
  dokument(`der Kopf nennt ${was}`, muster.test(ERZEUGER), true)
}
// Zwei Stufen Unterschied im Dunkeln sieht niemand am Bild, darum hier.
for (const [rolle, wert] of [
  ["SCHEIBE", "0x0E, 0x0D, 0x0A"],
  ["RAND", "0x46, 0x3B, 0x2C"],
  ["SYMBOL", "0xA7, 0xA5, 0x96"],
]) {
  dokument(`${rolle} traegt den Wert aus der Palette`,
    new RegExp(`^${rolle} = \\(${wert}`, "m").test(ERZEUGER), true)
}

console.log("\nNicht geprueft, ausdruecklich benannt:")
console.log("- Ob das Ersatzbild im laufenden Foundry erscheint (Reihe 8 der Abnahme).")
console.log("- Ob die Bilder gut aussehen. Geprueft sind Kopf, Masse, Alpha, Groesse.")
console.log("- Ob der Erzeuger laeuft. Er braucht Pillow; die Ergebnisse liegen committet.")
console.log("- Ein Ersatz aus dem Vorrat (Cache Storage). Der Satz faehrt ohne Vorrat.")
ende()
