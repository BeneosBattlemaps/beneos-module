/**
 * EIN FALSCHER HAKENNAME IST EIN STILLER FEHLER, UND DIESER HAT EINEN
 * KUNDENAUSFALL GETRAGEN.
 *
 * `OP-PRJ-216`. Bis zum 2026-11-09 band `ItemSheetExtender.register()` den
 * Namen `renderItemSheet`, und der gehoert zu Fassung 12. Gemessen am
 * 2026-11-08 in der Welt `v13-streaming` mit einem Zaehler auf beiden Namen:
 * beim Oeffnen eines Item-Blattes feuert `renderItemSheet` NULL mal und
 * `renderItemSheet5e` EIN mal.
 *
 * Was das gekostet hat: `_inject()` wurde nie gerufen. An einem Item MIT
 * vollstaendigen Beute-Vermerken stand `.beneos-loot-extras` null mal im
 * Blatt. Die Tabelle aus Typ, Set-Typ und Stufe sah der Kunde nicht. Der
 * Haken registriert sich ohne Klage, und ein Name, der nie feuert, sieht wie
 * ein Blatt ohne Beute-Vermerke aus.
 *
 * DIESER SATZ FAEHRT DEN ECHTEN CODE. Bis zum 15.11.2026 las er Quelltext und
 * blieb gruen, wenn das Verhalten kaputt war (stre-T-108, Nachfolger von
 * stre-T-017). Jetzt laedt er `item-sheet-extender.mjs` und
 * `codex2/item-companion.mjs` mit der Foundry-Attrappe
 * (`tools/lib/foundry-attrappe.mjs`), meldet die Haken an und feuert sie mit
 * gestellten Blaettern. Jede Probe ist im Sabotagelaeufer
 * (`tools/stream-sabotagen.mjs`, Satz `blatt`) bewacht.
 *
 * WAS HIER BEWUSST FEHLT, weil `stream-beute.test.mjs` es schon bewacht: dass
 * `_inject` an einem Blatt mit `document` bis zur Vorlage kommt und dass die
 * Vorlage den fertigen Kontext mit den Kartenadressen bekommt. Die Stubs fuer
 * `HTMLElement` und `renderTemplate` haben dieselbe Form wie dort.
 *
 * Lauf:  node scripts/loot/item-sheet-extender.test.mjs
 */

import { pruefstand, installiereFoundry, haken } from "../../tools/lib/foundry-attrappe.mjs"

const p = pruefstand("item-sheet-extender: Hakenname, Riegel und Doppelschutz am echten Code")
installiereFoundry({ einstellungen: {} })
globalThis.HTMLElement ??= class {}

const { ItemSheetExtender } = await import("./item-sheet-extender.mjs")

/** Ein gestelltes Blatt fuer den Haken: nur das Dokument zaehlt. */
const blatt = (feld, documentName) => ({ [feld]: { documentName } })

/** Eine Wurzel, in der die Beneos-Flaeche schon steht oder nicht. */
function wurzel(flaecheSteht) {
  return Object.assign(new globalThis.HTMLElement(), {
    querySelector: (sel) => (flaecheSteht && sel.includes(".beneos-loot-extras[data-beneos-loot]") ? {} : null),
    querySelectorAll: () => [],
  })
}

// ===========================================================================
p.abschnitt("register(): genau ein Haken, und es ist der gemessene")

/*
 * GEZAEHLT WIRD NUR, WAS register() DAZUBRINGT. Schon der Import meldet vier
 * Haken an (ready, canvasReady, init, canvasReady; gemessen 15.11.2026), die
 * mit dem Blatt nichts zu tun haben.
 */
haken.liste.length = 0
ItemSheetExtender.register()
const angemeldet = haken.namen()
p.gleich("register() meldet genau einen Haken an", angemeldet.length, 1)
p.gleich("und er heisst renderItemSheet5e", angemeldet[0], "renderItemSheet5e")
const HAKEN_IST = angemeldet[0]

/*
 * DIE ZWEI-WERTE-PROBE AM NAMEN. Ein Item-Blatt auf dem gemessenen Namen ruft
 * `_inject`, dasselbe Blatt auf einem der stummen oder zu breiten Namen nicht.
 *
 * Die stummen Namen: `renderItemSheet` ist Fassung 12 und stand bis zum
 * 2026-11-09 hier. `renderItemSheetV2` feuert bei dnd5e 5.3.3 nicht, weil
 * `ItemSheet5e` nicht von `ItemSheetV2` erbt. `renderActorSheet` und
 * `renderJournalSheet` sind das falsche Dokument.
 *
 * Die zu breiten Namen: Foundry V13 laesst alle Eltern-Haken der
 * Klassenkette feuern. Ein Haken auf `renderDocumentSheetV2` oder
 * `renderApplicationV2` riefe `_inject()` mehrfach je Render.
 */
