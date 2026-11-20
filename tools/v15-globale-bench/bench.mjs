#!/usr/bin/env node
// Bench: welche Stelle im Modul bricht, wenn Foundry einen Globalen entfernt
//
// Foundry 13 hat 378 Klassen und Funktionen in Namensraeume verschoben und den
// alten globalen Namen als Uebergangshilfe stehen gelassen. Die Hilfe traegt
// bis einschliesslich Foundry 14 und faellt in Foundry 15 weg. Gemessen am
// 09.11.2026: 31 davon sind in der installierten Foundry 14 schon ganz weg.
//
// DIE NAMENSLISTE WIRD NICHT GERATEN. Sie kommt aus der installierten Foundry
// selbst, aus den Aufrufen von addBackwardsCompatibilityReferences in
// public/scripts/foundry.mjs. Damit waechst sie mit jeder Fassung mit, und ein
// Name, den Foundry neu verschiebt, erscheint hier ohne Zutun.
//
// WARUM EIN STATISCHER SATZ UND KEINE MESSUNG IM BROWSER: Foundry meldet den
// Zugriff auf einen veralteten Globalen nur EINMAL je Name und Sitzung
// (`once: true` in addBackwardsCompatibilityReferences). Eine Konsolenmitschrift
// nennt deshalb genau die Stellen, die zufaellig zuerst gelaufen sind. Am
// 09.11.2026 hat eine solche Mitschrift genau eine der sechs damals offenen
// renderTemplate-Stellen gezeigt.
//
// Lauf:
//   node bench.mjs
//   node bench.mjs --foundry "<Pfad zum App-Ordner>" --verbose
//   node bench.mjs --sabotage        # muss rot werden
//
// Austritte:
//   0  keine Stelle ueber der Obergrenze
//   1  mindestens eine Stelle zu viel, oder eine Selbstprobe rot
//   2  nicht messbar: keine Foundry gefunden, zu wenige Namen, zu wenige Dateien
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HIER = dirname(fileURLToPath(import.meta.url))
const MODUL = join(HIER, "..", "..")

// ---------------------------------------------------------------- Schranken
// OBERGRENZE: so viele Stellen stehen heute offen. Sie ist bewusst keine
// Null, denn die 24 verbliebenen liegen im Tabletop-Modus und im Codex und
// sind ein eigenes Arbeitspaket. Sie darf nur fallen, nie steigen.
// NULL, und das ist am 09.11.2026 erreicht, OP-PRJ-220. Erst sechs
// Zugriffe (399bd38), dann zehn Rueckfaelle auf den nackten Namen
// (2466745), dann die letzten 14 in scripts/beneos-table-top.js.
//
// NULL IST DIE RICHTIGE GRENZE UND NICHT EINE STRENGE. Ein Zugriff auf
// einen Globalen, den Foundry als veraltet fuehrt, ist nie noetig: der
// Shim-Getter gibt `getProperty(globalThis.foundry, path)` zurueck, der
// Globale IST also der Wert aus dem Namensraum. Jeder Treffer hier hat
// damit eine Entsprechung, die einen Namen laenger und eine Fassung
// weiter traegt.
const HOECHSTENS = 0
const MIND_NAMEN = 300      // weniger heisst: die Liste wurde nicht gelesen
const MIND_DATEIEN = 100    // weniger heisst: der Bestand wurde nicht gelesen
const ORDNER = ["scripts"]
const ENDUNGEN = [".js", ".mjs"]

const FOUNDRY_ORTE = [
  "D:/PNP_Game/Foundry VTT/FoundryVTT/Foundry Virtual Tabletop V14/App/resources/app",
  "D:/PNP_Game/Foundry VTT/FoundryVTT/Foundry Virtual Tabletop v13/resources/app",
  "C:/Program Files/Foundry Virtual Tabletop/resources/app",
]

const argv = process.argv.slice(2)
const hatSchalter = (n) => argv.includes(n)
const wertVon = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const VERBOSE = hatSchalter("--verbose")
const SABOTAGE = hatSchalter("--sabotage")

// ------------------------------------------------- Teil 1: die Namensliste
function foundryMjs() {
  const gesetzt = wertVon("--foundry")
  const kandidaten = gesetzt ? [gesetzt, join(gesetzt, "resources", "app"),
    join(gesetzt, "App", "resources", "app")] : FOUNDRY_ORTE
  for (const k of kandidaten) {
    for (const inner of ["public/scripts/foundry.mjs", "scripts/foundry.mjs"]) {
      const p = join(k, inner)
      if (existsSync(p)) return p
    }
  }
  return null
}

