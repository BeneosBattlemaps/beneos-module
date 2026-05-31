// Beneos Forge — imprint a Beneos Origin onto an arbitrary dnd5e Item so it
// behaves like a real Beneos loot item: the Origin Radar detects it (when
// attuned + origin matches), the character-sheet inventory shows the Origin
// pill, and the Beneos set-bonus/Origin tab counts it. The single source of
// truth all those systems read is flags.beneos-module.loot.origin.slug
// (see loot-schema.mjs + the read sites in character-inventory-origin-icon,
// set-bonus-calculator, sense-compass-data).
//
// The imprint also (per design):
//   - prepends the Origin display name to the item name ("Vampiric Longsword +1")
//   - appends the Origin's Echo-of-Origin bonus text to the description (never
//     overwriting; a marker prevents double-append on re-forge)
//   - marks the item as Named (isNamed:true) so the set-bonus tab grants its Echo.

import { OriginsRegistry } from "./origins-registry.mjs";
import {
  getLootFlags, isBeneosLootItem,
  BENEOS_LOOT_FLAG_SCOPE, BENEOS_LOOT_FLAG_KEY, LOOT_SCHEMA_VERSION,
} from "./loot-schema.mjs";
import { isReplaceableIcon, generateBeneosItemIcon } from "./forge-icon.mjs";

const ECHO_MARKER = "data-beneos-echo";

/** Render the Origin Echo rules (lightweight markdown: **bold** + blank-line
 *  paragraphs) into safe HTML for appending to a dnd5e description. */
export function echoRulesToHtml(md) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return String(md ?? "")
    .split(/\n{2,}/)
    .map((para) => {
      const t = esc(para.trim()).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
      return t ? `<p>${t}</p>` : "";
    })
    .join("");
}

/** True if this item already carries a Beneos Origin imprint. */
export function isForged(itemDoc) {
  return !!getLootFlags(itemDoc)?.origin?.slug;
}

/**
 * Imprint `slug` onto `itemDoc`. Mutates the item in place when it is a world
 * or actor-owned item; for a compendium item (read-only) it first creates a
 * world copy and imprints that. Returns the imprinted Item document.
 */
export async function imprintBeneosOrigin(itemDoc, slug, { isNamed = true } = {}) {
  if (!itemDoc) throw new Error("Forge: no item to imprint");
  const origin = OriginsRegistry.get(slug);
  if (!origin) throw new Error(`Forge: unknown origin "${slug}"`);
  if (isBeneosLootItem(itemDoc)) {
    throw new Error("Forge: item is already a Beneos item");
  }

  // Compendium items cannot be edited in place -> import a world copy.
  let item = itemDoc;
  if (itemDoc.pack) {
    const data = itemDoc.toObject();
    delete data._id;
    item = await Item.implementation.create(data);
    if (!item) throw new Error("Forge: failed to import a world copy");
  }

  const display = origin.display_name || slug;
  const echo = origin.tiers?.echo || {};
  const echoTitle = echo.title || `${display}: Echo of Origin`;
  const echoBody = echoRulesToHtml(echo.rules || echo.lore || "");

  // Name -> "<Origin> <original name>" (only prepend once).
  const baseName = item.name || "Item";
  const newName = baseName.startsWith(`${display} `) ? baseName : `${display} ${baseName}`;

  // Description -> append the Echo bonus section (never overwrite). The marker
  // makes a re-forge idempotent (no duplicate echo block).
  const desc = item.system?.description?.value ?? "";
  let newDesc = desc;
  if (!desc.includes(ECHO_MARKER)) {
    newDesc = `${desc}<hr><div ${ECHO_MARKER}="1"><p><strong>${echoTitle}</strong></p>${echoBody}</div>`;
  }

  // Generate a Beneos icon only when the current image is a Foundry/system
  // default (mundane SRD items). Custom uploads keep their image. Resolved
  // from the still-original name/type/rarity, before the rename below.
  let newImg = null;
  if (isReplaceableIcon(item.img)) {
    newImg = await generateBeneosItemIcon(item);
  }

  const updateData = { name: newName, "system.description.value": newDesc };
  if (newImg) updateData.img = newImg;
  await item.update(updateData);
  await item.setFlag(BENEOS_LOOT_FLAG_SCOPE, BENEOS_LOOT_FLAG_KEY, {
    schema: LOOT_SCHEMA_VERSION,
    isFinal: false,
    origin: { slug, isNamed },
    card: { frontTitle: newName },
    _meta: { source: "forge-v1", forgedAt: Date.now(), sourceItemId: itemDoc.id ?? null },
  });

  return item;
}

/**
 * Change only the Origin of an item that is ALREADY a Beneos item (forged or a
 * real Beneos loot item). This reassigns the radar / set-bonus / inventory-pill
 * membership without re-forging: name, description, Echo text and image are left
 * untouched, and no new Echo is granted. For a compendium item it first imports
 * a world copy. Returns the (possibly new) Item document.
 */
export async function changeBeneosOrigin(itemDoc, slug) {
  if (!itemDoc) throw new Error("Forge: no item");
  const origin = OriginsRegistry.get(slug);
  if (!origin) throw new Error(`Forge: unknown origin "${slug}"`);
  if (!isForged(itemDoc) && !isBeneosLootItem(itemDoc)) {
    throw new Error("Forge: item is not a Beneos item; forge it first");
  }

  let item = itemDoc;
  if (itemDoc.pack) {
    const data = itemDoc.toObject();
    delete data._id;
    item = await Item.implementation.create(data);
    if (!item) throw new Error("Forge: failed to import a world copy");
  }

  const flags = foundry.utils.duplicate(getLootFlags(item) || {});
  const isNamed = flags?.origin?.isNamed ?? true;
  flags.origin = { ...(flags.origin || {}), slug, isNamed };
  await item.setFlag(BENEOS_LOOT_FLAG_SCOPE, BENEOS_LOOT_FLAG_KEY, flags);

  return item;
}
