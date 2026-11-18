/**
 * cloud-kaufknopf.test.mjs - heisst der Kaufknopf "Buy bundle", wenn der
 * Server auf ein Bundle zeigt, und bleibt er sonst "Buy pack"? Seit stre-T-120.
 *
 * Seit stre-T-118 liefert der Server je Release `shop_url_kind` neben
 * `shop_url`: 'pack', 'bundle' oder null. 'bundle' heisst, das Release ist nur
 * ueber ein Bundle kaeuflich, und der Link fuehrt auf die Bundle-Seite.
 * Betreiberentscheid 15.11.2026: dann heisst der Knopf "Buy bundle". Ein alter
 * Server oder Katalog ohne das Feld darf nichts merken, also bleibt dort
 * "Buy pack".
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
  : () => ({ url: null, labelKey: "fehlt", tooltipKey: "fehlt" })

const PACK = "BENEOS.Cloud.Card.BuyPack"
const PACK_TIPP = "BENEOS.Cloud.Card.BuyPackTooltip"
const BUNDLE = "BENEOS.Cloud.Card.BuyBundle"
const BUNDLE_TIPP = "BENEOS.Cloud.Card.BuyBundleTooltip"
const URL = "https://beneos-battlemaps.com/products/beispiel"

abschnitt("Zwei Werte: Bundle aendert die Beschriftung, alles andere nicht")
{
  const b = kaufKnopf({ shop_url: URL, shop_url_kind: "bundle" })
  gleich("bundle: Beschriftung Buy bundle", b.labelKey, BUNDLE)
  gleich("bundle: Tooltip Bundle", b.tooltipKey, BUNDLE_TIPP)
  gleich("bundle: Adresse unveraendert", b.url, URL)

  const p = kaufKnopf({ shop_url: URL, shop_url_kind: "pack" })
  gleich("pack: Beschriftung Buy pack", p.labelKey, PACK)
  gleich("pack: Tooltip Pack", p.tooltipKey, PACK_TIPP)
  gleich("pack: Adresse unveraendert", p.url, URL)

  const n = kaufKnopf({ shop_url: URL, shop_url_kind: null })
  gleich("Art null: Buy pack", n.labelKey, PACK)
  gleich("Art null: Tooltip Pack", n.tooltipKey, PACK_TIPP)

  const alt = kaufKnopf({ shop_url: URL })
  gleich("alter Server ohne Feld: Buy pack", alt.labelKey, PACK)
  gleich("alter Server ohne Feld: Tooltip Pack", alt.tooltipKey, PACK_TIPP)

  gleich("unbekannte Art: Buy pack", kaufKnopf({ shop_url: URL, shop_url_kind: "Bundle " }).labelKey, PACK)
  gleich("ohne shop_url: keine Adresse", kaufKnopf({ shop_url_kind: "bundle" }).url, null)
  gleich("ohne Release: keine Adresse", kaufKnopf(undefined).url, null)
  gleich("ohne Release: Buy pack", kaufKnopf(undefined).labelKey, PACK)
}

abschnitt("Fenster: beide Kauflinks laufen ueber kaufKnopf")
{
  const fenster = readFileSync(join(WURZEL, "scripts/cloud-v2/cloud-window-v2.mjs"), "utf8")
  struktur("Fenster importiert kaufKnopf",
    /import \{ kaufKnopf \} from "\.\/cloud-kaufknopf\.mjs"/.test(fenster), true)
  struktur("Fenster liest shop_url nirgends selbst", (fenster.match(/shop_url/g) || []).length, 0)
  struktur("Szenenkarte: kaufKnopf am Eltern-Release", /kaufKnopf\(bmapRelease\)/.test(fenster), true)
  struktur("Release-Karte: kaufKnopf am Release", /kaufKnopf\(r\)/.test(fenster), true)
  struktur("beide Karten tragen den Beschriftungsschluessel", (fenster.match(/shopLabelKey:/g) || []).length, 2)
  struktur("beide Karten tragen den Tooltipschluessel", (fenster.match(/shopTooltipKey:/g) || []).length, 2)
}

abschnitt("Vorlage: kein Kaufknopf fest verdrahtet")
{
  const vorlage = readFileSync(join(WURZEL, "templates/cloud-v2/parts/results-pane.hbs"), "utf8")
  const knoepfe = vorlage.split('class="bc-card-button bc-card-button-buy-pack"').slice(1).map((s) => s.slice(0, 400))
  struktur("vier Kaufknoepfe", knoepfe.length, 4)
  struktur("kein Knopf mit festem BuyPack-Text", knoepfe.filter((k) => k.includes("Card.BuyPack")).length, 0)
  struktur("jeder Knopf: Beschriftung aus der Karte",
    knoepfe.filter((k) => /\{\{localize (card|drawer\.asset)\.shopLabelKey\}\}/.test(k)).length, 4)
  struktur("jeder Knopf: Tooltip aus der Karte",
    knoepfe.filter((k) => /data-tooltip="\{\{localize (card|drawer\.asset)\.shopTooltipKey\}\}"/.test(k)).length, 4)
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
      else if (/[–—]/.test(w)) strich.push(`${n}:${k.split(".").pop()}`)
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
