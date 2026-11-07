/**
 * stream-posen.test.mjs
 *
 * Gegenprobe zur Pruefsumme je Posenansicht. Laeuft ohne Foundry, ohne
 * Browser, ohne Netz:
 *
 *   node scripts/stream/stream-posen.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ, `OP-PRJ-172`.
 *
 * `_posen.json` liegt je Kreatur im Spiegel und ist eine Datendatei ohne
 * Signatur. Wer sie schreibt, waehlt damit die ausgelieferte Datei, ohne dass
 * eine Zeile Code sich aendert. Haelt der Spiegel unter diesem Namen einen
 * ANDEREN Inhalt, bekommt der Kunde ein fremdes oder abgeschnittenes Bild,
 * und zwar ohne Meldung: ein Bild mit falschem Inhalt ist ein gueltiges Bild.
 * Dazu steuern die Masse in der Liste Skalierung und Ankerpunkt.
 *
 * Betreiberentscheid 07.11.2026: es wird mit Pruefsummen gearbeitet, je
 * Ansicht. Die billigere Variante mit der blossen Bytezahl ist ausdruecklich
 * abgewaehlt. Betreiberentscheid 08.11.2026 fuer die nicht pruefbare Lage:
 * durchlassen und melden.
 *
 * WARUM EINE PROBEKOPIE, UND WARUM SIE KEINE NACHBILDUNG IST
 *
 * `stream-posen.mjs` importiert `headCheck` aus `beneos-asset-watcher.js`, und
 * das ist ein Browsermodul: es braucht `document`, `FormApplication` und
 * weiteres. Gemessen am 07.11.2026 reisst die Importkette in Node ab, und sie
 * vollstaendig zu stellen waere ein zweites Foundry.
 *
 * Dieser Satz schreibt deshalb eine Kopie der Datei in den Temp-Ordner und
 * ersetzt darin GENAU EINE ZEILE, naemlich den Import des Watchers, durch
 * einen Stub. Alles andere ist der Bestand, Zeichen fuer Zeichen. Das ist der
 * Unterschied zu einer handgeschriebenen Nachbildung: hier wird der echte Code
 * gemessen, und ein Fall unten prueft, dass wirklich nur diese eine Zeile
 * getroffen wurde. Driftet die Datei, faellt der Ersatz aus und der Satz wird
 * rot, statt eine alte Kopie weiter gruen zu melden.
 *
 * WAS DIESER SATZ NICHT PRUEFT, und es steht auch im Abschlussblock: die
 * Anzeigefrage. `ansicht()` bleibt ungeprueft, und das ist Absicht, keine
 * Luecke. Eine Kachelleiste mit zwanzig Varianten wuerde sonst zwanzig
 * Dateien holen, die sie nur zaehlen wollte.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { webcrypto } from "node:crypto"

const hier = dirname(fileURLToPath(import.meta.url))
const QUELLE = join(hier, "stream-posen.mjs")

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  if (ist === soll) { gruen++; console.log(`  ok   ${name}`) }
  else {
    rot++
    console.log(`  ROT  ${name}`)
    console.log(`       soll ${JSON.stringify(soll)}`)
    console.log(`       ist  ${JSON.stringify(ist)}`)
  }
}

function wahr(name, bedingung) { gleich(name, !!bedingung, true) }

/**
 * Code ohne Kommentare.
 *
 * Die Lehre aus drei roten Proben in diesem Vorhaben: eine Probe, die eine
 * Zeichenfolge in der GANZEN Datei sucht, wird rot, weil der Kommentar daneben
 * genau erklaert, warum die Sache dort nicht passiert. Eine Probe, die mehr
 * zaehlt als ihre Frage, wird bei richtiger Arbeit rot.
 */
function nurCode(js) {
  return String(js)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(z => z.replace(/\/\/.*$/, "")).join("\n")
}

// ---------------------------------------------------------------------------
// Das gestellte Foundry. Nur so viel, wie `streamBase` und `streamKey` lesen.

