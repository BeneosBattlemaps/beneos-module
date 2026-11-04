/* ============================================================
   Hover tooltip of an item in the Loot Generator and the Magic Shop
   Generator. Pure, no Foundry dependency, so it can be checked in Node.

   The catalog carries SRD descriptions as flat text: the type and rarity
   line ("Ring, Rare", "Wondrous Item, Uncommon (Requires Attunement)")
   runs straight into the body ("Ring, RareThis ring has..."). The lead is
   split off, the rarity moves to the front ("Rare Ring") and a full stop
   with a space separates it from the body (user 2026-11-04).
   ============================================================ */

const RARITIES = ["Very Rare", "Uncommon", "Common", "Rare", "Epic", "Legendary", "Mythic", "Artifact", "Varies"]

// "Ring, Rare" at the very start: a type with an optional bracket that may
// hold commas ("Armor (Medium or Heavy, But Not Hide)"), the rarity, an
// optional bracket after it, then the body. The body must start with an
// upper-case letter or a digit, so a Beneos sentence such as
// "Scale armor, reducing damage" never matches.
const LEAD = new RegExp(
  `^([A-Z][^,.()]{0,40}(?: \\([^)]{1,80}\\))?), (${RARITIES.join("|")})( \\([^)]{1,120}\\))?(?=[A-Z0-9]|$)`
)

export function formatItemLead(description) {
  if (!description || typeof description !== "string") return description ?? null
  const m = LEAD.exec(description)
  if (!m) return description
  const [whole, type, rarity, bracket = ""] = m
  const body = description.slice(whole.length).trimStart()
  // "Varies" is no adjective: "Varies Potion" reads wrong, so that lead
  // keeps its order and only gains the separator.
  const lead = rarity === "Varies" ? `${type}, ${rarity}${bracket}` : `${rarity} ${type}${bracket}`
  return body ? `${lead}. ${body}` : lead
}

const safe = (s) => String(s || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")

// Name in gold (class bn-tt-title, css/beneos-cloud.css), price after a
// middle dot, the description below. The result is attribute-ready: the
// templates put it unescaped ({{{ }}}) into data-tooltip="...", the HTML
// parser decodes the entities once, and Foundry's tooltip then renders the
// decoded value as HTML. So the text is escaped for the HTML first and the
// whole HTML a second time for the attribute; escaping only once would
// turn a catalog "&lt;img&gt;" back into a live tag.
export function itemTooltipHtml(name, priceLabel, description) {
  const title = `<strong class="bn-tt-title">${safe(name)}</strong>`
  const head = priceLabel ? `${title} &middot; ${safe(priceLabel)}` : title
  const text = formatItemLead(description)
  const body = text ? `<p>${safe(text)}</p>` : ""
  return safe(`${head}${body}`)
}
