/**
 * stream-bilder.test.mjs
 *
 * Gegenprobe zu `stream-bilder.mjs`: welche Haken der Einbau anmeldet, welche
 * Namen der Riegel abweist, und was ein gefeuerter Haken mit einem Bild tut.
 * Laeuft ohne Foundry, ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-bilder.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ UEBERHAUPT. Ein falscher Hakenname ist ein stiller
 * Fehler: die Karte erscheint weiter, nur ohne Zwischenspeicher, ohne
 * Offline-Vorrat und ohne Ersatzbild. Nichts wird rot, und eine Abweisung des
 * Tores kommt als HTTP 200 mit einem durchsichtigen GIF von 42 Byte.
 *
 * DER NAHELIEGENDE NAME IST DER FALSCHE, gemessen am 08.11.2026 in der Welt
 * `v13-streaming` (Foundry 13, dnd5e 5.3.3): die Klassenkette des Item-Blattes
 * enthaelt `ItemSheetV2` NICHT. Wer den Item-Namen aus der Actor-Zeile
 * ableitet, schreibt `renderItemSheetV2` hin, und der Haken feuert null mal.
 *
 * SEIT stre-T-017 (14.11.2026) RUFT DIESER SATZ DEN ECHTEN CODE. Bis dahin las
 * er die Liste `FLAECHEN` als Text aus der Quelle. Jetzt laeuft
 * `installStreamBilder()` gegen eine Foundry-Attrappe (`tools/lib/`), die jede
 * Hakenanmeldung aufzeichnet; ein Haken wird gefeuert und das Bild danach
 * gelesen; der Riegel wird ueber die Naht `flaechenRiegelFuerPruefsatz`
 * gerufen, denselben, den der Einbau ruft. Textproben bleiben nur, wo die
 * Aussage selbst Text ist: der Kopfkommentar (`[Dokument] `, Betreiberentscheid
 * vom 14.11.2026) und dass der Einbau den Riegel ueberhaupt fragt
 * (`[Struktur] `), denn `FLAECHEN` traegt heute kein Verzeichnis, und ein
 * Einbau ohne Riegel verhielte sich heute gleich.
 *
 * WAS DIESER SATZ NICHT LEISTET. Ob Foundry die Haken in dieser Reihenfolge und
 * mit diesen Argumenten feuert, entscheidet `TC-PRJ-STR-302` im laufenden
 * Foundry. Die Attrappe liefert ein Element mit `querySelectorAll("img")`,
 * kein echtes DOM.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { pruefstand, installiereFoundry, haken, netz, nimmAbrufe } from "../../tools/lib/foundry-attrappe.mjs"

const { gleich, struktur, dokument, abschnitt, ende } = pruefstand("stream-bilder.mjs, am echten Code")

const SCHLUESSEL = "pk_pruefsatz_bilder"
const { einstellungen } = installiereFoundry({
  einstellungen: {
    "beneos-stream-mode": true,
    "beneos-stream-key": SCHLUESSEL,
    "beneos-stream-base": "https://gate.beneos.stream",
  },
})

const settings = await import("./stream-settings.mjs")
const bilder = await import("./stream-bilder.mjs")

// Jede Bildadresse des Tores antwortet mit vier Byte WebP-Kopf; alles andere
// ist ein fremder Abruf und macht den Satz rot.
netz((adresse) => {
  if (adresse.startsWith("https://gate.beneos.stream/") && adresse.includes("kaputt")) {
    return new Response("weg", { status: 404 })
  }
  if (adresse.startsWith("https://gate.beneos.stream/")) {
    return new Response(new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" }), { status: 200 })
  }
  return undefined
})

// ===========================================================================
abschnitt("Der Einbau meldet genau die gemessenen Haken an")

bilder.installStreamBilder()
// Der Editorhaken (stre-T-116, Bau 6) ist keine Flaeche; er wird unten geprueft.
const namen = haken.namen().filter((n) => n !== "createProseMirrorEditor")
const auf = namen.filter((n) => n.startsWith("render"))
const zu = namen.filter((n) => n.startsWith("close") || n.startsWith("delete"))

// Sechs Paare seit stre-T-116: der Chat (`renderChatMessageHTML`) hat kein
// Fenster, das sich schliesst; seine Bilder laesst `deleteChatMessage` los.
gleich("genau zwoelf Haken", namen.length, 12)
gleich("sechs davon render, sechs schliessen", `${auf.length}/${zu.length}`, "6/6")
// Die gemessenen Namen, fest. Die Proben laufen ueber diese Liste und nicht
// ueber das Angemeldete: fehlt ein Haken, wird seine Probe rot statt still
// zu entfallen.
const GEMESSEN = ["renderActorSheetV2", "renderChatMessageHTML", "renderImagePopout", "renderItemSheet5e",
  "renderJournalEntryPageSheet", "renderJournalEntrySheet"]
const SCHLIESST = (r) => (r === "renderChatMessageHTML" ? "deleteChatMessage" : r.replace(/^render/, "close"))
gleich("die sechs render-Haken sind die gemessenen", [...auf].sort().join(","), GEMESSEN.join(","))
for (const r of GEMESSEN) {
  gleich(`${r} hat seinen Schliesshaken`, zu.includes(SCHLIESST(r)), true)
}
gleich("kein Name steht zweimal", new Set(namen).size, namen.length)

/*
 * DIE STUMMEN NAMEN. `renderActorSheet` und `renderItemSheet` sind die Namen
 * aus Fassung 12, `renderItemSheetV2` ist der, den die Actor-Zeile nahelegt;
 * keiner feuert unter Foundry 13 mit dnd5e 5.3.3.
 */
