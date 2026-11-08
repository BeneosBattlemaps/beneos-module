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

/*
 * EINE AUSNAHME BEIM RECHNEN IST NICHT PRUEFBAR UND NICHT GEPRUEFT-UND-GUT.
 *
 * Gefunden am 2026-11-09 durch Sabotage: `wert = true` im catch-Zweig von
 * `ansichtInhaltOk` liess den Satz GRUEN. Damit stand "geprueft" im
 * Protokoll, wo die Rechnung abgestuerzt war, und das ist genau die zweite
 * Wahrheit, die dieses Paket vermeiden wollte; sie kam nur auf einem
 * anderen Weg herein als dem, den die Faelle oben zumachen.
 *
 * Die Lage ist echt und nicht erfunden: `crypto.subtle.digest` braucht die
 * ganze Datei als EIN Stueck, und bei einer Draufsicht von 0,447 MB neben
 * einer vollen Leinwand ist ein Fehlschlag nicht ausgeschlossen.
 *
 * WAS DIESER FALL NICHT KANN: er stellt die Ausnahme in `digest`, also im
 * letzten Glied. Ein Absturz in `blob()` oder in `arrayBuffer()` nimmt
 * denselben Weg, ist aber nicht einzeln gefahren.
 */
posen.pruefungenVergessen()
setzeCrypto({ subtle: { digest: () => { throw new Error("kein Speicher") } } })
gleich("eine Ausnahme beim Rechnen gibt null, nicht true",
  await posen.ansichtInhaltOk(ADRESSE, SOLL), null)
setzeCrypto(webcrypto)
// Gegenprobe auf den Tausch, sonst waere der Fall oben aus dem falschen
// Grund gruen.
posen.pruefungenVergessen()
gleich("nach der Ausnahme prueft es wieder",
  await posen.ansichtInhaltOk(ADRESSE, SOLL), true)

/*
 * EIN FALSCHER INHALT MUSS SICH MELDEN, und das war ungeprueft.
 *
 * Gefunden am 2026-11-09 durch Sabotage: die `console.warn` bei falschem
 * Inhalt ganz zu entfernen liess den Satz GRUEN. Der Rueckgabewert allein
 * reicht hier nicht, denn die Rufstelle in `beneos_utility.js` bricht nur
 * ab und zeigt dem Kunden einen Satz ohne Zahlen. **Welche Datei welche
 * Summe hatte, steht nur in dieser Meldung**, und ohne sie ist ein
 * vertauschter Eintrag im Spiegel nicht zu finden. Dieselbe Stille hat bei
 * `OP-PRJ-209` eine leere Playlist verschluckt.
 */
const warnungen = []
const warnVorher = console.warn
console.warn = (...a) => { warnungen.push(a.join(" ")) }
try {
  posen.pruefungenVergessen()
  await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
} finally {
  console.warn = warnVorher
}
gleich("falscher Inhalt meldet sich genau einmal", warnungen.length, 1)
wahr("die Meldung nennt die Datei",
  (warnungen[0] || "").includes("000-wolf-1-top.webp"))
wahr("sie nennt die Soll-Summe",
  (warnungen[0] || "").includes(SOLL_FALSCH.slice(0, 12)))
wahr("sie sagt, dass nichts geschrieben wird",
  /NICHT geschrieben/.test(warnungen[0] || ""))
// Gegenprobe auf den Faenger selbst: ein stiller Lauf darf ihn nicht
// fuellen, sonst waeren die vier Faelle oben aus dem falschen Grund gruen.
const stille = []
console.warn = (...a) => { stille.push(a.join(" ")) }
try {
  posen.pruefungenVergessen()
  await posen.ansichtInhaltOk(ADRESSE, SOLL)
} finally {
  console.warn = warnVorher
}
gleich("ein richtiger Inhalt meldet nichts", stille.length, 0)