/*
 * DIE EINSTELLUNGSNAMEN WERDEN IMPORTIERT UND NICHT GERATEN.
 *
 * Das ist die Lehre aus `OP-PRJ-184`: dort hiess der erste Entwurf
 * `SETTING.gateBase` und `SETTING.streamKey`, die echten Namen sind `base` und
 * `key`, und `game.settings.get` gab daraufhin die leere Zeichenkette. Die
 * Adresse trug dann ein LEERES Schluesselsegment. Derselbe Fehler ist in
 * dieser Datei am 07.11.2026 noch einmal passiert, mit
 * `beneos-stream-gate-base`: der Stub lieferte nichts, `assetUrl` fiel auf
 * `GATE_DEFAULT_BASE`, und vierzehn Faelle waren rot.
 *
 * Deshalb kommt `SETTING` aus dem Modul, und die erwarteten Adressen werden
 * mit `assetUrl` GEBILDET statt getippt. Eine getippte Adresse prueft meine
 * Tippgenauigkeit, keine Funktion.
 */
const { SETTING, assetUrl } = await import("./stream-settings.mjs")

const GATE = "https://stream.beneos-battlemaps.com"
const SCHLUESSEL = "pk_pruefsatz"
globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return SCHLUESSEL
      if (name === SETTING.base) return GATE
      return ""
    },
  },
  i18n: { localize: s => s, format: s => s },
}
/**
 * `crypto.subtle` gibt es in Node unter `webcrypto`. Fuer die Lage OHNE
 * sicheren Kontext wird es unten vorsaetzlich entfernt, und das ist der
 * wichtigste Fall dieser Datei.
 *
 * `globalThis.crypto` ist in Node 22 ein reiner Getter, eine Zuweisung wirft
 * also `TypeError`. Deshalb `defineProperty`, und deshalb als Funktion: der
 * Fall unten muss das Ding zweimal tauschen.
 */
function setzeCrypto(wert) {
  Object.defineProperty(globalThis, "crypto", { value: wert, configurable: true, writable: true })
}
setzeCrypto(webcrypto)

// ---------------------------------------------------------------------------
// Die Probekopie: eine Zeile ersetzt, alles andere Bestand.

const quellText = readFileSync(QUELLE, "utf8")
const IMPORT_ALT = 'import { headCheck } from "../beneos-asset-watcher.js"'
const IMPORT_NEU = "const headCheck = async () => ({ ok: true, laenge: 999999 })"

console.log("\nDie Probekopie, und sie ersetzt genau eine Zeile")
const treffer = quellText.split(IMPORT_ALT).length - 1
gleich("der Watcher-Import kommt genau einmal vor", treffer, 1)
if (treffer !== 1) {
  console.log("       NICHT PRUEFBAR: der Ersatz passt nicht mehr zum Bestand.")
  console.log("       Die Zeile heisst heute anders, und eine Kopie ohne sie")
  console.log("       waere eine Nachbildung statt des Bestands.")
  console.log(`\n  bestanden: ${gruen}\n  rot:       ${rot}`)
  process.exit(1)
}

const tempOrdner = mkdtempSync(join(tmpdir(), "posen-"))
const kopie = join(tempOrdner, "stream-posen.mjs")
// Die Nachbardateien liegen eine Ebene hoeher als der Temp-Ordner, also
// zeigen die relativen Importe ins Leere. Sie werden deshalb auf absolute
// Dateiadressen umgeschrieben; der Code dahinter bleibt der Bestand.
let kopiertext = quellText.replace(IMPORT_ALT, IMPORT_NEU)
kopiertext = kopiertext.replace(/from "\.\/([^"]+)"/g,
  (_, datei) => `from ${JSON.stringify(pathToFileURL(join(hier, datei)).href)}`)
writeFileSync(kopie, kopiertext, "utf8")