for (const stumm of ["renderActorSheet", "renderItemSheet", "renderItemSheetV2", "renderJournalSheet"]) {
  gleich(`der stumme Name ${stumm} ist nicht angemeldet`, namen.includes(stumm), false)
}
// Zu breit: ein Haken darauf doppelte die anderen Zeilen.
for (const zuBreit of ["renderDocumentSheetV2", "renderApplicationV2",
  "renderHandlebarsApplication", "renderDocumentSheet5e"]) {
  gleich(`${zuBreit} ist nicht angemeldet, es doppelte die anderen Zeilen`, namen.includes(zuBreit), false)
}

// ===========================================================================
abschnitt("Der Riegel gegen Verzeichnisse, ueber die Naht")

/*
 * ER IST DER GRUND, WARUM `OP-PRJ-177` NICHT WIEDERKOMMT. Foundry setzt an
 * jedem Listenbild `loading="lazy"`; dieser Helfer holt die Bytes SOFORT. Ein
 * Haken auf ein Verzeichnis verwandelt null Abrufe in so viele, wie die Liste
 * Zeilen hat, fuer die Szenenliste rund 609 MB.
 */
const riegel = bilder.flaechenRiegelFuerPruefsatz
gleich("die Naht ist da", typeof riegel, "function")
if (typeof riegel === "function") {
  for (const r of GEMESSEN) {
    gleich(`${r} faellt nicht unter den Riegel`, riegel(r, SCHLIESST(r)), false)
  }
  for (const boese of ["renderItemDirectory5e", "renderActorDirectory", "renderSidebarTab", "renderFilePicker"]) {
    gleich(`der Riegel weist ${boese} ab`, riegel(boese, "closeHarmlos"), true)
  }
  // BEIDE Namen: ein harmloser render-Name mit einem Verzeichnis als close.
  gleich("der Riegel prueft auch den close-Namen", riegel("renderHarmlos", "closeItemDirectory5e"), true)
  gleich("Gross und klein sind fuer den Riegel gleich", riegel("renderitemdirectory", "closeHarmlos"), true)
}
const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "stream-bilder.mjs"), "utf8")
const einbau = quelle.slice(quelle.indexOf("export function installStreamBilder("))
struktur("der Einbau fragt den Riegel je Paar, bevor er anmeldet",
  einbau.indexOf("flaechenRiegel(renderHaken, schliessHaken)") >= 0
    && einbau.indexOf("flaechenRiegel(renderHaken, schliessHaken)") < einbau.indexOf("Hooks.on("), true)

// ===========================================================================
abschnitt("Ein gefeuerter Haken tauscht das Bild gegen eine Blob-Adresse")

