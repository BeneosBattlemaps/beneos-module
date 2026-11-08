/**
 * stream-ersatzbild.test.mjs
 *
 * Gegenprobe zwischen drei Dingen, die auseinanderlaufen koennen, ohne dass
 * jemand es merkt: der Abrufschicht in `stream-fetch.mjs`, den sechs Dateien
 * unter `ui/`, und ihrem Erzeuger `tools/ersatzbilder.py`. Laeuft ohne
 * Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-ersatzbild.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ UEBERHAUPT. Das Ersatzbild ist die einzige Stelle im
 * Streaming, an der ein Fehler GENAU SO AUSSIEHT wie der Zustand, den es
 * beheben soll. Eine Abweisung des Tores kommt als HTTP 200 mit einem
 * durchsichtigen GIF von 42 Byte: der Kunde sieht ein leeres Feld, die
 * Konsole bleibt still. Faellt das Ersatzbild aus, sieht der Kunde dasselbe
 * leere Feld. Es gibt also keinen Unterschied zwischen "der Ersatz greift
 * nicht" und "es gibt keinen Ersatz", und ohne diesen Satz faellt beides
 * niemandem auf.
 *
 * DIE DREI WEGE, AUF DENEN ES STILL BRICHT, und jeder ist hier ein Fall:
 *
 *   1. `ersatzForm()` bekommt eine Form dazu und die Datei fehlt. Dann liefert
 *      `ersatzBytes()` HTTP 404, der Abruf wirft, und die Abrufschicht faellt
 *      auf die leere Antwort zurueck. Fall 3 unten haelt dagegen.
 *   2. Der Erzeuger wird geaendert und schreibt andere Masse. Ein
 *      quadratisches Ersatzbild in einem Breitbildfeld wird verzerrt, und das
 *      sieht nach einem kaputten Bild aus statt nach einem Hinweis. Fall 4.
 *   3. Der Alphakanal geht verloren. Dann ersetzt ein deckendes Rechteck die
 *      Tokentextur, also genau der Kasten um die Figur, den der Betreiber
 *      am 02.11.2026 verworfen hat. Fall 5.
 *
 * WAS DIESER SATZ NICHT LEISTET. Er liest Dateikoepfe und Quelltext. Dass die
 * Abrufschicht im laufenden Foundry wirklich auf das Ersatzbild faellt und
 * dass es dort erscheint, entscheidet die Reihe 8 der Abnahme. Und er sagt
 * nichts darueber, ob die Bilder GUT aussehen; er sagt nur, dass sie die Form
 * haben, die der Vertrag verlangt.
 *
 * Arbeitspaket `OP-PRJ-207`, dazu `OP-PRJ-128` und `OP-PRJ-129`.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

let rot = 0
let gruen = 0

/**
 * Vergleicht ueber `JSON.stringify` und nicht ueber `===`.
 *
 * Der Grund steht hier, weil er diesen Satz beim ersten Lauf neun mal rot
 * gemacht hat: `===` vergleicht zwei Listen als Verweise, also ist
 * `[512, 512] === [512, 512]` falsch. Der Satz meldete "ist [512,512], soll
 * [512,512]" und sah dabei aus wie ein Befund an den Bildern. Mit
 * `JSON.stringify` bleibt der Typ unterschieden, denn `5` und `"5"` ergeben
 * verschiedene Zeichenketten.
 */
function gleich(name, ist, soll) {
  if (JSON.stringify(ist) === JSON.stringify(soll)) {
    gruen++; console.log(`  ok   ${name}`)
  } else {
    rot++
    console.log(`  ROT  ${name}`)
    console.log(`       ist:  ${JSON.stringify(ist)}`)
    console.log(`       soll: ${JSON.stringify(soll)}`)
  }
}

function wahr(name, bedingung) {
  gleich(name, !!bedingung, true)
}

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, "..", "..")
const FETCH_QUELLE = readFileSync(join(HIER, "stream-fetch.mjs"), "utf8")
const ERZEUGER_PFAD = join(WURZEL, "tools", "ersatzbilder.py")

