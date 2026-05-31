import { ORIGIN_META } from "../codex2/origin-meta.mjs";
import { OriginsRegistry } from "./origins-registry.mjs";
import { getLootFlags } from "./loot-schema.mjs";
import {
  migratePing, distanceIntensity, degToSector,
  attunementRangeFt, compassDistanceKey, snapToCardinal,
  CARDINAL_FULL,
} from "../lgc/lgc-math.mjs";

// Farewell state: when a ping disappears (GM deletes it) we surface
// a brief "you no longer sense the item" overlay before falling back
// to the dormant compass. Cleared automatically after `until` expires.
const _farewellInfo = new Map();        // actorId -> { snapshot, until }
const _lastMatchedIds = new Map();      // actorId -> Set<pingId>
const _lastActiveSnapshot = new Map();  // actorId -> { originSlug, originName, originColor }

export function getLastMatchedIds(actorId) {
  return _lastMatchedIds.get(actorId) ?? new Set();
}
export function setLastMatchedIds(actorId, set) {
  _lastMatchedIds.set(actorId, set);
}
export function setFarewell(actorId, snapshot, ms = 2500) {
  _farewellInfo.set(actorId, { snapshot, until: Date.now() + ms });
}
export function clearFarewell(actorId) {
  _farewellInfo.delete(actorId);
}
/** Drop all per-actor sense-compass state. Call when an actor is
 *  deleted so the module-level Maps don't grow unbounded over a long
 *  session. */
export function clearActorState(actorId) {
  _farewellInfo.delete(actorId);
  _lastMatchedIds.delete(actorId);
  _lastActiveSnapshot.delete(actorId);
}

/** Compute the current matching pings for the actor without mutating
 *  any module state. Called from the updateSetting hook to detect a
 *  ping loss (was matched before, no longer matched now) and trigger
 *  the farewell overlay. Returns the new matched Set<pingId>. */
export function computeMatchedIds(actor) {
  const out = new Set();
  try {
    const lgc = game.settings.get("beneos-module", "beneos-lgc-active-pings");
    if (Array.isArray(lgc)) {
      for (const raw of lgc) {
        const p = migratePing(raw);
        const n = _countAttunedForOriginSlug(actor, p.originSlug);
        if (n < 1) continue;
        if (p.distanceFt > attunementRangeFt(n)) continue;
        out.add(p.id);
      }
    }
  } catch (_) { /* setting may not be registered yet */ }
  return out;
}

/** Diff old vs new matched sets and stage a farewell overlay when the
 *  actor has just lost ALL pings (matched → 0). Uses the snapshot from
 *  the last active decoration so the overlay can name the Origin
 *  even though it's already gone from the world setting. */
export function diffAndMaybeFarewell(actor) {
  const newSet = computeMatchedIds(actor);
  const oldSet = getLastMatchedIds(actor.id);
  const lost = [...oldSet].filter(id => !newSet.has(id));
  if (lost.length && newSet.size === 0) {
    // Snapshot fallback for the connected-user case: if the player
    // never opened their sheet while a ping was active, we have no
    // stored origin info — use a neutral gold cue so the overlay
    // still renders and the player sees the "contact lost" beat.
    const snap = _lastActiveSnapshot.get(actor.id) ?? {
      originSlug: null,
      originName: "",
      originColor: "#d4a857",
      iconPath: null,
    };
    setFarewell(actor.id, snap, 4000);
  }
  setLastMatchedIds(actor.id, newSet);
}

// Sample senses (replace later with GM-side flag data). Mirrors the
// design prototype so the demo state looks identical to the mock.
const DEMO_SENSES = [
  { id: "vamp", originSlug: "vampiric", direction: "Northeast", dirShort: "NE", angleDeg: 45,  distanceMi: 3, rarity: 4, rarityName: "Very Rare",
    flavor: "A hungering pulse, like cold breath at the back of your neck." },
  { id: "inf",  originSlug: "infernal", direction: "West",      dirShort: "W",  angleDeg: 270, distanceMi: 1, rarity: 2, rarityName: "Uncommon",
    flavor: "Something hot, close enough to feel through the floorboards." },
  { id: "arc",  originSlug: "arcane",   direction: "South",     dirShort: "S",  angleDeg: 180, distanceMi: 7, rarity: 5, rarityName: "Legendary",
    flavor: "A faint thrum of the Weave, distant, but it pulls at the back of the mind." },
];