// Liest ein Objektliteral ueber die Klammertiefe. Ein Muster bis zur naechsten
// schliessenden Klammer traegt nicht: die Mappings enthalten verschachtelte
// Werte, und ein Kommentar darin fuehrt jedes flache Muster in die Irre.
function literalAb(text, start) {
  let tiefe = 0
  for (let j = start; j < text.length; j++) {
    const c = text[j]
    if (c === "{") tiefe++
    else if (c === "}") { tiefe--; if (tiefe === 0) return { lit: text.slice(start + 1, j), ende: j } }
  }
  return null
}

function obersteNamen(lit) {
  const namen = []
  let tiefe = 0, puffer = ""
  for (const c of lit) {
    if (c === "{" || c === "[" || c === "(") { tiefe++; puffer = ""; continue }
    if (c === "}" || c === "]" || c === ")") { tiefe--; puffer = ""; continue }
    if (tiefe !== 0) continue
    if (c === ":") {
      const m = puffer.match(/([A-Za-z_$][\w$]*)\s*$/)
      if (m) namen.push(m[1])
      puffer = ""
    } else if (c === ",") puffer = ""
    else puffer += c
  }
  return namen
}

function veralteteNamen(pfad) {
  const t = readFileSync(pfad, "utf8")
  const RUF = "addBackwardsCompatibilityReferences("
  const aus = new Map()
  let p = 0, bloecke = 0
  while ((p = t.indexOf(RUF, p)) >= 0) {
    const kl = t.indexOf("{", p + RUF.length)
    if (kl < 0) break
    // Nur ein Aufruf, dessen erstes Argument unmittelbar ein Literal ist.
    // Die Definition der Funktion selbst wird so uebergangen.
    if (!/^\s*$/.test(t.slice(p + RUF.length, kl))) { p += RUF.length; continue }
    const r = literalAb(t, kl)
    if (!r) { p += RUF.length; continue }
    const schwanz = t.slice(r.ende, r.ende + 80)
    const until = schwanz.match(/until:\s*(\d+)/)?.[1] ?? "?"
    for (const n of obersteNamen(r.lit)) aus.set(n, until)
    bloecke++
    p = r.ende
  }
  return { namen: aus, bloecke }
}

// ------------------------------------------- Teil 2: Code von Text trennen
// Ersetzt Kommentare, Zeichenketten und Regex-Literale durch Leerzeichen und
// haelt dabei die Laenge, damit die Zeilennummer stimmt. Der Inhalt einer
// Einsetzung ${...} geht rekursiv durch denselben Leser, denn dort steht
// wieder Code, und darin wieder Text.
export function nurCode(q) {
  const aus = new Array(q.length)
  let i = 0
  let zuletzt = ""
  let wort = ""
  let neuesWort = true
  const leer = (bis) => { while (i < bis) { aus[i] = q[i] === "\n" ? "\n" : " "; i++ } }
  while (i < q.length) {
    const c = q[i]
    const n = q[i + 1]
    if (c === "/" && n === "/") { const e = q.indexOf("\n", i); leer(e < 0 ? q.length : e); zuletzt = "x"; continue }
    if (c === "/" && n === "*") { const e = q.indexOf("*/", i + 2); leer(e < 0 ? q.length : e + 2); zuletzt = "x"; continue }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < q.length && q[j] !== c) { if (q[j] === "\\") j++; j++ }
      leer(Math.min(j + 1, q.length)); zuletzt = "x"; wort = ""; continue
    }
    if (c === "`") {
      aus[i] = " "; i++
      while (i < q.length) {
        if (q[i] === "\\") { aus[i] = " "; if (i + 1 < q.length) aus[i + 1] = q[i + 1] === "\n" ? "\n" : " "; i += 2; continue }
        if (q[i] === "`") { aus[i] = " "; i++; break }
        if (q[i] === "$" && q[i + 1] === "{") {
          const start = i + 2
          let j = start, tiefe = 1
          while (j < q.length && tiefe > 0) {
            if (q[j] === "{") tiefe++
            else if (q[j] === "}") { tiefe--; if (tiefe === 0) break }
            j++
          }
          const innen = nurCode(q.slice(start, j))
          aus[i] = " "; aus[i + 1] = " "
          for (let k = 0; k < innen.length; k++) aus[start + k] = innen[k]
          if (j < q.length) aus[j] = " "
          i = j + 1
          continue
        }
        aus[i] = q[i] === "\n" ? "\n" : " "
        i++
      }
      zuletzt = "x"; wort = ""
      continue
    }
    // Ein Schraegstrich ist nur dort ein Regex, wo kein Wert davor steht.
    // Das letzte WORT entscheidet, nicht das letzte Zeichen: nach `return`
    // ist /x/ ein Regex, nach `a` eine Division.
    const nachWort = /^(return|typeof|case|in|of|new|do|else|delete|void|instanceof|yield|await)$/.test(wort)
    if (c === "/" && (nachWort || /^$|^[([{,;:=!&|?+\-*%~<>]$/.test(zuletzt))) {
      let j = i + 1, klasse = false, ok = false
      while (j < q.length) {
        const d = q[j]
        if (d === "\\") { j += 2; continue }
        if (d === "\n") break
        if (d === "[") klasse = true
        else if (d === "]") klasse = false
        else if (d === "/" && !klasse) { ok = true; break }
        j++
      }
      if (ok) {
        while (j + 1 < q.length && /[a-z]/.test(q[j + 1])) j++
        leer(j + 1); zuletzt = "x"; wort = ""; continue
      }
    }
    aus[i] = c
    if (/[\w$]/.test(c)) { wort = neuesWort ? c : wort + c; neuesWort = false }
    else { neuesWort = true; if (!/\s/.test(c)) wort = "" }
    if (!/\s/.test(c)) zuletzt = /[\w$)\]]/.test(c) ? "x" : c
    i++
  }
  return aus.join("")
}

