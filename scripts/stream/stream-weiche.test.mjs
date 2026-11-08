/**
 * stream-weiche.test.mjs
 *
 * Gegenprobe zu `buildStreamPack()` in `stream-install.mjs`. Laeuft ohne
 * Foundry, ohne Netz und ohne Browser:
 *
 *   node scripts/stream/stream-weiche.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. `buildStreamPack` ist die Weiche der ganzen
 * Auslieferung: sie entscheidet je Datei, ob sie auf die Platte des Kunden
 * geschrieben wird oder eine Adresse bleibt. Gemessen ueber die fuenfzehn
 * Betapakete gehen 18,98 GB an den Rand, 0,03 GB in den geteilten Raum,
 * 0,38 GB auf die Platte und 0,01 GB nirgendwohin. Trotzdem hing sie am
 * 2026-11-08 in NULL von sieben Streamsaetzen. `OP-PRJ-052`.
 *
 * DER ANLASS WAR EINE EINZELNE ZAHL, und sie ist der Schwerpunkt hier:
 * `localMaxBytes`, das groesste einzelne Stueck, das dieser Lauf wirklich
 * schreibt. Die Vorabsonde des Installers fragt mit dieser Zahl den Server des
 * Kunden, ob er einen Koerper dieser Groesse annimmt
 * (`beneos-native-installer.mjs`, `#preflightSizeCheck`). Ist die Zahl zu
 * gross, wird ein Kunde abgewiesen, dessen Server jede Datei des Laufs
 * angenommen haette. Ist sie zu klein, laeuft der Abbruch mitten im Schreiben
 * statt vorher mit klarer Meldung.
 *
 * VIER STELLEN RUFEN `zaehleLokal`, und eine vergessene faellt nicht auf: die
 * Sonde probt dann einfach kleiner und meldet nichts. Deshalb hat jeder der
 * vier Zweige hier seinen eigenen Fall.
 *
 * Die Haelfte der Faelle sind Gegenfaelle. Ohne sie waere der Satz eine
 * Behauptung.
 */
import { buildStreamPack, applyStreamAddresses } from "./stream-install.mjs"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HIER = dirname(fileURLToPath(import.meta.url))
const INSTALLER = join(HIER, "..", "cloud-v2", "beneos-native-installer.mjs")

/*
 * Die Einstellungen kommen aus dem Modul, nicht aus getippten Namen.
 *
 * Begruendung aus der Lehre von `stream-posen.test.mjs`: dort waren am
 * 2026-11-07 vierzehn Faelle rot, weil der Stub den Namen
 * `beneos-stream-gate-base` erfunden hatte und `game.settings.get` daraufhin
 * die leere Zeichenkette gab. `assetUrl` fiel auf die Vorgabeadresse, und der
 * Satz prueft dann die Vorgabe statt die Funktion.
 *
 * Deshalb kommt `SETTING` aus dem Modul, und jede erwartete Adresse wird mit
 * `assetUrl` GEBILDET statt geschrieben. Eine geschriebene Adresse prueft
 * meine Tippgenauigkeit.
 */
const { SETTING, assetUrl, INSTALL_MODE } = await import("./stream-settings.mjs")

const GATE = "https://stream.beneos-battlemaps.com"
const SCHLUESSEL = "pk_pruefsatz"

// Zwei Schalter, die die Faelle unten umstellen. Beide sind echte
// Welteinstellungen, und beide aendern die Weiche grundlegend.
let modus = INSTALL_MODE.stream
let pinAn = true

globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return SCHLUESSEL
      if (name === SETTING.base) return GATE
      if (name === SETTING.mode) return true
      if (name === SETTING.installMode) return modus
      if (name === SETTING.pinStills) return pinAn
      return ""
    },
  },
  i18n: { localize: (s) => s, format: (s) => s },
}

/*
 * Ein Kartenname, der weder Kreatur noch Beute ist.
 *
 * `assetUrl` baut drei verschiedene Adressformen, je nach Praefix des
 * Release (`istKreatur`, `istBeute`). Ein Kartenname haelt die Faelle unten
 * auf der Kartenroute, und darum geht es hier: `buildStreamPack` ist der
 * Kartenweg.
 */
