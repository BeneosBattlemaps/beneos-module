/**
 * The guard in front of the beta, and the deliberate limit of its reach.
 *
 * Existing worlds are allowed in this beta, which is why the reach is drawn
 * narrowly on purpose:
 *
 * **Streaming applies to new installs only.** Nothing that is already installed
 * in a world is converted. The tempting feature, a button that turns an
 * installed release into a streamed one, would have to rewrite hundreds of
 * fields in documents a game master has been building on, and a mistake there
 * costs somebody their prepared campaign. It is not worth it for a beta whose
 * question is whether streaming works at all.
 *
 * The way back is therefore the one that already exists and is already trusted:
 * remove the streamed release and install it normally. No new machinery, no new
 * way to lose data.
 *
 * What remains is one deliberate acknowledgement before the first activation,
 * so nobody switches this on without knowing it is a beta.
 */

import { MODULE_ID, SETTING, streamEnabled } from "./stream-settings.mjs"

const DialogV2 = () => foundry.applications?.api?.DialogV2

/** Has this world been told what it is getting into? */
export function acknowledged() {
  try { return Boolean(game.settings.get(MODULE_ID, SETTING.acknowledged)) } catch (_) { return false }
}

/**
 * Ask once per world. Returns true when the beta may proceed.
 *
 * Deliberately blunt about the two things a tester has to know: it is a beta,
 * and the way back is a normal reinstall rather than a switch.
 */
export async function ensureAcknowledged() {
  if (acknowledged()) return true
  if (!game.user?.isGM) return false

  const content = `
    <p><strong>Beneos Stream is a closed beta.</strong></p>
    <p>Releases installed from now on keep their video and sound at Beneos and
       fetch them while you play. They take a fraction of the disk space, and
       they need a connection to show motion. Every scene carries a still
       picture, so a lost connection costs motion and nothing else.</p>
    <p>Nothing already installed in this world is touched. Streaming applies to
       new installs only.</p>
    <p><strong>The way back</strong> is the one you already know: remove the
       release and install it normally.</p>
    <p>Please make a backup of this world before you continue, as you would
       before any beta.</p>`

  const D = DialogV2()
  if (!D) return false

  const ok = await D.confirm({
    window: { title: "Beneos Stream, closed beta" },
    content,
    yes: { label: "I have a backup, continue" },
    no: { label: "Not now", default: true },
  }).catch(() => false)

  if (ok) await game.settings.set(MODULE_ID, SETTING.acknowledged, true)
  return Boolean(ok)
}

/**
 * The gate to every beta code path.
 *
 * Off, or not acknowledged, or not a GM in a world that never agreed: the
 * module behaves exactly as it does on main.
 */
export function betaMayRun() {
  return streamEnabled() && acknowledged()
}