const echtesInject = ItemSheetExtender._inject
const gerufen = []
// Async wie das echte `_inject`: der Haken haengt `.catch` an das Ergebnis.
ItemSheetExtender._inject = async (sheet, root) => { gerufen.push({ sheet, root }) }

/*
 * DER SPION ZEICHNET AUCH DIE ARGUMENTE AUF. Ein Haken, der `_inject` ruft,
 * aber die Wurzel nicht weitergibt, liesse `_inject` sofort aussteigen: die
 * Flaeche erschiene nie, mit derselben Kundenwirkung wie OP-PRJ-216
 * (Kaltdurchsicht 15.11.2026).
 */
gerufen.length = 0
const gegebeneWurzel = wurzel(false)
await haken.rufe("renderItemSheet5e", blatt("document", "Item"), gegebeneWurzel)
p.gleich("ein Item-Blatt auf renderItemSheet5e ruft _inject", gerufen.length, 1)
p.gleich("und gibt die Wurzel des Blattes weiter", gerufen[0]?.root === gegebeneWurzel, true)

for (const name of ["renderItemSheet", "renderItemSheetV2", "renderActorSheet", "renderJournalSheet",
                    "renderDocumentSheetV2", "renderApplicationV2", "renderHandlebarsApplication",
                    "renderDocumentSheet5e"]) {
  gerufen.length = 0
  await haken.rufe(name, blatt("document", "Item"), wurzel(false))
  p.gleich(`dasselbe Blatt auf ${name} ruft _inject nicht`, gerufen.length, 0)
}

// ===========================================================================
p.abschnitt("Der Riegel am Haken laesst nur Item-Dokumente durch")

/*
 * Der Haken traegt nur Item-Blaetter, aber die Abfrage haelt die Funktion
 * unabhaengig vom Namen darueber. Das Dokument kommt aus `document`, `object`
 * oder `item`, je nach Bauart des Blattes.
 */
gerufen.length = 0
await haken.rufe(HAKEN_IST, blatt("document", "Actor"), wurzel(false))
p.gleich("ein Actor-Blatt ruft _inject nicht", gerufen.length, 0)

gerufen.length = 0
await haken.rufe(HAKEN_IST, blatt("object", "Item"), wurzel(false))
p.gleich("ein Blatt, das sein Item unter object fuehrt, ruft _inject", gerufen.length, 1)

gerufen.length = 0
await haken.rufe(HAKEN_IST, blatt("item", "Item"), wurzel(false))
p.gleich("ein Blatt, das sein Item unter item fuehrt, ruft _inject", gerufen.length, 1)

/*
 * EIN SYNCHRONER WURF WIRD VOM `try/catch` IM HAKEN GEFANGEN. Der Spion
 * wirft hier, bevor er eine Zusage zurueckgibt.
 */
const echteWarnung = console.warn
const warnungen = []
console.warn = (...a) => { warnungen.push(a.map(String).join(" ")) }
ItemSheetExtender._inject = () => { throw new Error("Pruefsatz wirft in _inject") }
let durchgeschlagen = false
try {
  await haken.rufe(HAKEN_IST, blatt("document", "Item"), wurzel(false))
} catch {
  durchgeschlagen = true
}
console.warn = echteWarnung
p.gleich("ein synchroner Wurf in _inject wird im Haken gefangen", durchgeschlagen, false)
p.gleich("und als Warnung gemeldet", warnungen.filter((w) => w.includes("ItemSheetExtender inject failed")).length, 1)

/*
 * EIN FEHLER IM ASYNCHRONEN `_inject` WIRD EBENSO GEMELDET (stre-T-112).
 * Das echte `_inject` ist `async` und wird ohne `await` gerufen. Sein Fehler
 * ist eine abgelehnte Zusage, die das `try/catch` nicht sieht. Ohne `.catch`
 * am Aufruf landet sie als unbehandelte Ablehnung an der Warnung vorbei.
 * Gegenwert: ein intaktes `_inject` meldet nichts.
 */
