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

**Creatures work the same way now.** The token on the canvas and its top-down
view come from our servers. The portrait you see in the actor list stays on
your disk on purpose, so that list is never empty, with or without a
connection. Items and spells still install the old way in this build.

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

Eleven things, in order. None takes longer than a few minutes, and the last two
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
7. **Install a creature.** Open the Cloud window, install any creature, and
   watch two things: how long it takes, and whether the actor list shows its
   portrait right away. Then drag it onto a map. The image you see on the
   canvas comes from our servers, the portrait does not.
8. **Switch its look.** With the token selected, use the token bar to switch
   between the 2.5D view and the top-down view, and between variants if the
   creature has several. Both should work exactly as you remember. If a button
   does nothing, or a token turns into an empty square, that is the single most
   useful thing you can report.
9. **Pull the plug on a creature.** Turn off your internet with a creature on
   the map, then reload. You should see a picture that says "offline", not an
   empty square and not a broken image. Turn the internet back on and reload
   again: the real creature should be back.
10. **Play with a player.** Have someone join and move a token on a streamed
    map. Ask them roughly where they are and whether it felt slower than usual.
11. **Play a real session.** Two or three hours, several scenes, several
    creatures, the normal mess. This is the one that matters.

**Two things we already know, so please do not spend time on them.**

- **Keeping a creature offline does not work yet.** You can keep a *map*
  offline, and that works. A creature is not carried along, and the switch for
  it is not built. If you play without a connection, expect the "offline"
  picture on your creatures.
- **A creature with very many variants can fail to install.** We have one in
  the catalogue with twenty, and it does not get through. If an install fails,
  the module now tells you so and names the creature. **Send us that name.** It
  is the one failure where the name alone is the whole report.

**One thing that is still on your disk and will move later:** the large picture
on a creature's journal page. It installs locally in this build. Nothing for
you to do, it is just not part of the test yet.

### How to tell us

Write it however you like. A list, a voice note, a running commentary, all
fine.

Four questions are the ones we care about most:

- Does a scene open as fast as before?
- Does the video start without a visible wait?
- **Do creatures appear as fast as they used to?** A token that takes a moment
  to show up is exactly the kind of thing that never produces an error report.
- What do your players see, and where do they sit?
- Did anything pull you out of the game? A pause, a black rectangle, a token
  that stayed empty, a sound that came late, a scene that took too long.

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

### Two preconditions on the account, and one of them bites quietly

**The account has to be on `stream`, and that is a server-side value.** A
tester whose record says `download` installs everything locally and tests the
old path while believing they test the new one. Nothing in the module tells
them apart, because both look right.

**A hand-set value does not survive a page reload.** Measured on 2026-11-06:
after a reload the setting falls back to whatever the server says, silently,
and the next install writes local paths. Set it on the server, not in the
world, and read it again right before an install when in doubt.

### Creatures: what reports itself and what does not

The `/report` mechanism above covers creature images too, because it sits in
the fetch layer and does not know one picture from another. **Install failures
are a different matter.** A creature that fails to install posts nothing to the
gate, because nothing was fetched; since 2026-11-06 the module shows the tester
a message naming the creature instead. That message is the only trace, so the
tester has to pass it on.

### Bump the version before the first invitation

`module.json` on `stream-beta` points at the branch, so a push delivers
immediately, but Foundry compares version numbers. Without a bump no tester is
offered the update, and every later fix sits on the branch unseen.
