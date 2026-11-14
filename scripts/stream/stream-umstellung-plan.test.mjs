/**
 * Pruefsatz fuer stream-umstellung-plan.mjs, stre-T-064: aus der Welt die
 * Einheiten bauen, die der Kern umstellt.
 *
 * Alles, was Foundry oder das Netz braucht, kommt als Dienst herein und ist
 * hier eine Attrappe. Ohne Netz, ohne Foundry.
 *
 *   node scripts/stream/stream-umstellung-plan.test.mjs
 */

import { buildStreamPack } from "./stream-install.mjs"
const { planeKreaturen, planeKarten } = await import("./stream-umstellung-plan.mjs")

let gruen = 0
let rot = 0
function gleich(name, ist, soll) {
  if (JSON.stringify(ist) === JSON.stringify(soll)) { gruen++; console.log("  ok   " + name) }
  else { rot++; console.log("  ROT  " + name + "\n       soll " + JSON.stringify(soll) + "\n       ist  " + JSON.stringify(ist)) }
}

const KEY = "PlanSchluesselNurFuerDiesenSatz01"
const adresse = (k, f) => `https://gate.beneos.stream/c/${KEY}/beneos_ct_${k}/${f}`
const lokal = (k, f) => `beneos_assets/cloud/tokens/${k}/${f}`

class Dok {
  constructor(data, { pack = null, embedded = {} } = {}) { this.data = data; this.pack = pack; this.meta = { metadata: { embedded } } }
  get id() { return this.data._id }
  toObject() { return structuredClone(this.data) }
}
// Foundry liest das Metadatum vom Konstruktor; die Attrappe reicht es durch.
Object.defineProperty(Dok.prototype, "constructor", { get() { return this.meta } })

// ======================================================= Kreaturen
console.log("Kreaturen")
{
  // Wolf: zwei Varianten. Variante 1 im Draufsicht-Stil installiert, darum
  // traegt das Register token == topDown, und der -token-Name steht nur in
  // der Posenliste. Variante 2 ohne Draufsicht.
  const register = {
    "w-1": { tokenKey: "wolf", token: lokal("wolf", "wolf-1-top.webp"), topDown: lokal("wolf", "wolf-1-top.webp"), avatar: lokal("wolf", "wolf-1-avatar.webp") },
    "w-2": { tokenKey: "wolf", token: lokal("wolf", "wolf-2-token.webp"), topDown: null },
    "b-1": { tokenKey: "baer", token: lokal("baer", "../boese-1-token.webp"), topDown: null },
    "f-1": { tokenKey: "fuchs", token: lokal("fuchs", "fuchs-1-token.webp"), topDown: null },
    "x-1": { tokenKey: "gestreamt", token: adresse("gestreamt", "gestreamt-1-token.webp"), topDown: null },
  }
  const sha = (c) => c.repeat(64)
  const listen = {
    beneos_ct_wolf: { tokenbilder: {
      1: { tokenized: { pfad: "wolf-1-token.webp", sha256: sha("a") }, topdown: { pfad: "wolf-1-top.webp", sha256: sha("b") } },
      2: { tokenized: { pfad: "wolf-2-token.webp", sha256: sha("c") } },
    } },
    beneos_ct_fuchs: null,
  }
  // Nachbau der Abfrage aus stream-posen.mjs, nach Variante und Stil des Namens.
  const tokenbildImSpiegel = (liste, pfad) => {
    const m = /-(\d+)-(token|top)\.webp$/.exec(pfad)
    const e = liste?.tokenbilder?.[m?.[1]]?.[m?.[2] === "top" ? "topdown" : "tokenized"]
    if (!liste) return { zustand: null, pfad: null, sha256: null }
    return e ? { zustand: true, pfad: e.pfad, sha256: e.sha256 } : { zustand: false, pfad: null, sha256: null }
  }
  const packActor = new Dok({ _id: "p", flags: { world: { beneos: { tokenKey: "wolf" } } }, prototypeToken: { texture: { src: lokal("wolf", "wolf-2-token.webp") } } }, { pack: "world.beneos_module_actors" })
  const fremdPack = new Dok({ _id: "q", flags: { world: { beneos: { tokenKey: "baer" } } } }, { pack: "world.beneos_module_actors" })
  const weltActor = new Dok({ _id: "w" })
  const szene = new Dok({ _id: "s", tokens: [] }, { embedded: { Token: "tokens" } })
  const abgefragt = []
  const r = await planeKreaturen({
    register, packActors: [packActor, fremdPack], weltActors: [weltActor], szenen: [szene],
    posenliste: async (rel) => { abgefragt.push(rel); return listen[rel] ?? null },
    tokenbildImSpiegel, adresse,
  })
  const wolf = r.einheiten.find((e) => e.id === "kreatur:wolf")
  gleich("Wolf: beide Ansichten von Variante 1 und Variante 2 in der Map",
    [...wolf.map.keys()].sort(),
    [lokal("wolf", "wolf-1-token.webp"), lokal("wolf", "wolf-1-top.webp"), lokal("wolf", "wolf-2-token.webp")])
  gleich("Wolf: Ziel ist die Toradresse wie beim Installer", wolf.map.get(lokal("wolf", "wolf-1-token.webp")), adresse("wolf", "wolf-1-token.webp"))
  gleich("Wolf: Proben mit sha256 aus der Posenliste", wolf.proben.map((p) => p.sha256).sort(), [sha("a"), sha("b"), sha("c")])
  gleich("Wolf: fullIds beider Varianten", wolf.fullIds.sort(), ["w-1", "w-2"])
  gleich("Wolf: Kompendiumsactor des Wolfs dabei, fremder nicht", wolf.dokumente.filter((d) => d.pack).map((d) => d.id), ["p"])
  gleich("Wolf: Weltactors und Szenen dabei", wolf.dokumente.filter((d) => !d.pack).map((d) => d.id), ["w", "s"])
  gleich("Avatar nie in der Map", [...wolf.map.keys()].some((k) => k.includes("avatar")), false)
  gleich("Baer mit untauglichem Namen: keine Einheit", r.einheiten.some((e) => e.id === "kreatur:baer"), false)
  gleich("Baer gezaehlt", r.lokal.untauglich, 1)
  const fuchs = r.einheiten.find((e) => e.id === "kreatur:fuchs")
  gleich("Fuchs ohne Posenliste: Name aus dem Register, Probe ohne sha256", [fuchs.map.size, fuchs.proben[0].sha256 ?? null], [1, null])
  gleich("schon gestreamte Kreatur: keine Einheit", r.einheiten.some((e) => e.id === "kreatur:gestreamt"), false)
  gleich("Posenliste je Kreatur einmal", abgefragt.sort(), ["beneos_ct_fuchs", "beneos_ct_wolf"])
}
{
  // Die Liste sagt: diese Datei gibt es am Tor nicht. Dann bleibt die Kreatur lokal.
  const r = await planeKreaturen({
    register: { "z-1": { tokenKey: "zombie", token: lokal("zombie", "zombie-1-token.webp") } },
    packActors: [], weltActors: [], szenen: [],
    posenliste: async () => ({ tokenbilder: {} }),
    tokenbildImSpiegel: () => ({ zustand: false, pfad: null, sha256: null }),
    adresse,
  })
  gleich("Datei laut Liste nicht am Tor: keine Einheit", r.einheiten.length, 0)
  gleich("als nicht am Tor gezaehlt", r.lokal.nichtAmTor, 1)
}

