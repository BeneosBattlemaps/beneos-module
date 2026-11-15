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
 * DER ECHTE CODE, OHNE KOPIE. Bis zum 14.11.2026 schrieb dieser Satz eine
 * Kopie von `stream-posen.mjs` mit einem Stub statt `headCheck`, weil die
 * Importkette in Node abriss, und er las die Rufstellen in
 * `beneos_utility.js` und `beneos_cloud.js` als Text (Befund B6 der
 * Stream-Inventur). Seit stre-T-017 stellt `tools/lib/foundry-attrappe.mjs`
 * die Foundry-Globalen, die Kette laedt, und der Satz ruft:
 *
 *   - `stream-posen.mjs` direkt, mit dem echten `headCheck` gegen das
 *     gestellte Netz,
 *   - die vier Rufstellen ueber ihre echten Methoden:
 *     `BeneosUtility.toggleTokenStyle`, `BeneosUtility.forceChangeToken`,
 *     `BeneosCloud#drainPendingCanvasDrops`, `BeneosCloud#runOrphanCleanup`.
 *     Beobachtet wird, was sie schreiben und melden.
 *
 * Text liest er nur noch fuer zwei Aussagen, die selbst strukturell sind:
 * "die Pruefung haengt nicht in der Abrufschicht" und "die ungepruefte Form
 * wird an den schreibenden Stellen nicht gerufen". Beide stehen als
 * Strukturprobe und werden getrennt gezaehlt.
 *
 * WAS DIESER SATZ NICHT PRUEFT, und es steht auch im Abschlussblock: die
 * Anzeigefrage. `ansicht()` bleibt ungeprueft, und das ist Absicht, keine
 * Luecke. Eine Kachelleiste mit zwanzig Varianten wuerde sonst zwanzig
 * Dateien holen, die sie nur zaehlen wollte.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { webcrypto } from "node:crypto"
import { pruefstand, installiereFoundry, netz, nimmAbrufe, meldungen } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, struktur, abschnitt, ende } = pruefstand("stream-posen, am echten Code und an seinen Rufstellen")
const wahr = (name, bedingung) => gleich(name, !!bedingung, true)
// Ein eigener Namensraum fuer einen Block, dessen Fragen anderswo gleich lauten.
const gleichMit = (praefix) => (name, ist, soll) => gleich(`${praefix}: ${name}`, ist, soll)
const hier = dirname(fileURLToPath(import.meta.url))

/*
 * DIE EINSTELLUNGSNAMEN WERDEN IMPORTIERT UND NICHT GERATEN.
 *
 * Das ist die Lehre aus `OP-PRJ-184`: dort hiess der erste Entwurf
 * `SETTING.gateBase`, der echte Name ist `base`, und die Adresse trug ein
 * LEERES Schluesselsegment. Deshalb kommt `SETTING` aus dem Modul, und die
 * erwarteten Adressen werden mit `assetUrl` GEBILDET statt getippt.
 */
const GATE = "https://gate.beneos.stream"
const SCHLUESSEL = "pk_pruefsatz"
const { SETTING } = await import("./stream-settings.mjs")
// `SETTING.mode` seit stre-T-102: die Inhaltspruefung holt die schluesselfreie
// Form ueber `leinwandAdresse`, und die setzt nur bei laufendem Streaming ein.
installiereFoundry({ einstellungen: { [SETTING.key]: SCHLUESSEL, [SETTING.base]: GATE, [SETTING.mode]: true } })
const { assetUrl, platzhalterAdresse } = await import("./stream-settings.mjs")

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
// Das gestellte Netz. Toradressen antworten aus NETZ, oertliche Pfade (der
// echte `headCheck` fragt sie mit HEAD) aus PLATTE. Was in keiner Karte
// steht, ist 404 am Tor oder auf der Platte; jede andere Adresse ist ein
// fremder Abruf und macht den Satz rot. "Einmal je Sitzung geprueft" ist eine
// Zahl, und `nimmAbrufe()` liefert sie.
const NETZ = new Map()
const PLATTE = new Map()
netz((url) => {
  const schluessel = String(url).split("?")[0]
  const eintrag = NETZ.get(schluessel)
  if (eintrag) return new Response(eintrag.bytes, { status: 200, headers: eintrag.kopf || {} })
  if (schluessel.startsWith(`${GATE}/`)) return new Response("fehlt", { status: 404 })
  if (/^beneos_assets\//.test(decodeURIComponent(schluessel))) {
    const laenge = PLATTE.get(decodeURIComponent(schluessel))
    return laenge === undefined
      ? new Response("", { status: 404 })
      : new Response(null, { status: 200, headers: { "content-length": String(laenge), "content-type": "image/webp" } })
  }
  return undefined
})

