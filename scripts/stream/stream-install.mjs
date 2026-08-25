/**
 * The streaming mode of the release installer.
 *
 * Today an install copies roughly 170 files into the world and then rewrites the
 * document paths to match. In streaming mode the heavy files are not copied at
 * all: the documents carry the address of the gate instead, and the browser
 * fetches the bytes the first time a scene is actually opened.
 *
 * The split is not decided here. Every manifest entry carries the role it was
 * given when the release was prepared, and this file only obeys it. Five roles
 * occur, and the module treats each differently:
 *
 *   edge    an address per release, behind the key check
 *   shared  one address for content several releases have in common, no key
 *   local   downloaded into the world; the pictures a failed edge must not take
 *   doc     the document collections
 *   skip    not downloaded and not rewritten: the client already has the file
 *
 * Measured over the fifteen beta releases: 18.98 GB moves to the edge, 0.03 GB
 * collapses into the shared space, 0.38 GB stays on the customer's disk, and
 * 0.01 GB is not shipped at all.
 *
 * Two things are deliberately NOT done here.
 *
 * The existing rewrite is left alone. `remapAssetString` returns early after its
 * prefix swap, so a battlemap path never reaches the exact-match table, and
 * bending that function would put a beta concern into the middle of the live
 * install path. Instead the addresses are applied in a second pass afterwards,
 * against the very paths the first pass produced.
 *
 * Nothing is touched that is not in the pack list. A customer's own picture
 * appears in no manifest, so it cannot be rewritten by accident.
 */

import { assetUrl, downloadMode, pinStillsEnabled, streamBase, streamEnabled, streamKey } from "./stream-settings.mjs"

const PACK_SOURCE_PREFIX = "beneos_assets/beneos_battlemaps/"
const CLOUD_INSTALL_PREFIX = "beneos_assets/cloud/battlemaps/"
const PACKAGED_INSTALL_PREFIX = "beneos_assets/cloud/packaged/"
const DOC_DIR = "_docs/"

const stripLeadSlash = (p) => String(p).replace(/^\/+/, "")

/**
 * Where a packed asset ends up in the world. Mirrors the installer's own rule,
 * both halves of it (beneos-native-installer.mjs:755-770).
 *
 * The second half matters now and did not before. Anything that does not land
 * in a `beneos_assets/` namespace is relocated under the packaged prefix,
 * because writing it back into `modules/` or `icons/` would be overwritten by
 * the next package update. While only video and sound were streamed the point
 * never came up, since both always sit under `beneos_assets/`. With pictures
 * streamed it comes up at once: the scene thumbnails under `worlds/` would get
 * a key that matches nothing after the rewrite, and the second pass would walk
 * silently past them.
 */
function installedPath(inWorld) {
  const swapped = inWorld.includes(PACK_SOURCE_PREFIX)
    ? inWorld.split(PACK_SOURCE_PREFIX).join(CLOUD_INSTALL_PREFIX)
    : inWorld
  return /^beneos_assets\//i.test(swapped)
    ? swapped
    : PACKAGED_INSTALL_PREFIX + stripLeadSlash(swapped)
}

/**
 * Split a package directory into release and variant.
 *
 * The stock names them `beneos_bm_<slug>_foundry_4k`, `_hd`, or plain
 * `_foundry` for the handful of single-edition packs. The bucket is laid out
 * the same way, so the address of a file is its key and nothing has to be
 * looked up.
 */
export function releaseFromPackage(packageId) {
  const m = /^(.+?)_foundry(?:_(4k|hd))?$/i.exec(String(packageId || ""))
  if (!m) return { release: String(packageId || ""), variant: "single" }
  return { release: m[1], variant: (m[2] || "single").toLowerCase() }
}

/**
 * The file list of one release variant, as written by the preparation tool.
 * Every entry carries its role: `edge` stays an address, `local` is downloaded,
 * `doc` is a document collection.
 */
export async function loadStreamManifest(release, variant) {
  // Cache-busted on purpose. The manifest decides, per file, whether it is
  // downloaded or stays an address, and it lives at a fixed address whose
  // content changes every time a release is prepared again. Measured on
  // 2026-08-12: a re-published release installed from the previous run's
  // manifest, held at the edge, and pulled down 62 files that should have
  // stayed remote. Nothing failed and nothing was logged.
  const url = `${assetUrl(release, variant, "stream-manifest.json")}?t=${Date.now()}`
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`stream manifest unavailable (${response.status}) for ${release}/${variant}`)
  }
  const manifest = await response.json()
  if (!Array.isArray(manifest?.entries)) {
    throw new Error(`stream manifest malformed for ${release}/${variant}`)
  }
  return manifest
}

