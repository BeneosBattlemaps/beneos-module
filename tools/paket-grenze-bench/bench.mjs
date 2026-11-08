/* Die Grenze des Kundenpakets, gemessen am wirklich erzeugten Archiv.
 *
 * WAS AUSGELIEFERT WIRD. Nicht dieses Repositorium, sondern GitHubs
 * automatisch erzeugtes Quellarchiv des Tags,
 * `archive/refs/tags/<version>.zip`. Es entsteht aus `git archive` und achtet
 * auf `export-ignore` in der `.gitattributes`. Wer dort nichts eintraegt,
 * liefert jede Entwicklerdatei mit aus.
 *
 * WARUM ES DIESEN STAND GIBT, und der Anlass ist eine Aussage, die vier
 * Wochen falsch dastand. Die `.gitattributes` trug seit dem 03.09.2026 die
 * Zeile `*.test.mjs export-ignore` und darueber den Kommentar "NOCH NICHT AM
 * ARCHIV NACHGEMESSEN" samt dem Befehl fuer die Probe. Die Probe hat niemand
 * gefahren. Gemessen am 08.11.2026, mit `OP-PRJ-217`: die Zeile trug, aber sie
 * war die einzige, und `tools/` fuhr mit 66 Dateien und 546.299 Byte
 * vollstaendig ins Kundenpaket.
 *
 * WARUM `git check-attr` DER FALSCHE MESSWEG IST, und das ist die Falle, die
 * dieser Stand festhaelt. Eine Verzeichnissperre `tools/ export-ignore` wirkt
 * im Archiv rekursiv, aber `git check-attr export-ignore -- tools/datei.py`
 * meldet `unspecified`, weil das Attribut am Verzeichnis haengt und nicht an
 * der Datei. Wer so prueft, haelt eine wirksame Sperre fuer unwirksam und
 * baut ein weites Muster daneben. Gemessen wird deshalb das Archiv.
 *
 * WARUM JEDE SPERRE EINE GEGENPROBE IM BAUM BRAUCHT. "Die Datei ist nicht im
 * Archiv" hat zwei Ursachen: die Sperre greift, oder es gibt die Datei nicht
 * mehr. Beide sehen gleich aus. Jeder Sperrsatz hier fragt deshalb ZWEI
 * Quellen: `git ls-tree` muss die Datei kennen, `git archive` darf sie nicht
 * tragen. Erst der Unterschied ist der Beweis.
 *
 * WAS NICHT GESPERRT WERDEN DARF. `docs/` traegt mit 569 Dateien die
 * Autorenquelle des Modul-Wikis, `icons/` 2464 Dateien, dazu `assets/`,
 * `lang/`, `ui/` und `fonts/`. Der zweite Abschnitt haelt sie fest, damit ein
 * weites Muster auffaellt, bevor es dem Kunden die Anleitung wegnimmt.
 *
 * Laeuft ohne Netz, ohne Foundry, ohne Abhaengigkeiten. Gemessen 0,4 Sekunden,
 * fast alles Node-Start. Er braucht ein Git-Repositorium und schweigt
 * freundlich, wo keines ist.
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = resolve(HIER, "..", "..")

let gruen = 0
let rot = 0

function wahr(name, bedingung, zusatz) {
  if (bedingung) {
    gruen++
    console.log(`  ok   ${name}`)
  } else {
    rot++
    console.log(`  ROT  ${name}${zusatz ? `  (${zusatz})` : ""}`)
  }
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: WURZEL,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

/* Der Baum, der WIRKLICH committet wird, und nicht HEAD.
 *
 * Dieser Stand laeuft aus dem Vorhaken, also VOR dem Commit. Wer hier HEAD
 * messen wuerde, pruefte die vorige Fassung der `.gitattributes` und liesse
 * genau die Aenderung durch, die er sichern soll. `git write-tree` legt den
 * Index als Baum ab; das schreibt lose Objekte und beruehrt weder Index noch
 * HEAD noch den Arbeitsbaum. */
let BAUM = null
try {
  if (!existsSync(resolve(WURZEL, ".git")) && !existsSync(resolve(WURZEL, ".git/HEAD"))) {
    // Worktree traegt .git als Datei, das deckt existsSync mit ab.
  }
  BAUM = git("write-tree").trim()
} catch (e) {
  console.log("paket-grenze-bench: kein Git-Baum lesbar, der Stand schweigt.")
  console.log(`  Grund: ${String(e.message || e).split("\n")[0]}`)
  process.exit(0)
}

/* Die Dateiliste des Archivs, einmal geholt.
 *
 * `--format=tar` statt zip, weil der Inhalt nicht gebraucht wird und tar ohne
 * Fremdwerkzeug zu lesen ist: jeder Kopfblock ist 512 Byte und traegt den
 * Namen am Anfang. Das ersetzt ein `unzip`, das auf einer Windows-Maschine
 * nicht ueberall liegt. */
