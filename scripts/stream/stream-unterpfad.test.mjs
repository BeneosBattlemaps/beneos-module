/**
 * ADRESSEN TRAGEN DAS ROUTENPRAEFIX, UND DIE TOUR BEHAELT EINE STREAMADRESSE
 * (stre-T-159, stre-T-160).
 *
 * Eine Foundry kann unter einem Unterpfad laufen (ROUTE_PREFIX, etwa
 * https://host/foundry/game). Eine Adresse "/" + pfad zeigt dann auf die
 * Wurzel des Servers: 404 beim Abruf, ein leeres Feld beim Bild. Neun
 * Stellen bauten so (Kalt-Review zu T-156, W2). Jetzt laufen alle ueber
 * `routeAdresse` aus `beneos-asset-watcher.js`, das `foundry.utils.getRoute`
 * ruft. Ohne Praefix kommt derselbe String heraus wie vorher; das ist der
 * zweite Wert jeder Probe.
 *
 * Dazu T-160: Bei intro-complete verwarf die Tour die gespeicherte
 * Kacheladresse, wenn headCheck sie nicht pruefen konnte (status -2, etwa
 * `beneos://` aus dem Stream-Einbau), und schrieb einen geratenen Pfad
 * dauerhaft in die Kachel.
 *
 * DIESER SATZ FAEHRT DEN ECHTEN CODE: Funktionen und Ausdruecke werden aus
 * dem Quelltext geschnitten (`tools/lib/extract-method.mjs`). Jede Probe ist
 * im Sabotagelaeufer (`tools/stream-sabotagen.mjs`, Satz `unterpfad`)
 * bewacht.
 *
 * Lauf:  node scripts/stream/stream-unterpfad.test.mjs
 */

import { readFileSync } from "node:fs"
import { pruefstand } from "../../tools/lib/foundry-attrappe.mjs"
import { extractMethod } from "../../tools/lib/extract-method.mjs"

const p = pruefstand("unterpfad: Routenpraefix an neun Stellen, Kachelsymbol der Tour")

const lies = (pfad) => readFileSync(new URL(pfad, import.meta.url), "utf8")
const WAECHTER = lies("../beneos-asset-watcher.js")
const TOUREN = lies("../beneos_tours.js")
const INSTALLER = lies("../cloud-v2/beneos-native-installer.mjs")
const DEINSTALLER = lies("../cloud-v2/beneos-native-uninstaller.mjs")
const KREATUR = lies("../codex2/creature-codex.mjs")
const KODEX = lies("../codex2/beneos-codex.mjs")
const SCHMIEDE = lies("../cloud-v2/forge-generator.mjs")
const PDF = lies("../codex2/pdf-viewer-window.mjs")

// Foundrys getRoute, Wortlaut aus common/utils/helpers.mjs:616 (V13 und V14).
function getRoute(path, { prefix } = {}) {
  prefix = prefix === undefined ? globalThis.ROUTE_PREFIX : prefix || null
  path = path.replace(/(^\/+)|(\/+$)/g, "")
  let paths = [""]
  if (prefix) paths.push(prefix)
  paths = paths.concat([path.replace(/(^\/)|(\/$)/g, "")])
  return paths.join("/")
}
globalThis.foundry = { utils: { getRoute } }
const mitPraefix = (fn) => { globalThis.ROUTE_PREFIX = "foundry"; try { return fn() } finally { globalThis.ROUTE_PREFIX = undefined } }
const ohnePraefix = (fn) => { globalThis.ROUTE_PREFIX = undefined; return fn() }