const posen = await import(pathToFileURL(kopie).href)
wahr("die Kopie laedt", typeof posen.ansichtInhaltOk === "function")
wahr("und sie bringt die gepruefte Form mit", typeof posen.ansichtGeprueft === "function")

// ---------------------------------------------------------------------------
// Das gestellte Netz. Eine Karte von Adresse zu Bytes, und ein Zaehler, denn
// "einmal je Sitzung geprueft" ist eine Zahl und keine Meinung.

let abrufe = 0
const NETZ = new Map()
globalThis.fetch = async (url) => {
  abrufe += 1
  const schluessel = String(url).split("?")[0]
  const eintrag = NETZ.get(schluessel)
  if (!eintrag) return { ok: false, status: 404, headers: new Map() }
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => eintrag.kopf?.[String(k).toLowerCase()] ?? null },
    blob: async () => ({ arrayBuffer: async () => eintrag.bytes }),
    json: async () => JSON.parse(new TextDecoder().decode(eintrag.bytes)),
  }
}

function bytesVon(text) {
  return new TextEncoder().encode(text).buffer
}

async function summeVon(text) {
  const buf = await webcrypto.subtle.digest("SHA-256", bytesVon(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

const INHALT_GUT = "das richtige bild"
const INHALT_FALSCH = "ein voellig anderes bild"
const SOLL = await summeVon(INHALT_GUT)
const SOLL_FALSCH = await summeVon(INHALT_FALSCH)

const RELEASE = "beneos_ct_000-wolf"
const ADRESSE = assetUrl(RELEASE, "", "000-wolf-1-top.webp")
NETZ.set(ADRESSE, { bytes: bytesVon(INHALT_GUT) })

// ---------------------------------------------------------------------------
console.log("\nDrei Antworten, und jede einzeln")

posen.pruefungenVergessen()
gleich("gleicher Inhalt gibt true", await posen.ansichtInhaltOk(ADRESSE, SOLL), true)

posen.pruefungenVergessen()
gleich("anderer Inhalt gibt false", await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH), false)

/*
 * DER WICHTIGSTE FALL DIESER DATEI.
 *
 * Ohne sicheren Kontext gibt es `crypto.subtle` nicht. `http://localhost` gilt
 * als sicher, `http://192.168.x.x` nicht, und ein Foundry im Heimnetz ist
 * genau das. Betreiberentscheid 08.11.2026: durchlassen und melden, denn ein
 * Kunde ohne HTTPS hat nichts falsch gemacht, und ihm statt seiner Kreaturen
 * ein Ersatzbild zu zeigen waere eine Verschlechterung ohne Gegenwert.
 *
 * Der Fall ist `null` und ausdruecklich NICHT `false`: `false` wuerde das Bild
 * zurueckhalten, und dann waere eine Lage ohne HTTPS ploetzlich eine Lage
 * ohne Bilder.
 */
posen.pruefungenVergessen()
setzeCrypto({})
gleich("ohne crypto.subtle gibt es null, nicht false",
  await posen.ansichtInhaltOk(ADRESSE, SOLL), null)
setzeCrypto({ subtle: {} })
posen.pruefungenVergessen()
gleich("auch ein subtle ohne digest gibt null",
  await posen.ansichtInhaltOk(ADRESSE, SOLL), null)
setzeCrypto(webcrypto)
// Gegenprobe auf den Tausch selbst: ohne sie koennte `setzeCrypto` wirkungslos
// sein, und die beiden Faelle oben waeren aus dem falschen Grund gruen.
posen.pruefungenVergessen()
gleich("nach dem Zuruecksetzen prueft es wieder",
  await posen.ansichtInhaltOk(ADRESSE, SOLL), true)

posen.pruefungenVergessen()
gleich("eine Datei, die nicht kommt, gibt null",
  await posen.ansichtInhaltOk(assetUrl(RELEASE, "", "gibt-es-nicht.webp"), SOLL), null)

// Eine Abweisung am Tor ist HTTP 200 mit 42 Byte und dem Kopf
// `x-beneos-denied`. Ohne diesen Fall wuerde die Pruefung das GIF hashen und
// "falscher Inhalt" melden, wo in Wahrheit ein Recht fehlt. Das waere ein
// Fehler mit der falschen Ursache, und der Kunde bekaeme die falsche Meldung.
const ABGEWIESEN = assetUrl(RELEASE, "", "000-wolf-2-top.webp")
NETZ.set(ABGEWIESEN, { bytes: bytesVon("GIF89a"), kopf: { "x-beneos-denied": "1" } })
posen.pruefungenVergessen()
gleich("eine Abweisung am Tor gibt null, nicht false",
  await posen.ansichtInhaltOk(ABGEWIESEN, SOLL), null)

const OFFLINE = assetUrl(RELEASE, "", "000-wolf-3-top.webp")
NETZ.set(OFFLINE, { bytes: bytesVon("GIF89a"), kopf: { "x-beneos-offline": "1" } })
posen.pruefungenVergessen()
gleich("eine Offline-Antwort gibt null, nicht false",
  await posen.ansichtInhaltOk(OFFLINE, SOLL), null)

// ---------------------------------------------------------------------------
console.log("\nOhne Soll-Summe wird nicht geprueft, und das ist der Uebergangszustand")
/*
 * WARUM ES KEINEN SCHALTER BRAUCHT, und das ist die Entscheidung dieses
 * Pakets. Die Reihenfolge ist bindend: schreiben, Durchgang fahren, erst
 * danach fordern. Der Volldurchgang ueber die Listen ist am 07.11.2026 NICHT
 * gefahren, die Listen tragen also noch keine `sha256`.
 *
 * Ein Schalter waere hier eine zweite Wahrheit. Die Abwesenheit der Summe IST
 * der Uebergangszustand, und sie faellt von sich aus auf "nicht pruefbar".
 * Fuer die Lage ohne Netz gilt dasselbe. Deshalb gibt es keinen Schalter, und
 * deshalb muss dieser Fall hier stehen.
 */
posen.pruefungenVergessen()
gleich("ohne Soll-Summe wird gar nicht abgerufen",
  await posen.ansichtInhaltOk(ADRESSE, null), null)
gleich("eine leere Summe ebenso", await posen.ansichtInhaltOk(ADRESSE, ""), null)
gleich("ohne Adresse ebenso", await posen.ansichtInhaltOk("", SOLL), null)

// ---------------------------------------------------------------------------
console.log("\nEinmal je Sitzung, und das ist eine Zahl")

posen.pruefungenVergessen()
abrufe = 0
await posen.ansichtInhaltOk(ADRESSE, SOLL)
await posen.ansichtInhaltOk(ADRESSE, SOLL)
await posen.ansichtInhaltOk(ADRESSE, SOLL)
gleich("drei Fragen, EIN Abruf", abrufe, 1)

// Dieselbe Adresse mit einer ANDEREN Soll-Summe ist eine andere Frage. Ohne
// das wuerde eine neu geschriebene Liste einen alten Erfolg erben, und genau
// das darf nicht sein: der Spiegel kann denselben Namen mit neuem Inhalt
// tragen.
abrufe = 0
await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
gleich("andere Soll-Summe ist eine neue Frage", abrufe, 1)

// Eine Abfrage an der Adresse darf keinen zweiten Eintrag machen. Der
// Schluessel laeuft deshalb durch `ohneAbfrage`.
abrufe = 0
await posen.ansichtInhaltOk(ADRESSE + "?v=2", SOLL)
gleich("dieselbe Adresse mit Abfrage trifft denselben Eintrag", abrufe, 0)

// Auch ein MISSERFOLG wird gemerkt. Sonst fragt jede Bewegung der Figur
// erneut, und bei einem echten Fehler ist das eine Anfrage je Klick, also
// genau die Last, gegen die `stream-posen.mjs` angetreten ist.
posen.pruefungenVergessen()
abrufe = 0
await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
gleich("ein Misserfolg wird genauso gemerkt", abrufe, 1)

// ---------------------------------------------------------------------------
console.log("\nansichtGeprueft: wer schreibt, prueft")

const LISTE_MIT = {
  release: RELEASE,
  kennung: "000-wolf",
  tokenbilder: {
    1: {
      tokenized: { pfad: "000-wolf-1-token.webp", breite: 700, hoehe: 700, sha256: SOLL },
      topdown: { pfad: "000-wolf-1-top.webp", breite: 2000, hoehe: 2000, sha256: SOLL },
    },
  },
}
const LISTE_ADRESSE = assetUrl(RELEASE, "", "_posen.json")
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(LISTE_MIT)) })