/**
 * Turn a manifest into what the installer expects.
 *
 * `packInfo` is shaped exactly like the one a ZIP or the cloud produces, so
 * `#classifyPack` and everything behind it stay untouched. `streamTargets` is
 * the extra part: installed path -> gate address, for the files that are never
 * copied.
 */
export function buildStreamPack(manifest, release, variant) {
  const packInfo = {}
  const streamTargets = new Map()
  const download = downloadMode()
  let edgeBytes = 0
  let localBytes = 0
  let sharedBytes = 0
  let skipped = 0
  let pinned = 0

  for (const entry of manifest.entries) {
    const key = stripLeadSlash(entry.key)

    if (key.startsWith(DOC_DIR)) {
      // Cache-busted for the same reason as the manifest. A document collection
      // is rewritten every time a release is prepared again, and it sits at a
      // fixed address; without this the edge answers with the version it has
      // been holding, and the install builds a world from documents that no
      // longer describe the package it just fetched.
      packInfo[`data/${key.slice(DOC_DIR.length)}`] =
        `${assetUrl(release, variant, key)}?t=${Date.now()}`
      continue
    }

    // Neither downloaded nor rewritten. The reference is left exactly as the
    // document wrote it, because Foundry resolves `icons/...` against its own
    // installation and the module's own icons ship with the module. Verified
    // by checksum on 2026-08-12, not assumed: all 345 module-owned files in the
    // beta packages are byte-identical to the installed ones.
    if (entry.role === "skip") {
      skipped += 1
      continue
    }

    // The cautious variant, off by default. The manifest marks per file whether
    // it is one of the pictures a scene needs in order to draw at all; with the
    // switch on those are downloaded instead of streamed. Keeping the mark in
    // the manifest rather than in the role is what lets the two forms be
    // compared by reloading rather than by preparing and publishing again.
    if (!download && entry.pin && pinStillsEnabled()) {
      packInfo[`data/assets/${key}`] = assetUrl(release, variant, key)
      localBytes += entry.bytes || 0
      pinned += 1
      continue
    }

    // The measuring mode. Every remaining file is fetched and written into the
    // world, so the release lands on disk exactly as the cloud route lands it
    // and the two routes differ in one thing only: where the bytes came from.
    // `streamTargets` stays empty, which makes the second pass a no-op by
    // itself, and the video is put back into its tile further down.
    if (download) {
      packInfo[`data/assets/${key}`] = entry.role === "shared"
        ? (entry.url || assetUrl(release, variant, key))
        : assetUrl(release, variant, key)
      localBytes += entry.bytes || 0
      continue
    }

    // Never enter packInfo: an entry there would be downloaded.
    if (entry.role === "edge") {
      streamTargets.set(stripLeadSlash(installedPath(key)),
                        assetUrl(release, variant, key))
      edgeBytes += entry.bytes || 0
      continue
    }
    if (entry.role === "shared") {
      // The address does not follow from release and variant, so it cannot be
      // derived and is read from the manifest. A shared entry without one is
      // dropped to the per-release address rather than guessed at.
      const url = entry.url || assetUrl(release, variant, key)
      streamTargets.set(stripLeadSlash(installedPath(key)), url)
      sharedBytes += entry.bytes || 0
      continue
    }

    packInfo[`data/assets/${key}`] = assetUrl(release, variant, key)
    localBytes += entry.bytes || 0
  }

  return { packInfo, streamTargets, edgeBytes, localBytes, sharedBytes, skipped, pinned, download }
}

/**
 * The beta release listing, in the shape the cloud window's own listing has.
 *
 * The beta has no database behind it: the gate filters a static catalogue
 * against the key and returns the rows unchanged, so the window can render and
 * install from them without knowing where they came from.
 */
export async function listReleases() {
  const response = await fetch(`${streamBase().replace(/\/+$/, "")}/catalog/${streamKey()}`)
  if (!response.ok) {
    throw new Error(`beta catalogue unavailable (${response.status})`)
  }
  const body = await response.json()
  if (!Array.isArray(body?.releases)) {
    throw new Error("beta catalogue malformed")
  }
  return body.releases
}