/** Schneidet eine Funktion; misslingt es, wird jede Probe rot statt abzubrechen. */
function schnitt(text, name, grenzen = { minZeilen: 1, maxZeilen: 80 }) {
  try { return extractMethod(text, name, grenzen).trimStart().replace(/^export /, "").replace(/^async #(\w+)/, "async function $1") }
  catch (e) { console.log(`  Schnitt ${name} misslang: ${e.message}`); return null }
}
function binde(quelle, namen, bereich, ausdruck) {
  if (quelle == null) return null
  try { return new Function(...Object.keys(bereich), `${quelle}\nreturn (${ausdruck ?? namen})`)(...Object.values(bereich)) }
  catch (e) { console.log(`  Binden ${namen} misslang: ${e.message}`); return null }
}
const sicher = (fn) => { try { return fn() } catch (e) { return `Wurf: ${e.message}` } }
const sicherAsync = async (fn) => { try { return await fn() } catch (e) { return `Wurf: ${e.message}` } }

// ===========================================================================
p.abschnitt("routeAdresse in beneos-asset-watcher.js")
const routeQuelle = schnitt(WAECHTER, "routeAdresse")
const routeAdresse = binde(routeQuelle, "routeAdresse", {}) ?? (() => "fehlt")
p.gleich("mit Praefix traegt die Adresse den Unterpfad", mitPraefix(() => routeAdresse("beneos_assets/x/y.webp")), "/foundry/beneos_assets/x/y.webp")
p.gleich("ohne Praefix bleibt die Adresse wie vorher", ohnePraefix(() => routeAdresse("beneos_assets/x/y.webp")), "/beneos_assets/x/y.webp")
p.gleich("fuehrende Schraegstriche werden zu genau einem", ohnePraefix(() => routeAdresse("///beneos_assets/x.webp")), "/beneos_assets/x.webp")
// Ohne foundry.utils (Rueckfallzweig) normalisiert getRoute nicht; dann
// muss routeAdresse selbst die fuehrenden Schraegstriche kuerzen.
const ohneFoundry = (fn) => { const f = globalThis.foundry; globalThis.foundry = undefined; try { return fn() } finally { globalThis.foundry = f } }
p.gleich("ohne Foundry bleibt es bei genau einem Schraegstrich", ohneFoundry(() => routeAdresse("///beneos_assets/x.webp")), "/beneos_assets/x.webp")
// stre-T-164, Vertrag erweitert: eine Adresse mit Schema und eine
// protokollrelative Adresse (//host) bleiben stehen; "///x" ist ein Pfad.
p.gleich("//host/x bleibt mit Praefix stehen", mitPraefix(() => routeAdresse("//host/x")), "//host/x")
p.gleich("//host/x bleibt ohne Praefix stehen", ohnePraefix(() => routeAdresse("//host/x")), "//host/x")
p.gleich("https://h/x bleibt mit Praefix stehen", mitPraefix(() => routeAdresse("https://h/x")), "https://h/x")
p.gleich("https://h/x bleibt ohne Praefix stehen", ohnePraefix(() => routeAdresse("https://h/x")), "https://h/x")
p.gleich("/x mit Praefix", mitPraefix(() => routeAdresse("/x")), "/foundry/x")
p.gleich("/x ohne Praefix", ohnePraefix(() => routeAdresse("/x")), "/x")
p.gleich("///x mit Praefix", mitPraefix(() => routeAdresse("///x")), "/foundry/x")
p.gleich("///x ohne Praefix", ohnePraefix(() => routeAdresse("///x")), "/x")

// ===========================================================================
p.abschnitt("A1 beneos_tours.js: Kodex-Inhalt des Rot Cerf")
const abrufe = []
const tourAbruf = binde(schnitt(TOUREN, "beneosTourJsonAbrufen"), "beneosTourJsonAbrufen",
  { routeAdresse, fetch: async (u) => { abrufe.push(u); return { ok: true } } })
abrufe.length = 0
await sicherAsync(() => mitPraefix(() => tourAbruf("beneos_assets/tour/actor-184-rot_cerf.json")))
p.gleich("ein oertlicher Pfad wird unter dem Praefix abgerufen", abrufe.join(","), "/foundry/beneos_assets/tour/actor-184-rot_cerf.json")
abrufe.length = 0
const absolut = await sicherAsync(() => tourAbruf("beneos://s/tour/actor-184-rot_cerf.json"))
p.gleich("eine absolute Adresse loest keinen Abruf aus", abrufe.length, 0)
p.gleich("und liefert keinen Inhalt", absolut, null)
p.struktur("der Rot Cerf holt seinen Inhalt ueber beneosTourJsonAbrufen",
  /const resp = await beneosTourJsonAbrufen\(await beneosResolveTourAssetPath\(GETTING_STARTED_RUNTIME_ASSETS\.codexContent\)\)/.test(TOUREN), true)

// ===========================================================================
p.abschnitt("A2/A3 Installer #headCheck, Deinstaller #sizeOf")
for (const [name, text, methode, ziel] of [["Installer #headCheck", INSTALLER, "#headCheck", "headCheck"], ["Deinstaller #sizeOf", DEINSTALLER, "#sizeOf", "sizeOf"]]) {
  const gesehen = []
  const fn = binde(schnitt(text, methode), ziel, {
    routeAdresse, STUB_MAX_BYTES: 64,
    fetch: async (u) => { gesehen.push(u.replace(/\?_b=\d+$/, "")); return { ok: false, headers: { get: () => "" } } },
  })
  await sicherAsync(() => mitPraefix(() => fn("beneos_assets/cloud/a.webp")))
  await sicherAsync(() => ohnePraefix(() => fn("beneos_assets/cloud/a.webp")))
  p.gleich(`${name}: mit Praefix unter dem Unterpfad`, gesehen[0], "/foundry/beneos_assets/cloud/a.webp")
  p.gleich(`${name}: ohne Praefix wie vorher`, gesehen[1], "/beneos_assets/cloud/a.webp")
}

// ===========================================================================
p.abschnitt("B1 creature-codex.mjs: _norm fuer Bild und Hintergrund")
const normZeile = KREATUR.match(/const _norm = (\(u\) => .*);$/m)?.[1] ?? null
const norm = binde("", "_norm", { routeAdresse }, normZeile ?? "null") ?? (() => "fehlt")
p.gleich("B1 relativer Pfad mit Praefix", sicher(() => mitPraefix(() => norm("beneos_assets/h.webp"))), "/foundry/beneos_assets/h.webp")
p.gleich("B1 relativer Pfad ohne Praefix wie vorher", sicher(() => ohnePraefix(() => norm("beneos_assets/h.webp"))), "/beneos_assets/h.webp")
p.gleich("B1 eine absolute Adresse bleibt stehen", sicher(() => mitPraefix(() => norm("https://x/h.webp"))), "https://x/h.webp")

// ===========================================================================
p.abschnitt("B2/B3 Masken-Symbole in beneos-codex.mjs und forge-generator.mjs")
for (const [name, text, schluessel, soll] of [["beneos-codex iconBw", KODEX, "iconBw", 2], ["forge-generator iconMask", SCHMIEDE, "iconMask", 2]]) {
  const ausdruecke = [...text.matchAll(new RegExp(`(?:${schluessel}|originIconMask)\\s*[:=]\\s*(\\w+\\.image \\? [^:]+ : null)`, "g"))].map((m) => m[1])
  p.struktur(`${name}: ${soll} Stellen gefunden`, ausdruecke.length, soll)
  // Ein Pfad mit Leerzeichen: die Stelle kodiert nicht und soll es weiter nicht tun.
  const BILD = "m/v one.webp"
  const werte = () => ausdruecke.map((a) => binde("", a, { routeAdresse, meta: { image: BILD }, originMeta: { image: BILD } }, a)).join("|")
  const soll2 = (vorne) => ausdruecke.length ? ausdruecke.map(() => vorne + BILD).join("|") : "keine Stelle"
  p.gleich(`${name}: mit Praefix unter dem Unterpfad`, mitPraefix(werte), soll2("/foundry/"))
  // Zusatz orch 1: ohne Praefix derselbe String wie der alte Ausdruck "/" + image.
  p.gleich(`${name}: ohne Praefix gleich dem alten "/" + image`, ohnePraefix(werte), soll2("/"))
}

// ===========================================================================
p.abschnitt("B4 pdf-viewer-window.mjs: file= fuer pdf.js")
const pdfQuelle = schnitt(PDF, "_prepareContext")?.replace(/^async _prepareContext/, "async function _prepareContext")
const pdf = binde(pdfQuelle, "_prepareContext", { routeAdresse })
const pdfSrc = async (pfad) => (await sicherAsync(() => pdf.call({ _filePath: pfad }, {})))?.viewerSrc ?? "fehlt"
globalThis.ROUTE_PREFIX = "foundry"
const pdfMit = await pdfSrc("beneos_assets/pdf/a b.pdf")
globalThis.ROUTE_PREFIX = undefined
const pdfOhne = await pdfSrc("beneos_assets/pdf/a b.pdf")
p.gleich("B4 mit Praefix, kodiert", pdfMit, "scripts/pdfjs/web/viewer.html?file=%2Ffoundry%2Fbeneos_assets%2Fpdf%2Fa%20b.pdf")
p.gleich("B4 ohne Praefix wie vorher, kodiert", pdfOhne, "scripts/pdfjs/web/viewer.html?file=%2Fbeneos_assets%2Fpdf%2Fa%20b.pdf")
// Der echte Erzeuger (codex-pdf-service.mjs pdfServedPath) liefert den Pfad
// mit fuehrendem "/"; auch dann muss das Praefix ankommen (Kalt-Review e1142c2).
const ERZEUGT = "/beneos_assets/cloud/tokens/x/x.pdf"
globalThis.ROUTE_PREFIX = "foundry"
const pdfErzMit = await pdfSrc(ERZEUGT)
globalThis.ROUTE_PREFIX = undefined
const pdfErzOhne = await pdfSrc(ERZEUGT)
p.gleich("B4 Erzeugerpfad mit Praefix", pdfErzMit, "scripts/pdfjs/web/viewer.html?file=%2Ffoundry%2Fbeneos_assets%2Fcloud%2Ftokens%2Fx%2Fx.pdf")
p.gleich("B4 Erzeugerpfad ohne Praefix wie vorher", pdfErzOhne, "scripts/pdfjs/web/viewer.html?file=%2Fbeneos_assets%2Fcloud%2Ftokens%2Fx%2Fx.pdf")
p.gleich("B4 eine Adresse mit Schema bleibt stehen", await pdfSrc("https://h/a.pdf"), "scripts/pdfjs/web/viewer.html?file=https%3A%2F%2Fh%2Fa.pdf")

// ===========================================================================
p.abschnitt("T-160 beneos_tours.js: gespeicherte Kacheladresse bei intro-complete")
let antwort = null
const behalten = binde(schnitt(TOUREN, "beneosTourAdresseBehalten"), "beneosTourAdresseBehalten", { headCheck: async () => antwort })
const frage = async (a) => { antwort = a; return sicherAsync(() => behalten("beneos://s/icons/icon_stop_play.webp")) }
p.gleich("status -2 (ungeprueft, etwa beneos://) wird behalten", await frage({ ok: false, status: -2 }), true)
p.gleich("404 wird ersetzt", await frage({ ok: false, status: 404 }), false)
p.gleich("200 wird behalten", await frage({ ok: true, status: 200 }), true)
p.struktur("intro-complete prueft die gespeicherte Adresse mit beneosTourAdresseBehalten",
  /savedIconSrc && await beneosTourAdresseBehalten\(savedIconSrc\)/.test(TOUREN), true)

// ===========================================================================
// stre-T-164: der Rest der wurzelabsoluten /modules/-Adressen.
p.abschnitt("T-164 Importe von scene-packer")
const PACKER = lies("../beneos-scenepacker.js")
const IMPORT_SOLL = /import\(routeAdresse\("modules\/scene-packer\/scripts\/export-import\/moulinette-importer\.js"\)\)/
p.struktur("beneos-scenepacker importiert scene-packer ueber routeAdresse", IMPORT_SOLL.test(PACKER), true)
p.struktur("beneos-scenepacker bindet routeAdresse ein",
  /^import \{[^}]*\brouteAdresse\b[^}]*\} from "\.\/beneos-asset-watcher\.js";?$/m.test(PACKER), true)
