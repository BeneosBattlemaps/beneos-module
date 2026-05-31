// LGC ping → target dispatcher. Pure helper: given a freshly-added
// ping (already in the new schema with originSlug, distanceFt,
// directionDeg), walks every actor in the world, classifies match per
// user, and returns who should hear the sound, who should get the
// detailed whisper, and who should get the "your item vibrates"
// whisper. Used by beneos-lgc.mjs._onPingAdd.

import { getLootFlags } from "../loot/loot-schema.mjs";
import { attunementRangeFt, migratePing } from "./lgc-math.mjs";

const MOD = "beneos-module";
const FLAG_KEY = "lgcRead";   // unused here, kept for chatcard tooling

// True if the actor has at least one item carrying the given origin
// slug in its loot-flag. Returns the first matching item so we can
// quote its name in the owned-not-attuned whisper.
function _firstItemMatching(actor, slug) {
  if (!actor?.items) return null;
  for (const it of actor.items) {
    const f = getLootFlags(it);
    if (f?.origin?.slug === slug) return it;
  }
  return null;
}

function _firstAttunedItemMatching(actor, slug) {
  if (!actor?.items) return null;
  for (const it of actor.items) {
    const f = getLootFlags(it);
    if (f?.origin?.slug !== slug) continue;
    // dnd5e attunement: system.attuned === true (5.x). Pre-5.x used
    // system.attunement === 2. Treat both as attuned.
    if (it.system?.attuned === true) return it;
    if (it.system?.attunement === 2) return it;
  }
  return null;
}

function _attunedCountForOrigin(actor, slug) {
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

// Map an actor to its owning user. Foundry assigns OWNER permission
// to one or more user-ids in actor.ownership; we prefer a non-GM
// user (the actual player) but fall back to a GM owner if no player
// owns the actor, so GM-test chars still trigger whispers.
function _ownerUserIdForActor(actor) {
  const own = actor?.ownership ?? {};
  let gmFallback = null;
  for (const [uid, level] of Object.entries(own)) {
    if (uid === "default") continue;
    if (level < 3) continue;
    const user = game.users?.get?.(uid);
    if (!user || !user.active) continue;
    if (!user.isGM) return uid;
    if (!gmFallback) gmFallback = uid;
  }
  return gmFallback;
}

// Classify all actors against the ping. Returns:
//   attuned:  Array<{ userId, actorId, actorName, itemName }>
//   owned:    Array<{ userId, actorId, actorName, itemName }>  (NOT attuned)
// The same user can appear in both lists if they have one attuned and
// one owned-not-attuned matching item across different chars. Sound
// is deduped to attuned-only users, max 1× per user.
export function dispatchPing(ping) {
  // World setting kill-switch: when "Use Beneos Items Set Bonuses" is
  // off, no whisper / sound / compass effect for anyone. The GM can
  // still add pings (settings store) but they will not surface to
  // players until the feature is re-enabled.
  try {
    if (game.settings.get("beneos-module", "beneos-loot-set-bonuses") === false) {
      return { attuned: [], owned: [], soundUserIds: [] };
    }
  } catch (_) { /* setting not registered yet during init */ }

  const p = migratePing(ping);
  const slug = p?.originSlug;
  if (!slug) return { attuned: [], owned: [], soundUserIds: [] };

  const attuned = [];
  const owned   = [];
  const attunedUserSet = new Set();

  for (const actor of game.actors ?? []) {
    if (actor.type !== "character" && actor.type !== "npc") continue;
    const userId = _ownerUserIdForActor(actor);
    if (!userId) continue;

    const attCount = _attunedCountForOrigin(actor, slug);
    if (attCount > 0) {
      // Gate by detection range: the user only sees this ping in their
      // compass if the ping is within the attunement-derived range
      // (1/3/5 mi for 1/2/3+ attuned items). Out-of-range attuned
      // matches get nothing — no compass, no whisper, no sound.
      const maxFt = attunementRangeFt(attCount);
      if (p.distanceFt > maxFt) continue;
      const attItem = _firstAttunedItemMatching(actor, slug);
      attuned.push({
        userId,
        actorId: actor.id,
        actorName: actor.name,
        itemName: attItem?.name,
      });
      attunedUserSet.add(userId);
      continue;
    }
    // Owned-not-attuned. The vibrate-whisper is a hint that the item
    // is *physically close* to its origin even without attunement, so
    // gate it on the 1-attunement-equivalent range (1 mile). Beyond
    // that the item stays silent — matches the "only when echoes are
    // active" expectation from the player's side.
    const item = _firstItemMatching(actor, slug);
    if (item && p.distanceFt <= attunementRangeFt(1)) {
      owned.push({
        userId,
        actorId: actor.id,
        actorName: actor.name,
        itemName: item.name,
      });
    }
  }

  // Dedup: user that already gets the attuned whisper should NOT also
  // get the "your item vibrates" whisper (the attuned one covers it).
  const ownedFiltered = owned.filter(o => !attunedUserSet.has(o.userId));

  return {
    attuned,
    owned: ownedFiltered,
    // Distinct user-ids that should play the sound exactly once.
    soundUserIds: [...attunedUserSet],
  };
}

// GM-side helper: which actors currently see THIS ping on their
// Compass? Same gate as the player-side filter (attunement-count gives
// range, ping must be within that range). Returns a list suitable
// for the active-ping-card footer ("Creatures sensing this").
export function actorsSensingPing(ping) {
  const p = migratePing(ping);
  const slug = p?.originSlug;
  if (!slug) return [];
  const out = [];
  for (const actor of game.actors ?? []) {
    if (actor.type !== "character" && actor.type !== "npc") continue;
    const attCount = _attunedCountForOrigin(actor, slug);
    if (attCount < 1) continue;
    if (p.distanceFt > attunementRangeFt(attCount)) continue;
    out.push({
      id: actor.id,
      name: actor.name,
      img: actor.img || actor.prototypeToken?.texture?.src || null,
      attCount,
    });
  }
  return out;
}

export const _internals = { _firstItemMatching, _firstAttunedItemMatching, _ownerUserIdForActor };
