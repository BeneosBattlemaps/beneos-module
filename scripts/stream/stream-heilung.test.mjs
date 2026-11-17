/**
 * stream-heilung.test.mjs
 *
 * Gegenprobe zur Praefix-Heilung in `beneos-asset-path-repair.js`
 * (`_heileStreamPraefixe`), stre-T-102. Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-heilung.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. Die Heilung liest `tile.texture.src`, also das
 * VORBEREITETE Feld, und schreibt per Update zurueck. Seit T-102 steht dort bei
 * einer schluesselfreien Kachel die Toradresse mit dem Schluessel von heute.
 * Traegt der Szenenhintergrund noch eine Toradresse mit einem aelteren
 * Schluessel, sind die Praefixe verschieden, und die Heilung schrieb den alten
 * Schluessel in die Kachel. Gemessen am 15.11.2026 in `v14Stream`
 * (Foundry 14.367): vorher `beneos://a/...`, nachher
 * `https://gate.beneos.stream/a/<alter Schluessel>/...`.
 *
 * Der Satz faengt den `canvasReady`-Haken ueber eine Attrappe von `Hooks` ab
 * und faehrt ihn mit einer nachgebauten Szene.
 */
import { assetUrl, platzhalterAdresse, SETTING, STREAM_RAUM_BUCHSTABE } from "./stream-settings.mjs"

const GATE = "https://gate.beneos.stream"
const HEUTE = "pk_heute_pruefsatz"
const ALT = "pk_alt_pruefsatz"
let schluesselAn = true
let basis = GATE

globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return schluesselAn ? HEUTE : ""
      if (name === SETTING.base) return basis
      if (name === SETTING.mode) return true
      return ""
    },
  },
  user: { isGM: true },
  actors: [],
  scenes: [],
  i18n: { localize: (s) => s, format: (s) => s },
}
const haken = {}
globalThis.Hooks = {
  on(name, fn) { haken[name] = fn },
  once(name, fn) { haken[name] = fn },
}

const { heileJournalGateAdressen } = await import("../beneos-asset-path-repair.js")
const { PLATZHALTER_BILD, htmlSchluesselfrei, nurBildadressenGetauscht, platzhalterMit } = await import("./stream-html.mjs")

let aussagen = 0, gruen = 0, rot = 0
function gleich(name, ist, soll) {
  aussagen++
  if (ist === soll) { gruen++; console.log(`  ok   ${name}`) }
  else { rot++; console.log(`  ROT  ${name}\n       ist:  ${ist}\n       soll: ${soll}`) }
}

const REL = "beneos_bm_0011_cos_barovia_village"
const PFAD = "beneos_assets/beneos_battlemaps/4k/11_cos_barovia_village/kachel.webp"
const HG = "beneos_assets/beneos_battlemaps/4k/11_cos_barovia_village/4k_bm.webp"
const mitSchluessel = (s, pfad) => assetUrl(REL, "4k", pfad).split(HEUTE).join(s)

/** Faehrt die Heilung fuer eine Szene und gibt die geschriebenen Werte zurueck. */
async function heile(hintergrund, kachelVorbereitet) {
  const geschrieben = []
  const szene = {
    name: "pruef",
    _source: { background: { src: hintergrund } },
    tiles: [{ id: "k1", texture: { src: kachelVorbereitet } }],
    getFlag: () => true,
    async updateEmbeddedDocuments(_art, updates) { geschrieben.push(...updates.map((u) => u["texture.src"])) },
  }
  haken.canvasReady({ scene: szene })
  await new Promise((r) => setTimeout(r, 0))
  return geschrieben
}

console.log("Die Praefix-Heilung schreibt keinen Schluessel")

// Die Kachel ist schluesselfrei gespeichert; vorbereitet traegt sie den
// Schluessel von heute. Der Hintergrund traegt noch einen aelteren.
const geschrieben = await heile(mitSchluessel(ALT, HG), mitSchluessel(HEUTE, PFAD))
gleich("aelterer Schluessel im Hintergrund: die Kachel wird geschrieben", geschrieben.length, 1)
gleich("und zwar schluesselfrei", geschrieben[0], platzhalterAdresse(REL, "4k", PFAD))

// Gegenwert: gleicher Schluessel, gleicher Praefix, nichts zu tun.
gleich("gleicher Schluessel: nichts wird geschrieben",
  (await heile(mitSchluessel(HEUTE, HG), mitSchluessel(HEUTE, PFAD))).length, 0)