const posen = await import("./stream-posen.mjs")
const { BeneosUtility } = await import("../beneos_utility.js")
const { BeneosCloud } = await import("../beneos_cloud.js")
const abrufZahl = () => nimmAbrufe().length


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
abschnitt("Drei Antworten, und jede einzeln")

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
const dreiErgebnisse = []
console.warn = (...a) => { dreimal.push(a.join(" ")) }
try {
  for (const a of [ADRESSE, ADRESSE_B, ADRESSE_C]) dreiErgebnisse.push(await posen.ansichtInhaltOk(a, SOLL))
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
gleich("alle drei gaben null zurueck", dreiErgebnisse.map(String).join("|"), "null|null|null")
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
abschnitt("Ohne Soll-Summe wird nicht geprueft, und das ist der Uebergangszustand")
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
nimmAbrufe()
gleich("ohne Soll-Summe gibt es null",
  await posen.ansichtInhaltOk(ADRESSE, null), null)
gleich("eine leere Summe ebenso", await posen.ansichtInhaltOk(ADRESSE, ""), null)
gleich("ohne Adresse ebenso", await posen.ansichtInhaltOk("", SOLL), null)
gleich("und keiner der drei Faelle hat etwas abgerufen", abrufZahl(), 0)

// ---------------------------------------------------------------------------
abschnitt("Einmal je Sitzung, und das ist eine Zahl")

posen.pruefungenVergessen()
nimmAbrufe()
await posen.ansichtInhaltOk(ADRESSE, SOLL)
await posen.ansichtInhaltOk(ADRESSE, SOLL)
await posen.ansichtInhaltOk(ADRESSE, SOLL)
gleich("drei Fragen, EIN Abruf", abrufZahl(), 1)

// Dieselbe Adresse mit einer ANDEREN Soll-Summe ist eine andere Frage. Ohne
// das wuerde eine neu geschriebene Liste einen alten Erfolg erben, und genau
// das darf nicht sein: der Spiegel kann denselben Namen mit neuem Inhalt
// tragen.
nimmAbrufe()
await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
gleich("andere Soll-Summe ist eine neue Frage", abrufZahl(), 1)

// Eine Abfrage an der Adresse darf keinen zweiten Eintrag machen. Der
// Schluessel laeuft deshalb durch `ohneAbfrage`.
nimmAbrufe()
await posen.ansichtInhaltOk(ADRESSE + "?v=2", SOLL)
gleich("dieselbe Adresse mit Abfrage trifft denselben Eintrag", abrufZahl(), 0)

// Auch ein MISSERFOLG wird gemerkt. Sonst fragt jede Bewegung der Figur
// erneut, und bei einem echten Fehler ist das eine Anfrage je Klick, also
// genau die Last, gegen die `stream-posen.mjs` angetreten ist.
posen.pruefungenVergessen()
nimmAbrufe()
await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
await posen.ansichtInhaltOk(ADRESSE, SOLL_FALSCH)
gleich("ein Misserfolg wird genauso gemerkt", abrufZahl(), 1)

// ---------------------------------------------------------------------------
abschnitt("ansichtGeprueft: wer schreibt, prueft")

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
/*
 * SEIT stre-T-102 SCHLUESSELFREI: jede Rufstelle schreibt diese Adresse in
 * ein Dokument. Geprueft wird trotzdem gegen die Datei am Tor, also mit
 * Schluessel; der Satz "Pruefung sagt true" belegt genau das.
 */
const ADRESSE_OHNE = platzhalterAdresse(RELEASE, "", "000-wolf-1-top.webp")
gleich("gutes Bild: die schluesselfreie Adresse kommt heraus", a.src, ADRESSE_OHNE)
wahr("und sie traegt keinen Schluessel", !String(a.src).includes(SCHLUESSEL))
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
gleich("ohne Summe in der Liste: Adresse kommt", a.src, ADRESSE_OHNE)
gleich("Pruefung null", a.pruefung, null)
gleich("Zustand bleibt true", a.zustand, true)

// Eine Summe der falschen FORM ist keine Summe. Ohne diesen Riegel wuerde
// `"ja"` oder `0` als Soll-Wert durchgehen und die Pruefung immer scheitern.
for (const kaputt of ["ja", "A".repeat(64), "a".repeat(63), "a".repeat(65), 42]) {
  const l = JSON.parse(JSON.stringify(LISTE_MIT))
  l.tokenbilder[1].topdown.sha256 = kaputt
  NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(l)) })
  posen.posenVergessen()
  const stummVorher = console.warn
  const gemeldet = []
  console.warn = (...x) => { gemeldet.push(x.join(" ")) }
  let r
  try { r = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown") } finally { console.warn = stummVorher }
  gleich(`Soll-Summe ${JSON.stringify(kaputt).slice(0, 12)} (Laenge ${String(kaputt).length}): es wird nichts geprueft und nichts gemeldet`, gemeldet.length, 0)
  gleich(`Soll-Summe ${JSON.stringify(kaputt).slice(0, 12)} (Laenge ${String(kaputt).length}) faellt auf nicht pruefbar`,
    r.pruefung, null)
  gleich(`Soll-Summe ${JSON.stringify(kaputt).slice(0, 12)} (Laenge ${String(kaputt).length}): die Adresse kommt trotzdem`, r.src, ADRESSE_OHNE)
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

// Eine Liste ohne das Feld `tokenbilder` ist keine Liste, sondern ein alter
// oder kaputter Stand: nicht geprueft, und nicht "gibt es nicht".
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify({ release: RELEASE, kennung: "000-wolf" })) })
posen.posenVergessen()
a = await posen.ansichtGeprueft(TOKEN_ADRESSE, "topdown")
gleich("eine Liste ohne tokenbilder: nicht geprueft statt gibt es nicht", a.zustand, null)