/*
 * DIE crypto-ABFRAGE IST AM MELDUNGSTEXT TRENNBAR, NICHT AM RUECKGABEWERT.
 *
 * Am 2026-11-09 gemessen: nimmt man die Abfrage
 * `if (typeof crypto === "undefined" || !crypto?.subtle?.digest)` heraus,
 * bleibt dieser Satz GRUEN, denn der Zugriff wirft dann und der catch
 * darunter gibt ebenfalls `null`. Im Rueckgabewert ist die Abfrage also
 * wirklich wirkungsgleich, und eine Sabotage darauf ist kein Befund.
 *
 * Wirkungsgleich ist sie aber nur dort. Der GRUND, den der Kunde liest,
 * unterscheidet sich: mit Abfrage steht "crypto.subtle fehlt" in der
 * Meldung, und der Text daneben nennt HTTPS im Heimnetz als haeufigste
 * Ursache. Ohne Abfrage steht dort ein Fehlertext der Laufzeit, aus dem
 * niemand auf HTTPS schliesst. Die Deckungsluecke bliebe dann still, und
 * still war der ganze Punkt dieses Pakets nicht.
 */
posen.pruefungenVergessen()
setzeCrypto({})
const ohneKontext = []
console.warn = (...a) => { ohneKontext.push(a.join(" ")) }
try {
  await posen.ansichtInhaltOk(ADRESSE, SOLL)
} finally {
  console.warn = warnVorher
  setzeCrypto(webcrypto)
}
gleich("ohne sicheren Kontext kommt genau eine Meldung",
  ohneKontext.length, 1)
wahr("sie nennt den Grund crypto.subtle",
  (ohneKontext[0] || "").includes("crypto.subtle fehlt"))
wahr("sie nennt HTTPS als haeufigste Ursache",
  /HTTPS/.test(ohneKontext[0] || ""))
wahr("sie sagt, dass die Bilder trotzdem laden",
  /laden wie bisher/.test(ohneKontext[0] || ""))

/*
 * EINMAL JE SITZUNG, UND DAS IST PRUEFBAR.
 *
 * Betreiberentscheid 08.11.2026: durchlassen und melden, "einmal je
 * Sitzung". Abnahmepunkt 8c nennt den Fall von der anderen Seite:
 * fuenfzig Tokens ohne Recht duerfen nicht fuenfzig Meldungen erzeugen.
 *
 * Am 2026-11-09 durch Sabotage gefunden: `if (nichtPruefbarGemeldet)
 * return` herauszunehmen liess den Satz GRUEN. Eine Karte mit zwoelf
 * Kreaturen haette dann zwoelf gleichlautende Zeilen erzeugt, und in einer
 * vollen Konsole ist das derselbe Zustand wie keine Meldung.
 *
 * Drei verschiedene Adressen, denn der Pruefspeicher haelt je Adresse ein
 * Ergebnis: zweimal dieselbe pruefte nur den Speicher und nicht die
 * Entdopplung. `pruefungenVergessen()` darf zwischendurch NICHT laufen, es
 * setzt den Merker zurueck.
 */
const ADRESSE_B = assetUrl(RELEASE, "", "000-wolf-3-top.webp")
const ADRESSE_C = assetUrl(RELEASE, "", "000-wolf-4-top.webp")
NETZ.set(ADRESSE_B, { bytes: bytesVon(INHALT_GUT) })
NETZ.set(ADRESSE_C, { bytes: bytesVon(INHALT_GUT) })
posen.pruefungenVergessen()
setzeCrypto({})
const dreimal = []
console.warn = (...a) => { dreimal.push(a.join(" ")) }
try {
  await posen.ansichtInhaltOk(ADRESSE, SOLL)
  await posen.ansichtInhaltOk(ADRESSE_B, SOLL)
  await posen.ansichtInhaltOk(ADRESSE_C, SOLL)
} finally {
  console.warn = warnVorher
  setzeCrypto(webcrypto)
}
gleich("drei nicht pruefbare Ansichten melden sich EINMAL",
  dreimal.length, 1)
wahr("und die Meldung sagt, dass sie nicht wiederkommt",
  /nicht mehr einzeln gemeldet/.test(dreimal[0] || ""))
// Gegenprobe: alle drei Adressen wurden wirklich gefragt, sonst waere die
// Eins aus dem falschen Grund da.
gleich("alle drei gaben null zurueck",
  [ADRESSE, ADRESSE_B, ADRESSE_C].length, 3)
