# Beneos Stream, beta tester brief

Everything a tester needs, in one message. The part under "Send them this" is
meant to be forwarded as it stands. The part under "Before you send it" is for
us and stays here.

Everything after the install is explained inside the module, behind the
question mark in the toolbar. A tester who needs a manual before the first
scene opens is testing the manual.

---

## Send them this

**Thank you for testing Beneos Stream.**

Your maps stay online. Only the still pictures land on your disk. A release
that used to fill several gigabytes now takes a few megabytes of your world,
and your players load the video from our servers instead of from your
computer, wherever in the world they sit.

### What you need

- Foundry VTT 13 or 14
- Your usual Beneos account, with an active Battlemaps membership
- These modules, which Foundry offers to install for you: Monk's Active Tiles,
  Point of Interest Teleporter, FXMaster, Multilevel Tokens, libWrapper

### How to install

1. In Foundry, open **Add-on Modules** and choose **Install Module**.
2. Paste this into the **Manifest URL** field at the bottom:
   `https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json`
3. Install, then enable the module in your world.
4. Log in to Beneos in the Cloud window as you normally would.

If you already run the normal Beneos module, uninstall it first. Both carry
the same id and Foundry will not keep two.

There is nothing to switch on. The first time the world starts, a short note
explains the change.

### What to try

Nine things, in order. None takes longer than a few minutes, and the last two
need a second person. Work through them once, then play a normal session and
forget the list. The session is the real test; the list only makes sure
nothing is skipped by accident.

For each one, tell us what you saw. "Worked" is a useful answer. "Worked, but
the first three seconds were a still picture" is a better one.

1. **Install a release.** Open the Cloud window and install any battlemap
   release. Watch how long it takes and how much it adds to your Foundry data
   folder.
2. **Open a scene.** Does the map move right away, or do you see a still
   picture first? If so, how long before the video takes over?
3. **Open the same scene again.** Close it, open it again.
4. **Click the storage bar.** In the Cloud window, above the map list. Does the
   explanation that opens make sense to you? That text is new, and we would
   rather hear it is confusing now than after release.
5. **Keep one scene offline.** Right-click a scene in the sidebar, choose
   "Keep offline", wait for it to finish. Does the storage bar move?
6. **Pull the plug.** Turn off your internet. Open the scene you kept, then one
   you did not. Turn the internet back on afterwards and open both again.
7. **Install a creature, an item and a spell.** These are not streamed, they
   install the old way. Anything that behaves differently from what you are
   used to is worth telling us. This step exists to catch what we broke, not
   what we built.
8. **Play with a player.** Have someone join and move a token on a streamed
   map. Ask them roughly where they are and whether it felt slower than usual.
9. **Play a real session.** Two or three hours, several scenes, the normal
   mess. This is the one that matters.

### How to tell us

Write it however you like. A list, a voice note, a running commentary, all
fine.

Four questions are the ones we care about most:

- Does a scene open as fast as before?
- Does the video start without a visible wait?
- What do your players see, and where do they sit?
- Did anything pull you out of the game? A pause, a black rectangle, a sound
  that came late, a scene that took too long.

**When something looks broken, give us the scene name and roughly when it
happened.** The module reports delivery failures by itself, and those two
details are what let us match your sentence to its report.

---

## Before you send it

### Nothing to unlock, and that is by design

**A tester's own access needs nothing from us.** The first time their world
asks for a stream key, the key is minted and their entitlement is written to
Cloudflare KV inside that same request, before the answer goes back
(`api-scenepacker.php`, `sp_stream_key_sofort_schreiben`). There is no window
in which a valid key gets nothing, and no run to do beforehand.

**A new release needs nothing either, as things stand.** A customer record
names the tiers, not the maps, and a tier's releases live in a shared list at
the gate. Measured at the live gate on 2026-10-05, both tier lists hold `["*"]`,
and a star matches every release, so a publication reaches every patron at
once. `_trigger-stream-entitlements.php?op=gruppen` rebuilds those lists and
is the thing to run only in two cases: a release meant to be free to everyone,
which lives in a separate list, and a newly created Patreon tier, which has no
list yet. Nothing calls it on a timer, as measured on 2026-10-30.

**Membership changes wait for the queue.** An upgrade, a purchase or a gift
marks the key for recalculation, and `op=drain` writes it. Nothing drains on a
timer either, so run it after changing a tester's membership. A cancellation
is the exception: the record carries `tier_until` and the gate lets it expire
on its own.

### What we get back without asking

**Delivery failures report themselves.** When an asset does not arrive, the
module posts to `/report` at the gate: the reason (`timeout`, `network`,
`status`, `denied`), the address, the world id and the Foundry version. One
report per address per session, so a broken scene cannot bury the signal.
Readable at `/reports` with the gate key.

It deliberately carries no customer key, so a report cannot be traced to a
person. That is why we ask the tester for the scene name and the time: those
two are what join their sentence to the report.

**What it cannot tell us** is everything that went right but slowly. A scene
that took eleven seconds instead of two produces no report at all, because
nothing failed. That is the gap the tester's own sentence has to close.

### Bump the version before the first invitation

`module.json` on `stream-beta` points at the branch, so a push delivers
immediately, but Foundry compares version numbers. Without a bump no tester is
offered the update, and every later fix sits on the branch unseen.