let unbehandelt = 0
const zaehleUnbehandelt = () => { unbehandelt++ }
process.on("unhandledRejection", zaehleUnbehandelt)
const zweiTakte = async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}
async function asyncLauf(inject) {
  // Erst die Ablehnungen frueherer Proben zustellen lassen, dann zaehlen.
  await zweiTakte()
  ItemSheetExtender._inject = inject
  unbehandelt = 0
  warnungen.length = 0
  console.warn = (...a) => { warnungen.push(a.map(String).join(" ")) }
  try {
    await haken.rufe(HAKEN_IST, blatt("document", "Item"), wurzel(false))
    await zweiTakte()
  } finally {
    console.warn = echteWarnung
  }
  return {
    unbehandelt,
    alle: warnungen.length,
    gemeldet: warnungen.filter((w) => w.includes("ItemSheetExtender inject failed")).length,
  }
}

const wirft = await asyncLauf(async () => { throw new Error("Pruefsatz wirft im async _inject") })
p.gleich("ein Wurf im async _inject wird keine unbehandelte Ablehnung", wirft.unbehandelt, 0)
p.gleich("ein Wurf im async _inject wird genau einmal als Warnung gemeldet", wirft.alle === 1 && wirft.gemeldet === 1, true)

const heil = await asyncLauf(async () => {})
p.gleich("ein intaktes async _inject meldet keine Warnung", heil.alle, 0)
p.gleich("und hinterlaesst keine unbehandelte Ablehnung", heil.unbehandelt, 0)
process.off("unhandledRejection", zaehleUnbehandelt)

ItemSheetExtender._inject = echtesInject

// ===========================================================================
p.abschnitt("_inject(): Dokumentaufloesung und Doppelschutz")

/*
 * Der Kontext wird hier gestellt: wie er entsteht, prueft stream-beute. Die
 * Vorlage schreibt mit und haelt an, wie dort.
 */
const echterKontext = ItemSheetExtender._buildContext
ItemSheetExtender._buildContext = async () => ({ gestellt: true })
const VORLAGE_HALT = "Pruefsatz haelt an der Vorlage an"
const vorlagen = []
foundry.applications.handlebars = {
  "renderTemplate": async (_pfad, ctx) => { vorlagen.push(ctx); throw new Error(VORLAGE_HALT) },
}

const mitBeute = { documentName: "Item", getFlag: (scope, key) => (scope === "beneos-module" && key === "loot" ? { render: {} } : undefined) }
const ohneBeute = { documentName: "Item", getFlag: () => undefined }

/** `_inject` einmal fahren und zaehlen, wie viele Vorlagen entstanden. */
async function vorlagenBei(sheet, root) {
  vorlagen.length = 0
  try {
    await ItemSheetExtender._inject(sheet, root)
  } catch (e) {
    if (e?.message !== VORLAGE_HALT) throw e
  }
  return vorlagen.length
}

p.gleich("ein Item mit Beute-Vermerk und leerer Wurzel rendert genau eine Vorlage",
  await vorlagenBei({ document: mitBeute }, wurzel(false)), 1)

/*
 * DER DOPPELSCHUTZ. Mit einem Namen statt dreien feuert der Haken einmal je
 * Render. Der Schutz ist damit die Linie gegen den zweiten Render desselben
 * Blattes, den Foundry von sich aus faehrt.
 */
p.gleich("steht die Flaeche schon in der Wurzel, entsteht keine zweite Vorlage",
  await vorlagenBei({ document: mitBeute }, wurzel(true)), 0)

/*
 * `document` STEHT VORNE. Ein ApplicationV2-Blatt fuehrt sein Dokument unter
 * `document`, und `item` kann fehlen oder etwas anderes tragen. Hier traegt
 * `document` den Beute-Vermerk und `item` keinen: nur wer `document` zuerst
 * liest, rendert.
 */
p.gleich("document wird vor item gelesen",
  await vorlagenBei({ document: mitBeute, item: ohneBeute }, wurzel(false)), 1)

p.gleich("ein Item ohne Beute-Vermerk rendert nichts",
  await vorlagenBei({ document: ohneBeute }, wurzel(false)), 0)

/*
 * ZWEI RIEGEL HALTEN DIESEN FALL. `if (!item) return;` wirkt genau wie die
 * Abfrage `if (!loot) return;`, denn `getLootFlags` liefert fuer ein fehlendes
 * Dokument `null`. Eine Sabotage an nur einem der zwei bleibt hier unsichtbar;
 * der Sabotagelaeufer nimmt deshalb beide zugleich weg.
 */
