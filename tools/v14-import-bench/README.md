# Bench: what a Foundry release throws away from our pack data

Measures the V13 to V14 bridge `scripts/cloud-v2/beneos-v14-scene-migration.mjs`,
and with it the question that matters to a customer: **after a fresh install, does
everything a pack brings actually arrive?**

Two runs, neither needs a running Foundry.

## `bench.mjs`, the gate

```
node bench.mjs --packs "F:/_beneos_cloud_uploads/zip"
node bench.mjs --packs "<folder of unpacked packs>"
node bench.mjs --foundry "<path to the app folder>" --packs "<...>" --limit 20 --verbose
node bench.mjs --packs "<...>" --without-bridge
```

It does not guess what a new Foundry generation dislikes. It loads the **real data
model of the installed Foundry release**, runs the Beneos bridge over scenes and
actors, then builds every pack document the way `createDocuments` builds it, and
compares what went in with what came out. Any field that disappears or changes
value on the way is a loss at install time.

Exit codes:

| code | meaning |
|---|---|
| 0 | nothing lost |
| 1 | at least one real loss |
| 2 | could not measure: no Foundry, no pack source, or too few documents |

Code 2 exists because "nothing lost" and "nothing measured" print the same way
otherwise. A source that holds no packs fails the run instead of passing it.

`--packs` takes a folder of ZIP archives or a folder of unpacked packs. ZIP needs
Python on PATH; node ships no ZIP reader. The archive path is handed over as an
argument, never pasted into the Python source.

`--foundry` points at the app folder of an installation, the one that contains
`common/`. Without it the usual locations are tried. This is where the value sits:
**the same measurement against any release** that is on disk.

### The red run

A green test that cannot turn red proves nothing. `--without-bridge` skips the
bridge and must fail:

```
  real   total  finding
   254     254   Scene.backgroundColor : falls away        e.g. "#000000"
   254     254   Scene.fog.exploration : becomes 1         e.g. true
   236     254   Scene.background.src : falls away         e.g. "beneos_assets/..."
   200     254   Scene.foregroundElevation : falls away    e.g. 20
    10      10   Scene.background.offsetY : becomes 0      e.g. -56
     8       8   Scene.background.offsetX : becomes 0      e.g. -94
     2      38   Actor.prototypeToken.detectionModes : becomes "object"
```

That is the list of defects that reached customers in September 2026: map gone,
fog on, offset zeroed, elevation gone, senses gone.

### What the run does not report, and why

Three kinds of difference are not losses. Each one is a named list in the source,
not a silent rule:

- **`FOUNDRY_MOVES`** are paths Foundry itself rewrites in its own `migrateData`:
  `changes` to `system.changes`, `duration.startTime` to `start.time`, a string
  effect value retyped to a number, and the scene's initial scale rounded to three
  decimals. Measured at the document, not assumed.
- **`BRIDGE_MOVES`** are the renames the Beneos bridge performs on purpose. They
  are excused in a normal run and **not** excused under `--without-bridge`, which
  is what proves the list is real.
- **`SKIP_AT_ROOT`** holds `system`, `_stats` and the fields the server stamps on
  create. Only at the document root: `flags` carries our own scene and token
  markers and `sort` is a tile's stacking order, so neither is waved through
  further down.

Beyond those lists, a dropped field is forgiven only when the **same leaf name with
the same value** turns up elsewhere in the result, which is how `background.src`
landing on `levels[0].background.src` is recognised as a move. Matching on the value
alone would excuse every `true`, `0` and `60` in the document.

## `unit.mjs`, the individual decisions

```
node unit.mjs
```

Pins down what the bridge does in detail, including cases the current catalogue
does not exercise. Needs neither Foundry nor pack data.

## Why this bench exists

On 22 September 2026 two customers reported uniformly misaligned maps. The cause
was **one** field written to the wrong place in the bridge, and the search for it
ran on samples and guesswork. Measuring afterwards turned up four more breaks of
the same kind that nobody had reported, one of them affecting more than half the
catalogue.

The reason for all five is the same: Foundry migrates worlds across versions by
itself, but `createDocuments` bypasses that migration. Whatever is missing there
falls away without a word. This class of defect is not reliably found by reading
and is found by measuring in a minute.

Foundry's own list of migrations sits in `dist/database/documents/<type>.mjs`,
field `_migrationRegistry`. Every entry carrying a version number of the new
generation needs checking. The other half, `common/documents/*.mjs` `migrateData`,
runs on our documents too and must **not** be rebuilt in the bridge.