const TOKEN_ADRESSE = assetUrl(RELEASE, "", "000-wolf-1-token.webp")

posen.posenVergessen()
let a = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown")
gleich("gutes Bild: Adresse kommt heraus", a.src, ADRESSE)
gleich("und die Pruefung sagt true", a.pruefung, true)
gleich("und der Zustand bleibt true", a.zustand, true)

// Die Liste nennt eine Summe, die Datei traegt eine andere. Das ist der Fall,
// fuer den dieses Paket gebaut ist.
const LISTE_FALSCH = JSON.parse(JSON.stringify(LISTE_MIT))
LISTE_FALSCH.tokenbilder[1].topdown.sha256 = SOLL_FALSCH
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(LISTE_FALSCH)) })
posen.posenVergessen()
a = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown")
gleich("falscher Inhalt: KEINE Adresse", a.src, null)
gleich("Pruefung false", a.pruefung, false)
// Der Zustand muss mitfallen. Sonst schreibt eine Rufstelle, die nur
// `zustand` liest, die Adresse trotzdem, und die Pruefung waere wirkungslos.
gleich("und der Zustand faellt mit", a.zustand, false)

// Eine Liste OHNE Summe: der Uebergangszustand, und er muss durchlassen.
const LISTE_OHNE = JSON.parse(JSON.stringify(LISTE_MIT))
delete LISTE_OHNE.tokenbilder[1].topdown.sha256
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(LISTE_OHNE)) })
posen.posenVergessen()
a = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown")
gleich("ohne Summe in der Liste: Adresse kommt", a.src, ADRESSE)
gleich("Pruefung null", a.pruefung, null)
gleich("Zustand bleibt true", a.zustand, true)

