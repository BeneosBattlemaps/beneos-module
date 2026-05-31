// Socket bridge for the LGC sound cue. The GM emits "lgc-ping-fired"
// with a list of recipient userIds; each connected client checks if
// it's in the list and plays the ping SFX locally on the interface
// bus exactly once per event. Plays-once-per-user is enforced by the
// dispatcher (it dedups before emit).

const MODULE = "beneos-module";
const SOCKET = `module.${MODULE}`;
const PING_SOUND = `modules/${MODULE}/ui/sfx/beneos_ping.ogg`;

let _wired = false;

export function registerLgcSocket() {
  if (_wired) return;
  _wired = true;
  game.socket?.on?.(SOCKET, (msg) => {
    if (!msg || msg.name !== "lgc-ping-fired") return;
    const ids = Array.isArray(msg.userIds) ? msg.userIds : [];
    if (!ids.includes(game.user?.id)) return;
    _playLocal();
  });
}

// Helper for the GM to broadcast a sound trigger to specific users.
// Also plays locally for the GM if requested (so the GM hears the
// cue too while testing).
export function emitPingSound(userIds, { alsoGM = true } = {}) {
  const recipients = Array.from(new Set(userIds.filter(Boolean)));
  if (recipients.length) {
    game.socket?.emit?.(SOCKET, { name: "lgc-ping-fired", userIds: recipients });
  }
  if (alsoGM && game.user?.isGM) _playLocal();
}

function _playLocal() {
  try {
    const helper = foundry.audio?.AudioHelper
                ?? (typeof AudioHelper !== "undefined" ? AudioHelper : null);
    helper?.play?.(
      { src: PING_SOUND, volume: 0.6, autoplay: true, loop: false },
      false,   // local only
    );
  } catch (e) {
    console.warn("Beneos | LGC ping sound failed:", e);
  }
}
