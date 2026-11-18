/**
 * cloud-kaufknopf.test.mjs - heisst der Kaufknopf "Buy bundle", wenn der
 * Server auf ein Bundle zeigt, und bleibt er sonst "Buy pack"? Seit stre-T-120.
 *
 * Seit stre-T-118 liefert der Server je Release `shop_url_kind` neben
 * `shop_url`: 'pack', 'bundle' oder null. 'bundle' heisst, das Release ist nur
 * ueber ein Bundle kaeuflich, und der Link fuehrt auf die Bundle-Seite.
 * Betreiberentscheid 15.11.2026: dann heisst der Knopf "Buy bundle". Bei einem
 * alten Server oder Katalog ohne das Feld bleibt die Beschriftung "Buy pack".
 * Der Pack-Tooltip heisst seit stre-T-120 in jedem Fall "Buy this map pack"
 * (Betreiberwahl).
 *
 * Geprueft wird die Funktion `kaufKnopf` mit zwei Werten, dazu am Text, dass
 * das Fenster beide Kauflinks ueber sie bildet, dass die Vorlage keinen Knopf
 * fest verdrahtet und dass alle Sprachdateien beide Schluessel tragen.
 * Handlebars gibt es in Node nicht; die Vorlage wird nur am Text geprueft.
 *
 * Aufruf: node scripts/cloud-v2/cloud-kaufknopf.test.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { pruefstand } from "../../tools/lib/foundry-attrappe.mjs"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, "..", "..")
const { gleich, struktur, abschnitt, ende } = pruefstand("cloud-kaufknopf, Buy bundle oder Buy pack")

const MODULPFAD = join(HIER, "cloud-kaufknopf.mjs")
const kaufKnopf = existsSync(MODULPFAD)
  ? (await import(pathToFileURL(MODULPFAD).href)).kaufKnopf
  : () => ({ url: null, isBundle: "fehlt" })

const PACK = "BENEOS.Cloud.Card.BuyPack"
const PACK_TIPP = "BENEOS.Cloud.Card.BuyPackTooltip"
const BUNDLE = "BENEOS.Cloud.Card.BuyBundle"
const BUNDLE_TIPP = "BENEOS.Cloud.Card.BuyBundleTooltip"
const URL = "https://beneos-battlemaps.com/products/beispiel"

abschnitt("Zwei Werte: Bundle schaltet um, alles andere nicht")
{
  const b = kaufKnopf({ shop_url: URL, shop_url_kind: "bundle" })
  gleich("bundle: isBundle", b.isBundle, true)
  gleich("bundle: Adresse unveraendert", b.url, URL)

  const p = kaufKnopf({ shop_url: URL, shop_url_kind: "pack" })
  gleich("pack: kein Bundle", p.isBundle, false)
  gleich("pack: Adresse unveraendert", p.url, URL)

  gleich("Art null: kein Bundle", kaufKnopf({ shop_url: URL, shop_url_kind: null }).isBundle, false)
  gleich("alter Server ohne Feld: kein Bundle", kaufKnopf({ shop_url: URL }).isBundle, false)
  gleich("unbekannte Art: kein Bundle", kaufKnopf({ shop_url: URL, shop_url_kind: "Bundle " }).isBundle, false)
  gleich("ohne shop_url: keine Adresse", kaufKnopf({ shop_url_kind: "bundle" }).url, null)
  gleich("ohne Release: keine Adresse", kaufKnopf(undefined).url, null)
  gleich("ohne Release: kein Bundle", kaufKnopf(undefined).isBundle, false)
}

abschnitt("Fenster: beide Kauflinks laufen ueber kaufKnopf")
{
  const fenster = readFileSync(join(WURZEL, "scripts/cloud-v2/cloud-window-v2.mjs"), "utf8")
  struktur("Fenster importiert kaufKnopf",
    /import \{ kaufKnopf \} from "\.\/cloud-kaufknopf\.mjs"/.test(fenster), true)
  struktur("Fenster liest shop_url nirgends selbst", (fenster.match(/shop_url/g) || []).length, 0)
  struktur("Szenenkarte: kaufKnopf am Eltern-Release", /kaufKnopf\(bmapRelease\)/.test(fenster), true)
  struktur("Release-Karte: kaufKnopf am Release", /kaufKnopf\(r\)/.test(fenster), true)
  // Je Karte ihre eigene Variable: bmapKauf in #enrichCard, kauf in
  // #buildReleaseCards. Vertauscht waere die eine undefiniert.
  struktur("Szenenkarte: Kauflink aus bmapKauf", (fenster.match(/shopUrl:\s+bmapKauf\.url,/g) || []).length, 1)
  struktur("Release-Karte: Kauflink aus kauf", (fenster.match(/shopUrl:\s+kauf\.url,/g) || []).length, 1)
  struktur("Szenenkarte: Bundle-Weiche aus bmapKauf", (fenster.match(/shopIsBundle:\s+bmapKauf\.isBundle,/g) || []).length, 1)
  struktur("Release-Karte: Bundle-Weiche aus kauf", (fenster.match(/shopIsBundle:\s+kauf\.isBundle,/g) || []).length, 1)
}

abschnitt("Vorlage: kein Kaufknopf fest verdrahtet")
{
  const vorlage = readFileSync(join(WURZEL, "templates/cloud-v2/parts/results-pane.hbs"), "utf8")
  const knoepfe = vorlage.split('class="bc-card-button bc-card-button-buy-pack"').slice(1).map((s) => s.slice(0, s.indexOf("</a>")))
  struktur("vier Kaufknoepfe", knoepfe.length, 4)
  // Die Schluessel stehen woertlich in der Vorlage, damit die Sprachwache
  // ihre Aufrufer sieht; gewaehlt wird mit der Weiche der Karte.
  const beschriftung = (p) => `<span>{{#if ${p}.shopIsBundle}}{{localize "${BUNDLE}"}}{{else}}{{localize "${PACK}"}}{{/if}}</span>`
  const tooltip = (p) => `data-tooltip="{{#if ${p}.shopIsBundle}}{{localize '${BUNDLE_TIPP}'}}{{else}}{{localize '${PACK_TIPP}'}}{{/if}}">`
  const praefix = ["card", "card", "drawer.asset", "drawer.asset"]
  struktur("jeder Knopf: Beschriftung mit Bundle-Weiche",
    knoepfe.filter((k, i) => k.includes(beschriftung(praefix[i]))).length, 4)
  struktur("jeder Knopf: Tooltip mit Bundle-Weiche",
    knoepfe.filter((k, i) => k.includes(tooltip(praefix[i]))).length, 4)
  struktur("kein Knopf mit fester Pack-Beschriftung ohne Weiche",
    knoepfe.filter((k) => k.includes(`<span>{{localize "${PACK}"}}</span>`)).length, 0)
}

abschnitt("Sprachen: alle Dateien tragen beide neuen Schluessel")
{
  const ordner = join(WURZEL, "lang")
  const dateien = readdirSync(ordner).filter((n) => n.endsWith(".json")).sort()
  struktur("vierzehn Sprachdateien", dateien.length, 14)
  const fehlt = []
  const strich = []
  for (const n of dateien) {
    const j = JSON.parse(readFileSync(join(ordner, n), "utf8"))
    for (const k of [PACK, PACK_TIPP, BUNDLE, BUNDLE_TIPP]) {
      const w = j[k]
      if (typeof w !== "string" || w.trim() === "") fehlt.push(`${n}:${k.split(".").pop()}`)
      else if (/[\u2013\u2014]/.test(w)) strich.push(`${n}:${k.split(".").pop()}`)
    }
  }
  struktur("kein Schluessel fehlt oder ist leer", fehlt.join(","), "")
  struktur("kein Gedankenstrich", strich.join(","), "")
  const en = JSON.parse(readFileSync(join(ordner, "en.json"), "utf8"))
  gleich("en: Buy bundle", en[BUNDLE], "Buy bundle")
  gleich("en: Buy pack unveraendert", en[PACK], "Buy pack")
  gleich("en: Pack-Tooltip nach Betreiberwahl", en[PACK_TIPP], "Buy this map pack")
  gleich("en: Bundle-Tooltip", en[BUNDLE_TIPP], "Buy the bundle with this map pack")
}

ende()
