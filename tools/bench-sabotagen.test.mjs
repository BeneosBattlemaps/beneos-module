/**
 * DER BENCH-LAEUFER ZAEHLT NUR, WAS WIRKLICH ROT WURDE (stre-T-015).
 *
 * Geprueft werden die Bewertung an gebauten Ergebnissen und der Laeufer
 * selbst mit `--selbstprobe`: eine Sabotage, die nichts aendert, muss als
 * Befund enden.
 *
 * Lauf:  node tools/bench-sabotagen.test.mjs
 */

import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { pruefstand } from "./lib/foundry-attrappe.mjs"

const p = pruefstand("bench-sabotagen: eine Sabotage zaehlt nur, wenn ihr Ziel rot wird")

let l = null
try { l = await import("./bench-sabotagen.mjs") } catch (_) { /* rot unten */ }
p.gleich("tools/bench-sabotagen.mjs liefert bewerte", typeof l?.bewerte, "function")

const lauf = (teile) => ({
  rc: 0, rot: new Set(), gruen: new Set(), doppelt: new Set(), getoetet: false,
  stderr: [], ausgabe: [], ms: 0, signal: null, grund: null, ...teile,
})
const art = (bench, r, ziele) => l?.bewerte(bench, lauf(r), ziele)?.art

p.abschnitt("Ziele mit Anhang an der roten Zeile")
p.gleich("Anhang ' - detail' trifft", l?.treffer(["X ist rot - weil"], "X ist rot"), 1)
p.gleich("Anhang '  (zusatz)' trifft", l?.treffer(["X ist rot  (zusatz)"], "X ist rot"), 1)
p.gleich("ein fremder Name trifft nicht", l?.treffer(["Y ist rot"], "X ist rot"), 0)

p.abschnitt("Art zeilen")
p.gleich("rote Zeile mit Anhang ist bewacht",
  art("stream-sprachen", { rc: 1, rot: new Set(["kein Schluessel fehlt - de: x"]) }, ["kein Schluessel fehlt "]), "bewacht")
p.gleich("rot, aber am Ziel vorbei, ist ein Befund",
  art("stream-sprachen", { rc: 1, rot: new Set(["etwas anderes"]) }, ["kein Schluessel fehlt "]), "befund")
p.gleich("rc 0 ist ein Befund", art("waisen-adressform", { rc: 0 }, ["x"]), "befund")
p.gleich("rc 0 trotz roter Zeile am Ziel ist ein Befund",
  art("waisen-adressform", { rc: 0, rot: new Set(["x"]) }, ["x"]), "befund")
p.gleich("rc 1 ohne rote Zeile ist ein Befund (Absturz)", art("waisen-adressform", { rc: 1 }, ["x"]), "befund")
p.gleich("getoetet ist nicht pruefbar",
  art("waisen-adressform", { rc: 1, rot: new Set(["x"]), getoetet: true }, ["x"]), "nichtpruefbar")

p.abschnitt("Art ausgang")
p.gleich("rc 2 ist nicht pruefbar", art("v15-globale", { rc: 2 }, ["ROT: 25"]), "nichtpruefbar")
p.gleich("rc 1 ohne ROT-Zeile ist ein Befund", art("v15-globale", { rc: 1, stderr: ["TypeError"] }, ["ROT: 25"]), "befund")
p.gleich("rc 1 mit ROT-Zeile am Ziel ist bewacht",
  art("v15-globale", { rc: 1, stderr: ["ROT: 25 Stellen, erlaubt sind 24."] }, ["ROT: 25 Stellen"]), "bewacht")
p.gleich("rc 1 mit ROT-Zeile, Ziel in stdout, ist bewacht",
  art("v15-globale", { rc: 1, stderr: ["ROT: 25"], ausgabe: ["    2  Ray  (bis Foundry 15)"] }, ["2  Ray  (bis Foundry 15)"]), "bewacht")
p.gleich("rc 1 mit ROT-Zeile, aber anderer Zahl, ist ein Befund",
  art("v15-globale", { rc: 1, stderr: ["ROT: 26 Stellen"] }, ["ROT: 25 Stellen"]), "befund")
p.gleich("Ausgang rc 0 ist ein Befund", art("v15-globale", { rc: 0 }, ["ROT: 25"]), "befund")

p.abschnitt("der Grundlauf")
const grenze = (zeile) => l?.grundlaufTaugt("v15-globale", lauf({ ausgabe: [zeile] }))
p.gleich("genau auf der Grenze taugt", grenze("Stellen, die bei entferntem Globalen brechen: 24, erlaubt 24"), null)
p.gleich("mit Luft taugt nicht", typeof grenze("Stellen, die bei entferntem Globalen brechen: 23, erlaubt 24"), "string")
p.gleich("ohne Grenzzeile taugt nicht", typeof grenze("irgendwas"), "string")
p.gleich("doppelte Probennamen taugen nicht",
  typeof l?.grundlaufTaugt("waisen-adressform", lauf({ gruen: new Set(["a"]), doppelt: new Set(["a"]) })), "string")
p.gleich("ein roter Grundlauf taugt nicht",
  typeof l?.grundlaufTaugt("waisen-adressform", lauf({ rc: 1, gruen: new Set(["a"]) })), "string")