// ======================================================= Karten
console.log("Karten")
const GRUND = { entries: [
  { key: "map.webp", role: "edge", bytes: 10 },
  { key: "tiles/baum.webp", role: "edge", bytes: 5 },
  { key: "token.webp", role: "local", bytes: 3 },
] }
function kartenWelt(manifeste, { docs = { byPath: { "data/Scene.json": ["s1"] }, playlists: [{ id: "pl", sounds: ["so"] }] }, sceneIds = ["s1"] } = {}) {
  const szene = new Dok({ _id: "s1", background: { src: "beneos_assets/cloud/packaged/map.webp" }, tiles: [{ _id: "t", texture: { src: "beneos_assets/cloud/packaged/tiles/baum.webp" } }] }, { embedded: { Tile: "tiles" } })
  const liste = new Dok({ _id: "pl", sounds: [{ _id: "so", path: "beneos_assets/cloud/packaged/token.webp" }] }, { embedded: { PlaylistSound: "sounds" } })
  return {
    szene,
    d: {
      vermerke: Object.fromEntries(Object.keys(manifeste).map((rel) => [`${rel}_4k`, { releaseDir: rel, variant: "4k", mode: manifeste[rel].mode ?? "download" }])),
      paketFuer: async (rel) => (manifeste[rel].paket === null ? null : `${rel}_foundry_4k`),
      ladeManifest: async (release) => { const m = manifeste[release].manifest; if (m instanceof Error) throw m; return m },
      // Der echte Bau, mit einer Adressbildung und einem Pfad wie im Installer.
      baueStreamPack: (m, release, variant) => buildStreamPack(m, release, variant),
      findDocs: () => docs,
      sceneIds: () => new Set(sceneIds),
      dokument: (art, id) => (art === "Scene" && id === "s1" ? szene : art === "Playlist" && id === "pl" ? liste : null),
    },
  }
}
{
  const { d } = kartenWelt({
    beneos_bm_0042: { manifest: GRUND },
    beneos_bm_shared: { manifest: { entries: [...GRUND.entries, { key: "ui.webp", role: "shared", url: "https://gate.beneos.stream/s/x/y/z/shared/" + "a".repeat(64) + "/ui.webp" }] } },
    beneos_bm_video: { manifest: { entries: [...GRUND.entries, { key: "loop.m4v", role: "edge" }] } },
    beneos_bm_videoabfrage: { manifest: { entries: [...GRUND.entries, { key: "loop.webm?x=1", role: "edge" }] } },
    beneos_bm_kaputt: { manifest: new Error("404") },
    beneos_bm_unbekannt: { manifest: GRUND, paket: null },
    beneos_bm_stream: { manifest: GRUND, mode: "stream" },
  })
  const r = await planeKarten(d)
  gleich("nur das saubere Release wird Einheit", r.einheiten.map((e) => e.id), ["karte:beneos_bm_0042_4k"])
  gleich("shared bleibt lokal", r.lokal.shared, 1)
  gleich("Video bleibt lokal, auch .m4v und mit Abfrage", r.lokal.video, 2)
  gleich("Manifest kaputt gezaehlt", r.lokal.manifest, 1)
  gleich("Paket unbekannt gezaehlt", r.lokal.unbekannt, 1)
  gleich("schon gestreamtes Release nicht angefasst", r.lokal.schonStream, 1)
}
{
  const { d } = kartenWelt({ beneos_bm_0042: { manifest: GRUND } }, { docs: null })
  const r = await planeKarten(d)
  gleich("Vermerk ohne Dokumente: lokal, unbekannt", [r.einheiten.length, r.lokal.unbekannt], [0, 1])
}
{
  const { d } = kartenWelt({ beneos_bm_0042: { manifest: GRUND } }, { sceneIds: [] })
  const r = await planeKarten(d)
  gleich("Vermerk ohne Szenen: lokal, unbekannt", [r.einheiten.length, r.lokal.unbekannt], [0, 1])
}
{
  const { d } = kartenWelt({ beneos_bm_0042: { manifest: GRUND } })
  const [e] = (await planeKarten(d)).einheiten
  gleich("Karte: Map nur aus edge-Eintraegen, local bleibt", [...e.map.keys()].sort(),
    ["beneos_assets/cloud/packaged/map.webp", "beneos_assets/cloud/packaged/tiles/baum.webp"])
  gleich("Karte: Szene und Playlist sind Dokumente", e.dokumente.map((x) => x.id), ["s1", "pl"])
  gleich("Karte: geprobt wird, was geschrieben wuerde (Hintergrund, Kachel)", e.proben.length, 2)
  gleich("Karte: keine Registerschluessel", e.fullIds, [])
}

