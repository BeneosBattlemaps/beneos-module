// Beneos Creature Codex — Foundry item resolver.
// Ports the Card-Creator (beneos_card_creator_v1) parsing rules to derive
// display pills (Activation / Attack / Save / Range / Template / Recharge)
// and a damage-formula line ("7 (2d6) Lightning + … · half on save") from a
// dnd5e 5.x item. Pure functions, no side effects.

const ABILITY_LABEL = Object.freeze({
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma",
});

const ACTIVATION_LABEL = Object.freeze({
  action: "Action", bonus: "Bonus Action", reaction: "Reaction",
  legendary: "Legendary Action", lair: "Lair Action",
  mythic: "Mythic Action", crew: "Crew Action",
  movement: "Movement", free: "Free Action", trait: "Trait",
});

const RECHARGE_PERIODS = new Set(["recharge", "combat", "turnStart", "turnEnd"]);

// ---- Activities access (dnd5e 5.x stores either a Map/Collection or a
// plain object keyed by activity id). Always returns a flat array. -------
function activitiesArray(sys) {
  const raw = sys?.activities;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw.values === "function") return Array.from(raw.values());
  if (typeof raw === "object") return Object.values(raw);
  return [];
}

// dnd5e 5.x stores save abilities as a Set; older data as a string or array.
// Always returns a flat array of string ability keys.
function toStringArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (v instanceof Set) return Array.from(v, String);
  if (typeof v === "string") return [v];
  if (typeof v === "object" && typeof v.values === "function") return Array.from(v.values(), String);
  return [];
}

function abilityMod(actorSystem, key) {
  const ab = actorSystem?.abilities?.[key];
  if (!ab) return null;
  if (Number.isFinite(ab.mod)) return ab.mod;
  if (Number.isFinite(ab.value)) return Math.floor((ab.value - 10) / 2);
  return null;
}
function profBonus(actorSystem) {
  const p = actorSystem?.attributes?.prof ?? actorSystem?.attributes?.proficiency;
  if (Number.isFinite(p)) return p;
  const cr = Number(actorSystem?.details?.cr);
  if (!Number.isFinite(cr)) return null;
  if (cr <= 4) return 2; if (cr <= 8) return 3; if (cr <= 12) return 4;
  if (cr <= 16) return 5; if (cr <= 20) return 6; if (cr <= 24) return 7;
  if (cr <= 28) return 8; return 9;
}
function spellcastingAbility(actorSystem) {
  const k = actorSystem?.attributes?.spellcasting;
  return (typeof k === "string" && k.length) ? k : null;
}
export function computeDcFromCalculation(actorSystem, calculation) {
  if (!actorSystem || typeof calculation !== "string" || !calculation.length) return null;
  const key = calculation === "spellcasting" ? spellcastingAbility(actorSystem) : calculation;
  if (!key) return null;
  const mod = abilityMod(actorSystem, key);
  const prof = profBonus(actorSystem);
  if (mod === null || prof === null) return null;
  return 8 + mod + prof;
}

function parseBonusInt(bonusStr) {
  if (typeof bonusStr !== "string" || !bonusStr.length) return 0;
  const m = bonusStr.match(/^\s*([+-]?\d+)/);
  return m ? Number(m[1]) : 0;
}
export function diceAverage(number, denomination, bonusInt) {
  return Math.floor(number * (denomination + 1) / 2 + bonusInt);
}

/** Format one damage part as "AVG (XdY+M) Type" (skips avg for a single
 *  small die without bonus, e.g. "(1d4) Cold"). */
export function formatDamagePart(part) {
  if (!part || typeof part !== "object") return "";
  const number = Number.isInteger(part.number) ? part.number : null;
  const denomination = Number.isInteger(part.denomination) ? part.denomination : null;
  const bonus = (typeof part.bonus === "string") ? part.bonus.trim() : "";
  const types = Array.isArray(part.types) ? part.types.filter(t => typeof t === "string") : [];
  const hasDice = (number !== null && denomination !== null);
  if (!hasDice && !bonus && !types.length) return "";
  const dieStr = hasDice ? `${number}d${denomination}` : "";
  const bonusNorm = bonus ? (bonus.startsWith("+") || bonus.startsWith("-") ? bonus : `+${bonus}`) : "";
  const formula = `${dieStr}${bonusNorm}`;
  const typeStr = types.length ? types.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join("/") : "";
  const bonusInt = parseBonusInt(bonus);
  let display;
  if (hasDice) {
    const avg = diceAverage(number, denomination, bonusInt);
    const skipAvg = (number === 1 && denomination <= 4 && bonusInt === 0);
    display = skipAvg ? `(${formula})` : `${avg} (${formula})`;
  } else {
    display = formula;
  }
  return typeStr ? `${display} ${typeStr}` : display;
}