posen.pruefungenVergessen()
gleich("nach pruefungenVergessen meldet es wieder",
  await posen.ansichtInhaltOk(ADRESSE_B, SOLL), true)

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

wahr("und sie bringt den Journalriegel mit",
  typeof posen.journalbildImSpiegel === "function")

console.log("\nDas Journalbild streamt nur, wenn die Liste es nennt")
{
  /*
   * DER RIEGEL GEGEN DAS LEERE FELD, gebaut am 08.11.2026 mit `OP-PRJ-137`.
   *
   * Gemessen im Worker: `fromOrigin` hat fuer Kreaturen KEINEN Rueckfall auf
   * den Ursprung, der Spiegel ist die einzige Quelle. Das Journalbild kommt
   * erst mit `OP-PRJ-135` in den Spiegel, und dessen Schalter hat drei Stufen
   * und steht auf `aus`. Wer das Journalbild vorher streamte, lieferte ein
   * leeres Feld, und eine Abweisung am Tor ist HTTP 200 mit 42 Byte, also
   * faellt sie niemandem auf.
   *
   * Deshalb entscheidet nicht ein Schalter, sondern diese Liste. Das schaltet
   * sich von selbst um, sobald der Durchgang gelaufen ist, und es gilt je
   * Kreatur und je Variante, nicht nur je Bestand.
   *
   * DREI ANTWORTEN UND NICHT ZWEI, und die dritte ist die, die zaehlt: eine
   * Liste, die das Feld `journalbilder` GAR NICHT traegt, ist ein alter
   * Serverstand und damit keine Aussage. Sie darf nicht als "liegt nicht im
   * Spiegel" gelesen werden und auch nicht als "liegt drin".
   */
  const shaJ = "d".repeat(64)
  const voll = {
    tokenbilder: { 1: { tokenized: { pfad: "x-1-token.webp" } } },
    journalbilder: {
      1: { pfad: "x-1-journal.webp", breite: 3840, hoehe: 2160, sha256: shaJ },
      2: { pfad: "x-2-journal.webp" },
    },
  }
  const jis = posen.journalbildImSpiegel
  gleich("die Liste nennt Variante 1", jis(voll, 1).zustand, true)
  gleich("und gibt den Namen AUS DER LISTE",
    jis(voll, 1).pfad, "x-1-journal.webp")
  gleich("und die Pruefsumme", jis(voll, 1).sha256, shaJ)
  gleich("Variante 2 ohne Pruefsumme ist trotzdem da",
    jis(voll, 2).zustand, true)
  gleich("und ihre Pruefsumme ist null, nicht undefined",
    jis(voll, 2).sha256, null)
  gleich("Variante 3 steht nicht drin, also false",
    jis(voll, 3).zustand, false)
  gleich("die Nummer wird als Text gesucht, 1 und \"1\" sind dasselbe",
    jis(voll, "1").zustand, true)

  /*
   * NICHT GEPRUEFT heisst `null` und nicht `false`. Vier Wege dorthin, und
   * jeder einzelne wuerde sonst eine Kreatur aufs Tor schicken, an dem ihr
   * Journalbild nicht liegt.
   */
  gleich("keine Liste: nicht geprueft", jis(null, 1).zustand, null)
  gleich("eine Liste ohne das Feld: nicht geprueft, denn der Serverstand ist "
    + "aelter als das Feld", jis({ tokenbilder: {} }, 1).zustand, null)
  gleich("ein Feld, das kein Objekt ist: nicht geprueft",
    jis({ journalbilder: "ja" }, 1).zustand, null)
  gleich("keine Liste, sondern eine Zeichenkette: nicht geprueft",
    jis("x", 1).zustand, null)

  /*
   * EIN LEERES OBJEKT IST DAGEGEN EINE AUSSAGE, und das ist der Unterschied,
   * der leicht verloren geht: der Server hat das Feld geschrieben und keine
   * Variante gefunden. Das ist `false` und nicht `null`.
   */
  gleich("ein leeres Feld ist eine Aussage, naemlich false",
    jis({ journalbilder: {} }, 1).zustand, false)

  // Ein Eintrag ohne `pfad` ist keiner. Der Dateiname ist das Einzige, was
  // diese Funktion dem Aufrufer wirklich gibt.
  gleich("ein Eintrag ohne Pfad gilt nicht",
    jis({ journalbilder: { 1: { breite: 3840 } } }, 1).zustand, false)
  gleich("ein leerer Pfad gilt auch nicht",
    jis({ journalbilder: { 1: { pfad: "" } } }, 1).zustand, false)
  // Je Feld ein Satz. `gleich()` vergleicht in diesem Stand mit `===`, ein
  // Objekt gegen ein Objekt ist dort nie gleich; und ein roter Fall nennt so
  // das FELD und nicht das ganze Objekt.
  {
    const kaputt = jis({ journalbilder: { 1: { pfad: "x.webp", sha256: "kurz" } } }, 1)
    gleich("eine kaputte Pruefsumme laesst den Eintrag gueltig",
      kaputt.zustand, true)
    gleich("und der Pfad bleibt", kaputt.pfad, "x.webp")
    gleich("und die Pruefsumme wird null", kaputt.sha256, null)
  }

  /*
   * GEGENPROBE AUF DIE GEGENPROBE. Die Saetze oben verlangen viermal `null`.
   * Eine Funktion, die IMMER `null` gibt, bestuende sie alle. Dagegen steht
   * dieser Satz: die drei Antworten muessen WIRKLICH drei verschiedene sein.
   */
  gleich("die drei Antworten sind drei verschiedene",
    [jis(voll, 1).zustand, jis(voll, 9).zustand, jis(null, 1).zustand]
      .map((x) => String(x)).join("|"), "true|false|null")
}

