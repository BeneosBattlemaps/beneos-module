// LGC Chat-Card: two flavours per ping fire-event.
//
//   "attuned" - the player has an attuned item with the matching origin.
//               The whisper has a clickable char-link that opens the
//               actor sheet and switches to the Beneos tab. The card
//               pulses gold until clicked, at which point the read
//               flag is persisted and the pulse stops.
//
//   "owned"   - the player has the item but is not attuned. Cue tells
//               them the item is vibrating but offers no targeting.
//
// Both are whispered to the player + GM so the GM can audit dispatch.

import { OriginsRegistry } from "../loot/origins-registry.mjs";
import { ORIGIN_META } from "../codex2/origin-meta.mjs";
import { snapToCardinal, coarseDistanceBucket, CARDINAL_FULL } from "./lgc-math.mjs";

const MOD = "beneos-module";
const FLAG_READ = "lgcRead";

function _originDisplay(slug) {
  const meta = ORIGIN_META[slug] ?? {};
  const def  = OriginsRegistry.get(slug);
  const i18nKey = `BENEOS.Codex.Origins.${slug}.Name`;
  const i18nName = game.i18n.localize(i18nKey);
  const name = (i18nName && i18nName !== i18nKey) ? i18nName : (def?.display_name ?? slug);
  // Use the BW silhouette so the Codex-style emblem tints the form
  // in the origin colour rather than picking up the colour artwork.
  const bwPath = OriginsRegistry.iconPath?.(slug, "bw");
  return {
    slug,
    name,
    color: meta.glow ?? "#d4a857",
    iconPath: bwPath ?? meta.image ?? null,
  };
}

// Codex-style origin emblem (mirror of the .emblem-tint-wrap pattern
// from beneos-codex.css). Renders the BW silhouette tinted in the
// origin's signature colour with a luminosity overlay so the inner
// detail of the icon stays readable. Falls back to a coloured dot.
function _emblemHtml(origin) {
  if (origin?.iconPath) {
    return `<span class="lgc-origin-emblem">
      <span class="emblem-disc has-image" style="--origin-color: ${origin.color};">
        <span class="emblem-tint-wrap">
          <span class="emblem-tint-base"
                style="background-color: ${origin.color};
                       -webkit-mask: url('${origin.iconPath}') center / contain no-repeat;
                               mask: url('${origin.iconPath}') center / contain no-repeat;"></span>
          <img class="emblem-tint-detail" src="${origin.iconPath}" alt="" />
        </span>
      </span>
    </span>`;
  }
  return `<span class="lgc-origin-emblem"><span class="emblem-disc" style="--origin-color: ${origin?.color || "#d4a857"};"></span></span>`;
}

function _build(card) {
  return `<div class="beneos-ping-whisper ${card.cls}"
       data-actor-id="${card.actorId ?? ""}"
       style="--origin-color: ${card.origin.color};">
    <div class="bpw-head">
      <span class="bpw-emblem">${_emblemHtml(card.origin)}</span>
      <span class="bpw-title">${card.title}</span>
    </div>
    <div class="bpw-body">${card.body}</div>
    ${card.actorId ? `
      <button type="button"
              class="bpw-link"
              data-action="beneos-open-sheet"
              data-actor-id="${card.actorId}">
        <i class="fa-solid fa-arrow-up-right-from-square"></i>
        <span>${game.i18n.localize("BENEOS.LGC.ChatCard.OpenSheet")}</span>
      </button>` : ""}
  </div>`;
}

