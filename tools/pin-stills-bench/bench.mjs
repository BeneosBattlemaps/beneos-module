// Prueft, wohin `buildStreamPack()` die Bilder legt, die eine Szene zum
// Zeichnen braucht, und dass die ausgelieferte Vorgabe sie LOKAL legt.
//
// Hintergrund, 29.10.2026. Der Schalter `beneos-stream-pin-stills` stand auf
// aus, und das war fuer die Messphase richtig: die reine Form sollte gemessen
// werden, bevor ein Kompromiss gemacht wird. Die Erklaerung beim ersten
// Weltstart sagte aber die ganze Zeit woertlich "Every scene carries a still
// picture, so a lost connection costs motion and nothing else"
// (BENEOS.Stream.Intro.Cost). Mit dem Schalter auf aus war das Standbild selbst
// eine Toradresse. Der Satz war also nur wahr, solange der Zwischenspeicher sie
// noch hielt; eine Szene, die noch nie offen war, zeichnete ohne Verbindung GAR
// NICHTS. Betreiberentscheid vom selben Tag: Standbilder werden lokal
// heruntergeladen, damit nicht die ganze Oberflaeche leer bleibt, wenn die
// WebM-Dateien nicht kommen.
//
// Gemessen hat die Umstellung 1,78 Prozent gekostet, ueber zwoelf Releases:
// 110,1 MB Standbilder gegen 6.192,7 MB Video.
//
// WAS DIESER STAND MISST und was nicht. Gemessen wird die VERTEILUNG: landet
// ein vorgemerktes Bild in `packInfo` (wird also heruntergeladen) oder in
// `streamTargets` (bleibt eine Adresse). Die Adressrechnung selbst ist
// gestellt, denn `assetUrl` und `installedPath` haengen an Foundry-Globalen und
// ihre Form ist hier nicht die Frage.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Code
//   node bench.mjs --alt    faehrt gegen die alte Vorgabe und muss rot werden
//
// Kein Foundry und kein Netz noetig.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const INSTALL = join(HERE, "..", "..", "scripts", "stream", "stream-install.mjs")
const SETTINGS = join(HERE, "..", "..", "scripts", "stream", "stream-settings.mjs")

const installText = readFileSync(INSTALL, "utf8")
const settingsText = readFileSync(SETTINGS, "utf8")

const altModus = process.argv.includes("--alt")

/* ---------------------------------------------------------- Mini-Pruefstand */

let bestanden = 0
let gescheitert = 0