function bildElement(src) {
  const attr = new Map([["src", src]])
  return {
    nodeType: 1,
    isConnected: true,
    getAttribute: (k) => attr.get(k) ?? null,
    setAttribute: (k, v) => { attr.set(k, String(v)) },
    hasAttribute: (k) => attr.has(k),
    closest: () => null,
  }
}
function fenster(bilderListe) {
  const wurzel = {
    nodeType: 1,
    querySelectorAll: (s) => (s === "img" ? bilderListe : []),
    querySelector: () => null,
  }
  return { app: { rendered: true, element: wurzel }, wurzel }
}

const tor = settings.assetUrl("beneos_bm_0042", "4k", "map_assets/kompass.webp")
const platz = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/leiste.webp")
// Fuenf Segmente, also von `zerlegeAdresse` lesbar: nur der Host macht sie fremd.
const fremd = "https://example.test/a/geheim/beneos_bm_0042/4k/y.webp"
const b1 = bildElement(tor)
const b2 = bildElement(platz)
const b3 = bildElement(fremd)
const f1 = fenster([b1, b2, b3])
nimmAbrufe()
await haken.rufe("renderJournalEntrySheet", f1.app, f1.wurzel)
// Der Haken wartet nicht; das Bild wird im naechsten Takt gesetzt.
for (let i = 0; i < 20 && !String(b1.getAttribute("src")).startsWith("blob:"); i++) {
  await new Promise((r) => setTimeout(r, 5))
}
gleich("die Toradresse wird eine Blob-Adresse", String(b1.getAttribute("src")).startsWith("blob:"), true)
gleich("die Platzhalterform wird eine Blob-Adresse", String(b2.getAttribute("src")).startsWith("blob:"), true)
gleich("eine fremde Adresse bleibt, wie sie ist", b3.getAttribute("src"), fremd)
const geholt = nimmAbrufe().map((a) => a.adresse).sort()
gleich("abgerufen wird die Toradresse von heute, auch fuer die Platzhalterform",
  geholt.join(" "), [tor, settings.assetUrl("beneos_bm_0042", "4k", "map_assets/leiste.webp")].sort().join(" "))
gleich("zwei Bilder gehalten", bilder.bilderBlobStand().eintraege, 2)

// Gegenwert zum Loslassen: ein zweites Fenster haelt dieselbe Adresse. Schliesst
// das erste, darf das Blob des zweiten nicht widerrufen werden.
const zweitBild = bildElement(tor)
const zweitFenster = fenster([zweitBild])
await haken.rufe("renderJournalEntrySheet", zweitFenster.app, zweitFenster.wurzel)
for (let i = 0; i < 20 && !String(zweitBild.getAttribute("src")).startsWith("blob:"); i++) {
  await new Promise((r) => setTimeout(r, 5))
}
gleich("ein zweites Fenster mit derselben Adresse bekommt ein Blob", String(zweitBild.getAttribute("src")).startsWith("blob:"), true)
gleich("und holt die Adresse kein zweites Mal", nimmAbrufe().length, 0)

await haken.rufe("closeJournalEntrySheet", f1.app)
gleich("das erste Fenster zu: die Adresse des zweiten bleibt gehalten", bilder.bilderBlobStand().eintraege, 1)
await haken.rufe("closeJournalEntrySheet", zweitFenster.app)
gleich("der close-Haken gibt beide frei", bilder.bilderBlobStand().eintraege, 0)

// Gegenwert: Stream aus, derselbe Haken fasst nichts an.
einstellungen["beneos-stream-mode"] = false
const b4 = bildElement(tor)
// Die Platzhalterform haengt nicht an `ours()`, also misst nur sie den Riegel
// "Stream aus" selbst.
const b5 = bildElement(platz)
const f2 = fenster([b4, b5])
await haken.rufe("renderJournalEntrySheet", f2.app, f2.wurzel)
await new Promise((r) => setTimeout(r, 20))
gleich("bei ausgeschaltetem Stream bleibt die Toradresse", b4.getAttribute("src"), tor)
gleich("bei ausgeschaltetem Stream bleibt auch die Platzhalterform", b5.getAttribute("src"), platz)
gleich("und es wird nichts abgerufen", nimmAbrufe().length, 0)
einstellungen["beneos-stream-mode"] = true

