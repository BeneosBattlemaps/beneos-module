/**
 * Pruefsatz fuer kreatur-ziele.mjs, stre-T-064 (E5).
 *
 * Die Zielregel einer Kreaturendatei steht EINMAL, und Installer und
 * Umstellung rufen dieselbe Funktion. Dieser Satz haelt zwei Dinge fest:
 *
 *  1. Die Ausgabe der Funktion ist genau das, was der Installer bis zum
 *     14.11.2026 von Hand gebildet hat (beneos_cloud.js, Ausdruecke an den
 *     Stellen der Prototyp-Textur und des Registers). Die Erwartung steht hier
 *     als feste Zeichenkette und nicht als Aufruf, sonst prueft der Satz die
 *     Funktion gegen sich selbst.
 *  2. Der Installer RUFT die Funktion an allen drei Stellen. Ein Text-Pin,
 *     denn beneos_cloud.js laedt in Node nicht (Dialog fehlt).
 *
 * Ohne Netz, ohne Foundry.
 *
 *   node scripts/stream/kreatur-ziele.test.mjs
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const hier = dirname(fileURLToPath(import.meta.url))
const { kreaturDateiOk, varianteStreamt, kreaturBildZiel, kreaturOrdner, registerTopDown }
  = await import("./kreatur-ziele.mjs")

let gruen = 0
let rot = 0
function gleich(name, ist, soll) {
  if (JSON.stringify(ist) === JSON.stringify(soll)) { gruen++; console.log("  ok   " + name) }
  else { rot++; console.log("  ROT  " + name + "\n       soll " + JSON.stringify(soll) + "\n       ist  " + JSON.stringify(ist)) }
}

// Eine erfundene Adressbildung, damit der Satz ohne Einstellungen laeuft.
const adresse = (k, f) => `https://gate.test/c/KEY/beneos_ct_${k}/${f}`

// --- Ordner und Dateiname ----------------------------------------------------
gleich("Ordner wie finalFolder", kreaturOrdner("000-wolf"), "beneos_assets/cloud/tokens/000-wolf")
gleich("gewoehnlicher Name ok", kreaturDateiOk("000-wolf-1-token.webp"), true)
gleich("Name mit Schraegstrich nein", kreaturDateiOk("../x-1-token.webp"), false)
gleich("Name ohne webp nein", kreaturDateiOk("x-1-token.png"), false)
gleich("leerer Name nein", kreaturDateiOk(undefined), false)

// --- variantStreamt, wie beneos_cloud.js bisher --------------------------------
gleich("streamt mit sauberem Token und Top", varianteStreamt({ streamt: true, tokenName: "a-1-token.webp", topName: "a-1-top.webp" }), true)
gleich("streamt ohne Top", varianteStreamt({ streamt: true, tokenName: "a-1-token.webp", topName: undefined }), true)
gleich("untauglicher Top kippt die Variante", varianteStreamt({ streamt: true, tokenName: "a-1-token.webp", topName: "a b.webp" }), false)
gleich("untauglicher Token kippt die Variante", varianteStreamt({ streamt: true, tokenName: "x/y.webp", topName: "a-1-top.webp" }), false)
gleich("Download streamt nie", varianteStreamt({ streamt: false, tokenName: "a-1-token.webp", topName: "a-1-top.webp" }), false)

// --- Bildziel ------------------------------------------------------------------
gleich("Bildziel gestreamt", kreaturBildZiel({ tokenKey: "000-wolf", name: "000-wolf-1-token.webp", streamt: true, adresse }),
  "https://gate.test/c/KEY/beneos_ct_000-wolf/000-wolf-1-token.webp")
gleich("Bildziel lokal", kreaturBildZiel({ tokenKey: "000-wolf", name: "000-wolf-1-token.webp", streamt: false, adresse }),
  "beneos_assets/cloud/tokens/000-wolf/000-wolf-1-token.webp")

// --- Register topDown ------------------------------------------------------------
gleich("Register topDown gestreamt", registerTopDown({ tokenKey: "000-wolf", topName: "000-wolf-1-top.webp", variantStreamt: true, adresse }),
  "https://gate.test/c/KEY/beneos_ct_000-wolf/000-wolf-1-top.webp")
gleich("Register topDown lokal", registerTopDown({ tokenKey: "000-wolf", topName: "000-wolf-1-top.webp", variantStreamt: false, adresse }),
  "beneos_assets/cloud/tokens/000-wolf/000-wolf-1-top.webp")
gleich("Register topDown ohne Top null", registerTopDown({ tokenKey: "000-wolf", topName: undefined, variantStreamt: true, adresse }), null)

// --- zwanzig Varianten, jede mit eigenem Namen -------------------------------------
const zwanzig = Array.from({ length: 20 }, (_, i) => kreaturBildZiel({
  tokenKey: "x", name: `x-${i + 1}-top.webp`, streamt: true, adresse,
}))
gleich("zwanzig Varianten, zwanzig Adressen", new Set(zwanzig).size, 20)
gleich("Variante 20 traegt ihre Nummer", zwanzig[19], "https://gate.test/c/KEY/beneos_ct_x/x-20-top.webp")

// --- Text-Pin: der Installer ruft die Funktion ------------------------------------
const cloud = readFileSync(join(hier, "..", "beneos_cloud.js"), "utf8")
const zaehle = (re) => (cloud.match(re) || []).length
gleich("Installer importiert kreatur-ziele.mjs", /from "\.\/stream\/kreatur-ziele\.mjs"/.test(cloud), true)
gleich("Installer ruft varianteStreamt einmal", zaehle(/\bvarianteStreamt\(\{/g), 1)
gleich("Installer ruft kreaturBildZiel fuer Token und Top", zaehle(/\bkreaturBildZiel\(\{/g), 2)
gleich("Installer ruft registerTopDown einmal", zaehle(/\bregisterTopDown\(\{/g), 1)
gleich("kein Handausdruck mehr fuer die Prototyp-Textur",
  /prototypeToken\.texture\.src = variantStreamt\s*\?/.test(cloud), false)
gleich("_beneosKreaturDateiOk reicht an kreaturDateiOk weiter",
  /function _beneosKreaturDateiOk\(filename\) \{\s*return kreaturDateiOk\(filename\)/.test(cloud), true)

console.log(`\n${gruen} gruen, ${rot} rot`)
process.exit(rot ? 1 : 0)
