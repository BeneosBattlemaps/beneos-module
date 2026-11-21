/**
 * Where the benches look for an installed Foundry (stre-T-019).
 *
 * Three benches load Foundry's own code: v14-import, scene-merge-token and
 * v15-globale. Each one carried its own copy of this list, and two copies drift.
 * The list lives here and only here.
 *
 * A bench that finds no Foundry ends with exit code 2, "could not measure". It
 * never ends green: "nothing lost" and "nothing measured" would print the same.
 *
 * `BENEOS_FOUNDRY_ORTE` replaces the list, separated by the platform's path
 * delimiter (`;` on Windows). Set but empty, the list is empty: that is how the
 * sabotage runner proves the behaviour of a machine without Foundry.
 */
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

export const FOUNDRY_ORTE = [
  "D:/PNP_Game/Foundry VTT/FoundryVTT/Foundry Virtual Tabletop V14/App/resources/app",
  "D:/PNP_Game/Foundry VTT/FoundryVTT/Foundry Virtual Tabletop v13/resources/app",
  "C:/Program Files/Foundry Virtual Tabletop/resources/app",
]

/** The list in force: the environment variable when set, otherwise the default. */
export function foundryOrte(umgebung = process.env) {
  const gesetzt = umgebung.BENEOS_FOUNDRY_ORTE
  if (gesetzt === undefined) return [...FOUNDRY_ORTE]
  return gesetzt.split(delimiter).map((s) => s.trim()).filter(Boolean)
}

/**
 * `--foundry` given replaces the list, even when its value is empty: a bad
 * argument must not fall back to the default places and measure something else.
 */
function ortsliste(gesetzt, umgebung) {
  if (gesetzt === null || gesetzt === undefined) return foundryOrte(umgebung)
  return gesetzt ? [gesetzt] : []
}

/**
 * The first app folder that holds one of `merkmale`, or null.
 *
 * `gesetzt` is the value of a bench's `--foundry`. It replaces the list and may
 * name the app folder or the installation above it.
 *
 * @returns {{app: string, datei: string, gesucht: string[]}|null}
 */
export function findeFoundry({ gesetzt = null, merkmale, umgebung = process.env }) {
  const orte = ortsliste(gesetzt, umgebung)
  for (const ort of orte) {
    for (const app of [ort, join(ort, "resources", "app"), join(ort, "App", "resources", "app")]) {
      for (const m of merkmale) {
        const datei = join(app, m)
        if (existsSync(datei)) return { app, datei, gesucht: orte }
      }
    }
  }
  return null
}

/** The places a failed search looked in, for the message of exit code 2. */
export function gesuchteOrte(gesetzt = null, umgebung = process.env) {
  const orte = ortsliste(gesetzt, umgebung)
  return orte.length ? orte : ["(no place: the list is empty)"]
}