// Eine Summe der falschen FORM ist keine Summe. Ohne diesen Riegel wuerde
// `"ja"` oder `0` als Soll-Wert durchgehen und die Pruefung immer scheitern.
for (const kaputt of ["ja", "A".repeat(64), "a".repeat(63), "a".repeat(65), 42]) {
  const l = JSON.parse(JSON.stringify(LISTE_MIT))
  l.tokenbilder[1].topdown.sha256 = kaputt
  NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(l)) })
  posen.posenVergessen()
  const r = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown")
  gleich(`Soll-Summe ${JSON.stringify(kaputt).slice(0, 12)} faellt auf nicht pruefbar`,
    r.pruefung, null)
  gleich("und die Adresse kommt trotzdem", r.src, ADRESSE)
}

// Eine Ansicht, die die Liste als `null` fuehrt, gibt es nicht. Das ist kein
// Pruefsummenfall, und die Pruefung darf ihn nicht umdeuten.
const LISTE_NULL = JSON.parse(JSON.stringify(LISTE_MIT))
LISTE_NULL.tokenbilder[1].topdown = null
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(LISTE_NULL)) })
posen.posenVergessen()
a = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown")
gleich("null in der Liste: gibt es nicht", a.zustand, false)
gleich("keine Adresse", a.src, null)
gleich("und das ist KEIN Pruefsummenfall", a.pruefung, null)