// Gegenwert: fremde Adressen gehen zeichengleich durch.
const fremd = await heile("https://fremd.example/x/beneos_assets/a/hg.webp",
  "https://fremd.example/y/beneos_assets/a/kachel.webp")
gleich("fremder Host: die Heilung schreibt den Praefix des Hintergrunds unveraendert",
  fremd[0], "https://fremd.example/x/beneos_assets/a/kachel.webp")

// Ein schluesselfreier Hintergrund ist kein absoluter Pfad: keine Heilung.
gleich("schluesselfreier Hintergrund: nichts wird geschrieben",
  (await heile(platzhalterAdresse(REL, "4k", HG), mitSchluessel(HEUTE, PFAD))).length, 0)

/*
 * DIE JOURNALHEILUNG SCHREIBT FORM (a), stre-T-116. Bis dahin schrieb sie den
 * Praefix der Massstab-Adresse samt Schluessel ins HTML. Seit pages[].src
 * schluesselfrei ist, nimmt sie auch `beneos://a/<release>/<variante>/` als
 * Massstab, aus `page.src` oder aus `data-beneos-src`.
 */
console.log("Die Journalheilung schreibt Form (a)")
const LOKAL = "beneos_assets/cloud/battlemaps/11_cos_barovia_village/handout.webp"
const MANIFEST = "beneos_assets/beneos_battlemaps/11_cos_barovia_village/handout.webp"
const FREI_MANIFEST = platzhalterAdresse(REL, "4k", MANIFEST)
const FORM_A = `<img src="${PLATZHALTER_BILD}#${FREI_MANIFEST}" data-beneos-src="${FREI_MANIFEST}">`
function journal(seiten) {
  const geschrieben = []
  return {
    geschrieben,
    j: { name: "J", pages: seiten, async updateEmbeddedDocuments(_art, u) { geschrieben.push(...u) } },
  }
}
const textSeite = { id: "t1", text: { content: `<img src="${LOKAL}">` } }
const ohneSchluessel = (s) => !String(s).includes(HEUTE) && !String(s).includes(ALT)