// Emit chat-whispers for one freshly added ping. Called from
// beneos-lgc.mjs._onPingAdd after the world setting has been persisted.
//
// Whisper recipients: ONLY the affected player. The GM sees their own
// composer action; they don't need a chat copy. Per user direction,
// the cue should be a personal/private effect, not an audit trail.
export async function createPingWhispers(ping, dispatch) {
  const origin = _originDisplay(ping.originSlug);
  // Coarse, evocative wording — three distance tiers (within 1/3/5
  // miles) and an 8-way spelled-out direction ("North East"). The
  // exact degree and feet are GM-side info; players get a vibe, not
  // a measurement.
  const bucketKey = coarseDistanceBucket(ping.distanceFt);
  const distLabel = game.i18n.localize(`BENEOS.LGC.ChatCard.Within.${bucketKey}`);
  const cardinal  = snapToCardinal(ping.directionDeg);
  const dirLabel  = game.i18n.localize(`BENEOS.LGC.Cardinal.${cardinal}`) || CARDINAL_FULL[cardinal] || cardinal;

  // 1) Attuned matches: one whisper per (actor, user). Pulsing.
  for (const m of dispatch.attuned) {
    const title = game.i18n.localize("BENEOS.LGC.ChatCard.AttunedTitle");
    const body  = game.i18n.format("BENEOS.LGC.ChatCard.AttunedBody", {
      origin: `<strong>${origin.name}</strong>`,
      char:   `<strong>${m.actorName}</strong>`,
      dir:    `<strong>${dirLabel}</strong>`,
      dist:   `<strong>${distLabel}</strong>`,
    });
    const content = _build({
      cls: "pulse attuned", title, body,
      origin, actorId: m.actorId,
    });
    await ChatMessage.create({
      content,
      whisper: [m.userId],
      flags: { [MOD]: { lgcCard: true, lgcPingId: ping.id, [FLAG_READ]: false } },
    });
  }

  // 2) Owned-not-attuned: one whisper per user with the first matching
  //    item name. Not pulsing.
  for (const m of dispatch.owned) {
    const title = game.i18n.localize("BENEOS.LGC.ChatCard.OwnedTitle");
    const body  = game.i18n.format("BENEOS.LGC.ChatCard.OwnedBody", {
      item: `<strong>${m.itemName}</strong>`,
    });
    const content = _build({
      cls: "owned", title, body,
      origin, actorId: null,
    });
    await ChatMessage.create({
      content,
      whisper: [m.userId],
      flags: { [MOD]: { lgcCard: true, lgcPingId: ping.id } },
    });
  }
}

// Hook into chat-message rendering to bind the click handler on the open-sheet
// button. Also restores the .pulse class state from the persisted flag.
// Foundry V14 renamed the hook renderChatMessage -> renderChatMessageHTML (and
// no longer fires the old name). V13 already fires renderChatMessageHTML too, so
// we register on the new name when the ChatMessageHTML pipeline exists and fall
// back to the legacy name on older cores. Registering on exactly one avoids the
// double-invocation that would happen if we bound both on V13.
let _hookWired = false;
export function registerLgcChatcardHook() {
  if (_hookWired) return;
  _hookWired = true;
  const CHAT_RENDER_HOOK = foundry?.applications?.sidebar?.tabs?.ChatLog
    ? "renderChatMessageHTML"
    : "renderChatMessage";
  Hooks.on(CHAT_RENDER_HOOK, (message, html, _data) => {
    const root = (html instanceof HTMLElement) ? html
              : (html?.[0] instanceof HTMLElement) ? html[0]
              : null;
    if (!root) return;
    const card = root.querySelector?.(".beneos-ping-whisper");
    if (!card) return;

    // Strip the pulse class if the user has already read this card.
    if (message.getFlag?.(MOD, FLAG_READ)) card.classList.remove("pulse");

    const link = card.querySelector?.('[data-action="beneos-open-sheet"]');
    link?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const actorId = link.dataset.actorId;
      const actor = actorId ? game.actors?.get?.(actorId) : null;
      if (!actor) return;
      try {
        await actor.sheet.render(true);
        // Switch to the Beneos tab once the sheet is mounted.
        setTimeout(() => {
          const sheetEl = actor.sheet?.element;
          const root2 = (sheetEl instanceof HTMLElement) ? sheetEl
                     : (sheetEl?.[0] instanceof HTMLElement) ? sheetEl[0]
                     : null;
          const tab = root2?.querySelector?.('[data-tab="beneos"]');
          if (tab) tab.click();
        }, 350);
      } catch (e) { console.warn("LGC card open-sheet failed:", e); }

      // Mark read: stop the pulse on this client + persist so it does
      // not re-pulse on next render anywhere.
      card.classList.remove("pulse");
      // V14 removed ChatMessage#user in favour of ChatMessage#author; fall back
      // to #user for V13.
      const msgAuthorId = (message.author ?? message.user)?.id;
      if (game.user?.isGM || msgAuthorId === game.user?.id || (message.whisper ?? []).includes(game.user?.id)) {
        try { await message.setFlag(MOD, FLAG_READ, true); } catch (_) {}
      }
    });
  });
}