export function rechargeLabel(recoveryEntry) {
  if (!recoveryEntry || typeof recoveryEntry !== "object") return null;
  const period = recoveryEntry.period;
  const formula = recoveryEntry.formula;
  if (!period) return null;
  if (RECHARGE_PERIODS.has(period)) {
    return (typeof formula === "string" && formula.trim().length) ? `Recharge ${formula.trim()}` : "Recharge";
  }
  if (period === "day" || period === "dawn" || period === "dusk") return "Daily";
  if (period === "shortRest") return "Short Rest";
  if (period === "longRest") return "Long Rest";
  return null;
}

function pickActivationType(item, acts) {
  const legacy = item?.system?.activation?.type;
  if (typeof legacy === "string" && legacy.length) return legacy;
  for (const a of acts) {
    const t = a?.activation?.type;
    if (typeof t === "string" && t.length) return t;
  }
  return "trait";
}

/** Build the display pills for an ability item, in the order
 *  Activation → Attack → Save → Range → Template → Recharge.
 *  Returns [{ label, kind }]. kind ∈ activation|attack|save|range|recharge. */
export function buildHeaderPills(item, actor) {
  if (!item) return [];
  const sys = item.system ?? {};
  const acts = activitiesArray(sys);
  const actorSystem = actor?.system ?? null;
  const pills = [];

  // The activation type (Action / Reaction / Bonus / Trait) is already shown
  // as the colored ability tag in the card header, so it is intentionally NOT
  // repeated as a pill here (avoids the redundant "Action · Action" row).

  for (const act of acts) {
    if (act?.attack) {
      const bonus = (act.attack.bonus != null && String(act.attack.bonus).trim().length) ? String(act.attack.bonus).trim() : "";
      const bonusFmt = bonus ? (bonus.startsWith("+") || bonus.startsWith("-") ? bonus : `+${bonus}`) : "";
      const aType = act.attack.type;
      const typeLabel = (aType?.value === "ranged") ? "Ranged" : (aType?.value === "melee" ? "Melee" : "");
      if (bonusFmt || typeLabel) {
        pills.push({ label: [typeLabel, bonusFmt ? `${bonusFmt} to Hit` : "Attack"].filter(Boolean).join(" "), kind: "attack" });
      }
    }
    const abList = toStringArray(act?.save?.ability);
    if (abList.length) {
      const dcObj = act.save.dc || {};
      let dcStr = "DC ?";
      if (dcObj.formula && /^\d+$/.test(String(dcObj.formula).trim())) dcStr = `DC ${String(dcObj.formula).trim()}`;
      else if (dcObj.calculation) {
        const c = computeDcFromCalculation(actorSystem, dcObj.calculation);
        if (c !== null) dcStr = `DC ${c}`;
      }
      const abStr = abList.map(a => ABILITY_LABEL[a] || String(a).toUpperCase()).filter(Boolean).join("/");
      pills.push({ label: `${dcStr} ${abStr} Save`.trim(), kind: "save" });
    }
    const r = act?.range;
    if (r && (r.reach || r.value)) {
      const units = r.units || "ft";
      if (r.reach) pills.push({ label: `${r.reach} ${units} reach`, kind: "range" });
      else if (r.long) pills.push({ label: `${r.value}/${r.long} ${units}`, kind: "range" });
      else if (r.units !== "self" && r.units !== "touch") pills.push({ label: `${r.value} ${units}`, kind: "range" });
    }
    const tpl = act?.target?.template;
    if (tpl && tpl.size && tpl.type) {
      const units = tpl.units || "ft";
      pills.push({ label: `${tpl.size} ${units} ${tpl.type}`, kind: "range" });
    }
  }

  const recovery = Array.isArray(sys.uses?.recovery) ? sys.uses.recovery[0] : null;
  const rl = rechargeLabel(recovery);
  if (rl) pills.push({ label: rl, kind: "recharge" });

  return pills;
}

/** Build the damage-formula line for an ability item:
 *  "7 (2d6) Lightning + 7 (2d6) Lightning · half on save". */
export function buildDamageLine(item) {
  if (!item) return "";
  const acts = activitiesArray(item.system ?? {});
  const bits = [];
  let halfOnSave = false;
  for (const act of acts) {
    const parts = Array.isArray(act?.damage?.parts) ? act.damage.parts : [];
    for (const p of parts) {
      const f = formatDamagePart(p);
      if (f) bits.push(f);
    }
    if (act?.damage?.onSave === "half") halfOnSave = true;
  }
  if (!bits.length) return "";
  const out = [bits.join(" + ")];
  if (halfOnSave) out.push("half on save");
  return out.join(" · ");
}
