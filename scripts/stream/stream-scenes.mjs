/**
 * Rebuilding a scene so a failed video leaves a usable picture behind.
 *
 * WHY THE VIDEO MUST LEAVE THE DOCUMENT
 *
 * `Canvas#draw` awaits every texture of a scene before a single layer is drawn,
 * and `TextureLoader.loadSceneTextures` collects every tile regardless of
 * visibility. Nothing in that chain has a deadline: `VideoResource.load()` has
 * no timeout, so a transfer that neither finishes nor fails parks the draw for
 * good. `canvas.loading` stays true and `Scene#view` refuses every further
 * scene change for the rest of the session.
 *
 * A video is the largest file of a scene and the one most likely to stall over
 * a foreign line. So it does not sit in `texture.src` at all: the tile is left
 * empty, the address lives in a flag beside it, and `stream-canvas.mjs` fetches
 * it after the draw with a budget of its own. Losing it costs motion and
 * nothing else.
 *
 * WHY THIS RUNS HERE AND NOT IN THE PACKAGE
 *
 * Until 2026-08-23 a tool on the operator's workstation did this and shipped a
 * second copy of every scene document inside the release. The download path
 * then had to undo it again (`restoreLocalVideos`), because a video on the
 * customer's own disk belongs in the document where every other Foundry feature
 * can see it.
 *
 * That is twice the work for one thing, and it made the release carry two
 * versions of the same scene. The arithmetic is deterministic, so it can happen
 * anywhere; doing it at install time means the package holds nothing but the
 * originals, and the undo disappears.
 *
 * WHERE THE STILL COMES FROM
 *
 * From the package. The encoding pipeline writes `<name>-4k_bm.webp` beside
 * `<name>-4k_bm.webm` out of the same render frame, and the same for scenery.
 * Measured 2026-08-23 over the whole stock: battlemaps 99.8 percent, scenery
 * 100 percent. Cutting a frame again with ffmpeg produced 4161 files and
 * 1.99 GB that duplicated pictures already in the package.
 *
 * WHAT IS NOT TOUCHED
 *
 * Everything else about a scene. Walls, lights, notes, sounds, grid, and the
 * flags of other modules.
 */

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

export const FLAG_SCOPE = "beneos-module"
export const FLAG_KEY = "stream"
export const ROLE_VIDEO = "stream-video"
export const ROLE_STILL = "stream-still"

const VIDEO_EXT = /\.(webm|mp4|ogv|m4v)(\?.*)?$/i

/* ------------------------------------------------------------------ geometry */

// Transcribed from the running client, not guessed:
//   client/documents/scene.mjs   getDimensions()
//   common/grid/square.mjs       calculateDimensions()
//   common/grid/gridless.mjs     calculateDimensions()
//   common/grid/hexagonal.mjs    calculateDimensions()
//
// Foundry's own source warns twice against replacing `* (1 / n)` with `/ n`.
// The reciprocal is kept here for the same reason.
const GRID_GRIDLESS = 0
const GRID_SQUARE = 1
const HEX_TYPES = [2, 3, 4, 5]
const HEX_COLUMN_TYPES = [4, 5]      // flat-topped, stacked along x

const SQRT3 = Math.sqrt(3)
const DEFAULT_GRID_SIZE = 100
const DEFAULT_PADDING = 0.25

/**
 * The x and y offsets of a hexagonal scene rectangle.
 *
 * Hexagons interleave in the cross axis instead of stacking, and the top-left
 * hexagon has to come out whole. Skipping this was wrong once already: the
 * Barovia map in the landing release is hexagonal and carries a video.
 */
function hexPadding(sceneWidth, sceneHeight, padding, size, columns) {
  const sizeX = columns ? (2 * size) / SQRT3 : size
  const sizeY = columns ? size : (2 * size) / SQRT3
  const strideX = columns ? 0.75 * sizeX : sizeX
  const strideY = columns ? sizeY : 0.75 * sizeY

  if (!padding) return { x: 0, y: 0 }

  let x = Math.ceil((padding * sceneWidth) * (1 / strideX)) * strideX
  let y = Math.ceil((padding * sceneHeight) * (1 / strideY)) * strideY

  const cross = columns ? x / strideX : y / strideY
  if (Math.round(cross) % 2 !== 0) {
    if (columns) y += sizeY / 2
    else x += sizeX / 2
  }
  return { x, y }
}

