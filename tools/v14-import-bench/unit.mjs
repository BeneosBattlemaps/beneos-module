/**
 * Unit bench for the V13 -> V14 import bridge.
 *
 * Needs no Foundry: the bridge is imported directly and only
 * `game.release.generation` is provided, which is what its gate reads. Its big
 * brother bench.mjs measures against the real data model; this one pins down the
 * individual decisions, including the ones the catalogue never exercises.
 *
 * Usage: node einheiten.mjs      Exit code 1 on any failure.
 */
import path from "node:path"
import url from "node:url"

globalThis.game = { release: { generation: 14 } }
const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const SRC = url.pathToFileURL(
  path.resolve(HERE, "..", "..", "scripts", "cloud-v2", "beneos-v14-scene-migration.mjs")).href
const { migrateSceneForV14, packNeedsV14Migration, rectShiftFrom, levelExtrasFrom,
        detectionModesToV14, migrateActorForV14 } = await import(SRC)

/** A scene body in V13 pack shape, as it sits in data/Scene.json. */
function scene({ ox = 0, oy = 0, src = "beneos_assets/x/4k_bm.webm", fgElev, fogOverlay, tiles = [] } = {}) {
  const s = {
    _id: "aaaaaaaaaaaaaaaa", name: "BM: 1F", width: 3850, height: 2200, padding: 0.25,
    grid: { size: 120, type: 1 },
    background: { src, anchorX: 0, anchorY: 0, offsetX: ox, offsetY: oy, fit: "fill",
      scaleX: 1, scaleY: 1, rotation: 0, tint: "#ffffff", alphaThreshold: 0.75 },
    foreground: null, backgroundColor: "#111111",
    fog: { exploration: true, overlay: fogOverlay ?? null },
    walls: [{ _id: "w1", c: [963, 550, 4813, 550] }],
    tiles, _stats: { coreVersion: "13.351" },
  }
  if (fgElev !== undefined) s.foregroundElevation = fgElev
  return s
}
const tile = (x, y, w, h, anchor = 0.5) => ({
  _id: "t1", x, y, width: w, height: h,
  texture: { src: "a.webp", anchorX: anchor, anchorY: anchor }, occlusion: { mode: 0, alpha: 0 },
})

const cases = []
const check = (name, ok) => cases.push([name, ok])

// (1) The defect that started this: the rect shift belongs on shiftX/shiftY.
{
  const s = migrateSceneForV14(scene({ ox: 110, oy: 90 }))
  const t = s.levels[0].textures
  check("offset 110/90 lands on shiftX/shiftY", s.shiftX === 110 && s.shiftY === 90)
  check("offset does NOT land in level.textures", t.offsetX === undefined && t.offsetY === undefined)
  check("anchor stays 0.5/0.5", t.anchorX === 0.5 && t.anchorY === 0.5)
  check("the other transform fields survive", t.fit === "fill" && t.scaleX === 1 && t.rotation === 0)
  check("background src moves onto the level", s.levels[0].background.src === "beneos_assets/x/4k_bm.webm")
  check("level id is Foundry's default", s.levels[0]._id === "defaultLevel0000" && s.initialLevel === "defaultLevel0000")
  check("the removed V13 fields are gone", s.background === undefined && s.backgroundColor === undefined)
}

// (2) Counter-case: without an offset nothing may change. This is the case of the
// other 2140 scenes, and without it only the rule would be proven, not its silence.
{
  const s = migrateSceneForV14(scene({ ox: 0, oy: 0 }))
  check("no offset leaves shiftX/shiftY at 0", s.shiftX === 0 && s.shiftY === 0)
  check("no offset writes no textures offset", s.levels[0].textures.offsetX === undefined)
}

// (3) Negative offsets and fractions.
{
  const s = migrateSceneForV14(scene({ ox: -94, oy: -56 }))
  check("negative offset is carried", s.shiftX === -94 && s.shiftY === -56)
  const r = migrateSceneForV14(scene({ ox: 20.4, oy: -5.5 }))
  check("fractions are rounded (V14 wants integers)", Number.isInteger(r.shiftX) && Number.isInteger(r.shiftY) && r.shiftX === 20)
}

// (4) A tile-only scene takes the early exit and must still keep its rect shift.
{
  const s = migrateSceneForV14(scene({ ox: 35, oy: 30, src: null }))
  check("tile-only scene keeps its rect shift", s.shiftX === 35 && s.shiftY === 30)
}