const REL = "beneos_bm_pruefsatz"
const VAR = "4k"

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll)
  if (ok) {
    gruen++
    console.log(`  ok   ${name}`)
  } else {
    rot++
    console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`)
  }
}

function wahr(name, bedingung, hinweis = "") {
  if (bedingung) {
    gruen++
    console.log(`  ok   ${name}`)
  } else {
    rot++
    console.log(`  ROT  ${name}${hinweis ? "\n       " + hinweis : ""}`)
  }
}

/** Ein Manifesteintrag mit den Vorgaben, die der Manifestbauer wirklich setzt. */
function e(key, role, bytes, extra = {}) {
  return { key, role, bytes, sha256: "x".repeat(64), pin: false, ...extra }
}

/** Die Weiche einmal fahren, mit den gesetzten Schaltern. */
function fahre(eintraege) {
  return buildStreamPack({ entries: eintraege }, REL, VAR)
}

/*
 * Die Warnung des unbekannten Zweigs wird gefangen statt ausgeblendet.
 *
 * Sie ist eine Zusage im Quelltext ("beides gehoert gesagt"), also gehoert sie
 * geprueft und nicht weggeworfen. Nebenbei bleibt die Ausgabe des Satzes
 * lesbar.
 */
const warnungen = []
const echteWarnung = console.warn
console.warn = (...a) => { warnungen.push(a.join(" ")) }

// ===========================================================================
console.log("Die Zahl, um die es geht: das GROESSTE Stueck, nicht die Summe")
{
  modus = INSTALL_MODE.stream
  pinAn = true

  const a = fahre([e("a.webp", "local", 100), e("b.webp", "local", 500), e("c.webp", "local", 200)])
  gleich("drei lokale Dateien: die Summe ist 800", a.localBytes, 800)
  gleich("drei lokale Dateien: das Maximum ist 500", a.localMaxBytes, 500)

  // Ein Maximum, das nur den ersten Eintrag sieht, waere gruen geblieben.
  const b = fahre([e("a.webp", "local", 500), e("b.webp", "local", 100)])
  gleich("das Maximum steht vorne und bleibt 500", b.localMaxBytes, 500)

  const c = fahre([e("a.webp", "local", 777)])
  gleich("eine einzige Datei: Summe und Maximum sind dieselbe Zahl", [c.localBytes, c.localMaxBytes], [777, 777])
}

// ===========================================================================
console.log("\nJeder der VIER Zweige, die lokal schreiben, zaehlt mit")
/*
 * DER KERN DIESES SATZES. Eine vergessene Rufstelle laesst die Sonde kleiner
 * proben als der Lauf schreibt, und das faellt nirgends auf: der Abbruch kommt
 * dann mitten im Schreiben und wird einzeln eingeordnet, statt vorher als eine
 * klare Meldung.
 */
{
  // 1. Der Pin-Zweig. Ein Standbild, das eine Szene zum Zeichnen braucht, wird
  //    bei eingeschaltetem Schalter heruntergeladen statt gestreamt.
  modus = INSTALL_MODE.stream
  pinAn = true
  const pin = fahre([e("still.webp", "edge", 4242, { pin: true })])
  gleich("Zweig 1, Pin: gezaehlt", pin.localMaxBytes, 4242)
  gleich("Zweig 1, Pin: als Pin verbucht", pin.pinned, 1)
  gleich("Zweig 1, Pin: landet in packInfo", pin.packInfo["data/assets/still.webp"], assetUrl(REL, VAR, "still.webp"))
  gleich("Zweig 1, Pin: NICHT am Rand gezaehlt", pin.edgeBytes, 0)

  // 2. Der Messmodus. Dort ist jede Datei lokal, auch die vom Rand.
  modus = INSTALL_MODE.download
  pinAn = true
  const dl = fahre([e("gross.webm", "edge", 99999)])
  gleich("Zweig 2, Download-Modus: gezaehlt", dl.localMaxBytes, 99999)
  gleich("Zweig 2, Download-Modus: nichts bleibt entfernt", dl.streamTargets.size, 0)
  gleich("Zweig 2, Download-Modus: der Schalter steht in der Rueckgabe", dl.download, true)

  // 3. Die Rolle `local`. Der Normalfall seit dem 2026-08-28: alles, was ein
  //    Actor- oder Item-Dokument als Bild nennt.
  modus = INSTALL_MODE.stream
  const lo = fahre([e("portrait.webp", "local", 5555)])
  gleich("Zweig 3, Rolle local: gezaehlt", lo.localMaxBytes, 5555)

  // 4. Eine Rolle, die dieses Modul nicht kennt. Herunterladen ist die
  //    richtige Ausfallrichtung, und sie muss mitgezaehlt werden, sonst probt
  //    die Sonde an genau der Datei vorbei, die der Lauf schreibt.
  warnungen.length = 0
  const un = fahre([e("neu.webp", "zukunft", 6666)])
  gleich("Zweig 4, unbekannte Rolle: gezaehlt", un.localMaxBytes, 6666)
  gleich("Zweig 4, unbekannte Rolle: landet in packInfo", un.packInfo["data/assets/neu.webp"], assetUrl(REL, VAR, "neu.webp"))
  wahr("Zweig 4, unbekannte Rolle: sie wird GESAGT, nicht verschluckt",
    warnungen.length === 1 && warnungen[0].includes("zukunft") && warnungen[0].includes("neu.webp"),
    `gemeldet wurde: ${JSON.stringify(warnungen)}`)

  // Ein Eintrag ohne jede Rolle faellt in denselben Zweig. Ein Tippfehler im
  // Manifestbauer sieht genau so aus.
  warnungen.length = 0
  const ohne = fahre([{ key: "nackt.webp", bytes: 7777 }])
  gleich("Zweig 4, Rolle fehlt ganz: gezaehlt", ohne.localMaxBytes, 7777)
  wahr("Zweig 4, Rolle fehlt ganz: auch das wird gesagt", warnungen.length === 1)
}

// ===========================================================================
console.log("\nDie Null, auf der der Fruehausgang der Sonde ruht")
/*
 * `#preflightSizeCheck` hat die Zeile `if (bekannt && gemessen === 0) return
 * { ok: true }`. Sie entscheidet, dass gar nicht sondiert wird. Ist diese Null
 * falsch, faellt eine echte Grenze des Kundenservers erst beim Schreiben auf.
 */
{
  modus = INSTALL_MODE.stream
  pinAn = true

  const nurRand = fahre([e("a.webm", "edge", 50000000), e("b.webm", "edge", 60000000)])
  gleich("ein reiner Streamlauf schreibt nichts: Maximum 0", nurRand.localMaxBytes, 0)
  gleich("ein reiner Streamlauf schreibt nichts: Summe 0", nurRand.localBytes, 0)
  // Gegenprobe: die Null darf nicht daran liegen, dass die Weiche nichts getan hat.
  gleich("und trotzdem sind beide Dateien am Rand verbucht", nurRand.edgeBytes, 110000000)
  gleich("und trotzdem stehen beide als entfernte Ziele", nurRand.streamTargets.size, 2)

  const leer = fahre([])
  gleich("leeres Manifest: Maximum 0", leer.localMaxBytes, 0)
  gleich("leeres Manifest: und es ist eine ZAHL, kein undefined", typeof leer.localMaxBytes, "number")

  const nurSkip = fahre([e("icons/x.svg", "skip", 1234)])
  gleich("nur nicht ausgelieferte Dateien: Maximum 0", nurSkip.localMaxBytes, 0)
  gleich("nur nicht ausgelieferte Dateien: als uebergangen verbucht", nurSkip.skipped, 1)
  gleich("nur nicht ausgelieferte Dateien: packInfo bleibt leer", Object.keys(nurSkip.packInfo).length, 0)
}

/*
 * Warum die Dokumentsammlung NICHT mitzaehlt, und das ist eine Entscheidung
 * und kein Versehen.
 *
 * Gemessen am 2026-11-08 in `#classifyPack`: nur `data/assets/...` wird als
 * Datei hochgeladen. `data/<X>.json` landet in `jsons` und wird als Dokument
 * in die Welt IMPORTIERT, nicht geschrieben. Die Sonde fragt nach der
 * Upload-Grenze eines Proxys, und ein Dokumentimport laeuft nicht durch den
 * Dateiweg.
 *
 * Dieser Fall steht hier, damit niemand `zaehleLokal` "der Vollstaendigkeit
 * wegen" in den Dokumentzweig setzt. Die Sonde wuerde dann nach einer Groesse
 * fragen, die nie hochgeht, und einen Kunden grundlos abweisen.
 */
console.log("\nDie Dokumentsammlung geht einen anderen Weg und zaehlt deshalb nicht")
{
  modus = INSTALL_MODE.stream
  const d = fahre([e("_docs/Scene.json", "doc", 9000000)])
  gleich("ein Dokument von 9 MB hebt das Maximum NICHT", d.localMaxBytes, 0)
  // Gegenprobe: die Null darf nicht daran liegen, dass der Eintrag verlorenging.
  wahr("und es ist trotzdem im Pack, sonst waere die Null ein Verlust",
    typeof d.packInfo["data/Scene.json"] === "string")
  wahr("Dokumente tragen einen Cache-Brecher, damit kein alter Randstand kommt",
    /\?t=\d+$/.test(String(d.packInfo["data/Scene.json"])),
    `die Adresse war: ${d.packInfo["data/Scene.json"]}`)
}

// ===========================================================================
console.log("\nEine kaputte Groessenangabe darf die Zahl nicht verseuchen")
/*
 * Der Manifestbauer schreibt `(int) ($f['s'] ?? 0)`, also immer eine Zahl.
 * Diese Faelle pruefen die Toleranz der Weiche, nicht den Bauer: eine Zahl,
 * die zu NaN wird, macht jeden Vergleich in der Sonde falsch, und NaN meldet
 * sich nicht.
 */
{
  modus = INSTALL_MODE.stream

  const fehlt = fahre([{ key: "a.webp", role: "local", sha256: "x" }])
  gleich("Groesse fehlt: Maximum 0", fehlt.localMaxBytes, 0)
  gleich("Groesse fehlt: Summe bleibt 0 und nicht NaN", fehlt.localBytes, 0)

  const unfug = fahre([e("a.webp", "local", "ziemlich gross"), e("b.webp", "local", 300)])
  gleich("Groesse ist Unfug: die Summe bleibt eine Zahl", unfug.localBytes, 300)
  gleich("Groesse ist Unfug: das Maximum bleibt die echte Datei", unfug.localMaxBytes, 300)

  const text = fahre([e("a.webp", "local", "500")])
  gleich("Groesse als Zeichenkette wird gelesen", text.localMaxBytes, 500)

  const negativ = fahre([e("a.webp", "local", -5)])
  wahr("eine negative Groesse hebt das Maximum nicht unter null",
    negativ.localMaxBytes === 0, `Maximum war ${negativ.localMaxBytes}`)
}

// ===========================================================================
console.log("\nDie Weiche selbst: fuenf Rollen, und jede geht woandershin")
{
  modus = INSTALL_MODE.stream
  pinAn = true

  const edge = fahre([e("v/karte.webm", "edge", 1000)])
  gleich("edge: steht als entferntes Ziel", [...edge.streamTargets.values()], [assetUrl(REL, VAR, "v/karte.webm")])
  // Der scharfe Teil: ein Eintrag in packInfo WUERDE heruntergeladen.
  gleich("edge: steht NICHT in packInfo, sonst wuerde er geholt", Object.keys(edge.packInfo).length, 0)

  const FREMD = "https://free.beneos-battlemaps.com/free/shared/abc/ton.ogg"
  const geteilt = fahre([e("ton.ogg", "shared", 2000, { url: FREMD })])
  gleich("shared: nimmt die Adresse aus dem Manifest", [...geteilt.streamTargets.values()], [FREMD])
  gleich("shared: am geteilten Raum verbucht", geteilt.sharedBytes, 2000)
  gleich("shared: nicht am Rand verbucht", geteilt.edgeBytes, 0)

  // Gegenfall: ohne Adresse wird keine geraten, sondern die des Release genommen.
  const ohneAdresse = fahre([e("ton.ogg", "shared", 2000)])
  gleich("shared ohne Adresse: faellt auf die Release-Adresse",
    [...ohneAdresse.streamTargets.values()], [assetUrl(REL, VAR, "ton.ogg")])
}

// ===========================================================================
console.log("\nDie beiden Schalter, und welcher den anderen schlaegt")
{
  // Der Pin-Zweig hat die Bedingung `!download && entry.pin && pinStillsEnabled()`.
  // Alle drei Teile bekommen ihren Gegenfall, sonst prueft der Fall oben nur
  // einen von drei.
  modus = INSTALL_MODE.stream
  pinAn = false
  const aus = fahre([e("still.webp", "edge", 4242, { pin: true })])
  gleich("Pin-Schalter aus: das Standbild bleibt am Rand", aus.pinned, 0)
  gleich("Pin-Schalter aus: und es wird nicht lokal gezaehlt", aus.localMaxBytes, 0)
  gleich("Pin-Schalter aus: es steht als entferntes Ziel", aus.streamTargets.size, 1)

  pinAn = true
  const ohnePin = fahre([e("v.webm", "edge", 4242)])
  gleich("Schalter an, aber die Datei ist kein Standbild: bleibt am Rand", ohnePin.pinned, 0)

  // Der Messmodus schlaegt den Pin-Zweig, denn dort ist alles lokal.
  modus = INSTALL_MODE.download
  const beides = fahre([e("still.webp", "edge", 4242, { pin: true })])
  gleich("Download-Modus schlaegt den Pin-Zweig: nicht als Pin verbucht", beides.pinned, 0)
  gleich("Download-Modus schlaegt den Pin-Zweig: trotzdem lokal gezaehlt", beides.localMaxBytes, 4242)

  // Auch im Messmodus wird die geteilte Adresse aus dem Manifest gelesen und
  // nicht gebildet, sonst holt der Lauf eine Datei von der falschen Stelle.
  const FREMD = "https://free.beneos-battlemaps.com/free/shared/abc/ton.ogg"
  const dlGeteilt = fahre([e("ton.ogg", "shared", 2000, { url: FREMD })])
  gleich("Download-Modus: shared wird von seiner eigenen Adresse geholt",
    dlGeteilt.packInfo["data/assets/ton.ogg"], FREMD)

  const dlGeteiltOhne = fahre([e("ton.ogg", "shared", 2000)])
  gleich("Download-Modus: shared ohne Adresse faellt auf die des Release",
    dlGeteiltOhne.packInfo["data/assets/ton.ogg"], assetUrl(REL, VAR, "ton.ogg"))
}

// ===========================================================================
console.log("\nDer Zielpfad im Weltverzeichnis, denn der zweite Durchgang sucht danach")
/*
 * `streamTargets` ist eine Zuordnung vom INSTALLIERTEN Pfad auf die Adresse.
 * Trifft der Pfad nicht, laeuft der zweite Durchgang still daran vorbei und
 * das Dokument behaelt eine Adresse, die niemand bedient.
 */
{
  modus = INSTALL_MODE.stream
  pinAn = true

  const quelle = fahre([e("beneos_assets/beneos_battlemaps/x/a.webm", "edge", 1)])
  gleich("der Autorenpfad wird auf den Installationsort umgeschrieben",
    [...quelle.streamTargets.keys()], ["beneos_assets/cloud/battlemaps/x/a.webm"])

  const fremd = fahre([e("worlds/autorenwelt/thumb.webp", "edge", 1)])
  gleich("was ausserhalb von beneos_assets liegt, kommt unter den Paketordner",
    [...fremd.streamTargets.keys()], ["beneos_assets/cloud/packaged/worlds/autorenwelt/thumb.webp"])

  const drin = fahre([e("beneos_assets/cloud/battlemaps/x/a.webm", "edge", 1)])
  gleich("was schon am Ziel liegt, bleibt unveraendert",
    [...drin.streamTargets.keys()], ["beneos_assets/cloud/battlemaps/x/a.webm"])

  const schraeg = fahre([e("/beneos_assets/cloud/battlemaps/x/a.webm", "edge", 1)])
  gleich("ein fuehrender Schraegstrich faellt weg",
    [...schraeg.streamTargets.keys()], ["beneos_assets/cloud/battlemaps/x/a.webm"])
}

// ===========================================================================
console.log("\nEin gemischter Lauf, wie er wirklich vorkommt")
{
  modus = INSTALL_MODE.stream
  pinAn = true
  warnungen.length = 0

  const alles = fahre([
    e("_docs/Scene.json", "doc", 400000),
    e("icons/eigen.svg", "skip", 1234),
    e("v/karte.webm", "edge", 50000000),
    e("still.webp", "edge", 180000, { pin: true }),
    e("ton.ogg", "shared", 2000, { url: "https://free.beneos-battlemaps.com/free/shared/abc/ton.ogg" }),
    e("portrait.webp", "local", 70000),
    e("gross_portrait.webp", "local", 310000),
  ])

  gleich("die Summe des Lokalen: Pin plus zwei Portraits", alles.localBytes, 180000 + 70000 + 310000)
  gleich("das Maximum ist das groesste EINZELNE Stueck", alles.localMaxBytes, 310000)
  gleich("der Rand traegt nur die Karte", alles.edgeBytes, 50000000)
  gleich("der geteilte Raum traegt nur den Ton", alles.sharedBytes, 2000)
  gleich("ein Eintrag wurde uebergangen", alles.skipped, 1)
  gleich("ein Eintrag ist ein Pin", alles.pinned, 1)
  gleich("zwei Dateien bleiben entfernt: Karte und Ton", alles.streamTargets.size, 2)
  gleich("vier Posten werden geschrieben: Dokument, Pin und zwei Portraits",
    Object.keys(alles.packInfo).sort(),
    ["data/Scene.json", "data/assets/gross_portrait.webp", "data/assets/portrait.webp", "data/assets/still.webp"])
  gleich("und keine Rolle war unbekannt", warnungen.length, 0)

  /*
   * Die Zahl, auf die es ankommt, in Worten: die Sonde fragt nach 310 KB und
   * nicht nach 2 MB. Ein Kunde hinter dem nginx-Standard von 1 MB laeuft
   * durch, obwohl er vorher abgewiesen wurde.
   */
  wahr("Nutzen in einem Satz: die Sonde fragt nach 310 KB statt nach 2 MB",
    alles.localMaxBytes < 2 * 1024 * 1024)
}

// ===========================================================================
console.log("\nDie Sonde selbst, als Quelltextprobe")
/*
 * WARUM NUR EINE QUELLTEXTPROBE. `beneos-native-installer.mjs` laesst sich in
 * Node nicht laden: der Dateikopf ruft `Hooks`, und das ist eine Foundry-Sache.
 * Gemessen am 2026-11-08: `Hooks is not defined`. Die ganze Importkette zu
 * stellen waere ein zweites Foundry.
 *
 * Eine Quelltextprobe ist schwaecher als ein Aufruf, und das steht hier
 * ausdruecklich. Sie faengt genau einen Fall, und das ist der wahrscheinliche:
 * dass jemand die feste Zahl wieder zur Probegroesse macht und damit den
 * Fehlalarm zurueckholt.
 */
{
  const q = readFileSync(INSTALLER, "utf8")

  wahr("die Sonde nimmt das Kleinere von gemessenem Stueck und fester Obergrenze",
    /Math\.min\(gemessen,\s*PREFLIGHT_SIZE_PROBE_BYTES\)/.test(q),
    "ohne Math.min probt die Sonde wieder die feste Zahl, und der Fehlalarm ist zurueck")

  wahr("ein Lauf, der nichts schreibt, wird nicht sondiert",
    /if\s*\(bekannt\s*&&\s*gemessen\s*===\s*0\)\s*return\s*\{\s*ok:\s*true\s*\}/.test(q))

  wahr("die Zahl kommt aus der Weiche und wird nicht im Installer gerechnet",
    /this\._localMaxBytes\s*=\s*built\.localMaxBytes/.test(q))

  wahr("die feste Zahl steht noch als Obergrenze von 2 MB",
    /PREFLIGHT_SIZE_PROBE_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/.test(q))

  // Gegenprobe auf die Probe selbst. Eine Suche, die nichts mehr findet, ist
  // von einer kaputten Suche nicht zu unterscheiden: alle vier Aussagen oben
  // waeren gruen, wenn die Datei leer gelesen worden waere.
  wahr("die Quelldatei wurde wirklich gelesen", q.length > 50000, `gelesen: ${q.length} Zeichen`)
  wahr("und ein Muster, das NICHT darin stehen darf, findet sich nicht",
    !/const groesse = PREFLIGHT_SIZE_PROBE_BYTES\s*$/m.test(q),
    "die feste Zahl ist wieder die Probegroesse")
}

// ===========================================================================
console.log("\napplyStreamAddresses(): ein Listenbild bleibt oertlich, OP-PRJ-149")
{
  /*
   * WARUM DIESE LAGE GEBRAUCHT WIRD, und warum sie heute nichts BEHEBT.
   *
   * `applyStreamAddresses()` schreibt rekursiv JEDEN String eines
   * Kundendokuments um und hing am 08.11.2026 in NULL Pruefsaetzen. Der ganze
   * Schutz der Felderregel lag auf dem Server: der Manifestbauer vergibt seit
   * dem 2026-08-28 die Rolle `local` fuer alles, was ein Actor- oder
   * Item-Dokument als Bild nennt, und damit kommt so eine Datei gar nicht in
   * `streamTargets`.
   *
   * EINE Stelle also, und sie liegt nicht dort, wo der Schaden entsteht. Diese
   * Lage fuettert die Funktion deshalb mit genau dem, was der Manifestbauer
   * heute nicht liefert: ein Listenbild als Toradresse. Was sie prueft, ist
   * nicht die heutige Lage, sondern dass die morgige nicht durchgeht.
   *
   * Der Schaden waere kein Darstellungsfehler: `Actor.img` und `Item.img`
   * REISEN BEIM EXPORT MIT. Gemessen in der Pruefwelt am 05.11.2026 trugen
   * sechs Felder `Actor.img` eine Toradresse samt Streamschluessel, und das
   * kam vom Kartenweg, nicht von den Kreaturen.
   */
  const PORTRAIT = "beneos_assets/cloud/tokens/pruef/pruef-1-avatar.webp"
  const LEINWAND = "beneos_assets/cloud/tokens/pruef/pruef-1-top.webp"
  const ziele = new Map([
    [PORTRAIT, assetUrl(REL, VAR, PORTRAIT)],
    [LEINWAND, assetUrl(REL, VAR, LEINWAND)],
  ])

  warnungen.length = 0
  const akteur = {
    name: "Pruefkreatur",
    img: PORTRAIT,
    prototypeToken: { texture: { src: LEINWAND } },
    items: [{ name: "Beutestueck", img: PORTRAIT }],
  }
  applyStreamAddresses(akteur, ziele)

  gleich("das Portrait in `img` bleibt der oertliche Pfad",
    akteur.img, PORTRAIT)
  gleich("das Symbol eines eingebetteten Gegenstands ebenso",
    akteur.items[0].img, PORTRAIT)

  /*
   * DIE GEGENPROBE IST DER WICHTIGERE SATZ. Eine Sperre, die alles sperrt,
   * sieht an den zwei Zeilen darueber genauso aus wie eine richtige, und sie
   * waere der Ausbau des Streamings: `prototypeToken.texture.src` ist der
   * Leinwandweg und geht nach Teil 3 A des Bauplans ausdruecklich ans Tor.
   */
  gleich("das Leinwandbild in `texture.src` geht ans Tor",
    akteur.prototypeToken.texture.src, assetUrl(REL, VAR, LEINWAND))

  // Die Meldung kommt, und das ist der halbe Zweck: ein stiller Riegel
  // verdeckt den Fehler im Manifest fuer immer.
  gleich("die Sperre meldet sich genau einmal", warnungen.length, 1)
  wahr("und nennt das Feld", warnungen[0].includes('Feld "img"'),
    warnungen[0] || "(keine Meldung)")
  wahr("und nennt den Pfad der Datei", warnungen[0].includes(PORTRAIT))

  /*
   * UND SIE NENNT DEN SCHLUESSEL NICHT. Das ist der sicherheitsrelevante Teil
   * dieser Lage und derselbe Fehler, der am 05.11.2026 im Meldekanal und am
   * 08.11.2026 in der Konsolenmaske steckte: wer eine Toradresse in einen Text
   * schreibt, schreibt den Streamschluessel mit, denn er ist das zweite
   * Pfadstueck. Eine Konsolenmitschrift ist genau das, was ein Kunde in einen
   * Supportkanal einfuegt.
   */
  wahr("die Meldung traegt den Streamschluessel NICHT",
    !warnungen[0].includes(SCHLUESSEL), warnungen[0] || "(keine Meldung)")
  wahr("und auch nicht die gebildete Toradresse",
    !warnungen[0].includes(assetUrl(REL, VAR, PORTRAIT)))

  // Zweimal dasselbe Feld: eine Meldung, nicht zwei.
  const zweiter = { img: PORTRAIT }
  applyStreamAddresses(zweiter, ziele)
  gleich("dieselbe Datei meldet sich nicht zweimal", warnungen.length, 1)
  gleich("gesperrt wird sie trotzdem", zweiter.img, PORTRAIT)
}

console.log("\napplyStreamAddresses(): die Sperre greift nur am Feldnamen")
{
  const PFAD = "beneos_assets/cloud/items/pruef/pruef-front.webp"
  const ziele = new Map([[PFAD, assetUrl(REL, VAR, PFAD)]])
  const TOR = assetUrl(REL, VAR, PFAD)

  warnungen.length = 0
  // Vier Felder, die ans Tor gehen MUESSEN. Ohne diese Zeilen waere nicht
  // belegt, dass die Sperre eng ist.
  const doku = {
    src: PFAD,
    thumb: PFAD,
    background: { src: PFAD },
    pages: [{ src: PFAD, text: { content: `<img src="${PFAD}">` } }],
  }
  applyStreamAddresses(doku, ziele)
  gleich("`src` geht ans Tor", doku.src, TOR)
  gleich("`thumb` geht ans Tor", doku.thumb, TOR)
  gleich("`background.src` geht ans Tor", doku.background.src, TOR)
  gleich("`src` einer Journalseite geht ans Tor", doku.pages[0].src, TOR)
  gleich("und die Adresse im eingebetteten HTML auch",
    doku.pages[0].text.content, `<img src="${TOR}">`)
  gleich("dabei meldet sich die Sperre nicht", warnungen.length, 0)

  /*
   * EIN `img`-FELD MIT HTML DARIN ist der Fall, bei dem die Sperre zu viel
   * koennte. Sie laesst den Wert ganz stehen, und das ist richtig: `img` ist
   * in Foundry durchgaengig ein Pfad und nie HTML. Waere es je HTML, waere ein
   * unveraenderter Wert immer noch die sichere Richtung, denn die Datei liegt
   * oertlich.
   */
  const mitHtml = { img: `<img src="${PFAD}">` }
  applyStreamAddresses(mitHtml, ziele)
  gleich("ein `img`-Feld mit HTML darin bleibt ganz unberuehrt",
    mitHtml.img, `<img src="${PFAD}">`)
  /*
   * DIESER SATZ WAR BEIM ERSTEN LAUF ROT, und er ist der Grund, warum die
   * Sperre heute vor beiden Wegen steht statt nur vor einem.
   *
   * Gebaut war sie zuerst IM Zweig `if (target)`. Dort deckte sie nur den
   * direkten Tausch. Ein `img`-Feld mit HTML darin faellt an
   * `gateAdresseFuer` vorbei, weil der ganze String kein Listenschluessel ist,
   * und landete im HTML-Umschreiben, das von der Sperre nichts wusste.
   * Gemessen am 08.11.2026 ging die Toradresse samt Streamschluessel dort
   * durch, waehrend die zehn Saetze darueber gruen blieben.
   *
   * `img` traegt in Foundry nie HTML, der Fall ist also keiner aus dem
   * Betrieb. Er ist der Fall, an dem sich zeigt, ob der Riegel den Feldnamen
   * schuetzt oder nur einen von zwei Wegen.
   */
  /*
   * UND SIE MELDET SICH NICHT, obwohl sie gegriffen hat. Das ist Absicht:
   * gemeldet wird nur, wenn an dieser Stelle wirklich eine Toradresse
   * entstanden waere. Jedes Portrait jeder Kreatur laeuft durch diese Zeile,
   * und eine Meldung je Portrait waere Rauschen, in dem der eine echte Fall
   * untergeht.
   */
  gleich("dabei meldet sich die Sperre weiterhin nicht", warnungen.length, 0)
}

console.log("\napplyStreamAddresses(): Quelltextprobe zur Sperrliste")
{
  const q = readFileSync(join(HIER, "stream-install.mjs"), "utf8")
    .replace(/\r\n/g, "\n")

  wahr("die Sperrliste steht im Bestand", /const FELDER_NIE = new Set\(/.test(q))

  // DIE LISTE SELBST, nicht ihr Umfeld. Ein Kommentarblock darueber nennt
  // `texture.src` ausdruecklich, und ein Satz, der das Umfeld liest, waere
  // dadurch rot, obwohl die Liste richtig ist.
  const m = /const FELDER_NIE = new Set\(\[([^\]]*)\]\)/.exec(q)
  wahr("und ist lesbar", !!m)
  const eintraege = m
    ? (m[1].match(/"([^"]+)"/g) || []).map((x) => x.slice(1, -1))
    : []
  gleich("sie nennt genau `img`", eintraege.join(","), "img")

  /*
   * DIE ZAHL IST DER SATZ. Ein fuenfter Feldname faellt sonst nicht auf, und
   * ein falscher waere der Ausbau des Streamings: stuende `src` darin, blieben
   * alle Journalbilder und alle Szenenhintergruende oertlich, und zwar
   * lautlos, denn die Sperre meldet nur bei einer Toradresse, die sie faengt.
   */
  wahr("und nichts, was ans Tor gehoert",
    !eintraege.includes("src") && !eintraege.includes("texture")
    && !eintraege.includes("thumb") && !eintraege.includes("path"))

  /*
   * DER FELDNAME WIRD WEITERGEGEBEN, und ohne diesen Satz waere die Sperre auf
   * jeder Ebene unter der ersten blind. Genau dort liegt `items[].img`.
   */
  wahr("die Rekursion gibt den Schluessel weiter",
    /applyStreamAddresses\(value\[k\], streamTargets, k\)/.test(q))
  wahr("und ein Array gibt sein Feld weiter",
    /applyStreamAddresses\(value\[i\], streamTargets, feld\)/.test(q))

  // Gegenprobe auf die Probe. Eine Suche, die nichts findet, ist von einer
  // kaputten Suche nicht zu unterscheiden.
  wahr("die Listensuche findet in einem Probetext",
    /const FELDER_NIE = new Set\(\[([^\]]*)\]\)/
      .test('const FELDER_NIE = new Set(["x"])'))
  wahr("und ein leeres Ergebnis waere aufgefallen", eintraege.length === 1,
    `gefunden: ${eintraege.length}`)
}

// ===========================================================================
console.warn = echteWarnung
console.log(`\n${gruen} gruen, ${rot} rot`)
process.exit(rot === 0 ? 0 : 1)