// ---------------------------------------------------------------------------
abschnitt("ansicht() gibt die Soll-Summe mit heraus")
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
/*
 * DIE RUFSTELLEN, GEFAHREN UND NICHT GELESEN.
 *
 * Die Faelle oben messen die Pruefung. Was sie nicht messen koennen, ist, ob
 * sie auch GERUFEN wird und ob ihre Antwort dort WIRKT: `ansichtGeprueft`
 * koennte vollkommen richtig sein und von niemandem benutzt werden. Diese
 * Luecke hat eine Sabotage am 08.11.2026 in `OP-PRJ-184` aufgedeckt. Bis zum
 * 14.11.2026 stand sie hier als Textsuche an den Rufstellen; seit stre-T-017
 * werden die vier Methoden gerufen, und beobachtet wird, was sie schreiben
 * und melden.
 *
 * Das gestellte Token traegt nur, was die Methoden lesen: Bildquelle,
 * Schreibrecht, `update` und `setFlag`. Was sie schreiben, landet in
 * `geschrieben`.
 */
const geschrieben = []
function stelleToken(id, src) {
  const actor = {
    getFlag: () => undefined,
    flags: {},
    update: async (daten) => { geschrieben.push({ wer: "actor", daten }) },
  }
  const token = {
    id,
    actor,
    document: {
      actorId: null,
      texture: { src },
      canUserModify: () => true,
      update: async (daten) => { geschrieben.push({ wer: "token", daten }) },
      setFlag: async () => {},
    },
  }
  globalThis.canvas = { tokens: { placeables: [token] }, hud: { token: { rendered: false } } }
  return token
}
const tokenSchrieb = () => geschrieben.filter((g) => g.wer === "token").map((g) => g.daten["texture.src"])
const warnTexte = () => meldungen.filter((m) => m.art === "warn").map((m) => m.text)
function frisch(liste) {
  NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(liste)) })
  posen.posenVergessen()
  posen.pruefungenVergessen()
  geschrieben.length = 0
  meldungen.length = 0
}

abschnitt("Der Stilwechsel (BeneosUtility.toggleTokenStyle) schreibt nur, was die Pruefung freigibt")

