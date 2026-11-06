/**
 * map-sharpen-curve.test.mjs
 *
 * Gegenprobe zu `map-sharpen-curve.mjs`, ohne Foundry:
 *
 *   node scripts/canvas/map-sharpen-curve.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 */
import { squaresAcross, sharpenAmount, sharpenWanted, texelSize, strengthFromPoints, upsertPoint, clampStrength } from "./map-sharpen-curve.mjs"

const near = (a, b) => a !== null && Math.abs(a - b) < 1e-9
const P = [{ squares: 7, strength: 3 }, { squares: 15, strength: 1 }, { squares: 25, strength: 0 }]

const cases = [
  // Felder ueber den Bildschirm: 1920 / (100 * 1) = 19,2; 4K-Raster 120 bei Zoom 2.
  ["squares 1920/100/1", squaresAcross(1920, 100, 1), 19.2],
  ["squares 1920/120/2", squaresAcross(1920, 120, 2), 8],
  ["squares fehlender Wert", squaresAcross(0, 100, 1), null],
  ["squares negativer Zoom", squaresAcross(1920, 100, -1), null],
  // Kurve: 25 und mehr Felder 0, 7 und weniger 1, dazwischen linear.
  ["amount 40", sharpenAmount(40), 0],
  ["amount 25", sharpenAmount(25), 0],
  ["amount 16", sharpenAmount(16), 0.5],
  ["amount 7", sharpenAmount(7), 1],
  ["amount 3", sharpenAmount(3), 1],
  ["amount null", sharpenAmount(null), 0],
  ["amount NaN", sharpenAmount(NaN), 0],
  // Schwellen vertauscht: lieber gar nicht schaerfen als falsch herum.
  ["amount start<=full", sharpenAmount(10, 7, 25), 0],
  // An oder aus: Einstellung, Performance-Modus, Video.
  ["wanted an, perf aus, video", sharpenWanted(true, false, true), true],
  ["wanted perf an", sharpenWanted(true, true, true), false],
  ["wanted standbild", sharpenWanted(true, false, false), false],
  ["wanted einstellung aus", sharpenWanted(false, false, true), false],
  // Texelabstand nur bei bekannter Groesse.
  ["texel 3840x2160", texelSize(3840, 2160), [1 / 3840, 1 / 2160]],
  ["texel breite 0", texelSize(0, 2160), null],
  ["texel unbekannt", texelSize(undefined, undefined), null],
  // Eingemessene Kurve: Punkte bei 7 (3.0), 15 (1.0), 25 (0); dazwischen linear, aussen gehalten.
  ["punkte genau 15", strengthFromPoints(P, 15), 1],
  ["punkte zwischen 7 und 15", strengthFromPoints(P, 11), 2],
  ["punkte zwischen 15 und 25", strengthFromPoints(P, 20), 0.5],
  ["punkte naeher als 7", strengthFromPoints(P, 3), 3],
  ["punkte weiter als 25", strengthFromPoints(P, 40), 0],
  ["punkte unsortiert", strengthFromPoints([P[2], P[0], P[1]], 11), 2],
  ["punkte ein Punkt", strengthFromPoints([{ squares: 10, strength: 2 }], 30), 2],
  ["punkte leer", strengthFromPoints([], 10), null],
  ["punkte kaputt", strengthFromPoints([{ squares: "x" }], 10), null],
  ["punkte zoom unbekannt", strengthFromPoints(P, null), null],
  // Speichern: gleicher Zoom ersetzt, anderer ergaenzt.
  ["upsert ersetzt", upsertPoint(P, 15.1, 1.8).length, 3],
  ["upsert ersetzter Wert", strengthFromPoints(upsertPoint(P, 15.1, 1.8), 15.1), 1.8],
  ["upsert ergaenzt", upsertPoint(P, 10, 2).length, 4],
  ["upsert aus leer", upsertPoint(undefined, 10, 2).length, 1],
  // Toleranzgrenze: genau 0.25 daneben ergaenzt, knapp darunter ersetzt.
  ["upsert 0.25 daneben ergaenzt", upsertPoint(P, 15.25, 2).length, 4],
  ["upsert 0.24 daneben ersetzt", upsertPoint(P, 15.24, 2).length, 3],
  // Staerke wird auf 0..5 geklemmt.
  ["upsert klemmt oben", strengthFromPoints(upsertPoint([], 10, 9), 10), 5],
  ["upsert klemmt unten", strengthFromPoints(upsertPoint([], 10, -1), 10), 0],
  ["clamp mitte", clampStrength(2.5), 2.5],
]

let red = 0
for (const [label, got, want] of cases) {
  const ok = want === null ? got === null
    : typeof want === "boolean" ? got === want
    : Array.isArray(want) ? Array.isArray(got) && want.every((w, i) => near(got[i], w))
    : near(got, want)
  if (!ok) red++
  console.log(`${ok ? "gruen" : "ROT  "} | ${label} | soll ${want} | ist ${got}`)
}

// Fliessend: jeder Schritt hineingezoomt schaerft mindestens so stark wie der vorige.
let prev = -1, mono = true
for (let s = 30; s >= 2; s -= 0.25) { const a = sharpenAmount(s); if (a < prev) mono = false; prev = a }
if (!mono) red++
console.log(`${mono ? "gruen" : "ROT  "} | monoton beim Hineinzoomen`)

const total = cases.length + 1
console.log(`${total - red} von ${total} gruen`)
process.exit(red ? 1 : 0)