// ---------------------------------------------------------------------------
console.log("\nansicht() gibt die Soll-Summe mit heraus")
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(LISTE_MIT)) })
posen.posenVergessen()
const roh = await posen.ansicht(TOKEN_ADRESSE, "topdown")
gleich("sha256 steht im Ergebnis", roh.sha256, SOLL)
// Ohne diesen Fall koennte `ansicht()` die Summe auch dann liefern, wenn sie
// aus der Platte kaeme, und dort gibt es keine: die Liste beschreibt den
// Spiegel, nicht die Platte des Kunden.
const OERTLICH = "beneos_assets/cloud/tokens/000-wolf/000-wolf-1-token.webp"
posen.posenVergessen()
const lokal = await posen.ansicht(OERTLICH, "topdown")
gleich("oertlich gibt es keine Soll-Summe", lokal.sha256, null)

// ---------------------------------------------------------------------------
console.log("\nDer Quelltext des Bestands, nicht der Kopie")
/*
 * WARUM NOCH QUELLTEXTPROBEN, obwohl oben echter Code lief.
 *
 * Die Faelle oben messen die KOPIE. Sie messen damit alles ausser der einen
 * ersetzten Zeile, und das ist viel. Was sie nicht messen koennen, ist, ob die
 * Pruefung auch GERUFEN wird: `ansichtGeprueft` koennte vollkommen richtig
 * sein und von niemandem benutzt werden. Genau diese Luecke hat eine Sabotage
 * am 08.11.2026 in `OP-PRJ-184` aufgedeckt, und die Lehre steht dort:
 * **eine Luecke, die nur in der anderen Lage sichtbar ist, braucht einen
 * Riegel in dieser.**
 *
 * Gezaehlt wird im reinen Code ohne Kommentare, denn die Kommentare daneben
 * nennen die gesuchten Namen.
 */
const posenCode = nurCode(quellText)
wahr("Trenner laesst Code stehen", posenCode.includes("export async function ansichtGeprueft"))
wahr("Trenner wirft Kommentare weg", !posenCode.includes("zweite Wahrheit"))

wahr("die Pruefung haengt NICHT in der allgemeinen Abrufschicht",
  !nurCode(readFileSync(join(hier, "stream-fetch.mjs"), "utf8")).includes("ansichtInhaltOk"))

const utility = nurCode(readFileSync(join(hier, "..", "beneos_utility.js"), "utf8"))

/**
 * Die Zeilen um eine Rufstelle, und nicht die ganze Datei.
 *
 * Eine Sabotage kam zuerst durch, weil `/auskunft\.pruefung === false/` ueber
 * die GANZE Datei suchte: die Zeichenfolge steht an ZWEI Rufstellen, also
 * blieb die Probe gruen, nachdem sie an der einen entfernt war. Dasselbe
 * Muster hat in diesem Vorhaben schon dreimal zugeschlagen. Eine Probe muss
 * genau ihre Frage zaehlen und nicht mehr.
 */
function umRufstelle(code, marke, nachher = 12) {
  const zeilen = code.split("\n")
  const i = zeilen.findIndex(z => z.includes(marke))
  return i < 0 ? "" : zeilen.slice(i, i + nachher).join("\n")
}

const stilwechsel = umRufstelle(utility, "ansichtGeprueft(currentSrc, newStyle)")
wahr("der Stilwechsel ruft die gepruefte Form", stilwechsel !== "")
wahr("und er liest das Ergebnis DORT", /auskunft\.pruefung === false/.test(stilwechsel))
wahr("und bricht dann ab, schreibt also nichts", /\breturn\b/.test(stilwechsel))