{
  const { j, geschrieben } = journal([{ id: "b1", src: mitSchluessel(HEUTE, PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  gleich("Massstab Toradresse: Seite in Form (a)", geschrieben[0]?.["text.content"], FORM_A)
  gleich("Massstab Toradresse: eine Adresse gezaehlt", b.adressen, 1)
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: platzhalterAdresse(REL, "4k", PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab beneos:// aus page.src: Seite in Form (a)", geschrieben[0]?.["text.content"], FORM_A)
}
{
  // data-beneos-src VOR src: die gierige Medien-Regex faengt das letzte `src`
  // im Tag und saehe hier nur den Platzhalter. So bewacht die Probe die eigene
  // Suche nach data-beneos-src.
  const anderes = `<img data-beneos-src="${platzhalterAdresse(REL, "4k", PFAD)}" src="${PLATZHALTER_BILD}">`
  const { j, geschrieben } = journal([{ id: "t0", text: { content: anderes } }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab aus data-beneos-src: Seite in Form (a)", geschrieben[0]?.["text.content"], FORM_A)
}
{
  // Der Bilddialog hat data-beneos-src verworfen; der Massstab steht nur noch
  // im Fragment des Platzhalters (Kalt-Review, kritisch).
  const nurFragment = `<img src="${PLATZHALTER_BILD}#${platzhalterAdresse(REL, "4k", PFAD)}">`
  const { j, geschrieben } = journal([{ id: "t0", text: { content: nurFragment } }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("Massstab aus dem Fragment des Platzhalters: Seite in Form (a)", geschrieben.find((u) => u._id === "t1")?.["text.content"], FORM_A)
}
{
  // Kalt-Review W6: bei schluesselfreiem Massstab schrieb die Heilung einem
  // Video die Toradresse MIT Schluessel ins HTML. Ein Video geht nie ueber den
  // Blob-Weg und hat keine Form (a); es bleibt lokal.
  const video = `<video src="${LOKAL}"></video>`
  const { j, geschrieben } = journal([{ id: "b1", src: platzhalterAdresse(REL, "4k", PFAD) },
    { id: "t1", text: { content: video + `<img src="${LOKAL}">` } }])
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  gleich("Massstab beneos://: ein Video bleibt lokal, ungezaehlt, das Bild wird Form (a)",
    `${geschrieben[0]?.["text.content"]}|${b.fremdeBasis}`, `${video}${FORM_A}|0`)
}
/*
 * DIE HEILUNG FUEGT KEINEN SCHLUESSEL HINZU, stre-T-122 (2a und 2b). Eine
 * Toradresse, die schon vorher im HTML stand und die die Heilung nicht
 * anfasst, bleibt stehen. Gemessen wird deshalb: die Zahl der Schluesselstellen
 * nach dem Schreiben ist nicht groesser als vorher.
 */
console.log("Die Journalheilung fuegt keinen Schluessel hinzu")
// Die Raeume aus der Tabelle, nicht abgetippt: die Kopie haette sonst wie
// die Endkontrolle selbst `/l/` vergessen (Kalt-Review T-122, Befund 1).
const RAEUME = Object.values(STREAM_RAUM_BUCHSTABE)
const SCHLUESSEL_RE = new RegExp(`https?:\\/\\/[^/"'\\s]+\\/(?:${RAEUME.join("|")})\\/[A-Za-z0-9_-]{16,64}\\/`, "gi")
const schluesselStellen = (s) => [...String(s ?? "").matchAll(SCHLUESSEL_RE)].length
const LOKAL2 = "beneos_assets/cloud/battlemaps/11_cos_barovia_village/karte.webp"
const FREI_MASSSTAB = { id: "b1", src: platzhalterAdresse(REL, "4k", PFAD) }
const TOR_MASSSTAB = () => ({ id: "b1", src: mitSchluessel(HEUTE, PFAD) })
let stellenVorher = 0, stellenNachher = 0
const warnungen = []
const warnAlt = console.warn
console.warn = (...a) => { warnungen.push(a.map(String).join(" ")); warnAlt(...a) }

/** Faehrt die Journalheilung ueber ein Journal und zaehlt die Schluesselstellen. */
async function lauf(seiten) {
  const { j, geschrieben } = journal(seiten)
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  for (const u of geschrieben) {
    stellenVorher += schluesselStellen(seiten.find((s) => s.id === u._id)?.text?.content)
    stellenNachher += schluesselStellen(u["text.content"])
  }
  return { b, geschrieben, text: (id) => geschrieben.find((u) => u._id === id)?.["text.content"] }
}
const seite = (html) => ({ id: "t1", text: { content: html } })

{
  // Bis T-122 schrieb die Heilung bei einer Toradresse als Massstab einem
  // Video den Praefix MIT Schluessel ins HTML. Nicht-Bilder bleiben lokal.
  const video = `<video src="${LOKAL}"></video>`
  const r = await lauf([TOR_MASSSTAB(), seite(video + `<img src="${LOKAL}">`)])
  gleich("Massstab Toradresse: ein Video bleibt lokal, ungezaehlt, das Bild wird Form (a)",
    `${r.text("t1")}|${r.b.fremdeBasis}`, `${video}${FORM_A}|0`)
}
{
  const klang = `<audio src="${LOKAL}"></audio><video><source src="${LOKAL}"></video>`
  const r = await lauf([TOR_MASSSTAB(), seite(klang + `<img src="${LOKAL}">`)])
  gleich("Massstab Toradresse: audio und source bleiben lokal, ungezaehlt, das Bild wird Form (a)",
    `${r.text("t1")}|${r.b.fremdeBasis}`, `${klang}${FORM_A}|0`)
}
{
  // H: `data-src` hinter dem lokalen `src`. Seit stre-T-131 sucht die Heilung
  // das echte `src` und nicht das in `data-src`; jedes Attribut steht fuer
  // sich. Das `src` wird Form (a), das lokale `data-src` bleibt zeichengleich.
  const r = await lauf([TOR_MASSSTAB(), seite(`<img src="${LOKAL}" data-src="${LOKAL2}">`)])
  const text = r.text("t1") ?? ""
  gleich("H: data-src hinter dem lokalen src: src wird Form (a), data-src bleibt lokal",
    `${r.geschrieben.length}|${r.b.abgelehnt}|${text.includes(`data-beneos-src="${FREI_MANIFEST}"`)}|${text.includes(`data-src="${LOKAL2}"`)}|${text.includes(`src="${LOKAL}"`)}`,
    "1|0|true|true|false")
}
/*
 * stre-T-131: zwei Formen, die die Heilung bis dahin uebersah. Ein
 * grossgeschriebenes `IMG SRC` (der Vorfilter war case-sensitiv) und ein
 * `data-src` hinter dem lokalen `src` (die Suche fing `data-src`).
 */
{
  const r = await lauf([TOR_MASSSTAB(), seite(`<IMG SRC="${LOKAL}">`)])
  const text = r.text("t1") ?? ""
  gleich("T131-A: IMG SRC gross: das Bild wird Form (a), ohne Schluessel",
    `${r.geschrieben.length}|${text.includes(LOKAL)}|${schluesselStellen(text)}|${text.includes(`data-beneos-src="${FREI_MANIFEST}"`)}`,
    "1|false|0|true")
}
{
  // Gegenwert: eine Adresse, die nicht aus der Installation stammt, bleibt.
  const r = await lauf([TOR_MASSSTAB(), seite(`<IMG SRC="worlds/x/bild.webp">`)])
  gleich("T131-A Gegenwert: IMG SRC gross mit fremder lokaler Adresse: nichts geschrieben", r.geschrieben.length, 0)
}
{
  const tor = mitSchluessel(HEUTE, PFAD)
  const r = await lauf([TOR_MASSSTAB(), seite(`<img src="${LOKAL}" data-src="${tor}">`)])
  const text = r.text("t1") ?? ""
  gleich("T131-B: data-src mit Toradresse hinter dem lokalen src: src wird Form (a), kein Schluessel",
    `${r.geschrieben.length}|${text.includes(`src="${LOKAL}"`)}|${schluesselStellen(text)}|${text.includes(`data-beneos-src="${FREI_MANIFEST}"`)}`,
    "1|false|0|true")
}
{
  // Y: derselbe Wert steht in einem Attribut vor dem `src`. Getauscht wuerde
  // das erste Vorkommen, nicht das `src`. Auch das lehnt die Schreibpruefung ab.
  const r = await lauf([TOR_MASSSTAB(), seite(`<img alt="${LOKAL}" src="${LOKAL}">`)])
  gleich("Y: gleicher Wert vor dem src: nicht geschrieben, abgelehnt", `${r.geschrieben.length}|${r.b.abgelehnt}`, "0|1")
}
for (const [name, b] of [["K", "HTTPS://Gate.Beneos.Stream"], ["V", "https://Gate.Beneos.Stream"]]) {
  // Die erlaubte Basis kommt roh zurueck, der Host im Vergleich klein.
  basis = b
  const r = await lauf([FREI_MASSSTAB, seite(`<img src="${LOKAL}">`)])
  basis = GATE
  gleich(`${name}: Basis ${b}: das Bild wird Form (a), ohne Schluessel`, r.text("t1"), FORM_A)
}
{
  const gross = mitSchluessel(HEUTE, PFAD).replace("https://gate.beneos.stream", "https://GATE.BENEOS.STREAM")
  const r = await lauf([{ id: "b1", src: gross }, seite(`<img src="${LOKAL}">`)])
  gleich("X: Massstab mit grossgeschriebenem Host: das Bild wird Form (a)", r.text("t1"), FORM_A)
}
for (const [name, massstab] of [["Toradresse", TOR_MASSSTAB()], ["beneos://", FREI_MASSSTAB]]) {
  // Doppeltes src: die Heilung trifft das zweite, die Wandlung liest das erste.
  // Der Schluessel bliebe im zweiten stehen; das Tag bleibt lokal.
  const r = await lauf([massstab, seite(`<img src="${LOKAL}" src="${LOKAL2}">`)])
  gleich(`W2 (${name}): doppeltes src bleibt lokal, gezaehlt, nicht abgelehnt`,
    `${r.geschrieben.length}|${r.b.abgelehnt}|${r.b.fremdeBasis}`, "0|0|1")
}
{
  // srcset mit Toradresse: die Wandlung nimmt es heraus. Verglichen wird gegen
  // die gewandelte Fassung des Bestandes, darum geht die Seite durch.
  const r = await lauf([TOR_MASSSTAB(), seite(`<img src="${LOKAL}" srcset="${mitSchluessel(HEUTE, PFAD)} 2x">`)])
  gleich("G: srcset faellt weg, das Bild wird Form (a), nicht abgelehnt", `${r.text("t1")}|${r.b.abgelehnt}`, `${FORM_A}|0`)
}
{
  // Ein absichtlich getauschtes Bild: eigenes src, data-beneos-src steht noch.
  // Es bleibt zeichengleich und haelt die Seite nicht auf.
  const getauscht = `<img src="beneos_assets/eigen/bild.webp" data-beneos-src="${FREI_MANIFEST}">`
  const r = await lauf([TOR_MASSSTAB(), seite(getauscht + `<img src="${LOKAL}">`)])
  gleich("J: ein getauschtes Bild bleibt, das andere wird Form (a), nicht abgelehnt",
    `${r.text("t1")}|${r.b.abgelehnt}`, `${getauscht}${FORM_A}|0`)
}
{
  // M: ein Video, das schon vorher die Toradresse trug, bleibt stehen.
  const vorher = `<video src="${mitSchluessel(HEUTE, PFAD)}"></video><img src="${LOKAL}">`
  const r = await lauf([FREI_MASSSTAB, seite(vorher)])
  gleich("M: Video mit Toradresse bleibt, nicht mehr Schluesselstellen als vorher",
    `${r.text("t1")}|${schluesselStellen(r.text("t1")) <= schluesselStellen(vorher)}`,
    `<video src="${mitSchluessel(HEUTE, PFAD)}"></video>${FORM_A}|true`)
}
{
  // P: ein Bild unter einem frueheren Host bleibt stehen.
  const alt = `<img src="https://gate.alt.example/a/${ALT}/${REL}/4k/alt.webp">`
  const r = await lauf([FREI_MASSSTAB, seite(alt + `<img src="${LOKAL}">`)])
  gleich("P: frueherer Host bleibt, nicht mehr Schluesselstellen als vorher",
    `${r.text("t1")}|${schluesselStellen(r.text("t1")) <= schluesselStellen(alt)}`, `${alt}${FORM_A}|true`)
}
{
  // Unter einer fremden oder frueheren Basis gibt es keine schluesselfreie
  // Form. Bis T-122 schrieb die Heilung dann die Toradresse mit dem alten
  // Schluessel ins HTML; jetzt bleibt das Bild lokal und wird gezaehlt.
  const r = await lauf([{ id: "b1", src: "https://gate.alt.example/a/" + ALT + "/" + REL + "/4k/x.webp" }, structuredClone(textSeite)])
  gleich("fremde Basis: nichts geschrieben, gezaehlt", `${r.geschrieben.length}|${r.b.fremdeBasis}`, "0|1")
}
for (const raum of RAEUME) {
  // Die Endkontrolle kennt jeden Raum (Kalt-Review T-122, Befund 1). Eine
  // Toradresse mit Schluessel unter fremdem Host in einem Attribut vor dem
  // `src` haelt das Tag lokal, auch im Beuteraum `/l/`. Vor dem `src`, weil der
  // Treffer der Endkontrolle dort endet; dahinter zaehlt die Seite.
  const fremd = `https://gate.alt.example/${raum}/${ALT}/${REL}/x.webp`
  const r = await lauf([TOR_MASSSTAB(), seite(`<img data-x="${fremd}" src="${LOKAL}">`)])
  gleich(`Endkontrolle /${raum}/: das Tag bleibt lokal, gezaehlt`, `${r.geschrieben.length}|${r.b.fremdeBasis}`, "0|1")
}
{
  // kandidat(): ein grossgeschriebener Torhost wird Form (a), ein fremder
  // Host bleibt unveraendert.
  basis = "HTTPS://Gate.Beneos.Stream"
  const tor = `<img src="${assetUrl(REL, "4k", MANIFEST)}">`
  const fremd = `<img src="https://fremd.example/a/${HEUTE}/${REL}/4k/${MANIFEST}">`
  const ist = `${htmlSchluesselfrei(tor).html}|${htmlSchluesselfrei(fremd).html}`
  basis = GATE
  gleich("kandidat: grossgeschriebener Torhost wird Form (a), fremder Host bleibt", ist, `${FORM_A}|${fremd}`)
}
{
  // nurBildadressenGetauscht: der Host in data-beneos-src wird ohne Ruecksicht
  // auf Gross- und Kleinschreibung erkannt.
  const mit = (h) => { const d = `beneos://a/${REL}/4k/${h}/x.webp`; return `<img src="${platzhalterMit(d)}" data-beneos-src="${d}">` }
  gleich("nurBildadressenGetauscht: Host klein und gross gleich abgelehnt",
    `${nurBildadressenGetauscht("<img>", mit("gate.beneos.stream"))}|${nurBildadressenGetauscht("<img>", mit("Gate.Beneos.Stream"))}`, "false|false")
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: mitSchluessel(HEUTE, PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  schluesselAn = false
  const b = await heileJournalGateAdressen()
  schluesselAn = true
  // Ohne den fruehen Ausstieg haelt die Endkontrolle das Bild lokal und
  // zaehlt es; gezaehlt wird deshalb mit, damit der Ausstieg bewacht bleibt.
  gleich("ohne Schluessel: kein Lauf", `${geschrieben.length}|${b.fremdeBasis}`, "0|0")
}
{
  const { j, geschrieben } = journal([structuredClone(textSeite)])
  game.journal = [j]
  const b = await heileJournalGateAdressen()
  gleich("ohne Massstab: nichts geschrieben, benannt", `${geschrieben.length}|${b.ohneMassstab.join()}`, "0|J")
}
{
  const { j, geschrieben } = journal([{ id: "b1", src: mitSchluessel(HEUTE, PFAD) }, structuredClone(textSeite)])
  game.journal = [j]
  await heileJournalGateAdressen()
  gleich("kein Schluessel im Geschriebenen", ohneSchluessel(JSON.stringify(geschrieben)), true)
}
gleich("ueber den ganzen Satz: nicht mehr Schluesselstellen als vorher",
  `${stellenNachher <= stellenVorher}|${stellenVorher}`, `true|${stellenVorher}`)
gleich("keine Warnung nennt einen Schluessel",
  warnungen.filter((w) => new RegExp(`pk_|https?:\\/\\/[^/\\s]+\\/(?:${RAEUME.join("|")})\\/`, "i").test(w) || w.includes(ALT) || w.includes(HEUTE)).length, 0)
console.warn = warnAlt

/*
 * stre-T-131, Kalt-Review: die engere `HTML_SRC_RE` darf weder die Suche nach
 * dem Massstab noch die Wurzelsuche beim Schluesselwechsel blind machen, und
 * die Rueckschau gilt auch fuer Attribute wie `xsrc`.
 */
console.log("stre-T-131: Massstab, Wurzelsuche, xsrc")
{
  // Ohne Bildseite steht der Massstab nur im `data-src` desselben Tags.
  const tor = mitSchluessel(HEUTE, PFAD)
  const r = await lauf([seite(`<img src="${LOKAL}" data-src="${tor}">`)])
  const text = r.text("t1") ?? ""
  gleich("M2: Massstab nur in data-src: das Bild wird Form (a), kein Schluessel",
    `${r.geschrieben.length}|${r.b.ohneMassstab.length}|${schluesselStellen(text)}|${text.includes(`data-beneos-src="${FREI_MANIFEST}"`)}`,
    "1|0|0|true")
}
{
  const r = await lauf([TOR_MASSSTAB(), seite(`<img src="${LOKAL}" xsrc="${LOKAL2}">`)])
  const text = r.text("t1") ?? ""
  gleich("xsrc hinter dem lokalen src: src wird Form (a), xsrc bleibt",
    `${r.geschrieben.length}|${r.b.abgelehnt}|${text.includes(`data-beneos-src="${FREI_MANIFEST}"`)}|${text.includes(`xsrc="${LOKAL2}"`)}`,
    "1|0|true|true")
}
{
  const { schluesselNachziehen } = await import("../beneos-asset-path-repair.js")
  const torAlt = mitSchluessel(ALT, PFAD)
  for (const [name, html] of [
    ["W2: alter Schluessel nur in data-src: die Wurzel wird gefunden", `<img src="${LOKAL}" data-src="${torAlt}">`],
    ["W5: alter Schluessel nur im srcset: die Wurzel wird gefunden", `<img src="${LOKAL}" srcset="${torAlt} 2x">`],
  ]) {
    game.journal = [{ name: "J", pages: [{ id: "t1", text: { content: html } }] }]
    const logAlt = console.log
    console.log = () => {}
    let b
    try { b = await schluesselNachziehen({ trocken: true }) } finally { console.log = logAlt }
    gleich(name, b.gefunden.length, 1)
  }
}

console.log(`\n${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
const ERWARTET = 43
if (aussagen !== ERWARTET) {
  console.log(`ROT erwartet ${ERWARTET} Aussagen, gezaehlt ${aussagen}`)
  process.exit(1)
}
process.exit(rot ? 1 : 0)