/**
 * The rectangle the background image is drawn into.
 *
 * A tile given exactly these coordinates covers what the background covered,
 * which is what makes the swap invisible. Returns null for a grid type this
 * cannot place exactly; the caller then leaves the scene alone rather than
 * guessing.
 *
 * Verified against a shipped scene: BM: Asteroid Battle, 4000x2500, padding
 * 0.25, grid 100 yields x=1000, y=700, and the shipped tile sits at exactly
 * 1000, 700.
 */
export function sceneRect(scene) {
  const grid = scene?.grid || {}
  const gtype = grid.type ?? GRID_SQUARE
  const size = grid.size || DEFAULT_GRID_SIZE
  const padding = scene?.padding ?? DEFAULT_PADDING
  const sceneWidth = scene?.width || 0
  const sceneHeight = scene?.height || 0

  let x
  let y
  if (gtype === GRID_GRIDLESS || gtype === GRID_SQUARE) {
    x = Math.ceil((padding * sceneWidth) * (1 / size)) * size
    y = Math.ceil((padding * sceneHeight) * (1 / size)) * size
  } else if (HEX_TYPES.includes(gtype)) {
    const p = hexPadding(sceneWidth, sceneHeight, padding, size,
      HEX_COLUMN_TYPES.includes(gtype))
    x = p.x
    y = p.y
  } else {
    return null
  }

  const background = scene?.background || {}
  return {
    x: x - (background.offsetX || 0),
    y: y - (background.offsetY || 0),
    width: sceneWidth,
    height: sceneHeight
  }
}

/* --------------------------------------------------------------------- parts */

export function isVideo(path) {
  return VIDEO_EXT.test(String(path || ""))
}

/**
 * Where the still belonging to a video lives: beside it, same stem, `.webp`.
 *
 * This is the package's own convention, not one this module invents. Anything
 * that changes it has to change the encoding pipeline too.
 */
export function stillPathFor(videoPath) {
  const raw = String(videoPath || "")
  const cut = raw.search(/[?#]/)
  const base = cut >= 0 ? raw.slice(0, cut) : raw
  const tail = cut >= 0 ? raw.slice(cut) : ""
  const dot = base.lastIndexOf(".")
  if (dot <= base.lastIndexOf("/")) return ""
  return `${base.slice(0, dot)}.webp${tail}`
}

/**
 * A Foundry-shaped id that stays the same across runs.
 *
 * Deterministic on purpose: installing a release twice must not invent new
 * document ids, otherwise the second run stacks another layer of tiles on the
 * first. Same algorithm the preparation tool used, so a world installed under
 * the old scheme keeps the same ids under the new one.
 */
export async function stableId(...parts) {
  const data = new TextEncoder().encode(parts.join("\x1f"))
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data))
  let out = ""
  for (let i = 0; i < 16; i++) out += ID_ALPHABET[digest[i] % ID_ALPHABET.length]
  return out
}

/** A texture block shaped like the ones the packs already ship. */
function texture(src, rotation = 0) {
  return {
    src,
    anchorX: 0.5,
    anchorY: 0.5,
    offsetX: 0,
    offsetY: 0,
    fit: "fill",
    scaleX: 1,
    scaleY: 1,
    rotation,
    tint: "#ffffff",
    alphaThreshold: 0.75
  }
}

function marker(role, partner, video = "") {
  const m = { role, partner }
  if (video) m.video = video
  return { [FLAG_SCOPE]: { [FLAG_KEY]: m } }
}

function lowestSort(tiles) {
  let low = 0
  let seen = false
  for (const t of tiles) {
    const s = t?.sort || 0
    if (!seen || s < low) { low = s; seen = true }
  }
  return seen ? low : 0
}

/**
 * Has this scene been through the rebuild already?
 *
 * Both roles count. A scene whose video sat in the background gains no still
 * tile at all, only a video tile, so testing for the still alone would let a
 * second run walk over it and treat it as a scene without a video.
 */
function alreadyDone(tiles) {
  for (const t of tiles) {
    const flag = t?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]
    if (flag?.role === ROLE_STILL || flag?.role === ROLE_VIDEO) return true
  }
  return false
}

/* ------------------------------------------------------------------- rebuild */

/**
 * Rewrite one scene in place. Safe to call twice; the second call does nothing.
 *
 * Two shapes occur in the stock and each gets its own treatment. Measured over
 * the stock: 1859 of 2138 scenes carry the video in the background, and 253
 * carry it as a tile, of which 65 are rotated by 90, 180 or 270 degrees.
 */
