/**
 * install-ziel.test.mjs
 *
 * Gegenprobe zu `install-ziel.mjs`, ohne Foundry:
 *
 *   node --test scripts/cloud-v2/install-ziel.test.mjs
 *
 * MO-011: #doRefreshManifest schluesselte gepackte Assets ohne
 * PACKAGED_INSTALL_PREFIX, #classifyPack mit. Nach einem Signatur-Refresh las
 * der Transfer fuer gepackte Assets weiter die abgelaufene URL.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as ziel from "./install-ziel.mjs"

const { installZiel, PACKAGED_INSTALL_PREFIX } = ziel

test("installZiel: Battlemap, gepackt, Dokument", () => {
  assert.deepEqual(installZiel("data/assets/beneos_assets/beneos_battlemaps/a/map.webp"),
    { target: "beneos_assets/cloud/battlemaps/a/map.webp", rawRel: "beneos_assets/beneos_battlemaps/a/map.webp", gepackt: false })
  assert.deepEqual(installZiel("data/assets/beneos_assets/beneos_tokens/t.webp"),
    { target: "beneos_assets/beneos_tokens/t.webp", rawRel: "beneos_assets/beneos_tokens/t.webp", gepackt: false })
  assert.deepEqual(installZiel("data/assets/modules/beneos-module/icons/pin.webp"),
    { target: PACKAGED_INSTALL_PREFIX + "modules/beneos-module/icons/pin.webp", rawRel: "modules/beneos-module/icons/pin.webp", gepackt: true })
  assert.deepEqual(installZiel("data/assets//worlds/w/thumb.webp"),
    { target: PACKAGED_INSTALL_PREFIX + "worlds/w/thumb.webp", rawRel: "/worlds/w/thumb.webp", gepackt: true })
  assert.deepEqual(installZiel("data/Scene.json"), { target: "data/Scene.json", rawRel: null, gepackt: false })
  assert.deepEqual(installZiel("mtte.json"), { target: "mtte.json", rawRel: null, gepackt: false })
})

// Die beiden Schleifen werden WOERTLICH aus dem Installer geschnitten und
// ausgefuehrt, damit der Test die echten Stellen misst und nicht einen Nachbau.
// Ein fehlender Anker heisst: die Stelle wurde umgebaut, der Test muss mit.
const quelle = readFileSync(new URL("./beneos-native-installer.mjs", import.meta.url), "utf8")
function schneide(von, bis) {
  const i = quelle.indexOf(von)
  const j = i < 0 ? -1 : quelle.indexOf(bis, i + von.length)
  assert.ok(i >= 0 && j >= 0, `Anker im Installer fehlt: ${von}`)
  return quelle.slice(i, j)
}
const helfer = Object.keys(ziel)
const lauf = (rumpf, ...namen) => new Function(...helfer, ...namen, rumpf)

test("Refresh trifft jeden Schluessel, den die Klassifikation angelegt hat", () => {
  const klassifiziere = lauf(
    schneide("    for (const [relPath, url] of Object.entries(packInfo)) {", "    return { assets, jsons }") + "\nreturn assets",
    "packInfo", "assets", "jsons")
  const anker = "const fresh = await mgr.getPackInfo(this.packageId)\n"
  const refresh = lauf(schneide(anker, "      return true").slice(anker.length), "fresh")
  const packInfo = {
    "data/Scene.json": "https://x/scene?sig=ALT",
    "data/assets/beneos_assets/beneos_battlemaps/map.webp": "https://x/map?sig=ALT",
    "data/assets/modules/beneos-module/icons/pin.webp": "https://x/pin?sig=ALT",
    "data/assets/worlds/autorenwelt/thumb.webp": "https://x/thumb?sig=ALT",
  }
  const fresh = Object.fromEntries(Object.entries(packInfo).map(([k, v]) => [k, v.replace("ALT", "NEU")]))
  const self = { _urlByTarget: new Map(), _packagedRemap: new Map(), _result: { totals: {} } }
  const werte = helfer.map((k) => ziel[k])
  const assets = klassifiziere.call(self, ...werte, packInfo, [], {})
  assert.equal(self._result.totals.packagedAssets, 2)
  refresh.call(self, ...werte, fresh)
  for (const a of assets) {
    assert.equal(self._urlByTarget.get(a.target), fresh[a.relPath], `abgelaufene URL fuer ${a.target}`)
  }
  assert.equal(self._urlByTarget.get("data/Scene.json"), fresh["data/Scene.json"])
})