frisch(LISTE_MIT)
stelleToken("t1", TOKEN_ADRESSE)
await BeneosUtility.toggleTokenStyle("t1")
// Schluesselfrei seit stre-T-102: `ansicht()` nennt die Form, die geschrieben wird.
gleich("gute Summe: das Token bekommt die Draufsicht, schluesselfrei", tokenSchrieb().join(), ADRESSE_OHNE)
gleich("gute Summe: keine Warnung", warnTexte().length, 0)

frisch(LISTE_FALSCH)
stelleToken("t1", TOKEN_ADRESSE)
await BeneosUtility.toggleTokenStyle("t1")
gleich("falsche Summe: nichts wird geschrieben", geschrieben.length, 0)
gleich("falsche Summe: die Warnung ist der Inhaltstext und nicht der Fehlt-Text",
  warnTexte().join(), "BENEOS.TokenMenu.ViewContentMismatch")

frisch(LISTE_NULL)
stelleToken("t1", TOKEN_ADRESSE)
await BeneosUtility.toggleTokenStyle("t1")
gleich("Ansicht gibt es nicht: nichts wird geschrieben", geschrieben.length, 0)
gleich("Ansicht gibt es nicht: die Warnung ist der Fehlt-Text",
  warnTexte().join(), "BENEOS.TokenMenu.TopDownAssetMissing")

frisch(LISTE_OHNE)
stelleToken("t1", TOKEN_ADRESSE)
await BeneosUtility.toggleTokenStyle("t1")
gleich("ohne Summe in der Liste: die Draufsicht wird geschrieben", tokenSchrieb().join(), ADRESSE_OHNE)

// Keine Liste am Tor heisst "nicht geprueft": der Stilwechsel faellt auf den
// Textersatz von vor dem Umbau zurueck, statt "gibt es nicht" zu melden.
frisch(LISTE_MIT)
NETZ.delete(LISTE_ADRESSE)
stelleToken("t1", TOKEN_ADRESSE)
await BeneosUtility.toggleTokenStyle("t1")
/*
 * DER RUECKFALL SCHREIBT SCHLUESSELFREI (stre-T-102). Das Token traegt hier
 * die Toradresse mit Schluessel, so wie ein vorbereitetes Dokument sie seit
 * T-102 im Arbeitsspeicher haelt (`stream-leinwand.mjs`). Der Textersatz
 * bildet daraus die Draufsicht; ohne den Fang an der Schreibstelle stuende der
 * Schluessel danach im Token und im Prototyp des Akteurs, also im Export.
 */
const akteurSchrieb = () => geschrieben.filter((g) => g.wer === "actor").map((g) => g.daten["prototypeToken.texture.src"])
gleich("ohne Liste am Tor: der Textersatz wird geschrieben, schluesselfrei", tokenSchrieb().join(), ADRESSE_OHNE)
gleich("ohne Liste am Tor: der Prototyp bekommt dieselbe schluesselfreie Form", akteurSchrieb().join(), ADRESSE_OHNE)
gleich("ohne Liste am Tor: keine Fehlt-Warnung", warnTexte().length, 0)
// Die Gegenhaelfte, eine Adresse, die keine Streamadresse ist, geht
// zeichengleich durch: `stream-leinwand.test.mjs`, Block "Die Gegenrichtung".
// Hier nicht fahrbar, denn der oertliche Stilwechsel fragt die Platte, und die
// Attrappe hat keine.

abschnitt("Der Variantenwechsel (BeneosUtility.forceChangeToken) schreibt keine falsche Draufsicht")

// Das Token steht auf Draufsicht, der Zwischenspeicher kennt keine. Dann fragt
// der Wechsel die Liste, und zwar in der geprueften Form.
BeneosUtility.beneosTokens = { "000-wolf-1": { token: TOKEN_ADRESSE, fullId: "000-wolf-1" } }
frisch(LISTE_MIT)
stelleToken("t2", ADRESSE)
await BeneosUtility.forceChangeToken("t2", "000-wolf-1")
gleich("gute Summe: die Draufsicht der Variante wird geschrieben", tokenSchrieb().join(), ADRESSE_OHNE)

frisch(LISTE_FALSCH)
stelleToken("t2", ADRESSE)
await BeneosUtility.forceChangeToken("t2", "000-wolf-1")
gleich("falsche Summe: geschrieben wird 2.5D und nicht die falsche Draufsicht, schluesselfrei",
  tokenSchrieb().join(), platzhalterAdresse(RELEASE, "", "000-wolf-1-token.webp"))
