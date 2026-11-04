/**
 * item-tooltip.test.mjs
 *
 * Gegenprobe zu `item-tooltip.mjs`. Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/cloud-v2/item-tooltip.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 * Jeder Fall nennt Soll und Ist.
 */
import { formatItemLead, itemTooltipHtml } from "./item-tooltip.mjs"

const cases = [
  // Lead erkannt, Seltenheit vorn, Punkt und Leerzeichen als Trenner.
  ["Ring, RareThis ring has 3 charges.", "Rare Ring. This ring has 3 charges."],
  ["Armor (Shield), UncommonWhile holding this Shield, you gain.", "Uncommon Armor (Shield). While holding this Shield, you gain."],
  ["Wondrous Item, Uncommon (Requires Attunement)These furred boots.", "Uncommon Wondrous Item (Requires Attunement). These furred boots."],
  ["Weapon (Longsword), Very RareYou gain a +3 bonus.", "Very Rare Weapon (Longsword). You gain a +3 bonus."],
  ["Ring, Epic", "Epic Ring"],
  // Komma in der Typklammer, lange Klammer nach der Seltenheit.
  ["Armor (Medium or Heavy, But Not Hide), RareWhile wearing.", "Rare Armor (Medium or Heavy, But Not Hide). While wearing."],
  ["Wand, Uncommon (Requires Attunement by a Cleric, Druid, Sorcerer, Warlock, or Wizard)This wand.", "Uncommon Wand (Requires Attunement by a Cleric, Druid, Sorcerer, Warlock, or Wizard). This wand."],
  // "Varies" behaelt die Reihenfolge und bekommt nur den Trenner.
  ["Potion, VariesA potion.", "Potion, Varies. A potion."],
  // Kein Lead: Text bleibt, wie er ist.
  ["Scale armor, reducing damage taken.", "Scale armor, reducing damage taken."],
  ["A dreadful blade that extinguishes all light.", "A dreadful blade that extinguishes all light."],
  ["Ring, rare and cursed.", "Ring, rare and cursed."],
  ["Ring, Rarely seen in battle.", "Ring, Rarely seen in battle."],
  ["", ""],
  [null, null],
]

let red = 0
for (const [input, want] of cases) {
  const got = formatItemLead(input)
  const ok = got === want
  if (!ok) red++
  console.log(`${ok ? "gruen" : "ROT  "} | soll ${JSON.stringify(want)} | ist ${JSON.stringify(got)}`)
}

// Das Ziel ist nicht die Zeichenkette, sondern das, was der Browser daraus
// macht: das Attribut loest Entitaeten einmal auf, der Tooltip rendert das
// Ergebnis als HTML. Gemessen wird nach genau dieser einen Aufloesung.
const decodeAttr = (s) => s.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")
const raw = itemTooltipHtml("A<img src=x onerror=1>", "10 gp", "Ring, RareA <x>")
const html = decodeAttr(raw)
const wantHtml = '<strong class="bn-tt-title">A&lt;img src=x onerror=1&gt;</strong> &middot; 10 gp<p>Rare Ring. A &lt;x&gt;</p>'
const htmlOk = html === wantHtml && !raw.includes('"') && !raw.includes("<")
if (!htmlOk) red++
console.log(`${htmlOk ? "gruen" : "ROT  "} | soll ${wantHtml} | ist ${html}`)

console.log(`${cases.length + 1 - red} von ${cases.length + 1} gruen`)
process.exit(red ? 1 : 0)