p.gleich("ein Blatt ohne Dokument rendert nichts", await vorlagenBei({}, wurzel(false)), 0)

ItemSheetExtender._buildContext = echterKontext

// ===========================================================================
p.abschnitt("Der Nachbar traegt denselben Namen, und das ist die Gegenprobe")

/*
 * WARUM DER NACHBAR MITGEPRUEFT WIRD. `item-companion.mjs` hing von Anfang an
 * am richtigen Namen und ist damit die zweite, unabhaengige Quelle fuer den
 * Namen oben. Er wird ERST JETZT geladen, damit seine Haken die Zaehlung oben
 * nicht verfaelschen, und gemessen wird nur, was er dazubringt.
 *
 * WAS DAS NICHT BEWEIST: dass der Name richtig IST. Benennt dnd5e ihn eines
 * Tages um, sind beide Dateien gleich falsch, und dieser Satz bleibt gruen.
 */
haken.liste.length = 0
const { ItemCompanion } = await import("../codex2/item-companion.mjs")
const nachbar = haken.namen()
p.gleich("der Nachbar haengt sich an denselben Namen wie dieses Blatt",
  nachbar.filter((n) => n.startsWith("render")).join(","), HAKEN_IST)
p.gleich("und haengt sich an closeItemSheet5e ab",
  nachbar.filter((n) => n.startsWith("close")).join(","), "closeItemSheet5e")

/*
 * DER NACHBAR TRAEGT DEN RIEGEL ZWEIMAL, am Anhaengen und am Abhaengen, und
 * jeder wird einzeln gefahren. Beim Sabotagelauf am 2026-11-09 rutschte genau
 * hier eine Sabotage durch, weil eine Textprobe den zweiten Riegel fand,
 * nachdem der erste fehlte. Die Spione sind `async`, weil der Haken `.catch`
 * auf das Ergebnis von `attach` ruft. Vor jedem Aufruf werden die Listen
 * geleert, damit die Item-Probe nicht vom Rest der Actor-Probe lebt, und der
 * Spion zeichnet das HTML auf, ohne das der Begleiter ins Leere mountet.
 */
const angehaengt = []
const abgehaengt = []
ItemCompanion.attach = async (app, html) => { angehaengt.push({ app, html }) }
ItemCompanion.detach = (app) => { abgehaengt.push(app) }

const blattHtml = wurzel(false)
angehaengt.length = 0
await haken.rufe("renderItemSheet5e", blatt("document", "Actor"), blattHtml)
p.gleich("ein Actor-Blatt haengt den Begleiter nicht an", angehaengt.length, 0)
angehaengt.length = 0
await haken.rufe("renderItemSheet5e", blatt("document", "Item"), blattHtml)
p.gleich("ein Item-Blatt haengt ihn an", angehaengt.length, 1)
p.gleich("und gibt ihm das HTML des Blattes", angehaengt[0]?.html === blattHtml, true)

abgehaengt.length = 0
await haken.rufe("closeItemSheet5e", blatt("document", "Actor"))
p.gleich("ein Actor-Blatt haengt den Begleiter nicht ab", abgehaengt.length, 0)
abgehaengt.length = 0
await haken.rufe("closeItemSheet5e", blatt("document", "Item"))
p.gleich("ein Item-Blatt haengt ihn ab", abgehaengt.length, 1)

/*
 * NICHT PRUEFBAR, UND ZWAR AN DIESEM SATZ DAUERHAFT:
 *
 * - DASS DER HAKEN IM ECHTEN FOUNDRY FEUERT. Die Zahl 0 gegen 1 stammt aus
 *   einer Messung im laufenden Foundry am 2026-11-08. Hier feuert die
 *   Attrappe, was der Satz ihr sagt. Der Feldtest ist `TC-PRJ-STR-308`.
 * - DASS DIE FLAECHE ERSCHEINT. Ob der Einfuegepunkt im Blatt von dnd5e 5.3.3
 *   existiert und `.beneos-loot-extras` sichtbar ist, entscheidet ein Browser.
 * - OB DER NAME RICHTIG BLEIBT. Die Nachbarprobe zeigt Uebereinstimmung, nicht
 *   Richtigkeit.
 * - WELCHE FEHLER DAS ECHTE `_inject` IM BLATT WIRFT. Dass ein Fehler darin
 *   als Warnung ankommt, zeigt oben ein werfender Spion; ob einer entsteht,
 *   entscheidet ein laufendes Foundry.
 */

p.ende()