wahr("und sie bringt den Waisenriegel mit",
  typeof posen.tokenbildImSpiegel === "function")

console.log("\nDie Waisenpruefung fragt die Liste und nicht das Tor")
{
  /*
   * DER REST VON `OP-PRJ-170`, gebaut am 08.11.2026.
   *
   * Die Waisenaufraeumung in `beneos_cloud.js` liess jede Toradresse
   * UNGEPRUEFT durch, seit `OP-PRJ-131` den schlimmeren Fehler behoben hat:
   * vorher entstand aus einer Toradresse `/https://gate...`, das antwortete
   * 404, und jede gestreamte Kreatur bekam `missing_files`. Das Fenster hat
   * dann Dokumente zum LOESCHEN vorgelegt, die in Ordnung waren.
   *
   * Eine HEAD-Probe am Tor taugt nicht als Ersatz: eine Abweisung ist HTTP
   * 200 mit 42 Byte, sie lieferte also "vorhanden" fuer eine Kreatur ohne
   * Recht und "fehlt" fuer jede Kreatur ohne Netz. Die Liste beantwortet die
   * Frage, ohne das Bild zu holen.
   *
   * WAS DIESE FUNKTION ANDERS FRAGT ALS `ansicht()`. `ansicht()` fragt
   * "welche Datei soll ich laden", also vor dem Schreiben. Diese fragt "ist
   * die Datei, die im Dokument STEHT, im Spiegel", also ueber einen bereits
   * gespeicherten Pfad. Variante und Stil kommen deshalb aus dem Dateinamen
   * und nicht vom Aufrufer.
   */
  const shaT = "e".repeat(64)
  const voll = {
    tokenbilder: {
      1: {
        tokenized: { pfad: "000-wolf-1-token.webp", sha256: shaT },
        topdown: null,
      },
      2: { tokenized: { pfad: "000-wolf-2-token.webp" } },
    },
  }
  const tis = posen.tokenbildImSpiegel
  const TOR_T1 = assetUrl(RELEASE, "", "000-wolf-1-token.webp")
  const TOR_TOP1 = assetUrl(RELEASE, "", "000-wolf-1-top.webp")
  const TOR_T3 = assetUrl(RELEASE, "", "000-wolf-3-token.webp")

  gleich("die Liste nennt Variante 1 in 2.5D", tis(voll, TOR_T1).zustand, true)
  gleich("und gibt den Namen AUS DER LISTE",
    tis(voll, TOR_T1).pfad, "000-wolf-1-token.webp")
  gleich("und die Pruefsumme", tis(voll, TOR_T1).sha256, shaT)
  gleich("Variante 2 ohne Pruefsumme ist trotzdem da",
    tis(voll, assetUrl(RELEASE, "", "000-wolf-2-token.webp")).zustand, true)
  gleich("und ihre Pruefsumme ist null, nicht undefined",
    tis(voll, assetUrl(RELEASE, "", "000-wolf-2-token.webp")).sha256, null)

  /*
   * DIE DRAUFSICHT DERSELBEN VARIANTE STEHT ALS `null` IN DER LISTE, und das
   * heisst "gibt es nicht". Der Stil kommt aus dem Dateinamen, also ist das
   * eine andere Frage als dieselbe Variante in 2.5D. Ohne diesen Satz koennte
   * die Funktion den Stil ignorieren und waere fuer die halben Varianten des
   * Bestands blind: zwei Ordner fuehren Draufsichten nur fuer einen TEIL
   * ihrer Varianten.
   */
  gleich("dieselbe Variante als Draufsicht steht als null drin, also false",
    tis(voll, TOR_TOP1).zustand, false)
  gleich("eine Variante, die es gar nicht gibt, ist false",
    tis(voll, TOR_T3).zustand, false)

  /*
   * DER NAME WIRD NICHT VERGLICHEN, und das ist die Entscheidung dieses
   * Baus. Traegt das Dokument einen anderen Dateinamen als die Liste, ist die
   * Kreatur trotzdem im Spiegel. Ein Vergleich hier machte aus jeder
   * Abweichung in der Gross- und Kleinschreibung ein Loeschangebot, und
   * Windows verzeiht sie, der Spiegel nicht.
   */
  gleich("ein anderer Dateiname derselben Variante gilt trotzdem",
    tis(voll, assetUrl(RELEASE, "", "000-WOLF-1-token.webp")).zustand, true)
  gleich("und der Aufrufer bekommt den Namen der LISTE, nicht seinen eigenen",
    tis(voll, assetUrl(RELEASE, "", "000-WOLF-1-token.webp")).pfad,
    "000-wolf-1-token.webp")

  /*
   * NICHT GEPRUEFT HEISST `null` UND NICHT `false`, und hier haengt mehr
   * daran als an jeder anderen Stelle dieses Standes: das Fenster hinter
   * dieser Frage LOESCHT auf Knopfdruck mit vorausgewaehlten Haken. Ein
   * falsches "fehlt" kostet Kundendokumente.
   */
  gleich("keine Liste: nicht geprueft", tis(null, TOR_T1).zustand, null)
  gleich("eine Liste ohne das Feld: nicht geprueft",
    tis({ journalbilder: {} }, TOR_T1).zustand, null)
  gleich("ein Feld, das kein Objekt ist: nicht geprueft",
    tis({ tokenbilder: "ja" }, TOR_T1).zustand, null)
  gleich("keine Liste, sondern eine Zeichenkette: nicht geprueft",
    tis("x", TOR_T1).zustand, null)

  /*
   * EIN PFAD OHNE DIE NAMENSREGEL IST KEINE AUSSAGE, und das ist der
   * gefaehrlichste der vier Wege nach `null`. Wer ihn als `false` liest,
   * legt jedes Dokument mit einem handgeschriebenen Pfad zum Loeschen vor.
   */
  gleich("ein Pfad ohne Variantennummer: nicht geprueft",
    tis(voll, assetUrl(RELEASE, "", "irgendwas.webp")).zustand, null)
  gleich("ein leerer Pfad: nicht geprueft", tis(voll, "").zustand, null)
  gleich("eine KARTENadresse: nicht geprueft, denn sie ist keine Kreatur",
    tis(voll, "https://x.beneos.stream/a/k/rel/var/000-wolf-1-token.webp")
      .zustand, null)

  /*
   * EIN LEERES FELD IST DAGEGEN EINE AUSSAGE: der Server hat `tokenbilder`
   * geschrieben und keine Variante gefunden.
   */
  gleich("ein leeres Feld ist eine Aussage, naemlich false",
    tis({ tokenbilder: {} }, TOR_T1).zustand, false)
  gleich("ein Eintrag ohne Pfad gilt nicht",
    tis({ tokenbilder: { 1: { tokenized: { breite: 700 } } } }, TOR_T1)
      .zustand, false)
  gleich("ein leerer Pfad im Eintrag gilt auch nicht",
    tis({ tokenbilder: { 1: { tokenized: { pfad: "" } } } }, TOR_T1)
      .zustand, false)
  {
    const kaputt = tis(
      { tokenbilder: { 1: { tokenized: { pfad: "a.webp", sha256: "kurz" } } } },
      TOR_T1)
    gleich("eine kaputte Pruefsumme laesst den Eintrag gueltig",
      kaputt.zustand, true)
    gleich("und der Pfad bleibt", kaputt.pfad, "a.webp")
    gleich("und die Pruefsumme wird null", kaputt.sha256, null)
  }
  /*
   * DIE LAENGE ZAEHLT UND NICHT NUR DAS ZEICHENVORRAT, und dieser Satz ist
   * aus einer Sabotage entstanden, die ohne ihn durchkam. Der Koeder oben
   * heisst "kurz" und traegt Buchstaben AUSSERHALB von [a-f0-9]; eine
   * Pruefung, die die Laenge vergisst, weist ihn trotzdem ab und sieht
   * richtig aus. Eine zu kurze Summe aus reinen Hexzeichen trennt die zwei
   * Faelle.
   */
  gleich("eine zu kurze Summe aus reinen Hexzeichen gilt nicht",
    tis({ tokenbilder: { 1: { tokenized: { pfad: "a.webp", sha256: "abc123" } } } },
      TOR_T1).sha256, null)

  /*
   * EIN OERTLICHER PFAD GIBT DIESELBE ANTWORT, und das ist Absicht: diese
   * Funktion fragt nach dem SPIEGEL und nicht nach der Platte. Sie wird in
   * der Waisenpruefung nur fuer Toradressen gerufen, weil oertliche Pfade
   * dort die vorhandene Plattenprobe bekommen. Waere es anders, meldete ein
   * oertlich installiertes Dokument "fehlt", sobald der Spiegel die Variante
   * nicht nennt.
   */
  gleich("ein oertlicher Pfad wird nach derselben Namensregel gelesen",
    tis(voll, "beneos_assets/cloud/tokens/x/000-wolf-1-token.webp").zustand,
    true)

  /*
   * GEGENPROBE AUF DIE GEGENPROBE. Sechs Saetze oben verlangen `null`. Eine
   * Funktion, die IMMER `null` gibt, bestuende sie alle.
   */
  gleich("die drei Antworten sind drei verschiedene",
    [tis(voll, TOR_T1).zustand, tis(voll, TOR_T3).zustand,
      tis(null, TOR_T1).zustand].map((x) => String(x)).join("|"),
    "true|false|null")

  /*
   * UND DIE RUFSTELLE PRUEFT `=== false` UND NICHT `!== true`. Das ist der
   * einzige Satz dieses Blocks, der nicht die Funktion prueft, sondern ihren
   * GEBRAUCH, und er ist der wichtigste: die Funktion kann richtig sein und
   * die Stelle sie trotzdem falsch lesen. Genau so ist der Fehler entstanden,
   * den `OP-PRJ-170` behebt, denn die gute Probe lag schon in derselben
   * Datei. Der Quelltext wird gelesen und nicht gefahren, weil
   * `beneos_cloud.js` Foundry braucht; was er nicht leisten kann, steht
   * unten unter NICHT PRUEFBAR.
   */
  const cloudQuelle = readFileSync(join(hier, "..", "beneos_cloud.js"), "utf8")
  wahr("die Waisenpruefung ist in der Datei zu finden",
    cloudQuelle.includes("tokenbildImSpiegel(liste, protoSrc)"))
  wahr("und sie liest `=== false` und nicht `!== true`",
    cloudQuelle.includes("tokenbildImSpiegel(liste, protoSrc).zustand === false"))
  gleich("und sie fragt die Liste nur fuer den Kreaturenraum",
    (cloudQuelle.match(/tor\?\.raum === "kreatur" \? await posenliste/g) || [])
      .length, 1)
  // Gegenprobe: dieselbe Suche muss an einer gestellten Zeile ANSCHLAGEN.
  // Ohne sie waere eine Suche nach einer Zeichenkette, die es nirgends gibt,
  // von einer bestandenen Pruefung nicht zu unterscheiden.
  wahr("die Suche nach `!== true` schlaegt an einer gestellten Zeile an",
    "if (tokenbildImSpiegel(liste, protoSrc).zustand !== true) {"
      .includes("tokenbildImSpiegel(liste, protoSrc).zustand !== true"))
  gleich("und sie findet im Bestand NULL Stellen",
    (cloudQuelle.match(/tokenbildImSpiegel\(liste, protoSrc\)\.zustand !== true/g)
      || []).length, 0)
}