/**
 * Der Kopf einer WebP-Datei, so weit er hier gebraucht wird.
 *
 * Gelesen wird die erweiterte Form VP8X, weil Pillow sie fuer Bilder mit
 * Alphakanal schreibt und nur sie Masse und Alpha-Schalter im Klartext
 * fuehrt. Eine Datei ohne VP8X ist damit entweder kein WebP oder eines ohne
 * Alphakanal, und beides ist hier ein Befund und kein Sonderfall.
 */
function webpKopf(pfad) {
  const b = readFileSync(pfad)
  if (b.length < 30) return { fehler: "zu kurz" }
  if (b.toString("latin1", 0, 4) !== "RIFF") return { fehler: "kein RIFF" }
  if (b.toString("latin1", 8, 12) !== "WEBP") return { fehler: "kein WEBP" }
  const art = b.toString("latin1", 12, 16)
  if (art !== "VP8X") return { fehler: `Chunk ${art} statt VP8X`, art }
  return {
    art,
    alpha: (b[20] & 0x10) !== 0,
    breite: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
    hoehe: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
    bytes: b.length,
  }
}

// ---------------------------------------------------------------------------
console.log("\n1. Der Pfad kommt aus der Quelle und ist nicht abgeschrieben")

// ERSATZ_PFAD traegt den Ordner und den gemeinsamen Anfang der Dateinamen.
// Er wird hier AUS DER QUELLE gelesen: ein Satz, der ihn abschreibt, bliebe
// gruen, wenn jemand den Ordner im Modul verschiebt.
const pfadTreffer = FETCH_QUELLE.match(
  /const ERSATZ_PFAD = `modules\/\$\{MODULE_ID\}\/([^`]+)`/)
wahr("`ERSATZ_PFAD` steht in stream-fetch.mjs und ist lesbar", !!pfadTreffer)
const ORDNER_UND_ANFANG = pfadTreffer ? pfadTreffer[1] : "ui/beneos_stream_"
gleich("er zeigt auf ui/ und den Anfang beneos_stream_",
  ORDNER_UND_ANFANG, "ui/beneos_stream_")

const schraeg = ORDNER_UND_ANFANG.lastIndexOf("/")
const ORDNER = join(WURZEL, ORDNER_UND_ANFANG.slice(0, schraeg))
const ANFANG = ORDNER_UND_ANFANG.slice(schraeg + 1)

// ---------------------------------------------------------------------------
console.log("\n2. Die zwei Ursachen stehen in der Abrufschicht")

// Zwei Ursachen, zwei Bilder: "offline" heisst warten, "denied" heisst
// klaeren. Ein einziges Bild fuer beides macht jeden Supportfall unaufloesbar.
// Die Namen stehen in `ersatzAntwort()` als Kopfzeilen, und ueber dieselben
// Kopfzeilen weist `toStore` die Antwort ab. Sie sind also kein Zierwerk.
const URSACHEN = ["offline", "denied"]
for (const u of URSACHEN) {
  wahr(`die Abrufschicht kennt die Kopfzeile x-beneos-${u}`,
    FETCH_QUELLE.includes(`x-beneos-${u}`))
}
wahr("sie unterscheidet die Ursachen am Namen offline",
  /ursache === "offline"/.test(FETCH_QUELLE))

// ---------------------------------------------------------------------------
console.log("\n3. Jede Form, die ersatzForm() liefern kann, hat ihre Dateien")

// DAS IST DER FALL, DER DEN STILLEN AUSFALL FAENGT. Die Formen werden aus dem
// Rumpf von `ersatzForm()` gelesen, nicht hier aufgezaehlt: kommt eine Form
// dazu und fehlt ihre Datei, liefert `ersatzBytes()` HTTP 404 und der Kunde
// sieht wieder das leere Feld.
const rumpf = FETCH_QUELLE.match(/function ersatzForm\(url\)\s*\{([\s\S]*?)\n\}/)
wahr("der Rumpf von ersatzForm() ist lesbar", !!rumpf)
const FORMEN = rumpf
  ? [...new Set((rumpf[1].match(/return "([a-z]+)"/g) || [])
      .map((s) => s.slice(8, -1)))].sort()
  : []
gleich("ersatzForm() liefert genau drei Formen",
  FORMEN, ["card", "journal", "token"])

const ERWARTET = []
for (const u of URSACHEN) for (const f of FORMEN) ERWARTET.push(`${ANFANG}${u}_${f}.webp`)

for (const name of ERWARTET) {
  wahr(`${name} liegt im Modul`, existsSync(join(ORDNER, name)))
}

// Die Gegenrichtung: kein Ersatzbild ohne eine Form, die es anfordert. Eine
// uebrige Datei ist kein Ausfall, aber sie ist ein Hinweis darauf, dass
// jemand eine Form aus `ersatzForm()` entfernt und die Datei vergessen hat.
const LIEGEND = readdirSync(ORDNER)
  .filter((n) => n.startsWith(ANFANG) && n.endsWith(".webp")).sort()
gleich("es liegen genau die erwarteten Dateien und keine weitere",
  LIEGEND, ERWARTET.slice().sort())

// ---------------------------------------------------------------------------
console.log("\n4. Die Masse folgen der Rolle, und der Erzeuger kennt dieselben")

// Das Ersatzbild sitzt im Feld der ausgefallenen Datei. Ein Journalbild ist
// Breitbild, eine Klappkarte hochkant, ein Token quadratisch. Die Masse
// werden AUS DEM ERZEUGER gelesen, damit Bild und Erzeuger nicht
// auseinanderlaufen koennen, ohne dass dieser Satz rot wird.
wahr("der Erzeuger tools/ersatzbilder.py liegt im Modul",
  existsSync(ERZEUGER_PFAD))

const ERZEUGER = existsSync(ERZEUGER_PFAD)
  ? readFileSync(ERZEUGER_PFAD, "utf8") : ""
const formenBlock = ERZEUGER.match(/FORMEN = \{([\s\S]*?)\n\}/)
wahr("seine Formentabelle ist lesbar", !!formenBlock)

const SOLL_MASSE = {}
if (formenBlock) {
  for (const z of formenBlock[1].matchAll(/"([a-z]+)":\s*\((\d+),\s*(\d+)\)/g)) {
    SOLL_MASSE[z[1]] = [Number(z[2]), Number(z[3])]
  }
}
gleich("er kennt genau die Formen aus ersatzForm()",
  Object.keys(SOLL_MASSE).sort(), FORMEN)

// Die Seitenverhaeltnisse muessen sich wirklich unterscheiden. Drei gleiche
// Masse waeren derselbe Fehler wie eine einzige Datei fuer alle Formen, nur
// schwerer zu sehen.
const verhaeltnisse = FORMEN
  .filter((f) => SOLL_MASSE[f])
  .map((f) => (SOLL_MASSE[f][0] / SOLL_MASSE[f][1]).toFixed(3))
gleich("die drei Seitenverhaeltnisse sind verschieden",
  new Set(verhaeltnisse).size, FORMEN.length)
wahr("token ist quadratisch",
  SOLL_MASSE.token && SOLL_MASSE.token[0] === SOLL_MASSE.token[1])
wahr("card ist hochkant",
  SOLL_MASSE.card && SOLL_MASSE.card[1] > SOLL_MASSE.card[0])
wahr("journal ist Breitbild",
  SOLL_MASSE.journal && SOLL_MASSE.journal[0] > SOLL_MASSE.journal[1])

// ---------------------------------------------------------------------------
console.log("\n5. Jede Datei ist ein WebP mit Alphakanal in den Sollmassen")

// WebP ist Pflicht und keine Geschmacksfrage: `ersatzAntwort()` setzt den
// Inhaltstyp fest auf image/webp. Eine PNG-Datei unter diesem Namen kaeme mit
// falschem Typ an.
// Der Alphakanal ebenso: das Bild ersetzt eine Tokentextur, und ein deckendes
// Rechteck waere der Kasten um die Figur, den der Betreiber verworfen hat.
wahr("die Abrufschicht meldet den Inhaltstyp image/webp",
  /"Content-Type": "image\/webp"/.test(FETCH_QUELLE))

for (const name of ERWARTET) {
  const pfad = join(ORDNER, name)
  if (!existsSync(pfad)) continue
  const k = webpKopf(pfad)
  const form = name.replace(/\.webp$/, "").split("_").pop()
  const soll = SOLL_MASSE[form]
  wahr(`${name}: WebP in erweiterter Form`, k.art === "VP8X")
  wahr(`${name}: traegt einen Alphakanal`, k.alpha === true)
  if (soll) {
    gleich(`${name}: Masse`, [k.breite, k.hoehe], soll)
  }
  // Eine Datei unter 1000 Byte waere das durchsichtige Pixel in neuem Kleid.
  wahr(`${name}: traegt wirklich ein Bild und nicht nur einen Kopf`,
    k.bytes > 1000)
}

// ---------------------------------------------------------------------------
console.log("\n6. Der Erzeuger nennt seine Werte und ihre Herkunft")

// OP-PRJ-207 entstand, weil die Bilder da waren und ihr Erzeuger nicht. Wer
// sie aendern wollte, haette raten muessen. Diese Faelle halten fest, dass
// der Erzeuger seine Eingabewerte benennt statt sie zu verstecken.
for (const [was, muster] of [
  ["die Farben mit ihrem Token aus der Bone-Palette", /--color-bg-base/],
  ["den Rand als --color-border-strong", /--color-border-strong/],
  ["das Symbol als Nebentext und keine Zustandsfarbe", /--color-text-secondary/],
  ["den Vertrag der Dateinamen", /beneos_stream_<ursache>_<form>\.webp/],
  ["dass er eine Neuschrift und kein Fund ist", /NEUSCHRIFT/],
]) {
  wahr(`der Kopf nennt ${was}`, muster.test(ERZEUGER))
}

// Die drei Farben stehen als Zahlenwerte im Erzeuger und muessen die Werte
// der Palette treffen. Eine Abweichung hier faellt am Bild nicht auf, weil
// zwei Stufen Unterschied im Dunkeln niemand sieht, und genau darum steht sie
// hier.
for (const [rolle, wert] of [
  ["SCHEIBE", "0x0E, 0x0D, 0x0A"],
  ["RAND", "0x46, 0x3B, 0x2C"],
  ["SYMBOL", "0xA7, 0xA5, 0x96"],
]) {
  wahr(`${rolle} traegt den Wert aus der Palette`,
    new RegExp(`^${rolle} = \\(${wert}`, "m").test(ERZEUGER))
}

// ---------------------------------------------------------------------------
console.log(`\n${gruen} bestanden, ${rot} gescheitert`)
console.log("\nNicht geprueft, ausdruecklich benannt:")
console.log("- Ob die Abrufschicht im laufenden Foundry wirklich auf das")
console.log("  Ersatzbild faellt. Das braucht ein Tor, das abweist, und steht in")
console.log("  der Reihe 8 der Abnahme.")
console.log("- Ob die Bilder gut aussehen. Dieser Satz prueft Form und Masse,")
console.log("  nicht Gestaltung. Dafuer gibt es den Design-Standard und das Auge.")
console.log("- Ob der Erzeuger laeuft. Er braucht Pillow, und das ist keine")
console.log("  Abhaengigkeit des Moduls; die Ergebnisse liegen committet.")
console.log("- Ob die Feldgroesse eines Tokens beim Ersatzbild gleich bleibt. Sie")
console.log("  kommt aus dem Dokument und nicht aus den Bildpunkten, aber das ist")
console.log("  Abnahmepunkt 8a und hier nicht fahrbar.")

process.exit(rot > 0 ? 1 : 0)