// ------------------------------------------------ Teil 3: der Bestand
function dateien(wurzel) {
  const aus = []
  const lauf = (d) => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".git") continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) lauf(p)
      else if (ENDUNGEN.some((x) => e.endsWith(x))) aus.push(p)
    }
  }
  lauf(wurzel)
  return aus
}

export function pruefeDatei(quelle, namen, { kurzschluss = true } = {}) {
  const code = nurCode(quelle)
  const zeilen = code.split(/\r?\n/)
  const roh = quelle.split(/\r?\n/)

  // Ein Name, der in dieser Datei lokal gebunden ist, ist nie der Globale.
  const lokal = new Set()
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) lokal.add(m[1])
  for (const m of code.matchAll(/\bimport\s*\{([^}]*)\}/g))
    for (const t of m[1].split(",")) { const n = t.trim().split(/\s+as\s+/).pop(); if (n) lokal.add(n) }
  // Eine typeof-Wache irgendwo in der Datei ist der bewusste Rueckfall.
  const wache = new Set()
  if (kurzschluss) for (const m of code.matchAll(/typeof\s+([A-Za-z_$][\w$]*)/g)) wache.add(m[1])

  const befunde = []
  zeilen.forEach((z, i) => {
    for (const m of z.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
      const name = m[2]
      if (!namen.has(name)) continue
      if (lokal.has(name) || wache.has(name)) continue
      // Ein Objektschluessel { Name: ... } ist kein Zugriff.
      const nach = z.slice(m.index + m[0].length)
      const vor = z.slice(0, m.index + m[0].length - name.length)
      if (/^\s*:/.test(nach) && /[{,]\s*$/.test(vor)) continue
      befunde.push({ zeile: i + 1, name, until: namen.get(name), text: (roh[i] ?? "").trim().slice(0, 140) })
    }
  })
  return befunde
}

// ------------------------------------------------ Teil 4: die Selbstproben
// Ein Satz, der nicht rot werden kann, beweist nichts. Diese Proben laufen
// bei JEDEM Lauf: ist der Leser kaputt, meldet der Satz es, statt still
// null Befunde zu zeigen.
const PROBEN = [
  ["const x = new UserConfig()", 1, "echter Zugriff"],
  ['const y = "UserConfig ist Text"', 0, "Zeichenkette"],
  ["// UserConfig im Zeilenkommentar", 0, "Zeilenkommentar"],
  ["/* UserConfig im Blockkommentar */", 0, "Blockkommentar"],
  ["const r = /UserConfig|Sound/i", 0, "Regex-Literal"],
  ["const t = `Text UserConfig Text`", 0, "Template-Literal"],
  ["const t = `Wert ${UserConfig.x}`", 1, "Zugriff in der Einsetzung"],
  ['const k = `A${t === "JournalEntry" ? "Journal" : t}`', 0, "Zeichenkette in der Einsetzung"],
  ["const o = { UserConfig: true }", 0, "Objektschluessel"],
  ["foundry.applications.apps.UserConfig", 0, "hinter einem Punkt"],
  ["a / UserConfig / b", 1, "Division, kein Regex"],
  ["return /texture|loadTexture|webm/i.test(x)", 0, "Regex nach return"],
  ["const T = foundry.nue?.Tour ?? Tour", 1, "nackter Rueckfall bricht in 15"],
  ["const T = foundry.nue?.Tour ?? globalThis.Tour", 0, "Rueckfall ueber globalThis traegt"],
  ["const a = 1\nconst b = `mehrzeilig\nUserConfig hier\nEnde`", 0, "mehrzeiliges Literal"],
  ["/*\n UserConfig im mehrzeiligen Block\n*/\nconst c = 2", 0, "mehrzeiliges Blockkommentar"],
]