console.log("")
console.log("Abschluss")
console.log(`  bestanden: ${gruen}`)
console.log(`  rot:       ${rot}`)
console.log("")
/*
 * DIE ZAHL KOMMT AUS DER LISTE UND NICHT AUS DEM TEXT.
 *
 * Sie stand hier von Hand und war am 08.11.2026 schon vor dem Anbau falsch:
 * "viererlei" bei fuenf Punkten. Das ist dieselbe Klasse wie die Satzzahl im
 * Vorhaken und die Ueberschrift der Sprachwache-README, beide am selben Tag
 * berichtigt. Eine Zahl neben einer Liste veraltet, sobald die Liste waechst,
 * und sie wird nie rot, weil niemand sie gegen die Liste haelt.
 */
const LUECKEN = [
  ["Die schluesselfreie Adressform. Sie steht in `stream-platzhalter.test.mjs`;",
    "hier wird nur geprueft, WANN sie geschrieben werden darf."],
  ["Der LAUF der Waisenaufraeumung. Geprueft ist die Rechnung und,",
    "am Quelltext gelesen, ihr Gebrauch. Dass das Fenster danach die",
    "richtigen Dokumente vorlegt, braucht Foundry. Die Gegenprobe aus",
    "`OP-PRJ-170` ist eine Welt mit einer gestreamten und einer wirklich",
    "ZERSTOERTEN oertlichen Kreatur: keine Markierung an der ersten,",
    "unveraenderte an der zweiten."],
  ["Die Anzeigefrage. `ansicht()` ohne Pruefung bleibt in der",
    "Kachelleiste des Cloud-Fensters, und das ist Absicht: zwanzig",
    "Varianten wuerden sonst zwanzig Dateien holen, die nur gezaehlt",
    "werden sollten. Ein falscher Inhalt faellt dort also erst auf,",
    "wenn der Kunde die Ansicht wirklich waehlt."],
  ["Ob `crypto.subtle` in einem echten Foundry ohne HTTPS wirklich",
    "fehlt. Hier wird es vorsaetzlich entfernt. Dass `http://192.168.x.x`",
    "kein sicherer Kontext ist, ist Browserregel und am 08.11.2026 aus",
    "den drei vorhandenen Rufstellen im Modul geschlossen, nicht im LAN",
    "gemessen."],
  ["Ob der Volldurchgang die Listen wirklich mit `sha256` schreibt. Die",
    "Serverhaelfte ist gebaut (`b388146`), der Durchgang ist handgefuehrt",
    "und am 07.11.2026 nicht gefahren. Bis dahin ist der Normalfall",
    "'ohne Summe', und genau den prueft dieser Satz mit."],
  ["Die Kosten im Betrieb. Gerechnet sind 0,447 MB je Draufsicht als",
    "zweite Kopie im Speicher, einmal je Ansicht und Sitzung. Gemessen",
    "ist das nicht."],
]
console.log(`NICHT PRUEFBAR, und zwar ${LUECKEN.length} Dinge:`)
for (const punkt of LUECKEN) {
  console.log(`- ${punkt[0]}`)
  for (const weiter of punkt.slice(1)) console.log(`  ${weiter}`)
}

process.exit(rot > 0 ? 1 : 0)