// (5) Already migrated data is left alone.
{
  const existing = scene({ ox: 50, oy: 50 })
  existing.levels = [{ _id: "defaultLevel0000", background: { src: "a.webm" }, textures: { anchorX: 0.5 } }]
  const s = migrateSceneForV14(existing)
  check("existing levels are untouched", s.levels.length === 1 && s.levels[0].textures.anchorX === 0.5)
}

// (6) The two relocations that used to be dropped.
{
  const s = migrateSceneForV14(scene({ fgElev: 60, fogOverlay: "beneos_assets/x/fog.webp" }))
  check("foregroundElevation moves to elevation.top", s.levels[0].elevation?.top === 60)
  check("fog.overlay moves to level.fog.src", s.levels[0].fog?.src === "beneos_assets/x/fog.webp")
  check("fog.overlay is removed from the scene head", s.fog.overlay === undefined)
  const empty = migrateSceneForV14(scene({}))
  check("no fog image creates no empty fog object", empty.levels[0].fog === undefined)
}

// (6b) The null case of the overhead elevation. 239 of 2180 catalogue scenes ship
// `foregroundElevation: null`. Coercing that to 0 would span the level from 0 to 0,
// and Level#clampElevation would then pin every token to elevation 0.
{
  const s = migrateSceneForV14(scene({ fgElev: null }))
  check("foregroundElevation null creates NO elevation field", s.levels[0].elevation === undefined)
  const missing = migrateSceneForV14(scene({}))
  check("missing foregroundElevation creates no elevation field", missing.levels[0].elevation === undefined)
  const zero = migrateSceneForV14(scene({ fgElev: 0 }))
  check("foregroundElevation 0 creates no elevation field", zero.levels[0].elevation === undefined)
  check("levelExtrasFrom is pure and returns an empty object", JSON.stringify(levelExtrasFrom({ foregroundElevation: null })) === "{}")
}

// (6c) An explicit shiftX wins, which is Foundry's own rule.
{
  const mixed = scene({ ox: 110, oy: 90 })
  mixed.shiftX = 7
  const s = migrateSceneForV14(mixed)
  check("an existing shiftX stays", s.shiftX === 7)
  check("a missing shiftY is set", s.shiftY === 90)
  check("rectShiftFrom is pure and returns null without a background", rectShiftFrom(null) === null)
  check("rectShiftFrom rounds", rectShiftFrom({ offsetX: 20.4, offsetY: -5.5 }).shiftX === 20)
}

// (6d) Fog exploration. V14 defaults to INDIVIDUAL, so a dropped `exploration:
// false` silently switches fog of war on.
{
  const off = scene({}); off.fog.exploration = false
  const a = migrateSceneForV14(off)
  check("exploration false becomes fog.mode 0 (DISABLED)", a.fog.mode === 0 && a.fog.exploration === undefined)
  const on = scene({}); on.fog.exploration = true
  const b = migrateSceneForV14(on)
  check("exploration true becomes fog.mode 1 (INDIVIDUAL)", b.fog.mode === 1 && b.fog.exploration === undefined)
  const already = scene({}); already.fog.exploration = false; already.fog.mode = 1
  const c = migrateSceneForV14(already)
  check("an existing fog.mode wins", c.fog.mode === 1)
  const noFog = scene({}); delete noFog.fog
  check("a scene without a fog object does not break", migrateSceneForV14(noFog).fog === undefined)
}

// (6e) Creature senses. V13 holds a list, V14 an object keyed by mode id.
{
  const m = detectionModesToV14([{ id: "blindsight", range: 60, enabled: true }, { id: "seeAll", range: 0, enabled: false }])
  check("the list becomes an object keyed by id", m.blindsight?.range === 60 && m.seeAll?.enabled === false)
  check("the id itself is no longer part of the value", m.blindsight?.id === undefined)
  check("an empty list becomes an empty object", JSON.stringify(detectionModesToV14([])) === "{}")
  check("anything but an array returns null", detectionModesToV14(undefined) === null && detectionModesToV14({ a: 1 }) === null)
  check("an entry without an id is dropped", JSON.stringify(detectionModesToV14([{ range: 30 }])) === "{}")
}

