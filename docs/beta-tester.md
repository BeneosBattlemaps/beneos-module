# Beneos Stream, beta tester brief

What to send a tester before they install. Everything after the install is
explained inside the module, behind the question mark in the toolbar.

Keep this short. A tester who needs a manual before the first scene opens is
testing the manual.

---

## Send them this

**Thank you for testing Beneos Stream.**

Your maps stay online. Only the still pictures land on your disk. A release
that used to fill several gigabytes now takes a few megabytes of your world,
and your players load the video from our servers instead of from your
computer, wherever in the world they sit.

**What you need**

- Foundry VTT 13 or 14
- Your usual Beneos account, with an active Battlemaps membership
- These modules, which Foundry offers to install for you: Monk's Active Tiles,
  Point of Interest Teleporter, FXMaster, Multilevel Tokens, libWrapper

**How to install**

1. In Foundry, open **Add-on Modules** and choose **Install Module**.
2. Paste this into the **Manifest URL** field at the bottom:
   `https://raw.githubusercontent.com/BeneosBattlemaps/beneos-module/stream-beta/module.json`
3. Install, then enable the module in your world.
4. Log in to Beneos in the Cloud window as you normally would.

If you already run the normal Beneos module, uninstall it first. Both carry
the same id and Foundry will not keep two.

**What happens then**

Nothing you have to switch on. The first time the world starts, a short note
explains the change. Install a release from the Cloud window and open a scene.
That is the test.

**Where the rest is explained**

The question mark in the Beneos toolbar opens the documentation. The chapter
"Streaming and offline play" in the FAQ answers what gets installed, where
your players load from, what happens when your connection drops, and how to
keep maps for a table with no internet.

**What we would like to hear**

- Does a scene open as fast as before?
- Does the video start without a visible wait?
- What do your players see, and where do they sit?
- Anything that looks broken, with the scene name and roughly the time.

---

## Before you send it

Two things are on our side, not the tester's.

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

**Bump the version before the first invitation.** `module.json` on
`stream-beta` points at the branch, so a push delivers immediately, but
Foundry compares version numbers. Without a bump no tester is offered the
update, and every later fix sits on the branch unseen.