const tokenstelle = umRufstelle(utility, 'ansichtGeprueft(tokenData.token, "topdown")')
wahr("die zweite Stelle im Token ruft sie auch", tokenstelle !== "")
wahr("und liest das Ergebnis DORT", /auskunft\.pruefung === false/.test(tokenstelle))
// Die ungepruefte Form darf in dieser Datei nicht mehr GERUFEN werden. Dass
// `ansichtGibtEs` bleibt, ist richtig: es ist die Anzeigefrage.
wahr("die ungepruefte Form wird dort nicht mehr gerufen",
  !/[^A-Za-z]ansicht\s*\(/.test(utility))

const cloud = nurCode(readFileSync(join(hier, "..", "beneos_cloud.js"), "utf8"))
wahr("der Wurf auf die Leinwand ruft die gepruefte Form",
  cloud.includes('ansichtGeprueft(protoSrc, "topdown")'))
wahr("und auch dort wird die ungepruefte Form nicht mehr gerufen",
  !/[^A-Za-z]ansicht\s*\(/.test(cloud))

// Der Textbaustein muss da sein, sonst sieht der Kunde den Schluesselnamen.
// Und er muss sich von "gibt es nicht" UNTERSCHEIDEN: eine falsche Datei ist
// vorhanden, nur mit falschem Inhalt, und "fehlt" schickte den Kunden auf die
// Suche nach etwas, das da ist.
const en = JSON.parse(readFileSync(join(hier, "..", "..", "lang", "en.json"), "utf8"))
wahr("der Textbaustein steht in en.json",
  typeof en["BENEOS.TokenMenu.ViewContentMismatch"] === "string"
  && en["BENEOS.TokenMenu.ViewContentMismatch"].length > 20)
wahr("und er sagt etwas anderes als der Fehlt-Text",
  en["BENEOS.TokenMenu.ViewContentMismatch"] !== en["BENEOS.TokenMenu.TopDownAssetMissing"])

for (const lang of ["de", "fr", "es", "it", "pt-BR", "pt-PT", "pl", "cs", "ca",
                    "ja", "ko", "zh-TW", "ru"]) {
  const d = JSON.parse(readFileSync(join(hier, "..", "..", "lang", `${lang}.json`), "utf8"))
  wahr(`${lang} traegt den Textbaustein`,
    typeof d["BENEOS.TokenMenu.ViewContentMismatch"] === "string"
    && d["BENEOS.TokenMenu.ViewContentMismatch"].length > 20)
}

// ---------------------------------------------------------------------------
rmSync(tempOrdner, { recursive: true, force: true })

console.log("")
console.log("Abschluss")
console.log(`  bestanden: ${gruen}`)
console.log(`  rot:       ${rot}`)
console.log("")
console.log("NICHT PRUEFBAR, und zwar genau viererlei:")
console.log("- Die Anzeigefrage. `ansicht()` ohne Pruefung bleibt in der")
console.log("  Kachelleiste des Cloud-Fensters, und das ist Absicht: zwanzig")
console.log("  Varianten wuerden sonst zwanzig Dateien holen, die nur gezaehlt")
console.log("  werden sollten. Ein falscher Inhalt faellt dort also erst auf,")
console.log("  wenn der Kunde die Ansicht wirklich waehlt.")
console.log("- Ob `crypto.subtle` in einem echten Foundry ohne HTTPS wirklich")
console.log("  fehlt. Hier wird es vorsaetzlich entfernt. Dass `http://192.168.x.x`")
console.log("  kein sicherer Kontext ist, ist Browserregel und am 08.11.2026 aus")
console.log("  den drei vorhandenen Rufstellen im Modul geschlossen, nicht im LAN")
console.log("  gemessen.")
console.log("- Ob der Volldurchgang die Listen wirklich mit `sha256` schreibt. Die")
console.log("  Serverhaelfte ist gebaut (`b388146`), der Durchgang ist handgefuehrt")
console.log("  und am 07.11.2026 nicht gefahren. Bis dahin ist der Normalfall")
console.log("  'ohne Summe', und genau den prueft dieser Satz mit.")
console.log("- Die Kosten im Betrieb. Gerechnet sind 0,447 MB je Draufsicht als")
console.log("  zweite Kopie im Speicher, einmal je Ansicht und Sitzung. Gemessen")
console.log("  ist das nicht.")
process.exit(rot > 0 ? 1 : 0)