/**
 * Gibt es dieses Standbild ueberhaupt?
 *
 * `bekannt` ist die Schluesselmenge des Manifests, also die Liste der Dateien,
 * die dieses Release wirklich mitbringt. Ohne sie hat der Umbau den Namen aus
 * dem Video abgeleitet und ungeprueft ins Dokument geschrieben.
 *
 * Warum das nicht bleiben durfte: 337 von rund 4.000 Videos im Bestand haben
 * kein Standbild im Paket, gemessen am 2026-08-24, die meisten davon
 * Intro-Sequenzen. Fuer jedes davon forderte Foundry eine Datei an, die es
 * nicht gibt, und schrieb eine rote 404-Zeile in das Konsolenlog des Kunden.
 * Bei JEDEM Oeffnen der Szene erneut, denn eine Fehlantwort wird nicht
 * zwischengespeichert.
 *
 * Ein 404 laesst sich nachtraeglich nicht verschlucken: der `fetch`-Ersatz des
 * Moduls sitzt hinter dem Ereignis, der Browser hat die Zeile bereits
 * geschrieben, wenn der Antwortkopf eintrifft. Die einzige Loesung ist, gar
 * nicht erst anzufragen.
 *
 * Ohne `bekannt` verhaelt sich der Umbau wie frueher. Das ist Absicht: eine
 * aeltere Modulfassung oder ein Aufruf von Hand soll nicht stumm die Haelfte
 * der Arbeit auslassen.
 */
function standbildVorhanden(still, bekannt) {
  if (!still) return false
  if (!bekannt) return true
  if (typeof bekannt.has === "function") return bekannt.has(still)
  return false
}