gleich("falsche Summe: mit dem Inhaltstext", warnTexte().join(), "BENEOS.TokenMenu.ViewContentMismatch")

abschnitt("Der Wurf auf die Leinwand (BeneosCloud#drainPendingCanvasDrops) faellt auf 2.5D")

const cloud = new BeneosCloud()
const gesetzt = []
function stelleWurf() {
  const welt = {
    getFlag: () => ({ tokenKey: "000-wolf" }),
    prototypeToken: { texture: { src: TOKEN_ADRESSE } },
    getTokenDocument: async () => ({ toObject: () => ({}) }),
  }
  const szene = {
    createEmbeddedDocuments: async () => {
      gesetzt.push({ stil: BeneosUtility._pendingDropStyle, src: BeneosUtility._pendingDropSrc })
    },
  }
  game.actors = Object.assign([welt], { get: () => welt })
  game.scenes = new Map([["s1", szene]])
  game.packs = new Map()
  cloud.pendingCanvasDrops.set("000-wolf", [{ sceneId: "s1", variantIndex: 1, forceStyle: "topdown", x: 0, y: 0 }])
  gesetzt.length = 0
}

frisch(LISTE_MIT)
stelleWurf()
await cloud.drainPendingCanvasDrops("000-wolf")
gleich("gute Summe: die Figur kommt als Draufsicht", gesetzt.map((g) => `${g.stil}|${g.src}`).join(), `topdown|${ADRESSE_OHNE}`)

frisch(LISTE_FALSCH)
stelleWurf()
await cloud.drainPendingCanvasDrops("000-wolf")
gleich("falsche Summe: die Figur kommt als 2.5D ohne Draufsichtadresse",
  gesetzt.map((g) => `${g.stil}|${g.src}`).join(), "tokenized|null")

abschnitt("Die Waisenpruefung (BeneosCloud#runOrphanCleanup) fragt die Liste und liest nur false als fehlt")

// Das Fenster hinter dieser Pruefung LOESCHT auf Knopfdruck mit
// vorausgewaehlten Haken. Ein falsches "fehlt" kostet Kundendokumente, darum
// zaehlt nur `zustand === false`, und `null` (nicht geprueft) laesst durch.
const vorgelegt = []
foundry.applications.api.DialogV2 = { wait: async (o) => { vorgelegt.push(o.content); return null } }
function stelleWaisen(src) {
  const doc = {
    name: "Wolf",
    _source: { folder: null },
    folder: { id: "f" },
    prototypeToken: { texture: { src } },
    getFlag: () => undefined,
  }
  game.packs = new Map([["world.beneos_module_actors", { getDocuments: async () => [doc], folders: new Map() }]])
  game.actors = Object.assign([], { get: () => null })
  vorgelegt.length = 0
}
const fehltGemeldet = () => vorgelegt.join("").includes("BENEOS.Cleanup.IssueMissingFiles")

frisch(LISTE_MIT)
stelleWaisen(TOKEN_ADRESSE)
await cloud.runOrphanCleanup()
gleich("die Liste nennt die Variante: nichts wird vorgelegt", vorgelegt.length, 0)

const LISTE_OHNE_VARIANTE = { ...LISTE_MIT, tokenbilder: {} }
frisch(LISTE_OHNE_VARIANTE)
stelleWaisen(TOKEN_ADRESSE)
await cloud.runOrphanCleanup()
gleich("die Liste nennt die Variante nicht: als fehlend vorgelegt", fehltGemeldet(), true)

// Keine Liste am Tor: nicht geprueft, also KEIN Loeschangebot.
NETZ.delete(LISTE_ADRESSE)
posen.posenVergessen()
stelleWaisen(TOKEN_ADRESSE)
await cloud.runOrphanCleanup()
gleich("ohne Liste am Tor: nichts wird vorgelegt", vorgelegt.length, 0)

// Eine Kartenadresse ist keine Kreatur: die Liste wird gar nicht gefragt.
frisch(LISTE_OHNE_VARIANTE)
const KARTE = assetUrl("beneos_bm_0113", "default", "000-wolf-1-token.webp")
stelleWaisen(KARTE)
nimmAbrufe()
await cloud.runOrphanCleanup()
gleich("eine Kartenadresse fragt keine Posenliste",
  nimmAbrufe().filter((a) => a.adresse.includes("_posen.json")).length, 0)