function archivPfade(baum) {
  const roh = execFileSync("git", ["archive", "--format=tar", baum], {
    cwd: WURZEL,
    maxBuffer: 512 * 1024 * 1024,
  })
  const pfade = []
  for (let off = 0; off + 512 <= roh.length; off += 512) {
    const kopf = roh.subarray(off, off + 512)
    if (kopf[0] === 0) break
    let ende = 0
    while (ende < 100 && kopf[ende] !== 0) ende++
    const name = kopf.subarray(0, ende).toString("utf8")
    if (!name) break
    pfade.push(name)
    // Groesse steht oktal in Byte 124 bis 135, danach folgen die Datenbloecke.
    const groesse = parseInt(kopf.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8)
    off += Math.ceil(groesse / 512) * 512
  }
  return pfade
}

const ARCHIV = archivPfade(BAUM)
const ARCHIV_SET = new Set(ARCHIV)
const BAUM_PFADE = git("ls-tree", "-r", "--name-only", BAUM).split("\n").filter(Boolean)
const BAUM_SET = new Set(BAUM_PFADE)

console.log(`paket-grenze-bench: Baum ${BAUM.slice(0, 8)}, ${BAUM_PFADE.length} verfolgte Dateien, ${ARCHIV.filter((p) => !p.endsWith("/")).length} im Archiv`)

/* ------------------------------------------------- 1. Was nicht mitfahren darf
 *
 * Je Eintrag ein Beispielpfad, der im Baum liegen MUSS, und ein Muster, das
 * im Archiv nichts treffen darf. Der Beispielpfad ist die Gegenprobe: ohne
 * ihn messe ich das Fehlen einer Datei und nenne es eine wirksame Sperre. */
console.log("\n1. Gesperrt, und im Baum vorhanden")

const GESPERRT = [
  {
    name: "tools/, die Messwerkzeuge und Erzeuger",
    beleg: "tools/ersatzbilder.py",
    trifft: (p) => p.startsWith("tools/"),
  },
  {
    name: "dev/, das Probiermaterial",
    beleg: "dev/news-mock.json",
    trifft: (p) => p.startsWith("dev/"),
  },
  {
    name: "*.test.mjs, die Pruefsaetze",
    beleg: "scripts/stream/stream-basis.test.mjs",
    trifft: (p) => p.endsWith(".test.mjs"),
  },
  {
    name: "eslint.config.mjs, braucht node_modules",
    beleg: "eslint.config.mjs",
    trifft: (p) => p === "eslint.config.mjs",
  },
  {
    name: "*.code-workspace, Editorzustand",
    beleg: "beneos_module.code-workspace",
    trifft: (p) => p.endsWith(".code-workspace"),
  },
  {
    name: ".gitattributes und .gitignore, Bauvorgaben",
    beleg: ".gitattributes",
    trifft: (p) => p === ".gitattributes" || p === ".gitignore",
  },
]

for (const s of GESPERRT) {
  const imBaum = BAUM_SET.has(s.beleg)
  const imArchiv = ARCHIV.filter((p) => !p.endsWith("/") && s.trifft(p))
  wahr(
    `${s.name}: der Beleg liegt im Baum`,
    imBaum,
    `${s.beleg} fehlt, die Sperre darunter messt dann nichts`,
  )
  wahr(
    `${s.name}: null im Archiv`,
    imArchiv.length === 0,
    imArchiv.length ? `${imArchiv.length} Treffer, erster ${imArchiv[0]}` : "",
  )
}

/* ------------------------------------------------- 2. Was mitfahren muss
 *
 * Der Gegenpol. Eine Sperre mit zu weitem Muster nimmt dem Kunden Teile des
 * Produkts, und das faellt erst auf, wenn er sie sucht. Die Zahlen sind der
 * Stand vom 08.11.2026 und nach UNTEN gesichert, damit neue Inhalte sie nicht
 * brechen. */
console.log("\n2. Muss mitfahren, sonst fehlt dem Kunden das Produkt")

const PFLICHT = [
  "module.json",
  "readme.md",
  "changelog.md",
  "lang/en.json",
  "lang/de.json",
  "scripts/stream/stream-fetch.mjs",
  "scripts/cloud-v2/wiki/wiki-manifest.mjs",
  "ui/beneos_stream_offline_token.webp",
  "ui/beneos_stream_denied_journal.webp",
]
for (const p of PFLICHT) {
  wahr(`${p} liegt im Archiv`, ARCHIV_SET.has(p), "fehlt im Archiv")
}