p.struktur("beneos_tours importiert scene-packer ueber routeAdresse", IMPORT_SOLL.test(TOUREN), true)
p.gleich("scene-packer ohne Praefix wie heute", ohnePraefix(() => routeAdresse("modules/scene-packer/x.js")), "/modules/scene-packer/x.js")
p.gleich("scene-packer mit Praefix unter dem Unterpfad", mitPraefix(() => routeAdresse("modules/scene-packer/x.js")), "/foundry/modules/scene-packer/x.js")

p.abschnitt("T-164 beneosfx.js: Bild des Todesmarkers")
const FX = lies("../beneosfx.js")
const fxBild = (FX.match(/filterId: "BFXDeadIcon",[^}]*?imagePath: "([^"]*)"/) ?? [])[1] ?? "fehlt"
const aufgeloest = (rel, basis) => { try { return new URL(rel, basis).pathname } catch (e) { return `Wurf: ${e.message}` } }
p.gleich("Todesmarker ohne Praefix wie heute", aufgeloest(fxBild, "https://h/game"), "/modules/beneos-module/icons/beneos_token_circular_death_overlay.webp")
p.gleich("Todesmarker mit Praefix unter dem Unterpfad", aufgeloest(fxBild, "https://h/foundry/game"), "/foundry/modules/beneos-module/icons/beneos_token_circular_death_overlay.webp")