// (6f) The actor. Only the prototypeToken needs work, and it carries no `level`.
{
  const a = migrateActorForV14({
    _id: "cccccccccccccccc", name: "Twig Blight",
    prototypeToken: { width: 2, height: 3, detectionModes: [{ id: "blindsight", range: 60, enabled: true }] },
  })
  const p = a.prototypeToken
  check("the prototype keeps its blindsight", p.detectionModes.blindsight?.range === 60)
  check("depth is the smaller edge", p.depth === 2)
  check("no level is written, the schema default already holds it", p.level === undefined)
  const bare = migrateActorForV14({ _id: "dddddddddddddddd", name: "X" })
  check("an actor without a prototype does not break", bare.prototypeToken === undefined)
}

// (6g) Effect icons. V14 sets showIcon for an effect that carries a status.
{
  const a = migrateActorForV14({
    _id: "eeeeeeeeeeeeeeee", name: "Y",
    effects: [{ _id: "e1", name: "Poisoned", statuses: ["poisoned"] }, { _id: "e2", name: "Plain" }],
    items: [{ _id: "i1", name: "Item", effects: [{ _id: "e3", statuses: ["prone"], showIcon: 0 }] }],
  })
  check("an effect with a status gets showIcon", a.effects[0].showIcon === 1)
  check("an effect without a status is left alone", a.effects[1].showIcon === undefined)
  check("an existing showIcon wins", a.items[0].effects[0].showIcon === 0)
}

// (6h) Scene tokens: same conversion, without the level assignment.
{
  const s = migrateSceneForV14(Object.assign(scene({}), {
    tokens: [{ _id: "ffffffffffffffff", width: 1, height: 1, detectionModes: [{ id: "tremorsense", range: 30 }] }],
  }))
  const t = s.tokens[0]
  check("a scene token keeps its senses", t.detectionModes.tremorsense?.range === 30)
  check("a scene token gets its depth", t.depth === 1)
}

// (6i) Measured templates: without Foundry's converter NOTHING may be deleted.
// A silent loss with our name on it would be worse than V14's own.
{
  const templates = [{ _id: "1111111111111111", t: "circle", x: 10, y: 20, distance: 5 }]
  const s = migrateSceneForV14(Object.assign(scene({}), { templates: templates.slice() }))
  check("without the converter the templates stay", Array.isArray(s.templates) && s.templates.length === 1)
  check("without the converter no regions appear", s.regions === undefined)
}

// (7) The tile conversion must not have changed.
{
  const s = migrateSceneForV14(scene({ tiles: [tile(1000, 600, 400, 200)] }))
  check("a tile moves onto its anchor point", s.tiles[0].x === 1200 && s.tiles[0].y === 700)
  check("occlusion.mode 0 becomes an empty set", Array.isArray(s.tiles[0].occlusion.modes) && s.tiles[0].occlusion.modes.length === 0)
  const fade = migrateSceneForV14(scene({ tiles: [Object.assign(tile(0, 0, 10, 10), { occlusion: { mode: 1 } })] }))
  check("occlusion.mode 1 (FADE) becomes 1", JSON.stringify(fade.tiles[0].occlusion.modes) === "[1]")
  const radial = migrateSceneForV14(scene({ tiles: [Object.assign(tile(0, 0, 10, 10), { occlusion: { mode: 3 } })] }))
  check("occlusion.mode 3 (RADIAL) becomes 4", JSON.stringify(radial.tiles[0].occlusion.modes) === "[4]")
  const surface = migrateSceneForV14(scene({ tiles: [Object.assign(tile(0, 0, 10, 10), { occlusion: { mode: 2 } })] }))
  check("occlusion.mode 2 becomes 2 and is no longer dropped", JSON.stringify(surface.tiles[0].occlusion.modes) === "[2]")
}

// (8) The gate.
{
  check("a V13 pack on a V14 client migrates", packNeedsV14Migration({ _stats: { coreVersion: "13.351" } }) === true)
  check("a V14 pack does not migrate", packNeedsV14Migration({ _stats: { coreVersion: "14.367" } }) === false)
  globalThis.game.release.generation = 13
  check("a V13 client never migrates", packNeedsV14Migration({ _stats: { coreVersion: "13.351" } }) === false)
  globalThis.game.release.generation = 14
}

let bad = 0
for (const [name, ok] of cases) {
  if (!ok) bad++
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`)
}
console.log(`\n${cases.length - bad}/${cases.length} as expected`)
process.exit(bad ? 1 : 0)