gleich("und wird nicht als fehlend vorgelegt", vorgelegt.length, 0)

// ---------------------------------------------------------------------------
abschnitt("Strukturproben: wo die Pruefung haengt und wo die ungepruefte Form fehlt")
/*
 * Zwei Aussagen, die kein Aufruf zeigen kann: dass eine Datei etwas NICHT
 * enthaelt. Gezaehlt wird im reinen Code ohne Kommentare, denn die Kommentare
 * daneben nennen die gesuchten Namen.
 */
function nurCode(js) {
  return String(js)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(z => z.replace(/\/\/.*$/, "")).join("\n")
}
const posenQuelle = readFileSync(join(hier, "stream-posen.mjs"), "utf8")
struktur("der Kommentarfilter laesst Code stehen", nurCode(posenQuelle).includes("export async function ansichtGeprueft"), true)
struktur("der Kommentarfilter nimmt Kommentare weg", nurCode(posenQuelle).includes("zweite Wahrheit"), false)
struktur("die Pruefung haengt NICHT in der allgemeinen Abrufschicht",
  nurCode(readFileSync(join(hier, "stream-fetch.mjs"), "utf8")).includes("ansichtInhaltOk"), false)
// Dass `ansichtGibtEs` bleibt, ist richtig: es ist die Anzeigefrage.
struktur("beneos_utility.js ruft die ungepruefte Form nicht",
  /[^A-Za-z]ansicht\s*\(/.test(nurCode(readFileSync(join(hier, "..", "beneos_utility.js"), "utf8"))), false)
struktur("beneos_cloud.js ruft die ungepruefte Form nicht",
  /[^A-Za-z]ansicht\s*\(/.test(nurCode(readFileSync(join(hier, "..", "beneos_cloud.js"), "utf8"))), false)

// ---------------------------------------------------------------------------
abschnitt("Der Textbaustein steht in allen Sprachen")
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
NETZ.set(LISTE_ADRESSE, { bytes: bytesVon(JSON.stringify(LISTE_MIT)) })


abschnitt("Das Journalbild streamt nur, wenn die Liste es nennt")
{
  // Eigener Namensraum: die Waisenpruefung unten stellt dieselben Fragen.
  const gleich = gleichMit("Journal")
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


abschnitt("Die Waisenpruefung fragt die Liste und nicht das Tor")
{
  const gleich = gleichMit("Waise")
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

  // Die Rufstelle, die diese Antwort liest (die Waisenpruefung in
  // `beneos_cloud.js`), wird oben im Abschnitt "Die Waisenpruefung" GEFAHREN:
  // `null` legt nichts vor, nur `false` legt vor. Bis zum 14.11.2026 stand
  // hier eine Textsuche nach `=== false`.
}

/*
 * DIE ZAHL KOMMT AUS DER LISTE UND NICHT AUS DEM TEXT.
 *
 * Sie stand hier von Hand und war am 08.11.2026 schon vor dem Anbau falsch:
 * "viererlei" bei fuenf Punkten. Eine Zahl neben einer Liste veraltet, sobald
 * die Liste waechst, und sie wird nie rot, weil niemand sie gegen die Liste
 * haelt.
 */
const LUECKEN = [
  ["Die schluesselfreie Adressform. Sie steht in `stream-platzhalter.test.mjs`;",
    "hier wird nur geprueft, WANN sie geschrieben werden darf."],
  ["Was nach dem Vorlegen geschieht. Gefahren ist die Waisenpruefung bis",
    "zum Inhalt des Fensters; Loeschen und Neuverknuepfen nach dem Klick",
    "braucht Foundry. Die Gegenprobe aus `OP-PRJ-170` ist eine Welt mit",
    "einer gestreamten und einer wirklich ZERSTOERTEN oertlichen Kreatur."],
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
  ["Wie Foundry das Token, die Szene und das Fenster wirklich zeichnet.",
    "Die Rufstellen laufen gegen gestellte Dokumente."],
]
console.log(`\nNICHT PRUEFBAR, und zwar ${LUECKEN.length} Dinge:`)
for (const punkt of LUECKEN) {
  console.log(`- ${punkt[0]}`)
  for (const weiter of punkt.slice(1)) console.log(`  ${weiter}`)
}
ende()