/*
 * EIN BILD MIT `data-edit` GEHOERT ZUM FORMULAR (Kalt-Review 16.11.2026). Foundry
 * liest beim Absenden sein `src` als Feldwert. Gemessen am selben Tag in
 * `v14Stream` (14.367, dnd5e 5.3.3), Akteurblatt im Bearbeitungsmodus: mit
 * getauschtem Bild ging `blob:` hinaus, und das Speichern scheiterte an der
 * Dateiendung. Es bleibt deshalb ungetauscht.
 */
const formBild = bildElement(tor)
formBild.setAttribute("data-edit", "img")
formBild.hasAttribute = (k) => formBild.getAttribute(k) !== null
const freiBild = bildElement(tor)
const f3 = fenster([formBild, freiBild])
await haken.rufe("renderActorSheetV2", f3.app, f3.wurzel)
for (let i = 0; i < 20 && !String(freiBild.getAttribute("src")).startsWith("blob:"); i++) {
  await new Promise((r) => setTimeout(r, 5))
}
gleich("ein Bild mit data-edit behaelt seine Adresse", formBild.getAttribute("src"), tor)
gleich("das Bild daneben wird weiter getauscht", String(freiBild.getAttribute("src")).startsWith("blob:"), true)
await haken.rufe("closeActorSheetV2", f3.app)
nimmAbrufe()

// ===========================================================================
abschnitt("Form (a), stre-T-116: das Bild steht in data-beneos-src")