/**
 * Medienadressen in HTML. Dieselbe Regex steht seit jeher dreimal im Modul, in
 * beneos-asset-path-repair.js:626, beneos-asset-watcher.js:409 und
 * beneos-scenepacker.js:563. Sie wird hier bewusst in derselben Form benutzt,
 * damit vier Stellen dieselbe Vorstellung davon haben, was eine Medienadresse
 * in HTML ist.
 */
const HTML_SRC_RE = /<(?:img|video|source|audio)\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi

/** Die Gate-Adresse zu einem installierten Pfad, oder null. */
function gateAdresseFuer(wert, streamTargets) {
  let key = stripLeadSlash(wert)
  try { key = stripLeadSlash(decodeURIComponent(wert)) } catch (_) { /* keep raw key */ }
  return streamTargets.get(key) || null
}

/**
 * Second pass over a document: swap installed paths for gate addresses.
 *
 * Runs after the installer's own rewrite, on the paths that rewrite produced.
 * Exact matches only, and only against the map built from this release's file
 * list, so anything the customer put there stays as it is.
 *
 * DER ZWEITE TREFFERTYP, seit dem 25.08.2026: Adressen mitten im HTML.
 *
 * Bis dahin gab es genau einen Treffertyp, den Nachschlag auf einem GANZEN
 * Feldwert. Ein `text.content` einer Journalseite beginnt mit `<p>`, trifft nie
 * einen Schluessel und ging unveraendert durch. Gemeldet vom Betreiber an einem
 * Handout: die Bildseite zeigte auf die Cloud, die Textseite daneben, die man
 * den Spielern aufdeckt, zeigte weiter auf die Platte.
 *
 * Gemessen in der Pruefwelt: 256 von 282 Textseiten tragen ein Bild im HTML,
 * zusammen 438 Adressen. Im Download-Modus faellt das nicht auf, weil die Datei
 * dann wirklich dort liegt; nur beim Streaming zeigt sie ins Leere.
 *
 * Der Nachschlag trifft ohne Umrechnung, und das ist kein Zufall: `streamTargets`
 * ist mit dem INSTALLIERTEN Pfad verschluesselt, und `toCloudAssetPath()` im
 * Installer arbeitet mit `split/join`, tauscht den Praefix also auch mitten im
 * HTML. Beide Seiten sprechen dieselbe Form.
 */
export function applyStreamAddresses(value, streamTargets) {
  if (!streamTargets || !streamTargets.size) return value

  if (typeof value === "string") {
    if (value === "") return value
    const target = gateAdresseFuer(value, streamTargets)
    if (target) return target

    // Der Vorfilter haelt die Regex von den zehntausenden gewoehnlichen
    // Feldwerten fern, die nie HTML sind.
    if (!value.includes("<") || !value.includes("src=")) return value
    return value.replace(HTML_SRC_RE, (treffer, anfuehrung, src) => {
      const ziel = gateAdresseFuer(src, streamTargets)
      if (!ziel) return treffer
      // Nur das Anfuehrungspaar tauschen, damit Attribute davor und dahinter
      // unberuehrt bleiben. Technik uebernommen aus _rewriteHtml,
      // beneos-asset-path-repair.js:628-638.
      return treffer.replace(`${anfuehrung}${src}${anfuehrung}`, `${anfuehrung}${ziel}${anfuehrung}`)
    })
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = applyStreamAddresses(value[i], streamTargets)
    return value
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = applyStreamAddresses(value[k], streamTargets)
    return value
  }
  return value
}

/*
 * `restoreLocalVideos` stand hier bis zum 2026-08-23 und ist ersatzlos
 * entfallen.
 *
 * Es baute den Szenenumbau fuer ein heruntergeladenes Release zurueck: Video
 * aus der Markierung zurueck in die Kachel, Markierung weg. Noetig war das,
 * weil die Aufbereitung den Umbau vorgekocht ins Paket legte und der
 * Download-Weg ihn deshalb erst wieder loswerden musste.
 *
 * Seit dem Umbau rechnet ihn `stream-scenes.mjs` beim Installieren, und zwar
 * nur im Streaming-Modus. Ein heruntergeladenes Release bekommt die
 * Originaldokumente und braucht keinen Rueckbau mehr.
 */

/** Every gate address a release variant will ever ask for. Feeds the prewarm. */
export function streamUrlsOf(streamTargets) {
  return [...streamTargets.values()]
}

export function streamModeActive() {
  return streamEnabled()
}
