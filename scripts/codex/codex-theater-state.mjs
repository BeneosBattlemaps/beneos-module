/* =============================================================
   Beneos Creature Codex — Combat-Theater Read-Aloud service.
   Welle 5c. Two delivery modes per the master mock spec:
     1. Primary: Foundry ChatMessage with `speaker: actor`, so all
        players see the read-aloud text in the chat log.
     2. Optional: browser SpeechSynthesis fallback when the GM has
        the per-user setting enabled.
   The Theater also tracks per-window state (round, used abilities,
   first-appearance-read flag); that lives on the window instance
   itself so closing the codex resets it.
   ============================================================= */

/** Read a creature read-aloud line. Posts to chat and optionally TTS. */
export async function readAloud({ actor, label, text, useTTS = false }) {
  if (!text) return
  const speaker = ChatMessage.getSpeaker({ actor: actor ?? undefined })
  const flavor = label ? `<em>${label}</em>` : null
  await ChatMessage.create({
    speaker,
    content: `${flavor ? flavor + "<br>" : ""}<blockquote class="cdx-chat-readaloud">${escapeHtml(text)}</blockquote>`
  })
  if (useTTS) speakBrowser(`${label ? label + ". " : ""}${text}`)
}

/** Escape user-content for safe insertion into chat HTML. Light
 *  sanitization — Foundry's content filter handles the rest. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ))
}

/** Browser TTS fallback. Cancel any in-flight utterance first so
 *  the GM can re-read without overlapping voices. */
function speakBrowser(text) {
  try {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 0.95; u.pitch = 0.9
      window.speechSynthesis.speak(u)
    }
  } catch (_) { /* TTS unavailable in this environment */ }
}

/** User setting key — toggled in module settings. Reading the
 *  setting through a helper keeps the Window decoupled from the
 *  exact registration timing. */
export function ttsEnabled() {
  try {
    return !!game.settings?.get?.("beneos-module", "codex-tts")
  } catch (_) {
    return false
  }
}