p.abschnitt("T-164 CSS: url() relativ zur CSS-Datei")
for (const datei of ["beneos-journal.css", "beneos-character-sheet.css", "beneos-wiki.css", "beneos.css"]) {
  const css = lies(`../../css/${datei}`)
  p.struktur(`${datei}: kein url() an der Serverwurzel`, /url\(\s*["']?\/modules\//.test(css), false)
  const urls = [...css.matchAll(/url\(\s*["']?([^"')]*icons\/[^"')]*)["']?\s*\)/g)].map((m) => m[1])
  const ohne = urls.map((u) => aufgeloest(u, `https://h/modules/beneos-module/css/${datei}`))
  const mit = urls.map((u) => aufgeloest(u, `https://h/foundry/modules/beneos-module/css/${datei}`))
  const name = (u) => u.split("/").pop()
  p.gleich(`${datei}: ohne Praefix wie heute`, JSON.stringify(ohne), JSON.stringify(urls.map((u) => `/modules/beneos-module/icons/${name(u)}`)))
  p.gleich(`${datei}: mit Praefix unter dem Unterpfad`, JSON.stringify(mit), JSON.stringify(urls.map((u) => `/foundry/modules/beneos-module/icons/${name(u)}`)))
  p.gleich(`${datei}: Bildadressen gefunden`, urls.length > 0, true)
}

p.ende()
