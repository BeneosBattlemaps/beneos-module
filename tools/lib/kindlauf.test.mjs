/**
 * EIN SATZPROZESS, DER OHNE ROTE PROBE ENDET, ERKLAERT SICH (stre-T-126).
 *
 * Der Sabotagelaeufer setzte `rc: fehler.code ?? 1` und verwarf stderr. Ein
 * echter Absturz und eine Toetung an der Zeitgrenze sahen damit gleich aus:
 * "rc 1 ohne rote Probe". Gemeldet von work-stre-2 an einem Volllauf auf
 * einem Baum mitten im Merge; nachgestellt in 17 Vollaeufen und 24-fach
 * parallel nicht. Der Lauf dauerte 76,2 s, eine Zeitgrenze war es nicht. Seitdem
 * schreibt `tools/lib/kindlauf.mjs` mit, was der Prozess gesagt hat, und ordnet
 * jeden Ausgang in genau eine von vier Arten ein.
 *
 * Der Satz faehrt echte Kindprozesse aus Wegwerfskripten im Temp-Verzeichnis.
 *
 * Lauf:  node tools/lib/kindlauf.test.mjs
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { pruefstand } from "./foundry-attrappe.mjs"

const p = pruefstand("kindlauf: jeder Ausgang eines Satzprozesses hat genau eine Art")

let baustein = null
try { baustein = await import("./kindlauf.mjs") } catch (_) { /* rot unten */ }
p.gleich("tools/lib/kindlauf.mjs liefert fahreKind", typeof baustein?.fahreKind, "function")
p.gleich("tools/lib/kindlauf.mjs liefert einordnen", typeof baustein?.einordnen, "function")

const ordner = mkdtempSync(join(tmpdir(), "kindlauf-"))
const skript = (name, text) => { writeFileSync(join(ordner, name), text); return name }

const SAUBER = skript("sauber.mjs", 'console.log("  ok   eins")\nconsole.log("  ok   zwei")\n')
const ROT = skript("rot.mjs", 'console.log("  ok   eins")\nconsole.log("  ROT  zwei")\nprocess.exit(1)\n')
// Zwanzig Warnzeilen VOR dem Absturz, wie ein Satz mit Modulwarnungen: der
// Fehler steht unten und muss die Kappung auf zwoelf Zeilen ueberleben.
const ABSTURZ = skript("absturz.mjs",
  'console.log("  ok   eins")\nfor (let i = 1; i <= 20; i++) console.error("Warnung " + i)\n' +
  'throw new Error("Pruefsatz stuerzt ab mit pk_kindlauf_attrappe_0123456789")\n')
const FLUT = skript("flut.mjs", 'console.log("  ROT  frueh")\nconsole.log("x".repeat(100000))\n')
const HAENGT = skript("haengt.mjs", 'console.log("  ok   eins")\nsetInterval(() => {}, 1000)\n')
const CODE3 = skript("code3.mjs", 'console.log("  ok   eins")\nprocess.exit(3)\n')

const fahre = (datei, zeitgrenze) => baustein
  ? baustein.fahreKind(ordner, datei, zeitgrenze ? { zeitgrenze } : {})
  : Promise.resolve(null)
const art = (r) => (baustein && r ? baustein.einordnen(r) : null)