const { PLATZHALTER_BILD } = await import("./stream-html.mjs")
async function warte(el) {
  for (let i = 0; i < 20 && !String(el.getAttribute("src")).startsWith("blob:"); i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
}
function formA(adresse) {
  const el = bildElement(PLATZHALTER_BILD)
  el.setAttribute("data-beneos-src", adresse)
  return el
}
const handout = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/handout.webp")
{
  const a = formA(handout)
  const f = fenster([a])
  nimmAbrufe()
  await haken.rufe("renderJournalEntryPageSheet", f.app, f.wurzel)
  await warte(a)
  gleich("Form (a) wird eine Blob-Adresse", String(a.getAttribute("src")).startsWith("blob:"), true)
  gleich("Form (a): abgerufen wird die Toradresse von heute",
    nimmAbrufe().map((x) => x.adresse).join(" "), settings.assetUrl("beneos_bm_0042", "4k", "map_assets/handout.webp"))
  gleich("Form (a): data-beneos-src bleibt am Element", a.getAttribute("data-beneos-src"), handout)
  await haken.rufe("renderJournalEntryPageSheet", f.app, f.wurzel)
  await new Promise((r) => setTimeout(r, 20))
  gleich("Form (a): ein zweiter Render haelt das Bild und holt nichts", `${bilder.bilderBlobStand().eintraege}|${nimmAbrufe().length}`, "1|0")
  await haken.rufe("closeJournalEntryPageSheet", f.app)
}
{
  // Am Schluessel, nicht am Modus: bei Modus aus mit Schluessel zeigte das HTML
  // vor stre-T-116 die Toradresse direkt. Mit Form (a) stuende sonst nur der
  // Platzhalter da. Eine alte Toradresse bleibt dabei unberuehrt wie vorher.
  einstellungen["beneos-stream-mode"] = false
  const a = formA(handout)
  const alt = bildElement(tor)
  const f = fenster([a, alt])
  await haken.rufe("renderJournalEntrySheet", f.app, f.wurzel)
  await warte(a)
  gleich("Modus aus mit Schluessel: Form (a) wird getauscht", String(a.getAttribute("src")).startsWith("blob:"), true)
  gleich("Modus aus mit Schluessel: die alte Toradresse bleibt wie vorher", alt.getAttribute("src"), tor)
  await haken.rufe("closeJournalEntrySheet", f.app)
  einstellungen["beneos-stream-key"] = ""
  const b = formA(handout)
  const g = fenster([b])
  nimmAbrufe()
  await haken.rufe("renderJournalEntrySheet", g.app, g.wurzel)
  await new Promise((r) => setTimeout(r, 20))
  gleich("ohne Schluessel: Form (a) bleibt der Platzhalter, nichts abgerufen",
    `${b.getAttribute("src") === PLATZHALTER_BILD}|${nimmAbrufe().length}`, "true|0")
  einstellungen["beneos-stream-key"] = SCHLUESSEL
  einstellungen["beneos-stream-mode"] = true
}
{
  // Der Chat: der Haken feuert auf ein noch nicht eingefuegtes Element
  // (v13 chat-message.mjs:415-419, renderBatch fuegt erst nach dem Stapel ein).
  const nachrichten = new Map()
  globalThis.game.messages = { has: (id) => nachrichten.has(id) }
  const nachricht = { id: "m1", documentName: "ChatMessage" }
  nachrichten.set("m1", nachricht)
  const a = formA(handout)
  a.isConnected = false
  const karte = { nodeType: 1, querySelectorAll: (s) => (s === "img" ? [a] : []), querySelector: () => null }
  await haken.rufe("renderChatMessageHTML", nachricht, karte)
  await warte(a)
  gleich("Chat: nicht eingefuegt, Nachricht lebt: das Bild wird gesetzt", String(a.getAttribute("src")).startsWith("blob:"), true)
  await haken.rufe("deleteChatMessage", nachricht)
  gleich("Chat: deleteChatMessage laesst los", bilder.bilderBlobStand().eintraege, 0)
  const weg = { id: "m2", documentName: "ChatMessage" }
  const b = formA(handout)
  b.isConnected = false
  const karte2 = { nodeType: 1, querySelectorAll: (s) => (s === "img" ? [b] : []), querySelector: () => null }
  await haken.rufe("renderChatMessageHTML", weg, karte2)
  await new Promise((r) => setTimeout(r, 20))
  gleich("Chat: Nachricht schon weg: nichts gesetzt, nichts gehalten",
    `${b.getAttribute("src") === PLATZHALTER_BILD}|${bilder.bilderBlobStand().eintraege}`, "true|0")
  delete globalThis.game.messages
}
{
  // Abruf scheitert: wie vor stre-T-116 laedt die Toradresse direkt, nur in
  // der Anzeige. Gespeichert bleibt Form (a).
  const kaputt = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/kaputt.webp")
  const a = formA(kaputt)
  const f = fenster([a])
  await haken.rufe("renderJournalEntrySheet", f.app, f.wurzel)
  for (let i = 0; i < 20 && a.getAttribute("src") === PLATZHALTER_BILD; i++) await new Promise((r) => setTimeout(r, 5))
  gleich("Abruf scheitert: die Anzeige laedt die Toradresse direkt",
    a.getAttribute("src"), settings.assetUrl("beneos_bm_0042", "4k", "map_assets/kaputt.webp"))
  gleich("Abruf scheitert: data-beneos-src bleibt", a.getAttribute("data-beneos-src"), kaputt)
  await haken.rufe("closeJournalEntrySheet", f.app)
  nimmAbrufe()
}

// ===========================================================================
abschnitt("Editor, stre-T-116: das echte Bild nur in der Ansicht, nie im Dokument")

/*
 * Foundry ruft `createProseMirrorEditor` vor dem Bau der Ansicht (v13
 * prosemirror-editor.mjs:220, v14 :222) und sammelt `nodeViews` auch aus
 * Plugins. Die Ansicht des Bildknotens setzt das `src` ihres DOM-Elements;
 * gespeichert wird aus `state.doc`, und der Knoten bleibt unberuehrt.
 */
{
  class PluginAttrappe { constructor(spec) { this.spec = spec } }
  function domAus(spec) {
    const attr = new Map(Object.entries(spec[1] ?? {}))
    return {
      nodeType: 1, isConnected: true, closest: () => null,
      getAttribute: (k) => attr.get(k) ?? null, setAttribute: (k, v) => { attr.set(k, String(v)) }, hasAttribute: (k) => attr.has(k),
    }
  }
  globalThis.ProseMirror = { Plugin: PluginAttrappe, DOMSerializer: { renderSpec: (_d, spec) => ({ dom: domAus(spec) }) } }
  const knoten = (adresse) => {
    const attrs = { src: PLATZHALTER_BILD, alt: "Karte", _preserve: adresse ? { "data-beneos-src": adresse } : {} }
    return { attrs, type: { spec: { toDOM: (n) => ["img", { src: n.attrs.src, alt: n.attrs.alt, ...n.attrs._preserve }] } } }
  }
  const editorHaken = haken.liste.filter((x) => x.name === "createProseMirrorEditor")
  gleich("Editor: der Haken createProseMirrorEditor ist angemeldet", editorHaken.length, 1)
  const plugins = {}
  for (const h of editorHaken) await h.fn("ProseMirror.x", plugins, {})
  const fabrik = plugins.beneosBildAnsicht?.spec?.props?.nodeViews?.image
  gleich("Editor: das Plugin traegt eine Ansicht fuer den Knoten image", typeof fabrik, "function")
  if (typeof fabrik === "function") {
    const k = knoten(handout)
    const vorher = JSON.stringify(k.attrs)
    nimmAbrufe()
    const ansicht = fabrik(k)
    await warte(ansicht.dom)
    gleich("Editor: die Ansicht zeigt ein Blob", String(ansicht.dom.getAttribute("src")).startsWith("blob:"), true)
    gleich("Editor: der Knoten im Dokument bleibt unberuehrt", JSON.stringify(k.attrs), vorher)
    gleich("Editor: Alt-Text und data-beneos-src stehen in der Ansicht",
      `${ansicht.dom.getAttribute("alt")}|${ansicht.dom.getAttribute("data-beneos-src")}`, `Karte|${handout}`)
    gleich("Editor: eine Attributaenderung der Ansicht wird nicht ins Dokument gelesen",
      ansicht.ignoreMutation?.({ type: "attributes" }), true)
    gleich("Editor: eine Auswahl wird weiter gelesen", ansicht.ignoreMutation?.({ type: "selection" }), false)
    const st = bilder.bilderBlobStand()
    gleich("Editor: gehalten, solange die Ansicht lebt", `${st.eintraege}|${st.halter}`, "1|1")
    ansicht.destroy?.()
    gleich("Editor: destroy laesst los", bilder.bilderBlobStand().eintraege, 0)
    const ohne = fabrik(knoten(null))
    await new Promise((r) => setTimeout(r, 20))
    gleich("Editor: ein Bild ohne data-beneos-src bleibt, wie es ist", ohne.dom.getAttribute("src"), PLATZHALTER_BILD)
    nimmAbrufe()
  }
  einstellungen["beneos-stream-key"] = ""
  const leer = {}
  for (const h of editorHaken) await h.fn("ProseMirror.y", leer, {})
  gleich("Editor: ohne Schluessel kein Plugin", "beneosBildAnsicht" in leer, false)
  einstellungen["beneos-stream-key"] = SCHLUESSEL
  delete globalThis.ProseMirror
}

// ===========================================================================
abschnitt("Der Kopf widerspricht der Liste unter sich nicht")

/*
 * EIN KOPFKOMMENTAR, DER DIE LISTE WIDERLEGT, IST SCHLIMMER ALS KEINER. Bis zum
 * 08.11.2026 stand im Kopf "Keine Klappkarten"; mit `OP-PRJ-140` liegen sie
 * am Tor. Dokumentproben, Betreiberentscheid vom 14.11.2026.
 */
dokument("der Kopf behauptet nicht mehr, Klappkarten seien aussen vor",
  (quelle.match(/\*\*Keine Klappkarten/g) || []).length, 0)
dokument("der Kopf nennt stattdessen, seit wann sie mitgehen",
  /Klappkarten gehen seit dem 08\.11\.2026 mit/.test(quelle), true)
for (const grenze of ["Kein `<video>`", "Keine Listen", "Keine Bearbeitenflaeche"]) {
  dokument(`der Kopf nennt die Grenze "${grenze}" weiter`, quelle.includes(grenze), true)
}

console.log("")
console.log("Nicht geprueft, ausdruecklich benannt:")
console.log("- Dass Foundry die Haken mit diesen Namen und Argumenten feuert. Gemessen")
console.log("  am 08.11.2026 in v13-streaming; die Wirkung entscheidet TC-PRJ-STR-302.")
console.log("- Echtes DOM, Bearbeitenmodus und Freigabe beim Rotieren des Schluessels.")
ende()