const grund = lauf({ gruen: new Set(["E4 eine", "E4b und", "E4c die"]) })
p.gleich("ein Ziel, das drei Proben beginnt, ist keine Probe",
  l?.zieleOhneProbe("bildform-adresse", grund, ["E4"])?.length, 1)
p.gleich("ein Ziel, das genau eine Probe beginnt, ist eine",
  l?.zieleOhneProbe("bildform-adresse", grund, ["E4b"])?.length, 0)
p.gleich("bei Art ausgang darf das Ziel nicht schon im Grundlauf stehen",
  l?.zieleOhneProbe("v15-globale", lauf({ ausgabe: ["    1  Ray  (bis Foundry 15)"] }), ["1  Ray"])?.length, 1)

p.abschnitt("Aufrufproben mit Ziel und Gegenprobe (stre-T-019)")
const urteil = (a, r, g) => l?.aufrufUrteil?.(a, lauf(r), g)?.art
const zwei = { bench: "v14-import", args: [], rc: 2 }
const mitGegen = { ...zwei, gegen: [["x", "a", "b"]] }
p.gleich("falscher Ausgang ist ein Befund", urteil(zwei, { rc: 0 }), "befund")
p.gleich("richtiger Ausgang ohne Gegenprobe ist ok", urteil(zwei, { rc: 2 }), "ok")
p.gleich("ein getoeteter Aufruf ist nicht pruefbar", urteil(zwei, { rc: 2, getoetet: true }), "nichtpruefbar")
p.gleich("Gegenprobe mit anderem Ausgang ist ok", urteil(mitGegen, { rc: 2 }, { r: lauf({ rc: 0 }) }), "ok")
p.gleich("Gegenprobe mit gleichem Ausgang ist ein Befund: die Probe sieht den Vorgabeweg nicht",
  urteil(mitGegen, { rc: 2 }, { r: lauf({ rc: 2 }) }), "befund")
p.gleich("Gegenprobe, die nicht lief, ist nicht pruefbar", urteil(mitGegen, { rc: 2 }, { fehler: "Anker 0x" }), "nichtpruefbar")
p.gleich("Gegenprobe getoetet ist nicht pruefbar",
  urteil(mitGegen, { rc: 2 }, { r: lauf({ rc: 0, getoetet: true }) }), "nichtpruefbar")
const mitZiel = { bench: "v14-import", args: ["--without-bridge"], rc: 1, ziel: ["ROT: A", "ROT: B"] }
p.gleich("alle Ziele da ist ok", urteil(mitZiel, { rc: 1, ausgabe: ["ROT: A : weg", "ROT: B : weg"] }), "ok")
p.gleich("ein Ziel fehlt ist ein Befund", urteil(mitZiel, { rc: 1, ausgabe: ["ROT: A : weg"] }), "befund")
p.gleich("jede Aufrufprobe nennt einen bekannten Bench",
  (l?.AUFRUFPROBEN ?? [{}]).every((a) => a.bench in (l?.BENCHES ?? {})), true)
p.gleich("jede Aufrufprobe auf einen Bench, der Foundry laedt, hat eine Gegenprobe",
  (l?.AUFRUFPROBEN ?? [{}]).filter((a) => ["v14-import", "scene-merge-token", "v15-globale"].includes(a.bench))
    .every((a) => Array.isArray(a.gegen) && a.gegen.length > 0), true)

p.abschnitt("die Tabelle")
const benches = Object.keys(l?.BENCHES ?? {})
p.gleich("jede Sabotage nennt einen bekannten Bench",
  (l?.SABOTAGEN ?? [{}]).every((s) => benches.includes(s.bench)), true)
p.gleich("jede Sabotage hat mindestens ein Ziel",
  (l?.SABOTAGEN ?? [{}]).every((s) => Array.isArray(s.ziel) && s.ziel.length > 0), true)
p.gleich("jeder Bench hat mindestens eine Sabotage",
  benches.length > 0 && benches.every((b) => l.SABOTAGEN.some((s) => s.bench === b)), true)

p.abschnitt("der Laeufer selbst")
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..")
const laeufer = (...args) => new Promise((fertig) => execFile(process.execPath,
  ["--no-warnings", "tools/bench-sabotagen.mjs", ...args], { cwd: WURZEL, maxBuffer: 16 * 1024 * 1024 },
  (e, out) => fertig({ rc: e ? e.code : 0, out: String(out) })))
const s = await laeufer("--selbstprobe")
p.gleich("Selbstprobe: eine wirkungslose Sabotage endet mit rc 1", s.rc, 1)
p.gleich("Selbstprobe: sie heisst Befund, Ziel nicht rot", /BEFUND B1 waisen-adressform: rc 0, Ziel nicht rot/.test(s.out), true)
p.gleich("Selbstprobe: sie zaehlt nicht als belegt", /0 per Sabotage rot belegt/.test(s.out), true)
const u = await laeufer("--bench", "gibtsnicht")
p.gleich("ein unbekannter Bench ist nicht pruefbar", u.rc, 2)
const o = await laeufer("--bench")
p.gleich("--bench ohne Namen ist nicht pruefbar", o.rc, 2)
const leer = await laeufer("--selbstprobe", "--bench", "doppelnamen")
p.gleich("eine leere Auswahl ist nicht pruefbar", leer.rc, 2)

p.ende()