function ok(name, bedingung, detail = "") {
  if (bedingung) {
    console.log(`  ok   ${name}`)
    bestanden++
  } else {
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`)
    gescheitert++
  }
}

/* ------------------------------------- die ausgelieferte Vorgabe des Schalters */

/**
 * Liest `default:` aus dem register-Aufruf fuer `SETTING.pinStills`.
 *
 * Am Quelltext und nicht an einer Zweitschrift: eine Zahl im Pruefstand
 * veraltet lautlos, sobald jemand den Schalter umstellt, und dann prueft der
 * Stand seine eigene Erinnerung.
 */
function vorgabeAusQuelle(text) {
  const i = text.indexOf("SETTING.pinStills")
  if (i < 0) throw new Error("SETTING.pinStills nicht im Quelltext gefunden")
  const ende = text.indexOf("})", i)
  if (ende < 0) throw new Error("register-Aufruf fuer pinStills nicht abgeschlossen")
  const block = text.slice(i, ende)
  const treffer = block.match(/default:\s*(true|false)/)
  if (!treffer) throw new Error("kein default im register-Aufruf fuer pinStills")
  return treffer[1] === "true"
}

const vorgabe = vorgabeAusQuelle(settingsText)

/* ------------------------------------------- buildStreamPack ausfuehrbar machen */

/*
 * `buildProbe()` baut eine KLASSE und passt deshalb hier nicht:
 * `buildStreamPack` ist eine freie Funktion, und `export function` ist in einem
 * Klassenrumpf ein Syntaxfehler. Geschnitten wird trotzdem mit demselben
 * Werkzeug, damit der ECHTE Code laeuft und keine Abschrift.
 */
const geschnitten = extractMethod(installText, "buildStreamPack", { minZeilen: 60, maxZeilen: 200 })
  .replace(/^export\s+/, "")

const PRELUDE = `
  const DOC_DIR = "_docs/"
  const stripLeadSlash = (p) => String(p).replace(/^\\/+/, "")
  const installedPath = (p) => "beneos/" + stripLeadSlash(p)
  const assetUrl = (release, variant, key) => "https://tor/" + release + "/" + variant + "/" + key
  const downloadMode = () => STUB.download
  const pinStillsEnabled = () => STUB.pin
  const console = { warn: () => {} }
`

const fabrik = new Function("STUB", `${PRELUDE}\n${geschnitten}\nreturn buildStreamPack`)

function bauen({ pin, download }) {
  const manifest = {
    entries: [
      // Das Video einer Szene. Nie vorgemerkt, immer eine Adresse.
      { key: "maps/bm_0119_chasm.webm", role: "edge", bytes: 28_000_000, pin: false },
      // Sein Standbild. Vorgemerkt, denn ohne es zeichnet die Szene nichts.
      { key: "maps/bm_0119_chasm.webp", role: "edge", bytes: 760_000, pin: true },
      // Ein Portrait in der Seitenleiste. Immer lokal, auch im Streaming.
      { key: "tokens/goblin-avatar.webp", role: "local", bytes: 36_000, pin: false },
      // Ein modul-eigenes Symbol. Weder geholt noch umgeschrieben.
      { key: "icons/svg/aura.svg", role: "skip", bytes: 1_200, pin: false },
      // Ein Dokument. Geht immer in packInfo, mit Cache-Buster.
      { key: "_docs/Scene.json", role: "doc", bytes: 30_000, pin: false },
    ],
  }
  return fabrik({ pin, download })(manifest, "bm_0119", "4k")
}

const istLokal = (r, key) => Object.keys(r.packInfo).some((p) => p.endsWith(key))
const istAdresse = (r, key) => [...r.streamTargets.keys()].some((p) => p.endsWith(key))

/* ------------------------------------------------------------------ Aussagen */

console.log("\nDie ausgelieferte Vorgabe")

/*
 * Die eine Aussage, um die es bei der Umstellung geht. Mit --alt wird sie
 * gegen die alte Vorgabe gefahren und MUSS fallen; ohne diese Gegenprobe
 * saehe ein gruener Lauf gleich aus, egal wie der Schalter steht.
 */
const erwarteteVorgabe = !altModus
ok(`pinStills wird mit default ${erwarteteVorgabe} ausgeliefert`,
  vorgabe === erwarteteVorgabe,
  `Quelltext sagt ${vorgabe}`)

console.log("\nMit der Vorgabe, wie sie im Quelltext steht")

{
  const r = bauen({ pin: vorgabe, download: false })

  ok("das Video bleibt eine Adresse",
    istAdresse(r, "bm_0119_chasm.webm") && !istLokal(r, "bm_0119_chasm.webm"))

  ok("das Standbild liegt lokal, die Szene zeichnet also ohne Verbindung",
    istLokal(r, "bm_0119_chasm.webp") && !istAdresse(r, "bm_0119_chasm.webp"))

  ok("der Zaehler nennt genau ein vorgemerktes Bild", r.pinned === 1)

  ok("das Portrait liegt lokal, wie im Streaming vorgesehen",
    istLokal(r, "goblin-avatar.webp"))

  ok("das Modulsymbol wird weder geholt noch umgeschrieben",
    !istLokal(r, "aura.svg") && !istAdresse(r, "aura.svg") && r.skipped === 1)

  ok("das Dokument geht in packInfo",
    Object.keys(r.packInfo).some((p) => p.endsWith("Scene.json")))
}

console.log("\nGegenprobe: der Schalter auf aus")

/*
 * Ohne diesen Block beweist der Block darueber nichts: eine Fassung, die
 * Standbilder IMMER lokal legt, waere dort genauso gruen. Hier muss dieselbe
 * Datei in die Gegenrichtung fallen.
 */
{
  const r = bauen({ pin: false, download: false })

  ok("mit Schalter aus wird das Standbild eine Adresse",
    istAdresse(r, "bm_0119_chasm.webp") && !istLokal(r, "bm_0119_chasm.webp"))

  ok("der Zaehler nennt dann kein vorgemerktes Bild", r.pinned === 0)
}

console.log("\nGegenprobe: Download-Betrieb")

/*
 * Im Download-Betrieb gibt es keine Adressen, und der Schalter darf daran
 * nichts aendern. Faellt das hier, haette eine Umstellung des Schalters den
 * Kunden ohne Internet getroffen, also genau den, fuer den es den Betrieb gibt.
 */
{
  const r = bauen({ pin: vorgabe, download: true })

  ok("alles liegt lokal, auch das Video", istLokal(r, "bm_0119_chasm.webm"))
  ok("keine einzige Adresse bleibt stehen", r.streamTargets.size === 0)
  ok("der Rueckgabewert nennt den Betrieb", r.download === true)
}

/* ------------------------------------------------------------------- Bilanz */

console.log(`\n${bestanden} bestanden, ${gescheitert} gescheitert`)
process.exit(gescheitert === 0 ? 0 : 1)