try {
  // ------------------------------------------------------------------ sauber
  p.abschnitt("ein sauberer Lauf")
  const s = await fahre(SAUBER)
  p.gleich("sauber: rc 0", s?.rc, 0)
  p.gleich("sauber: Art sauber", art(s), "sauber")
  p.gleich("sauber: zwei gruene Proben", s?.gruen?.size, 2)
  p.gleich("sauber: nicht getoetet", s?.getoetet, false)

  // ----------------------------------------------------------------- rot
  p.abschnitt("ein Lauf mit roter Probe")
  const r = await fahre(ROT)
  p.gleich("rot: rc 1", r?.rc, 1)
  p.gleich("rot: Art rot", art(r), "rot")
  p.gleich("rot: die rote Probe ist benannt", r?.rot?.has("zwei"), true)

  // ------------------------------------------------------------- absturz
  p.abschnitt("ein Absturz ohne rote Probe")
  const a = await fahre(ABSTURZ)
  p.gleich("Absturz: rc ungleich 0", typeof a?.rc === "number" && a.rc !== 0, true)
  p.gleich("Absturz: Art absturz", art(a), "absturz")
  p.gleich("Absturz: nicht getoetet", a?.getoetet, false)
  p.gleich("Absturz: stderr nennt den Fehler", (a?.stderr ?? []).some((z) => z.includes("Pruefsatz stuerzt ab")), true)
  p.gleich("Absturz: der Schluessel in stderr ist maskiert",
    (a?.stderr ?? []).some((z) => z.includes("pk_kindlauf_attrappe")), false)
  p.gleich("Absturz: die Maske laesst eine Spur stehen", (a?.stderr ?? []).some((z) => z.includes("<KEY>")), true)
  p.gleich("Absturz: genau zwoelf stderr-Zeilen", a?.stderr?.length, 12)
  p.gleich("Absturz: der Kopf bleibt (Warnung 1)", a?.stderr?.[0], "Warnung 1")
  p.gleich("Absturz: der Fehler am Ende ueberlebt die Kappung",
    (a?.stderr ?? []).some((z) => z.includes("Error: Pruefsatz stuerzt ab")), true)

  // Node toetet auch bei Ausgabe ueber maxBuffer, dann ohne fehler.killed.
  p.abschnitt("eine Toetung wegen Ausgabeflut")
  const f = baustein ? await baustein.fahreKind(ordner, FLUT, { puffer: 1000 }) : null
  p.gleich("Flut: getoetet", f?.getoetet, true)
  p.gleich("Flut: Art zeitgrenze, nicht rot", art(f), "zeitgrenze")
  p.gleich("Flut: die Erklaerung nennt den Grund",
    String(baustein?.erklaere?.(f ?? {}) ?? "").includes("ERR_CHILD_PROCESS_STDIO_MAXBUFFER"), true)

  // Ein Kind, das gar nicht startet, erklaert sich ueber den Code.
  p.abschnitt("ein Startfehler")
  const n = baustein ? await baustein.fahreKind(join(ordner, "gibtsnicht"), SAUBER) : null
  p.gleich("Startfehler: Art absturz", art(n), "absturz")
  p.gleich("Startfehler: die Erklaerung nennt einen Textcode",
    /^rc 1 \([A-Z_]+\)/.test(String(baustein?.erklaere?.(n ?? { stderr: [] }) ?? "")), true)

  p.abschnitt("die Maske")
  const m = baustein?.maskiere ?? (() => "")
  p.gleich("Maske: Schluessel ohne pk_ nach Raumbuchstaben",
    m("https://tor.example/a/AbCdEfGh12345678_-x/k/bild.webp"), "https://tor.example/a/<KEY>/k/bild.webp")
  p.gleich("Maske: ein kurzes Pfadstueck bleibt", m("modules/x/a/kurz/b.webp"), "modules/x/a/kurz/b.webp")
  p.gleich("Maske: pk_ in Text", m("Probe pk_abcd1234 rot"), "Probe <KEY> rot")

  // Der Code des Prozesses kommt unveraendert durch, nicht pauschal als 1.
  const c3 = await fahre(CODE3)
  p.gleich("Code 3: rc 3", c3?.rc, 3)
  p.gleich("Code 3: Art absturz", art(c3), "absturz")
  p.gleich("Code 3: die Erklaerung nennt rc 3", String(baustein?.erklaere?.(c3 ?? { stderr: [] }) ?? "").startsWith("rc 3 "), true)

  // ---------------------------------------------------------- zeitgrenze
  p.abschnitt("eine Toetung an der Zeitgrenze")
  const h = await fahre(HAENGT, 300)
  p.gleich("Zeitgrenze: getoetet", h?.getoetet, true)
  p.gleich("Zeitgrenze: Art zeitgrenze", art(h), "zeitgrenze")
  // Kein Signal-Vergleich: unter Windows liefert ein getoeteter Prozess
  // gemessen auch `signal: null` (Laeufer mit --zeitgrenze 1, 17.11.2026).
  // Das Merkmal ist `killed`, nicht das Signal.
  p.gleich("Zeitgrenze: die Erklaerung nennt die Grenze",
    String(baustein?.erklaere?.(h ?? {}, 300) ?? "").includes("Zeitgrenze 300 ms"), true)
  p.gleich("Zeitgrenze: die Dauer ist gemessen", typeof h?.ms === "number" && h.ms >= 300, true)

  // Gegenwert: dieselbe Zeitgrenze toetet einen sauberen Lauf nicht.
  const s2 = await fahre(SAUBER, 30000)
  p.gleich("Zeitgrenze nicht erreicht: Art sauber", art(s2), "sauber")

  // Der Laeufer selbst, nicht nur der Baustein: eine Toetung endet mit rc 2,
  // und kein Schluessel steht in seiner Ausgabe. Je 2 bis 4 s.
  p.abschnitt("der Sabotagelaeufer")
  const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const laeufer = (...args) => new Promise((fertig) => execFile(process.execPath,
    ["--no-warnings", "tools/stream-sabotagen.mjs", ...args], { cwd: WURZEL, maxBuffer: 16 * 1024 * 1024 },
    (e, out) => fertig({ rc: e ? e.code : 0, out: String(out) })))
  const l1 = await laeufer("--satz", "heilung", "--zeitgrenze", "1")
  p.gleich("Laeufer: Toetung endet mit rc 2", l1.rc, 2)
  p.gleich("Laeufer: Toetung meldet NICHT PRUEFBAR mit S-Nummer", /NICHT PRUEFBAR S\d+ heilung: Zeitgrenze 1 ms/.test(l1.out), true)
  p.gleich("Laeufer: Toetung wird nie BEFUND ohne rote Probe", l1.out.includes("ohne rote Probe"), false)
  const l2 = await laeufer("--satz", "leinwand", "--zeitgrenze", "1")
  p.gleich("Laeufer: kein Schluessel in der Ausgabe", /pk_[A-Za-z0-9_-]{4}/.test(l2.out), false)
  p.gleich("Laeufer: die Maske hat gegriffen", l2.out.includes("<KEY>"), true)
  const l3 = await laeufer("--zeitgrenze", "0")
  p.gleich("Laeufer: --zeitgrenze 0 ist nicht pruefbar", l3.rc, 2)

  // Einordnung ohne Prozess: die vier Arten an Hand gebauter Ergebnisse.
  p.abschnitt("einordnen an gebauten Ergebnissen")
  const leer = new Set()
  p.gleich("getoetet geht vor rot", art({ rc: 1, rot: new Set(["x"]), getoetet: true }), "zeitgrenze")
  p.gleich("rc 0 ist sauber", art({ rc: 0, rot: leer, getoetet: false }), "sauber")
  p.gleich("rc 0 mit roter Zeile ist rot", art({ rc: 0, rot: new Set(["x"]), getoetet: false }), "rot")
  p.gleich("rc 1 ohne rote Zeile ist absturz", art({ rc: 1, rot: leer, getoetet: false }), "absturz")
} finally {
  rmSync(ordner, { recursive: true, force: true })
}

/*
 * NICHT PRUEFBAR AN DIESEM SATZ: welche Zeile den einen Abbruch ausgeloest
 * hat. Der Lauf verwarf stderr, und der Baum von damals (mitten im Merge,
 * nicht committet) ist nicht wiederherstellbar. Ab jetzt steht die Ursache
 * eines solchen Abbruchs in der Befundzeile.
 */

p.ende()