const RARITY_COLORS = { 1: "#c8c8c0", 2: "#7dd07d", 3: "#6db0ec", 4: "#c478ec", 5: "#f0a040" };

export function buildSenseCompassContext(actor, activeId = null) {
  const senses = _resolveSenses(actor);

  // Track matched IDs for the loss-diff in actor-set-bonus-tab.
  if (senses.length) {
    setLastMatchedIds(actor.id, new Set(senses.map(s => s.id).filter(Boolean)));
  }

  // Farewell overlay state takes precedence over isEmpty so the
  // player sees a "contact lost" beat before the compass goes dark.
  const fw = _farewellInfo.get(actor.id);
  if ((!senses.length) && fw && Date.now() < fw.until) {
    return {
      isEmpty: false,
      isFarewell: true,
      farewell: fw.snapshot,
    };
  }
  if ((!senses.length) && fw && Date.now() >= fw.until) {
    _farewellInfo.delete(actor.id);
  }

  if (!senses.length) {
    setLastMatchedIds(actor.id, new Set());
    return { isEmpty: true };
  }

  const hydrated = senses.map(s => _hydrateSense(s));
  const active = hydrated.find(h => h.id === activeId) ?? hydrated[0];
  _decorateActive(active, actor);
  _snapshotActive(actor, active);

  const others = hydrated.filter(h => h.id !== active.id).map(o => ({
    ...o,
    lede: _ledeFor(o),
  }));

  return { isEmpty: false, active, others };
}

function _lgcPingToSense(rawPing) {
  const p = migratePing(rawPing);
  const sector8 = snapToCardinal(p.directionDeg);  // N / NE / E / ...
  return {
    id: p.id,
    originSlug: p.originSlug,
    direction:  sector8,
    dirShort:   sector8,
    angleDeg:   p.directionDeg,
    distanceMi: Math.max(0.1, p.distanceFt / 5280),
    distanceFt: p.distanceFt,
    intensity:  distanceIntensity(p.distanceFt),
    distanceKey:  compassDistanceKey(p.distanceFt),    // VeryClose / Close / WithinThree / WithinFive
    cardinalKey:  sector8,                              // N / NE / ... for i18n lookup
    rarity:     3,
    rarityName: "Rare",
    flavor:     "",
  };
}

// Count attuned items of a given Origin on the actor. Used both for
// the attunement gate (1/2/3+ items grant 1/3/5-mile range) and for
// the existing detail-tier display (rarity/distance reveal levels).
function _countAttunedForOriginSlug(actor, slug) {
  if (!actor?.items) return 0;
  let n = 0;
  for (const it of actor.items) {
    const f = getLootFlags(it);
    if (f?.origin?.slug !== slug) continue;
    if (it.system?.attuned === true) n++;
    else if (it.system?.attunement === 2) n++;
  }
  return n;
}