const ORDNER_MIN = { docs: 500, icons: 2000, lang: 10, assets: 50, ui: 20, fonts: 5 }
for (const [ordner, min] of Object.entries(ORDNER_MIN)) {
  const n = ARCHIV.filter((p) => !p.endsWith("/") && p.startsWith(`${ordner}/`)).length
  wahr(`${ordner}/ traegt mindestens ${min} Dateien`, n >= min, `nur ${n}`)
}

/* ------------------------------------------------- 3. Nichts Geladenes gesperrt
 *
 * Die Sicherheitsbedingung, und sie ist die einzige Zeile hier, deren
 * Verletzung das Modul beim Kunden nicht startet. Eine Sperre auf einem Pfad,
 * den `module.json` laedt, erzeugt ein Paket, das installiert und dann
 * schweigt. */
console.log("\n3. Nichts, was module.json laedt, ist gesperrt")

const MODUL = JSON.parse(git("cat-file", "blob", `${BAUM}:module.json`))
const GELADEN = [
  ...(MODUL.esmodules || []),
  ...(MODUL.scripts || []),
  ...(MODUL.styles || []),
]
wahr(
  "module.json nennt Ladepfade",
  GELADEN.length > 20,
  `nur ${GELADEN.length}, die Pruefung darunter messt dann fast nichts`,
)
const fehlend = GELADEN.filter((p) => !ARCHIV_SET.has(p))
wahr(
  `alle ${GELADEN.length} Ladepfade liegen im Archiv`,
  fehlend.length === 0,
  fehlend.length ? `fehlen: ${fehlend.slice(0, 3).join(", ")}` : "",
)

/* Die Sprachdateien, und sie stehen hier anstelle der Kompendien.
 *
 * Eine erste Fassung dieses Abschnitts prueefte `MODUL.packs`. Das Feld ist
 * im Modul ein leeres Array, der Satz meldete "alle 0 Kompendien liegen im
 * Archiv" und war gruen, ohne etwas zu messen. Ein Satz, der ueber eine leere
 * Menge laeuft, ist von einem bestandenen Satz nicht zu unterscheiden; die
 * Mindestzahl darunter schliesst genau das aus. */
const SPRACHEN = (MODUL.languages || []).map((l) => l.path).filter(Boolean)
wahr(
  `module.json nennt mindestens 13 Sprachdateien`,
  SPRACHEN.length >= 13,
  `nur ${SPRACHEN.length}`,
)
const sprFehlend = SPRACHEN.filter((p) => !ARCHIV_SET.has(p.replace(/^\.\//, "")))
wahr(
  `alle ${SPRACHEN.length} Sprachdateien liegen im Archiv`,
  sprFehlend.length === 0,
  sprFehlend.length ? `fehlen: ${sprFehlend.slice(0, 3).join(", ")}` : "",
)

/* ------------------------------------------------- 4. Die Sperrzeilen selbst
 *
 * Gegen das stille Entfernen. Ein Archiv ohne die Zeilen ist von einem Archiv
 * mit ihnen nur durch die Zeilen zu unterscheiden, sobald jemand die
 * Beispieldateien mitloescht. */
console.log("\n4. Die Zeilen stehen in der vorgemerkten .gitattributes")

const ATTR = git("cat-file", "blob", `${BAUM}:.gitattributes`)
for (const zeile of [
  "*.test.mjs export-ignore",
  "tools/ export-ignore",
  "dev/ export-ignore",
  "eslint.config.mjs export-ignore",
  "*.code-workspace export-ignore",
  ".gitattributes export-ignore",
  ".gitignore export-ignore",
]) {
  wahr(`${zeile}`, ATTR.includes(`\n${zeile}\n`), "Zeile fehlt oder steht anders")
}

/* Kein weites Muster, das das Produkt treffen kann. `*` oder `docs` in einer
 * export-ignore-Zeile waere der Fehler, den Abschnitt 2 erst nachtraeglich
 * bemerkt. */
const SPERRZEILEN = ATTR.split("\n")
  .map((z) => z.trim())
  .filter((z) => z && !z.startsWith("#") && z.includes("export-ignore"))
const WEIT = SPERRZEILEN.filter((z) => /^(\*|\*\/|docs|icons|assets|lang|ui|fonts|scripts|templates|css|data)\b/.test(z))
wahr(
  `keine der ${SPERRZEILEN.length} Sperrzeilen trifft einen Produktordner`,
  WEIT.length === 0,
  WEIT.length ? `verdaechtig: ${WEIT.join(" | ")}` : "",
)

/* ------------------------------------------------------------------ Ausgang */
console.log(`\npaket-grenze-bench: ${gruen} gruen, ${rot} rot`)
if (rot > 0) process.exit(1)