export async function rebuildScene(scene, report, bekannt) {
  const sid = String(scene?._id || "")
  const sname = String(scene?.name || sid)
  if (!Array.isArray(scene.tiles)) scene.tiles = []
  const tiles = scene.tiles

  if (alreadyDone(tiles)) {
    report?.skipped?.push(`${sname}: already rebuilt`)
    return
  }

  const background = scene.background || {}
  const bgSrc = background.src || ""

  // --- shape one: the video sits in the background -------------------------
  if (bgSrc && isVideo(bgSrc)) {
    const rect = sceneRect(scene)
    if (!rect) {
      report?.skipped?.push(`${sname}: unknown grid type ${scene?.grid?.type}`)
      return
    }
    const abgeleitet = stillPathFor(bgSrc)
    if (!abgeleitet) {
      report?.skipped?.push(`${sname}: cannot derive a still name from ${bgSrc}`)
      return
    }
    // Kein Standbild im Paket: der Hintergrund bleibt LEER statt auf eine
    // Datei zu zeigen, die es nicht gibt. Foundry zeichnet dann das Gitter,
    // fordert nichts an und meldet nichts. Das Video fuellt die Kachel, sobald
    // es da ist, und danach sieht die Szene aus wie jede andere.
    const still = standbildVorhanden(abgeleitet, bekannt) ? abgeleitet : ""
    if (!still) report?.stillless?.push(bgSrc)

    tiles.unshift({
      _id: await stableId(sid, bgSrc, "video"),
      // Empty on purpose. The still is already the scene background and covers
      // the same rectangle, so the tile has nothing to show until the video
      // arrives.
      texture: texture(""),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      elevation: 0,
      sort: lowestSort(tiles) - 1,
      rotation: 0,
      alpha: 1,
      hidden: false,
      locked: true,
      restrictions: { light: false, weather: false },
      occlusion: { mode: 0, alpha: 0 },
      video: { loop: true, autoplay: true, volume: 0 },
      flags: marker(ROLE_VIDEO, still, bgSrc)
    })

    scene.background = background
    scene.background.src = still
    report?.changes?.push({ scene: sname, action: "background-to-tile", video: bgSrc, still })
    // KEIN return. Bis zum 2026-08-24 stand hier einer, geerbt aus der
    // Python-Kette, und er war der gefaehrlichste Fehler des ganzen Umbaus.
    //
    // Eine Szene kann ein Video im Hintergrund UND Videos in Kacheln tragen.
    // Gemessen an "BM: Dragon Chamber" aus bm_0067: Hintergrundvideo plus zwei
    // Aktionsvideos als Kacheln. Der Abbruch behandelte den Hintergrund und
    // liess die beiden Kacheln stehen, mit dem Video in `texture.src`.
    //
    // Damit greift genau die Zeichenschranke, die dieser Umbau vermeiden soll:
    // `Canvas#draw` wartet auf jede Textur, `VideoResource.load()` kennt keine
    // Frist, und ein haengendes Video parkt die Leinwand fuer den Rest der
    // Sitzung. Ohne eine einzige Fehlermeldung, denn ein Warten ist kein
    // Fehler.
    //
    // Die unten eingefuegte Kachel stoert nicht: sie ist leer, und der Filter
    // von Form zwei sucht nach `texture.src`.
  }

  // --- shape two: the video is already a tile ------------------------------
  const videoTiles = tiles.filter(t => isVideo(t?.texture?.src || ""))
  if (!videoTiles.length) return

  // Below everything, and distinct per twin: sort ties are resolved by document
  // order, which is not something to rely on.
  const floor = lowestSort(tiles) - 1

  for (let index = 0; index < videoTiles.length; index++) {
    const srcTile = videoTiles[index]
    const tex = srcTile.texture || {}
    const video = tex.src || ""
    const abgeleitet = stillPathFor(video)
    if (!abgeleitet) {
      report?.skipped?.push(`${sname}: cannot derive a still name from ${video}`)
      continue
    }

    // Kein Standbild im Paket: KEINE Zwillingskachel. Eine Kachel, die auf eine
    // fehlende Datei zeigt, bekaeme von Foundry das Warndreieck ueber die halbe
    // Szene gelegt und erzeugte bei jedem Oeffnen eine 404-Zeile. Die
    // Originalkachel wird trotzdem geleert und traegt die Markierung, damit das
    // Video die Zeichenschranke verlaesst und spaeter nachkommt.
    const still = standbildVorhanden(abgeleitet, bekannt) ? abgeleitet : ""
    if (!still) {
      report?.stillless?.push(video)
      tex.src = ""
      srcTile.texture = tex
      srcTile.flags = srcTile.flags || {}
      srcTile.flags[FLAG_SCOPE] = srcTile.flags[FLAG_SCOPE] || {}
      srcTile.flags[FLAG_SCOPE][FLAG_KEY] = { role: ROLE_VIDEO, partner: "", video }
      report?.changes?.push({ scene: sname, action: "video-only", video, still: "" })
      continue
    }

    const twin = {
      _id: await stableId(sid, video, "still"),
      texture: texture(still, tex.rotation || 0),
      x: srcTile.x,
      y: srcTile.y,
      width: srcTile.width,
      height: srcTile.height,
      elevation: srcTile.elevation || 0,
      sort: floor - index,
      // Rotation is a document field, not a texture field, and 65 of the 253
      // video tiles in the stock use it. Copying it verbatim is what makes the
      // twin line up.
      rotation: srcTile.rotation || 0,
      alpha: srcTile.alpha ?? 1,
      // A hidden video must not gain a visible still.
      hidden: Boolean(srcTile.hidden),
      locked: true,
      restrictions: { light: false, weather: false },
      occlusion: { mode: 0, alpha: 0 },
      video: { loop: false, autoplay: false, volume: 0 },
      flags: marker(ROLE_STILL, video)
    }
    tiles.splice(tiles.indexOf(srcTile), 0, twin)

    // The video leaves the document the same way it does in shape one.
    srcTile.texture = tex
    tex.src = ""
    srcTile.flags = srcTile.flags || {}
    srcTile.flags[FLAG_SCOPE] = srcTile.flags[FLAG_SCOPE] || {}
    srcTile.flags[FLAG_SCOPE][FLAG_KEY] = { role: ROLE_VIDEO, partner: still, video }

    report?.changes?.push({ scene: sname, action: "twin-tile", video, still })
  }
}

/**
 * Rewrite every scene of a release in place.
 *
 * Called from the installer between the path rewrite and the gate-address pass,
 * so the paths written here are the installed ones and the second pass turns
 * both the still and the parked video address into gate addresses.
 */
export async function rebuildScenesForStream(scenes, bekannt) {
  const report = { changes: [], skipped: [], stillless: [] }
  if (!Array.isArray(scenes)) return report
  for (const scene of scenes) {
    if (scene && typeof scene === "object") await rebuildScene(scene, report, bekannt)
  }
  // Bewusst `log` und nicht `warn`. Uebersprungene Szenen und fehlende
  // Standbilder sind erwartbare Zustaende mit einem definierten Verhalten, kein
  // Fehlschlag. Eine gelbe Zeile im Konsolenlog liest ein Foundry-Nutzer als
  // Defekt seines Moduls, und das waere hier schlicht falsch.
  if (report.skipped.length) {
    console.log("Beneos Stream | Szenenumbau uebersprungen:", report.skipped)
  }
  if (report.stillless.length) {
    console.log(`Beneos Stream | ${report.stillless.length} Video(s) ohne Standbild im Paket. `
      + "Diese Szenen bleiben grau, bis das Video ankommt; es wird nichts angefordert.")
  }
  return report
}