function _resolveSenses(actor) {
  // Feature kill-switch: if the GM has disabled the Set-Bonus feature,
  // the Compass shows nothing regardless of LGC pings or actor flags.
  try {
    if (game.settings.get("beneos-module", "beneos-loot-set-bonuses") === false) {
      return [];
    }
  } catch (_) { /* setting not yet registered during early init */ }

  // 1) World-level Live Game Control pings (GM control center).
  //    Two-stage filter per ping:
  //      a) Actor must have >=1 attuned item with matching Origin
  //         (owned-not-attuned matches get a chat-whisper only).
  //      b) Ping's distance must be within the actor's detection range,
  //         which scales with the number of attuned items of that
  //         Origin: 1 attuned = 1 mi, 2 = 3 mi, 3+ = 5 mi.
  try {
    const lgc = game.settings.get("beneos-module", "beneos-lgc-active-pings");
    if (Array.isArray(lgc) && lgc.length) {
      const matched = lgc.filter(raw => {
        const p = migratePing(raw);
        const n = _countAttunedForOriginSlug(actor, p.originSlug);
        if (n < 1) return false;
        const maxFt = attunementRangeFt(n);
        return p.distanceFt <= maxFt;
      });
      if (matched.length) return matched.map(_lgcPingToSense);
    }
  } catch (_) { /* setting may not be registered yet */ }
  // 2) Per-actor flag (manual seeding for solo testing).
  const fromFlag = actor?.getFlag?.("beneos-module", "originSenses");
  if (Array.isArray(fromFlag) && fromFlag.length) return fromFlag;
  // 3) Demo fallback during dev.
  try {
    if (game.settings.get("beneos-module", "beneos-sense-demo")) return DEMO_SENSES;
  } catch (_) { /* setting not yet registered during early init */ }
  return [];
}

function _hydrateSense(s) {
  const slug = s.originSlug;
  const meta = ORIGIN_META[slug] ?? {};
  const def  = OriginsRegistry.get(slug);
  const i18nKey = `BENEOS.Codex.Origins.${slug}.Name`;
  const i18nName = game.i18n.localize(i18nKey);
  const name = (i18nName && i18nName !== i18nKey) ? i18nName : (def?.display_name ?? slug);
  return {
    ...s,
    origin: {
      slug,
      mono: meta.mono ?? slug.slice(0, 2).toUpperCase(),
      name,
      color: meta.glow ?? "#d4a857",
    },
    gemColor: RARITY_COLORS[s.rarity] ?? "#d4a857",
  };
}

function _snapshotActive(actor, active) {
  _lastActiveSnapshot.set(actor.id, {
    originSlug: active.originSlug,
    originName: active.origin.name,
    originColor: active.origin.color,
    iconPath: ORIGIN_META[active.originSlug]?.image ?? null,
  });
}

function _decorateActive(active, actor) {
  // Pulse hot-spot, port from sense-compass.jsx Z.99-102.
  const a = (active.angleDeg - 90) * Math.PI / 180;
  active.pulseX = (50 + Math.cos(a) * 32).toFixed(1);
  active.pulseY = (50 + Math.sin(a) * 32).toFixed(1);

  const attunement = _countAttunedForOrigin(actor, active.originSlug);
  active.attunement   = attunement;
  active.showRarity   = attunement >= 2;
  active.showDistance = attunement >= 3;

  active.introHtml = game.i18n.format("BENEOS.Sense.Intro", {
    origin: `<strong>${_escape(active.origin.name)}</strong>`,
  });

  // Narrative readout shown below the compass:
  //   "A pull from the North East"   (direction always spelled out)
  //   "Very close" | "Close" | "Within 3 miles" | "Within 5 miles"
  const cardinalLabel = game.i18n.localize(`BENEOS.LGC.Cardinal.${active.cardinalKey || "N"}`);
  active.pullFromHtml = game.i18n.format("BENEOS.LGC.Compass.PullFrom", {
    dir: `<strong>${_escape(cardinalLabel)}</strong>`,
  });
  active.distanceHtml = game.i18n.localize(`BENEOS.LGC.Compass.Dist.${active.distanceKey || "WithinFive"}`);
}

function _ledeFor(o) {
  return game.i18n.format("BENEOS.Sense.SomethingPulls", {
    origin: `<em style="color:${o.origin.color};">${_escape(o.origin.name.toLowerCase())}</em>`,
    direction: _escape(o.direction.toLowerCase()),
  });
}

function _countAttunedForOrigin(actor, slug) {
  if (!actor?.items) return 1;
  let n = 0;
  for (const it of actor.items) {
    if (it.system?.attuned !== true) continue;
    if (getLootFlags(it)?.origin?.slug === slug) n++;
  }
  return n || 1;
}

function _escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