// ======================================================= Paketkennung
console.log("Paketkennung aus dem Katalog (geschnitten aus beneos-install-state.mjs)")
{
  const { readFileSync } = await import("node:fs")
  const { dirname, join } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "cloud-v2", "beneos-install-state.mjs"), "utf8")
  // Das Modul laedt in Node nicht (Hooks, FormApplication, document); die
  // beiden reinen Funktionen werden darum aus dem echten Text geschnitten.
  const schnitt = (name) => {
    const m = new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(quelle)
    return m ? m[0].replace(/^export /, "") : ""
  }
  const rumpf = `${schnitt("releaseKern")}\n${schnitt("paketKennungAus")}\nreturn paketKennungAus`
  const paketKennungAus = new Function(rumpf)()
  const katalog = [
    { release_dir: "beneos_bm_0042_tavern", variant_dirs: { "4K": "beneos_bm_0042_foundry_4k", HD: "beneos_bm_0042_foundry_hd" } },
    { filename: "beneos_bm_0007", variant_dirs: { HD: "beneos_bm_0007_foundry_hd" } },
  ]
  gleich("voller Name, Variante klein geschrieben", paketKennungAus(katalog, "beneos_bm_0042_tavern", "hd"), "beneos_bm_0042_foundry_hd")
  gleich("nur der Kern stimmt", paketKennungAus(katalog, "bm_0042", "4k"), "beneos_bm_0042_foundry_4k")
  gleich("ohne Variante: 4K", paketKennungAus(katalog, "beneos_bm_0042_tavern", ""), "beneos_bm_0042_foundry_4k")
  gleich("Rueckfall auf HD", paketKennungAus(katalog, "beneos_bm_0007", ""), "beneos_bm_0007_foundry_hd")
  gleich("unbekannt: null", paketKennungAus(katalog, "beneos_bm_9999", "4k"), null)
  const uninst = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "cloud-v2", "beneos-native-uninstaller.mjs"), "utf8")
  gleich("Uninstaller ruft paketKennungAus", /return paketKennungAus\(await mgr\.listReleases\(\), releaseDir, variant\)/.test(uninst), true)
}

console.log(`\n${gruen} gruen, ${rot} rot`)
process.exit(rot ? 1 : 0)
