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
  if (adresse.startsWith("https://gate.beneos.stream/") && adresse.includes("ersatzfall")) {
    // So antwortet der Abrufersatz ohne Verbindung (stream-fetch.mjs, ersatzAntwort offline).
    return new Response(new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" }),
      { status: 200, headers: { "x-beneos-ersatz": "offline", "x-beneos-offline": "1" } })
  }
  if (adresse.startsWith("https://gate.beneos.stream/")) {
    return new Response(new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" }), { status: 200 })
  }
  return undefined
})

// ===========================================================================
abschnitt("Der Einbau meldet genau die gemessenen Haken an")

// Der Linkklick (stre-T-142 B3) hoert an `document`; die Attrappe kennt das nicht.
const hoerer = []
globalThis.document.addEventListener = (typ, fn, optionen) => { hoerer.push({ typ, fn, optionen }) }
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
// M6: S, FLAECHEN ist modulfest und traegt heute kein Verzeichnis, der Riegel weist im Pruefstand also nie ab und die Reihenfolge Riegel vor Hooks.on ist unbeobachtbar.
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

// Gegenwert: Stream aus. Der Riegel ist seit stre-T-116 der Schluessel, nicht
// der Modus (Vorgabe 6, 512b12d): bei Modus aus MIT Schluessel bleibt die
// Toradresse wie vorher, die Platzhalterform `beneos://` wird aber getauscht,
// denn sie laedt der Browser nicht (Kalt-Review W1; vorher verlangte diese
// Probe, dass auch sie stehen bleibt). Ohne Schluessel fasst der Haken nichts an.
einstellungen["beneos-stream-mode"] = false
const b4 = bildElement(tor)
// Die Platzhalterform haengt nicht an `ours()`, also misst nur sie den Riegel
// selbst.
const b5 = bildElement(platz)
einstellungen["beneos-stream-key"] = ""
const f2 = fenster([b4, b5])
await haken.rufe("renderJournalEntrySheet", f2.app, f2.wurzel)
await new Promise((r) => setTimeout(r, 20))
gleich("ohne Schluessel bleibt die Toradresse", b4.getAttribute("src"), tor)
gleich("ohne Schluessel bleibt auch die Platzhalterform", b5.getAttribute("src"), platz)
gleich("und es wird nichts abgerufen", nimmAbrufe().length, 0)
einstellungen["beneos-stream-key"] = SCHLUESSEL
await haken.rufe("renderJournalEntrySheet", f2.app, f2.wurzel)
await warte(b5)
gleich("Modus aus mit Schluessel: die Toradresse bleibt", b4.getAttribute("src"), tor)
gleich("Modus aus mit Schluessel: die Platzhalterform wird getauscht", String(b5.getAttribute("src")).startsWith("blob:"), true)
await haken.rufe("closeJournalEntrySheet", f2.app)
nimmAbrufe()
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
{
  // Kalt-Review, kritisch: der Bilddialog verwirft data-beneos-src, uebrig
  // bleibt das src mit der Adresse im Fragment. Die Anzeige liest sie dort.
  const a = bildElement(`${PLATZHALTER_BILD}#${handout}`)
  const f = fenster([a])
  nimmAbrufe()
  await haken.rufe("renderJournalEntrySheet", f.app, f.wurzel)
  await warte(a)
  gleich("Fragment ohne data-beneos-src: das Bild wird getauscht", String(a.getAttribute("src")).startsWith("blob:"), true)
  gleich("Fragment ohne data-beneos-src: abgerufen wird die Toradresse von heute",
    nimmAbrufe().map((x) => x.adresse).join(" "), settings.assetUrl("beneos_bm_0042", "4k", "map_assets/handout.webp"))
  await haken.rufe("closeJournalEntrySheet", f.app)
}
{
  // Ein kopiertes Bild: das src ist verworfen oder ein fremdes blob:, das
  // Attribut ist geblieben. Getauscht wird nach dem Attribut.
  const ohneSrc = formA(handout)
  ohneSrc.setAttribute("src", "")
  const fremdBlob = formA(handout)
  fremdBlob.setAttribute("src", "blob:https://anderswo.example/9f1")
  const f = fenster([ohneSrc, fremdBlob])
  await haken.rufe("renderJournalEntrySheet", f.app, f.wurzel)
  await warte(ohneSrc)
  await warte(fremdBlob)
  gleich("kopiertes Bild ohne src: getauscht", String(ohneSrc.getAttribute("src")).startsWith("blob:"), true)
  gleich("kopiertes Bild mit fremdem blob: getauscht", fremdBlob.getAttribute("src") !== "blob:https://anderswo.example/9f1"
    && String(fremdBlob.getAttribute("src")).startsWith("blob:"), true)
  gleich("fremdes src neben data-beneos-src bleibt", await (async () => {
    const b = formA(handout)
    b.setAttribute("src", "https://example.com/eigen.webp")
    const g = fenster([b])
    await haken.rufe("renderJournalEntrySheet", g.app, g.wurzel)
    await new Promise((r) => setTimeout(r, 20))
    await haken.rufe("closeJournalEntrySheet", g.app)
    return b.getAttribute("src")
  })(), "https://example.com/eigen.webp")
  await haken.rufe("closeJournalEntrySheet", f.app)
  nimmAbrufe()
}
{
  // Kalt-Review W1: bei Modus aus zeigt eine Bildseite ihr src ueber das Blatt.
  // Seit pages[].src schluesselfrei ist, steht dort beneos://, und das laedt
  // der Browser nicht. Ein beneos:// wird also auch bei Modus aus getauscht.
  einstellungen["beneos-stream-mode"] = false
  const seite = bildElement(handout)
  const f = fenster([seite])
  await haken.rufe("renderJournalEntryPageSheet", f.app, f.wurzel)
  await warte(seite)
  gleich("Modus aus: eine Bildseite mit beneos:// wird getauscht", String(seite.getAttribute("src")).startsWith("blob:"), true)
  await haken.rufe("closeJournalEntryPageSheet", f.app)
  const kaputt = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/kaputt.webp")
  const seiteKaputt = bildElement(kaputt)
  const g = fenster([seiteKaputt])
  await haken.rufe("renderJournalEntryPageSheet", g.app, g.wurzel)
  for (let i = 0; i < 20 && seiteKaputt.getAttribute("src") === kaputt; i++) await new Promise((r) => setTimeout(r, 5))
  gleich("Modus aus: scheitert der Abruf einer Bildseite, laedt die Toradresse direkt",
    seiteKaputt.getAttribute("src"), settings.assetUrl("beneos_bm_0042", "4k", "map_assets/kaputt.webp"))
  await haken.rufe("closeJournalEntryPageSheet", g.app)
  einstellungen["beneos-stream-mode"] = true
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
    // Nach dem Bilddialog traegt der Knoten nur noch das src mit Fragment.
    const nachDialog = { attrs: { src: `${PLATZHALTER_BILD}#${handout}`, alt: "", _preserve: {} }, type: knoten(null).type }
    const ansichtDialog = fabrik(nachDialog)
    await warte(ansichtDialog.dom)
    gleich("Editor: nach dem Bilddialog zeigt die Ansicht ein Blob aus dem Fragment",
      String(ansichtDialog.dom.getAttribute("src")).startsWith("blob:"), true)
    ansichtDialog.destroy?.()
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
abschnitt("Der Linkklick, stre-T-142 B3")

/*
 * Foundry verwirft `href="beneos://..."` beim Speichern (ALLOWED_URL_SCHEMES,
 * gemessen 18.11.2026 in v13Stream). Das Textnetz schreibt deshalb die Maske
 * mit `-` in `href` und die schluesselfreie Adresse in `data-beneos-href`.
 * Den Schluessel bekommt der Link erst im Moment des Klicks.
 */
{
  const ROH = "beneos://a/beneos_bm_0113/4k/karte.webp"
  const ZIEL = settings.leinwandAdresse(ROH)
  gleich("B3 Vorbedingung: die Toradresse von heute traegt den Schluessel", ZIEL.includes(SCHLUESSEL), true)
  for (const typ of ["click", "auxclick"]) {
    const h = hoerer.filter((x) => x.typ === typ)
    gleich(`B3 ${typ} ist einmal an document angemeldet, in der Capture-Phase`,
      `${h.length}|${h[0]?.optionen === true || h[0]?.optionen?.capture === true}`, "1|true")
  }
  const offen = []
  const altOpen = globalThis.open
  globalThis.open = (...a) => { offen.push(a) }
  const link = (wert, imEditor = false) => {
    const a = {
      getAttribute: (n) => (n === "data-beneos-href" ? wert : null),
      closest: (sel) => (sel.includes("data-beneos-href") ? (wert == null ? null : a) : (imEditor ? {} : null)),
    }
    return a
  }
  const klick = (ziel, typ = "click", button = typ === "click" ? 0 : 1, vorher = false) => {
    const e = { type: typ, button, target: ziel, defaultPrevented: vorher,
      preventDefault() { this.defaultPrevented = true }, stopPropagation() {} }
    offen.length = 0
    for (const x of hoerer.filter((y) => y.typ === typ)) x.fn(e)
    return { e, offen: offen.map((a) => a.join(" ")) }
  }
  let r = klick(link(ROH))
  gleich("B3 Klick: die Toradresse von heute in neuem Tab, ohne Opener", r.offen.join(), `${ZIEL} _blank noopener`)
  gleich("B3 Klick: der Standardklick ist unterbunden", r.e.defaultPrevented, true)
  r = klick(link(ROH), "auxclick", 1)
  gleich("B3 Mittelklick: oeffnet ebenso", r.offen.join(), `${ZIEL} _blank noopener`)
  r = klick(link(ROH), "auxclick", 2)
  gleich("B3 Rechtsklick: oeffnet nichts, das Kontextmenue bleibt", `${r.offen.length}|${r.e.defaultPrevented}`, "0|false")
  r = klick(link(ROH, true))
  gleich("B3 im Editor: oeffnet nichts", `${r.offen.length}|${r.e.defaultPrevented}`, "0|false")
  r = klick(link(null))
  gleich("B3 Link ohne Attribut: unberuehrt", `${r.offen.length}|${r.e.defaultPrevented}`, "0|false")
  r = klick(link("https://fremd.example/a/x/y.webp"))
  gleich("B3 fremde Adresse im Attribut: unberuehrt", `${r.offen.length}|${r.e.defaultPrevented}`, "0|false")
  r = klick(link(ROH), "click", 0, true)
  gleich("B3 schon unterbundener Klick: unberuehrt", r.offen.length, 0)
  einstellungen["beneos-stream-key"] = ""
  r = klick(link(ROH))
  gleich("B3 ohne Schluessel: oeffnet nichts", `${r.offen.length}|${r.e.defaultPrevented}`, "0|false")
  einstellungen["beneos-stream-key"] = SCHLUESSEL
  globalThis.open = altOpen
}

// ===========================================================================
abschnitt("Der Kopf widerspricht der Liste unter sich nicht")

/*
 * EIN KOPFKOMMENTAR, DER DIE LISTE WIDERLEGT, IST SCHLIMMER ALS KEINER. Bis zum
 * 08.11.2026 stand im Kopf "Keine Klappkarten"; mit `OP-PRJ-140` liegen sie
 * am Tor. Dokumentproben, Betreiberentscheid vom 14.11.2026.
 */
// M6: D, Dokumentproben auf den Dateikopf, Betreiberentscheid vom 14.11.2026.
dokument("der Kopf behauptet nicht mehr, Klappkarten seien aussen vor",
  (quelle.match(/\*\*Keine Klappkarten/g) || []).length, 0)
dokument("der Kopf nennt stattdessen, seit wann sie mitgehen",
  /Klappkarten gehen seit dem 08\.11\.2026 mit/.test(quelle), true)
for (const grenze of ["Kein `<video>`", "Keine Listen", "Keine Bearbeitenflaeche"]) {
  dokument(`der Kopf nennt die Grenze "${grenze}" weiter`, quelle.includes(grenze), true)
}

console.log("")
// ===========================================================================
abschnitt("stre-T-147: video, audio, source in Form (m) bekommen die Adresse nur im DOM")
{
  const { maskiere } = await import("./stream-tormaske.mjs")
  const frei = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/film.webm")
  const echt = settings.leinwandAdresse(frei)
  function medium(tag, eltern = null) {
    const attr = new Map([["src", maskiere(echt)], ["data-beneos-src", frei]])
    const el = {
      nodeType: 1, tagName: tag.toUpperCase(), parentElement: eltern, geladen: 0,
      getAttribute: (k) => attr.get(k) ?? null,
      setAttribute: (k, v) => { attr.set(k, String(v)) },
      closest: () => null,
      load() { this.geladen++ },
    }
    return el
  }
  function medienFenster(liste) {
    const wurzel = {
      nodeType: 1,
      querySelectorAll: (sel) => (sel === "img" ? [] : sel.includes("data-beneos-src") ? liste : []),
      querySelector: () => null,
    }
    return { app: { rendered: true, element: wurzel }, wurzel }
  }
  gleich("die echte Adresse traegt den Schluessel, die Maske nicht",
    `${echt.includes(SCHLUESSEL)}/${maskiere(echt).includes(SCHLUESSEL)}`, "true/false")
  const video = medium("video")
  const quelleEltern = medium("video")
  const quelle = medium("source", quelleEltern)
  const f = medienFenster([video, quelle])
  gleich("direkt: zwei Medien bekommen die Adresse", bilder.medienAnzeigen(f.wurzel, f.app), 2)
  gleich("video src ist danach die Adresse mit Schluessel", video.getAttribute("src"), echt)
  gleich("data-beneos-src bleibt schluesselfrei", video.getAttribute("data-beneos-src"), frei)
  gleich("source: das umgebende video laedt neu", quelleEltern.geladen, 1)
  gleich("zweiter Lauf aendert nichts mehr", bilder.medienAnzeigen(f.wurzel, f.app), 0)

  // Ueber den Haken, nicht nur direkt: faellt der Aufruf im Render weg, wird das rot.
  const v2 = medium("audio")
  const f2 = medienFenster([v2])
  await haken.rufe("renderJournalEntryPageSheet", f2.app, f2.wurzel)
  gleich("ueber renderJournalEntryPageSheet: audio src ist die Adresse", v2.getAttribute("src"), echt)
  await haken.rufe("closeJournalEntryPageSheet", f2.app)

  // Zwei-Werte-Probe: im Bearbeitenmodus und ohne Schluessel bleibt src die Maske.
  const v3 = medium("video")
  const f3 = medienFenster([v3])
  f3.wurzel.querySelector = (sel) => (sel.includes("prose-mirror") ? {} : null)
  gleich("im Bearbeitenmodus: 0, die Maske bleibt",
    `${bilder.medienAnzeigen(f3.wurzel, f3.app)}/${v3.getAttribute("src") === maskiere(echt)}`, "0/true")
  const v4 = medium("video")
  const f4 = medienFenster([v4])
  einstellungen["beneos-stream-key"] = ""
  const ohne = bilder.medienAnzeigen(f4.wurzel, f4.app)
  einstellungen["beneos-stream-key"] = SCHLUESSEL
  gleich("ohne Schluessel: 0, die Maske bleibt", `${ohne}/${v4.getAttribute("src") === maskiere(echt)}`, "0/true")
}

abschnitt("stre-T-147 Kalt-Review: medienAnzeigen prueft wie linkKlick, traegt Fragment und poster")
{
  const { maskiere } = await import("./stream-tormaske.mjs")
  const frei = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/film.webm")
  const echt = settings.leinwandAdresse(frei)
  const bildFrei = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/vorschau.webp")
  const bildEcht = settings.leinwandAdresse(bildFrei)
  function medium(werte) {
    const attr = new Map(Object.entries(werte))
    return {
      nodeType: 1, tagName: "VIDEO", parentElement: null, geladen: 0,
      getAttribute: (k) => attr.get(k) ?? null,
      setAttribute: (k, v) => { attr.set(k, String(v)) },
      closest: () => null,
      load() { this.geladen++ },
    }
  }
  const lauf = (el) => bilder.medienAnzeigen({ nodeType: 1, querySelectorAll: (sel) => (sel === "img" ? [] : [el]), querySelector: () => null }, { rendered: true })
  const getauscht = medium({ src: "https://example.com/eigen.webm", "data-beneos-src": frei })
  gleich("getauschtes Video: 0, src bleibt", `${lauf(getauscht)}/${getauscht.getAttribute("src")}`, "0/https://example.com/eigen.webm")
  const fremd = medium({ src: maskiere(echt), "data-beneos-src": "https://example.com/fremd.webm" })
  gleich("fremde data-beneos-src: 0, die Maske bleibt", `${lauf(fremd)}/${fremd.getAttribute("src") === maskiere(echt)}`, "0/true")
  const datei = medium({ src: maskiere(echt), "data-beneos-src": "file:///C:/geheim.mp3" })
  gleich("file:-Schema: 0, die Maske bleibt", `${lauf(datei)}/${datei.getAttribute("src") === maskiere(echt)}`, "0/true")
  const leer = medium({ "data-beneos-src": frei })
  gleich("ohne src: bekommt die Adresse", `${lauf(leer)}/${leer.getAttribute("src") === echt}`, "1/true")
  const fragment = medium({ src: `${maskiere(echt)}#t=10`, "data-beneos-src": frei })
  gleich("Fragment: src behaelt #t=10", `${lauf(fragment)}/${fragment.getAttribute("src") === `${echt}#t=10`}`, "1/true")
  gleich("Fragment: zweiter Lauf aendert nichts", lauf(fragment), 0)
  const poster = medium({ src: maskiere(echt), "data-beneos-src": frei, poster: maskiere(bildEcht), "data-beneos-poster": bildFrei })
  gleich("poster: bekommt die Adresse mit Schluessel", `${lauf(poster)}/${poster.getAttribute("poster") === bildEcht}/${poster.getAttribute("src") === echt}`, "2/true/true")
  gleich("poster: data-beneos-poster bleibt schluesselfrei", poster.getAttribute("data-beneos-poster"), bildFrei)
  const nurPoster = medium({ poster: maskiere(bildEcht), "data-beneos-poster": bildFrei })
  const passt = (sel) => sel.split(",").map((s) => s.trim()).includes("video[data-beneos-poster]")
  const nurPosterZahl = bilder.medienAnzeigen({ nodeType: 1, querySelectorAll: (sel) => (passt(sel) ? [nurPoster] : []), querySelector: () => null }, { rendered: true })
  gleich("nur poster: die Auswahl findet das Video", `${nurPosterZahl}/${nurPoster.getAttribute("poster") === bildEcht}`, "1/true")
}

abschnitt("stre-T-148: medienAnzeigen setzt srcset je Eintrag, nur im DOM")
{
  const { maskiere } = await import("./stream-tormaske.mjs")
  const frei1 = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/bild.webp")
  const frei2 = settings.platzhalterAdresse("beneos_bm_0042", "4k", "map_assets/bild-2x.webp")
  const echt1 = settings.leinwandAdresse(frei1)
  const echt2 = settings.leinwandAdresse(frei2)
  const maskenSatz = maskiere(echt1) + " 1x, " + maskiere(echt2) + " 2x"
  const freiSatz = frei1 + " 1x, " + frei2 + " 2x"
  function quelle(werte) {
    const attr = new Map(Object.entries(werte))
    return {
      nodeType: 1, tagName: "SOURCE", parentElement: null,
      getAttribute: (k) => attr.get(k) ?? null,
      setAttribute: (k, v) => { attr.set(k, String(v)) },
      closest: () => null,
    }
  }
  const lauf = (el) => bilder.medienAnzeigen({ nodeType: 1, querySelectorAll: (sel) => (sel === "img" ? [] : [el]), querySelector: () => null }, { rendered: true })
  const q = quelle({ srcset: maskenSatz, "data-beneos-srcset": freiSatz })
  gleich("srcset: bekommt die Adressen je Eintrag", lauf(q) + "/" + (q.getAttribute("srcset") === echt1 + " 1x, " + echt2 + " 2x"), "1/true")
  gleich("srcset: data-beneos-srcset bleibt schluesselfrei", q.getAttribute("data-beneos-srcset"), freiSatz)
  gleich("srcset: zweiter Lauf aendert nichts", lauf(q), 0)
  const leer = quelle({ "data-beneos-srcset": freiSatz })
  gleich("srcset ohne Wert: bekommt die Adressen", lauf(leer) + "/" + (leer.getAttribute("srcset") === echt1 + " 1x, " + echt2 + " 2x"), "1/true")
  const getauscht = quelle({ srcset: "https://example.com/eigen.webp 1x", "data-beneos-srcset": freiSatz })
  gleich("srcset getauscht: 0, bleibt", lauf(getauscht) + "/" + getauscht.getAttribute("srcset"), "0/https://example.com/eigen.webp 1x")
  const datei = quelle({ srcset: maskenSatz, "data-beneos-srcset": "file:///C:/geheim.webp 1x, " + frei2 + " 2x" })
  gleich("srcset mit file:-Eintrag: die Maske bleibt", lauf(datei) + "/" + (datei.getAttribute("srcset") === maskenSatz), "0/true")
  const gemischt = quelle({ srcset: "https://example.com/a.png 1x, " + maskiere(echt2) + " 2x", "data-beneos-srcset": "https://example.com/a.png 1x, " + frei2 + " 2x" })
  const passt = (sel) => sel.split(",").map((s) => s.trim()).includes("source[data-beneos-srcset]")
  const nurSatz = quelle({ "data-beneos-srcset": freiSatz })
  const nurSatzZahl = bilder.medienAnzeigen({ nodeType: 1, querySelectorAll: (sel) => (passt(sel) ? [nurSatz] : []), querySelector: () => null }, { rendered: true })
  gleich("nur srcset: die Auswahl findet das source", nurSatzZahl + "/" + (nurSatz.getAttribute("srcset") === echt1 + " 1x, " + echt2 + " 2x"), "1/true")
  gleich("srcset gemischt: fremder Eintrag bleibt", lauf(gemischt) + "/" + gemischt.getAttribute("srcset"), "1/https://example.com/a.png 1x, " + echt2 + " 2x")
  // Nachpruefung 19.11.2026, Befund 6: ein Anhang hinter der Maske geht mit, wie bei src.
  const anhang = quelle({ srcset: maskiere(echt1) + "?v=2 1x, " + maskiere(echt2) + "#f 2x", "data-beneos-srcset": freiSatz })
  gleich("srcset mit Anhang ?/#: Anhang geht an die Adresse", lauf(anhang) + "/" + (anhang.getAttribute("srcset") === echt1 + (echt1.includes("?") ? "&" : "?") + "v=2 1x, " + echt2 + "#f 2x"), "1/true")
  const fremdAnhang = quelle({ srcset: maskiere(echt1) + "x 1x, " + maskiere(echt2) + " 2x", "data-beneos-srcset": freiSatz })
  gleich("srcset mit fremdem Anhang: bleibt", lauf(fremdAnhang) + "/" + (fremdAnhang.getAttribute("srcset") === maskiere(echt1) + "x 1x, " + maskiere(echt2) + " 2x"), "0/true")
}

abschnitt("stre-T-222: ein Ersatzbild wegen fehlender Verbindung wird nicht wiederverwendet")
{
  // Notice.Offline verspricht "until it is back". Ein Journalbild, das ohne
  // Verbindung das Ersatzbild bekam, darf deshalb beim naechsten Render nicht
  // aus der Ablage kommen, sobald die Sitzung nicht mehr offline ist. Solange
  // sie offline ist, bleibt es beim Ersatz: ein neuer Abruf braechte nur ein neues.
  const warte = async (b) => {
    for (let i = 0; i < 20 && !String(b.getAttribute("src")).startsWith("blob:"); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  const ersatzAdresse = settings.assetUrl("beneos_bm_0042", "4k", "map_assets/ersatzfall.webp")
  const e1 = bildElement(ersatzAdresse)
  const fe1 = fenster([e1])
  nimmAbrufe()
  await haken.rufe("renderJournalEntrySheet", fe1.app, fe1.wurzel)
  await warte(e1)
  const erst = `${String(e1.getAttribute("src")).startsWith("blob:")}|${nimmAbrufe().length}`
  const e2 = bildElement(ersatzAdresse)
  const fe2 = fenster([e2])
  await haken.rufe("renderJournalEntrySheet", fe2.app, fe2.wurzel)
  await warte(e2)
  // Blob im ersten Fenster | Abrufe beim ersten Render | Abrufe beim zweiten
  gleich("Ersatzbild, Sitzung nicht offline: der naechste Render holt frisch", `${erst}|${nimmAbrufe().length}`, "true|1|1")

  // Gegenwert: ein echtes Bild kommt weiter aus der Ablage.
  const echtAdresse = settings.assetUrl("beneos_bm_0042", "4k", "map_assets/echtfall.webp")
  const g1 = bildElement(echtAdresse)
  const fg1 = fenster([g1])
  await haken.rufe("renderJournalEntrySheet", fg1.app, fg1.wurzel)
  await warte(g1)
  nimmAbrufe()
  const g2 = bildElement(echtAdresse)
  const fg2 = fenster([g2])
  await haken.rufe("renderJournalEntrySheet", fg2.app, fg2.wurzel)
  await warte(g2)
  gleich("echtes Bild: der naechste Render holt nichts", nimmAbrufe().length, 0)

  // Offline: der Ersatz bleibt in der Ablage. Die Sitzung wird ueber den
  // echten Zustand offline gestellt: der Browser meldet kein Netz.
  const online = await import("./stream-online.mjs")
  const vorher = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine")
  Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true })
  online.noteResult(false, "pruefsatz")
  const offline = online.isOffline()
  nimmAbrufe()
  const e3 = bildElement(ersatzAdresse)
  const fe3 = fenster([e3])
  await haken.rufe("renderJournalEntrySheet", fe3.app, fe3.wurzel)
  await warte(e3)
  // Sitzung offline | neue Abrufe der Ersatzadresse
  gleich("Ersatzbild, Sitzung offline: kein neuer Abruf", `${offline}|${nimmAbrufe().filter((a) => a.adresse.includes("ersatzfall")).length}`, "true|0")
  if (vorher) Object.defineProperty(globalThis.navigator, "onLine", vorher)
  else delete globalThis.navigator.onLine

  // Das abgeloeste Ersatz-Blob des ersten Fensters wird beim Schliessen
  // widerrufen, nicht erst mit dem Ende der Sitzung (Beneos-Review, CQ-H-06).
  const widerrufen = []
  const echtesWiderrufen = URL.revokeObjectURL
  URL.revokeObjectURL = (a) => { widerrufen.push(a); return echtesWiderrufen.call(URL, a) }
  const blob1 = e1.getAttribute("src")
  const blob2 = e2.getAttribute("src")
  await haken.rufe("closeJournalEntrySheet", fe2.app)
  const nachZweitem = widerrufen.includes(blob1)
  await haken.rufe("closeJournalEntrySheet", fe1.app)
  await haken.rufe("closeJournalEntrySheet", fe3.app)
  URL.revokeObjectURL = echtesWiderrufen
  // verschiedene Blobs | erstes widerrufen, solange sein Fenster offen ist | erstes nach dem Schliessen | zweites
  gleich("abgeloestes Ersatz-Blob: widerrufen, sobald sein Fenster schliesst",
    `${blob1 !== blob2}|${nachZweitem}|${widerrufen.includes(blob1)}|${widerrufen.includes(blob2)}`, "true|false|true|true")
  await haken.rufe("closeJournalEntrySheet", fg1.app)
  await haken.rufe("closeJournalEntrySheet", fg2.app)

  // Der Abruf meldet sich als Oberflaeche: ein Ersatzbild hier liegt nicht in
  // PIXI und darf dort nichts verwerfen lassen (Kalt-Review zum Diff, Befund 3).
  const m1 = bildElement(settings.assetUrl("beneos_bm_0042", "4k", "map_assets/markefall.webp"))
  const fm1 = fenster([m1])
  nimmAbrufe()
  await haken.rufe("renderJournalEntrySheet", fm1.app, fm1.wurzel)
  await warte(m1)
  const amTor = nimmAbrufe().filter((a) => a.adresse.includes("markefall"))
  // Abrufe | jeder mit der Marke
  gleich("der Abruf eines Blattbildes traegt die Marke beneosOberflaeche",
    `${amTor.length}|${amTor.every((a) => a.optionen?.beneosOberflaeche === true)}`, "1|true")
  await haken.rufe("closeJournalEntrySheet", fm1.app)
}

console.log("Nicht geprueft, ausdruecklich benannt:")
console.log("- Dass Foundry die Haken mit diesen Namen und Argumenten feuert. Gemessen")
console.log("  am 08.11.2026 in v13-streaming; die Wirkung entscheidet TC-PRJ-STR-302.")
console.log("- Echtes DOM, Bearbeitenmodus und Freigabe beim Rotieren des Schluessels.")
ende()