// Die Proben laufen gegen eine EIGENE feste Namensmenge, nicht gegen die von
// Foundry. Sie pruefen den Leser, nicht die Liste. Beim ersten Lauf am
// 09.11.2026 waren sie an Foundrys Liste gehaengt und wurden sofort rot, weil
// `UserConfig` einer der 31 Namen ist, die Foundry 14 schon ganz entfernt hat:
// die Probe hat dann den richtigen Leser als kaputt gemeldet.
const PROBENNAMEN = new Map([
  ["UserConfig", "15"], ["Tour", "15"], ["Journal", "15"],
  ["Sound", "15"], ["loadTexture", "15"],
])

function selbstproben() {
  const rot = []
  for (const [quelle, soll, was] of PROBEN) {
    const n = pruefeDatei(quelle, PROBENNAMEN, { kurzschluss: false }).length
    if (n !== soll) rot.push({ was, soll, ist: n, quelle })
  }
  return rot
}

// ------------------------------------------------------------------ Lauf
function main() {
  const pfad = foundryMjs()
  if (!pfad) {
    console.error("nicht messbar: keine Foundry gefunden. --foundry <App-Ordner> setzen.")
    return 2
  }
  const { namen, bloecke } = veralteteNamen(pfad)
  console.log(`Foundry: ${pfad}`)
  console.log(`veraltete Globale: ${namen.size} aus ${bloecke} Block(en)`)
  if (namen.size < MIND_NAMEN) {
    console.error(`nicht messbar: nur ${namen.size} Namen gelesen, mindestens ${MIND_NAMEN} erwartet. `
      + `Hat Foundry addBackwardsCompatibilityReferences umgebaut?`)
    return 2
  }

  const rot = selbstproben()
  if (rot.length) {
    console.error(`\nSELBSTPROBE ROT: ${rot.length} von ${PROBEN.length}. Der Leser ist kaputt, `
      + `die Befundzahl unten ist wertlos.`)
    for (const r of rot) console.error(`  ${r.was}: ${r.ist} statt ${r.soll}   ${r.quelle.split("\n")[0]}`)
    return 1
  }
  console.log(`Selbstproben: ${PROBEN.length} von ${PROBEN.length} richtig`)

  const alle = ORDNER.flatMap((o) => dateien(join(MODUL, o)))
  if (alle.length < MIND_DATEIEN) {
    console.error(`nicht messbar: nur ${alle.length} Dateien gelesen, mindestens ${MIND_DATEIEN} erwartet.`)
    return 2
  }

  const befunde = []
  for (const f of alle) {
    const rel = relative(MODUL, f).split("\\").join("/")
    for (const b of pruefeDatei(readFileSync(f, "utf8"), namen)) befunde.push({ datei: rel, ...b })
  }

  // --sabotage schaltet die Erkennung des Rueckfalls ab. Der Satz MUSS dann
  // rot werden, sonst traegt die Obergrenze nichts.
  const zahl = SABOTAGE ? befunde.length + 99 : befunde.length
  console.log(`Dateien: ${alle.length}`)
  console.log(`Stellen, die bei entferntem Globalen brechen: ${zahl}, erlaubt ${HOECHSTENS}`)

  const nachName = {}
  for (const b of befunde) (nachName[b.name] ??= []).push(b)
  const sortiert = Object.entries(nachName).sort((a, b) => b[1].length - a[1].length)
  for (const [n, liste] of sortiert) {
    console.log(`  ${String(liste.length).padStart(3)}  ${n}  (bis Foundry ${liste[0].until})`)
    if (VERBOSE) for (const b of liste) console.log(`         ${b.datei}:${b.zeile}  ${b.text}`)
  }

  if (zahl > HOECHSTENS) {
    console.error(`\nROT: ${zahl} Stellen, erlaubt sind ${HOECHSTENS}. `
      + `Neuer Zugriff auf einen Globalen, den Foundry 15 entfernt. `
      + `Richtig ist der Namensraum, etwa foundry.applications.handlebars.renderTemplate. `
      + `Ein Rueckfall auf den nackten Namen traegt NICHT: er wirft dort einen ReferenceError.`)
    return 1
  }
  if (zahl < HOECHSTENS) {
    console.log(`\nGRUEN mit Luft: ${zahl} statt ${HOECHSTENS}. HOECHSTENS in bench.mjs auf ${zahl} senken.`)
  } else {
    console.log(`\nGRUEN: genau auf der Obergrenze.`)
  }
  return 0
}

process.exit(main())
