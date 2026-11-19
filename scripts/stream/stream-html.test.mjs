/**
 * stream-html.test.mjs
 *
 * Pruefsatz zu `stream-html.mjs` (stre-T-116): kein Streamschluessel im HTML.
 * Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-html.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 mindestens einer rot.
 *
 * Der Schluessel ist ein Wegwerfwert. Jede Probe, die "Schluessel weg"
 * behauptet, sucht ihn roh UND URL-kodiert.
 */
import { assetUrl, platzhalterAdresse, SETTING } from "./stream-settings.mjs"

const GATE = "https://gate.beneos.stream"
const KEY = "pk_html_pruefsatz"
const einstellungen = { [SETTING.key]: KEY, [SETTING.base]: GATE, [SETTING.mode]: false }
const hakenListe = {}
globalThis.Hooks = {
  on(name, fn) { (hakenListe[name] ??= []).push(fn) },
  once(name, fn) { (hakenListe[name] ??= []).push(fn) },
}
globalThis.game = {
  settings: { get: (_m, name) => einstellungen[name] ?? "" },
  user: { isGM: true },
  i18n: { localize: (s) => s, format: (s) => s },
}

const { PLATZHALTER_BILD, htmlSchluesselfrei, htmlTiefSchluesselfrei, htmlAenderung, seitenSrc,
  installHtmlNetz, altseitenUmstellen, HTML_ARTEN, formAAdresse, platzhalterMit } = await import("./stream-html.mjs")

let aussagen = 0, gruen = 0, rot = 0
function wahr(name, bedingung, detail = "") {
  aussagen++
  if (bedingung) { gruen++; console.log(`  ok   ${name}`) }
  else { rot++; console.log(`  ROT  ${name}${detail ? `\n       ${detail}` : ""}`) }
}
const ohneSchluessel = (s) => !String(s).includes(KEY) && !String(s).includes(encodeURIComponent(KEY))

const REL = "beneos_bm_0011_cos_barovia_village"
const PFAD = "beneos_assets/beneos_battlemaps/4k/11_cos_barovia_village/handout.webp"
const TOR = assetUrl(REL, "4k", PFAD)
const FREI = platzhalterAdresse(REL, "4k", PFAD)
// Das src der Form (a): Platzhalter, die freie Adresse als Fragment dahinter.
const SRC_A = `${PLATZHALTER_BILD}#${FREI}`

console.log("H0 Vorbedingung der Probe")
wahr("H0 die Toradresse traegt den Schluessel", TOR.includes(KEY), TOR)
wahr("H0 die freie Form beginnt mit beneos://", FREI.startsWith("beneos://"), FREI)
wahr("H0 Platzhalter ohne ;base64 und ohne Anfuehrungszeichen",
  PLATZHALTER_BILD.startsWith("data:image/") && !PLATZHALTER_BILD.includes(";base64") && !/["']/.test(PLATZHALTER_BILD))

console.log("H1 Zwei-Werte-Probe: Toradresse wird Form (a), Fremdes bleibt bytegleich")
{
  const roh = `<p>a</p><img width="600" height="400" src="${TOR}" alt="Karte" class="x">`
  const r = htmlSchluesselfrei(roh)
  wahr("H1 eine Adresse gezaehlt", r.zahl === 1, `zahl ${r.zahl}`)
  wahr("H1 Schluessel weg", ohneSchluessel(r.html))
  wahr("H1 src ist der Platzhalter mit der freien Adresse als Fragment", r.html.includes(`src="${SRC_A}"`), r.html)
  wahr("H1 data-beneos-src traegt die freie Form", r.html.includes(`data-beneos-src="${FREI}"`))
  wahr("H1 width, height, alt, class bleiben",
    r.html.includes('width="600"') && r.html.includes('height="400"') && r.html.includes('alt="Karte"') && r.html.includes('class="x"'))
  wahr("H1 Text davor bleibt", r.html.startsWith("<p>a</p><img"))
  const fremd = `<p>b</p><img src="https://example.com/a/${KEY}/x/4k/y.webp"><img src="modules/x/y.webp">`
  // Neben einer Toradresse im selben Text: sonst haelt schon der Vorfilter
  // (Host nicht im Text) das Fremde fern, und die Probe saehe die Wandlung nie.
  const nachbar = `<img src="${TOR}">`
  const f = htmlSchluesselfrei(fremd + nachbar)
  wahr("H1 fremder Host bytegleich", f.html.startsWith(fremd) && f.zahl === 1, f.html)
  const basis = `<img src="https://gate.anders.example/a/${KEY}/${REL}/4k/${PFAD}">`
  const b = htmlSchluesselfrei(basis + nachbar)
  wahr("H1 fremde Basis bytegleich", b.html.startsWith(basis) && b.zahl === 1, b.html)
}

console.log("H2 einfach gefasste Attribute")
{
  const r = htmlSchluesselfrei(`<img src='${TOR}'>`)
  wahr("H2 einfache Anfuehrung bleibt einfach", r.html === `<img src='${SRC_A}' data-beneos-src='${FREI}'>`, r.html)
}

console.log("H3 data-beneos-src im Tag: kein zweites, Reihenfolge egal")
{
  const davor = `<img data-beneos-src="${FREI}" src="${TOR}">`
  const r1 = htmlSchluesselfrei(davor)
  wahr("H3 davor: Schluessel weg", ohneSchluessel(r1.html), r1.html)
  wahr("H3 davor: genau ein data-beneos-src", (r1.html.match(/data-beneos-src/g) || []).length === 1)
  const dahinter = `<img src="${TOR}" data-beneos-src="beneos://a/alt/4k/alt.webp">`
  const r2 = htmlSchluesselfrei(dahinter)
  wahr("H3 dahinter: Schluessel weg", ohneSchluessel(r2.html), r2.html)
  wahr("H3 dahinter: genau ein data-beneos-src, nachgezogen",
    (r2.html.match(/data-beneos-src/g) || []).length === 1 && r2.html.includes(`data-beneos-src="${FREI}"`), r2.html)
  const fertig = `<img src="${SRC_A}" data-beneos-src="${FREI}">`
  const r3 = htmlSchluesselfrei(fertig + `<img src="${TOR}">`)
  wahr("H3 Form (a) bleibt bytegleich", r3.html.startsWith(fertig) && r3.zahl === 1, r3.html)
}

console.log("H11 Editorwege: ein verlorenes data-beneos-src kommt aus dem Fragment zurueck (Kalt-Review, kritisch)")
{
  wahr("H11 platzhalterMit baut das src der Form (a)", platzhalterMit(FREI) === SRC_A)
  wahr("H11 formAAdresse liest das Fragment", formAAdresse(SRC_A, null) === FREI)
  wahr("H11 formAAdresse: data-beneos-src geht vor", formAAdresse(SRC_A, "beneos://a/r/4k/b.webp") === "beneos://a/r/4k/b.webp")
  wahr("H11 formAAdresse: blob und fehlendes src mit Attribut", formAAdresse("blob:x/1", FREI) === FREI && formAAdresse(null, FREI) === FREI)
  wahr("H11 formAAdresse: fremdes src ist nicht Form (a)", formAAdresse("https://example.com/a.webp", FREI) === null)
  wahr("H11 formAAdresse: fremdes Fragment ist nicht Form (a)", formAAdresse(`${PLATZHALTER_BILD}#https://x`, null) === null)
  wahr("H11 formAAdresse: ein data-beneos-src ohne beneos:// zaehlt nicht", formAAdresse("blob:x/1", "https://example.com/a.webp") === null)

  // Bilddialog (v13 und v14) und image_link (v13) bauen den Knoten neu, ohne
  // die erhaltenen Attribute. Uebrig bleibt das src.
  const dialog = `<p>x</p><img src="${SRC_A}" alt="Karte" width="600">`
  const d = htmlSchluesselfrei(dialog)
  wahr("H11 Bilddialog: data-beneos-src kommt zurueck", d.html === `<p>x</p><img src="${SRC_A}" data-beneos-src="${FREI}" alt="Karte" width="600">`, d.html)
  wahr("H11 Bilddialog: als Heilung gezaehlt", d.zahl === 1 && d.heil === 1, JSON.stringify(d))
  const link = `<a href="https://example.com"><img src="${SRC_A}"></a>`
  wahr("H11 Bild im Link: data-beneos-src kommt zurueck", htmlSchluesselfrei(link).html.includes(`data-beneos-src="${FREI}"`))

  const kopie = `<img src="blob:https://welt.example/0b7c" data-beneos-src="${FREI}">`
  wahr("H11 kopiertes Bild mit blob-src: Platzhalter zurueck", htmlSchluesselfrei(kopie).html === `<img src="${SRC_A}" data-beneos-src="${FREI}">`,
    htmlSchluesselfrei(kopie).html)
  const ohneSrc = `<img data-beneos-src="${FREI}" alt="k">`
  wahr("H11 src verworfen: Platzhalter kommt dazu", htmlSchluesselfrei(ohneSrc).html === `<img src="${SRC_A}" data-beneos-src="${FREI}" alt="k">`,
    htmlSchluesselfrei(ohneSrc).html)
  const alt = `<img src="${PLATZHALTER_BILD}" data-beneos-src="${FREI}">`
  wahr("H11 Platzhalter ohne Fragment bekommt es", htmlSchluesselfrei(alt).html === `<img src="${SRC_A}" data-beneos-src="${FREI}">`)

  const nachbar = `<img src="${TOR}">`
  const fremd = `<img src="https://example.com/a.webp" data-beneos-src="${FREI}">`
  wahr("H11 fremdes src neben data-beneos-src bleibt bytegleich", htmlSchluesselfrei(fremd + nachbar).html.startsWith(fremd))
  const fremdFrag = `<img src="${PLATZHALTER_BILD}#https://example.com/x.webp">`
  wahr("H11 Platzhalter mit fremdem Fragment bleibt bytegleich", htmlSchluesselfrei(fremdFrag + nachbar).html.startsWith(fremdFrag))

  // Bedingung orch (P-12:54:43): im Fragment steht nie Schluessel oder
  // Toradresse, auch wenn jemand eine solche Form einfuegt.
  const torImFragment = htmlSchluesselfrei(`<img src="${PLATZHALTER_BILD}#${TOR}">`)
  wahr("H11 Toradresse im Fragment wird frei", torImFragment.html === `<img src="${SRC_A}" data-beneos-src="${FREI}">`, torImFragment.html)
  const torImAttribut = htmlSchluesselfrei(`<img src="${SRC_A}" data-beneos-src="${TOR}">`)
  wahr("H11 Toradresse in data-beneos-src wird frei", torImAttribut.html === `<img src="${SRC_A}" data-beneos-src="${FREI}">`, torImAttribut.html)
  const torOhneSrc = htmlSchluesselfrei(`<img data-beneos-src="${TOR}">`)
  wahr("H11 Toradresse in data-beneos-src ohne src wird frei", torOhneSrc.html === `<img src="${SRC_A}" data-beneos-src="${FREI}">`, torOhneSrc.html)

  einstellungen[SETTING.key] = ""
  wahr("H11 ohne Schluessel keine Heilung", htmlSchluesselfrei(dialog).html === dialog)
  einstellungen[SETTING.key] = KEY
}

console.log("H12 Robustheit des Tags (Kalt-Review W2)")
{
  const gross = htmlSchluesselfrei(`<img alt="a > b" src="${TOR}">`)
  wahr("H12 '>' in einem Attribut davor: gewandelt", ohneSchluessel(gross.html) && gross.html.includes(`src="${SRC_A}"`) && gross.html.includes('alt="a > b"'), gross.html)
  const gross2 = htmlSchluesselfrei(`<IMG SRC="${TOR}">`)
  wahr("H12 Grossschreibung: gewandelt", ohneSchluessel(gross2.html) && gross2.zahl === 1
    && gross2.html.includes(`data-beneos-src="${FREI}"`), gross2.html)
  const nackt = htmlSchluesselfrei(`<img src=${TOR} alt=x>`)
  wahr("H12 src ohne Anfuehrung: gewandelt", ohneSchluessel(nackt.html) && nackt.html.includes(`src="${SRC_A}"`) && nackt.html.includes("alt=x"), nackt.html)
  const PFAD_APO = "beneos_assets/x/o'brien.webp"
  const TOR_APO = assetUrl(REL, "4k", PFAD_APO)
  const FREI_APO = platzhalterAdresse(REL, "4k", PFAD_APO)
  const apo = htmlSchluesselfrei(`<img src="${TOR_APO}">`)
  wahr("H12 Apostroph im Pfad: gewandelt", ohneSchluessel(apo.html) && apo.html.includes(`data-beneos-src="${FREI_APO}"`), apo.html)
  const satz = htmlSchluesselfrei(`<img src="${TOR}" srcset="${TOR} 2x, ${TOR} 3x">`)
  wahr("H12 srcset mit Toradresse faellt weg", ohneSchluessel(satz.html) && !satz.html.includes("srcset"), satz.html)
  const fremdSatz = `<img src="${TOR}" srcset="https://example.com/a.webp 2x">`
  wahr("H12 fremdes srcset bleibt", htmlSchluesselfrei(fremdSatz).html.includes('srcset="https://example.com/a.webp 2x"'))
  // Nachpruefung 17.11.2026, Befund 4: ein anderes Bildattribut mit Schluessel
  // blieb stehen und wurde nur gezaehlt; die Zahl las niemand. Es wird frei.
  const lazy = htmlSchluesselfrei(`<img data-src="${TOR}" src="${TOR}">`)
  wahr("H12 data-src davor: src gewandelt, data-src frei",
    lazy.html === `<img data-src="${FREI}" src="${SRC_A}" data-beneos-src="${FREI}">`, lazy.html)
  const lazyFremd = htmlSchluesselfrei(`<img src="https://example.com/x.webp" data-src="${TOR}">`)
  wahr("H12 data-src mit Schluessel neben fremdem src: nur data-src frei",
    lazyFremd.html === `<img src="https://example.com/x.webp" data-src="${FREI}">` && lazyFremd.zahl === 1, lazyFremd.html)
}

console.log("H13 Entitaeten im Attribut (Kalt-Review W3)")
{
  const PFAD_APO = "beneos_assets/x/o'brien.webp"
  const TOR_APO = assetUrl(REL, "4k", PFAD_APO)
  const FREI_APO = platzhalterAdresse(REL, "4k", PFAD_APO)
  const hex = htmlSchluesselfrei(`<img src='${TOR_APO.replace("'", "&#x27;")}'>`)
  wahr("H13 &#x27; im einfach gefassten src: gewandelt", ohneSchluessel(hex.html) && hex.zahl === 1, hex.html)
  wahr("H13 und im Wert wieder als Entitaet", hex.html.includes(`data-beneos-src='${FREI_APO.replace("'", "&#39;")}'`), hex.html)
  const dez = htmlSchluesselfrei(`<img src="${TOR_APO.replace("'", "&#39;")}">`)
  wahr("H13 &#39; im doppelt gefassten src: gewandelt", ohneSchluessel(dez.html) && dez.html.includes(`data-beneos-src="${FREI_APO}"`), dez.html)
  const amp = htmlSchluesselfrei(`<img src="${TOR}" alt="a &amp; b">`)
  wahr("H13 Entitaet in einem anderen Attribut bleibt", amp.html.includes('alt="a &amp; b"'), amp.html)
}

console.log("H4 video, audio, source: gezaehlt, nicht gewandelt")
{
  const v = `<video src="${TOR}"></video>`
  const r = htmlSchluesselfrei(v)
  wahr("H4 video bytegleich", r.html === v)
  wahr("H4 video gezaehlt", r.andere === 1, `andere ${r.andere}`)
}

console.log("H5 ohne Schluessel: nichts")
{
  einstellungen[SETTING.key] = ""
  const roh = `<img src="${TOR}">`
  wahr("H5 HTML bytegleich", htmlSchluesselfrei(roh).html === roh)
  wahr("H5 Seite bleibt", seitenSrc("image", TOR) === undefined)
  wahr("H5 Aenderung leer", htmlAenderung({ text: { content: roh } }).aenderung === null)
  einstellungen[SETTING.key] = KEY
}

console.log("H6 tief: Objekt, Liste, flacher Pfad")
{
  const w = { "text.content": `<img src="${TOR}">`, system: { a: [`<img src="${TOR}">`, "x"] }, n: 3 }
  const zahl = htmlTiefSchluesselfrei(w)
  wahr("H6 zwei gewandelt", zahl === 2, `zahl ${zahl}`)
  wahr("H6 Schluessel ueberall weg", ohneSchluessel(JSON.stringify(w)))
  wahr("H6 Zahl bleibt", w.n === 3 && w.system.a[1] === "x")
}

console.log("H7 Seiten: nur Bildseiten")
{
  wahr("H7 Bildseite wird frei", seitenSrc("image", TOR) === FREI)
  wahr("H7 Videoseite bleibt", seitenSrc("video", TOR) === undefined)
  wahr("H7 PDF-Seite bleibt", seitenSrc("pdf", TOR) === undefined)
}

console.log("H8 Aenderung fuer updateSource: nur Geaendertes, eingebettet nach _id")
{
  const quelle = {
    name: "J",
    pages: [
      { _id: "p1", type: "text", text: { content: `<img src="${TOR}">` } },
      { _id: "p2", type: "text", text: { content: "<p>ruhig</p>" } },
      { _id: "p3", type: "image", src: TOR },
      { _id: "p4", type: "video", src: TOR },
    ],
  }
  const vorher = JSON.stringify(quelle)
  const { aenderung, zahl } = htmlAenderung(quelle)
  wahr("H8 Quelle unberuehrt", JSON.stringify(quelle) === vorher)
  wahr("H8 zwei Adressen", zahl === 2, `zahl ${zahl}`)
  wahr("H8 nur p1 und p3", aenderung?.pages?.map((p) => p._id).join() === "p1,p3", JSON.stringify(aenderung))
  wahr("H8 kein name", aenderung && !("name" in aenderung))
  wahr("H8 Schluessel weg", ohneSchluessel(JSON.stringify(aenderung)))
  wahr("H8 Videoseite nicht in der Aenderung", !JSON.stringify(aenderung).includes('"p4"'))
  const ohneIds = htmlAenderung({ liste: [{ t: `<img src="${TOR}">` }, { t: "x" }] }).aenderung
  wahr("H8 Liste ohne _id geht ganz", ohneIds?.liste?.length === 2 && ohneIds.liste[1].t === "x")
  // Kalt-Review W5: eine Liste mit _id UNTER system ist keine eingebettete
  // Sammlung. Ein Teil davon ersetzte die ganze Liste.
  const vorschub = htmlAenderung({ system: { advancement: [{ _id: "a1", hint: `<img src="${TOR}">` }, { _id: "a2", hint: "x" }] } }).aenderung
  wahr("H8 Liste mit _id unter system geht ganz", vorschub?.system?.advancement?.map((a) => a._id).join() === "a1,a2"
    && vorschub.system.advancement[1].hint === "x", JSON.stringify(vorschub))
  const tief = htmlAenderung({ items: [{ _id: "i1", system: { teile: [{ _id: "t1", v: `<img src="${TOR}">` }, { _id: "t2", v: "y" }] } }] }).aenderung
  wahr("H8 eingebettet bleibt Teil, darunter geht ganz", tief?.items?.length === 1 && tief.items[0]._id === "i1"
    && tief.items[0].system.teile.length === 2, JSON.stringify(tief))
  const ohneIdOben = htmlAenderung({ rolls: [{ teile: [{ _id: "r1", v: `<img src="${TOR}">` }, { _id: "r2", v: "z" }] }] }).aenderung
  wahr("H8 Liste ohne _id am Dokument: darunter geht ganz", ohneIdOben?.rolls?.[0]?.teile?.length === 2, JSON.stringify(ohneIdOben))
  const unterSystem = htmlAenderung({ system: { type: "image", src: TOR } }).aenderung
  wahr("H8 type und src unter system sind keine Seite", unterSystem === null, JSON.stringify(unterSystem))
}

console.log("H9 Schreibnetz: Haken je Art, Wirkung beim Update und Anlegen")
{
  installHtmlNetz()
  wahr("H9 TableResult, Card und ActiveEffect im Netz (Kalt-Review W4)",
    ["TableResult", "Card", "ActiveEffect"].every((a) => HTML_ARTEN.includes(a)), HTML_ARTEN.join())
  for (const art of HTML_ARTEN) {
    wahr(`H9 preUpdate${art} und preCreate${art} gesetzt`,
      hakenListe[`preUpdate${art}`]?.length === 1 && hakenListe[`preCreate${art}`]?.length === 1)
  }
  installHtmlNetz()
  wahr("H9 zweiter Einbau setzt keinen Haken doppelt", hakenListe.preUpdateJournalEntryPage.length === 1)

  const update = { "text.content": `<p>t</p><img src="${TOR}">` }
  hakenListe.preUpdateJournalEntryPage[0]({ type: "text" }, update)
  wahr("H9 Update Seite: Form (a)", update["text.content"].includes(`data-beneos-src="${FREI}"`) && ohneSchluessel(update["text.content"]))

  const bild = { src: TOR }
  hakenListe.preUpdateJournalEntryPage[0]({ type: "image" }, bild)
  wahr("H9 Update Bildseite src frei", bild.src === FREI)
  const video = { src: TOR }
  hakenListe.preUpdateJournalEntryPage[0]({ type: "video" }, video)
  wahr("H9 Update Videoseite bleibt", video.src === TOR)

  const journal = { pages: [{ _id: "p9", src: TOR }] }
  const doc = { pages: { get: (id) => (id === "p9" ? { type: "image" } : undefined) } }
  hakenListe.preUpdateJournalEntry[0](doc, journal)
  wahr("H9 Update Journal: eingebettete Bildseite frei", journal.pages[0].src === FREI)

  const chat = { content: `<img src="${TOR}">` }
  hakenListe.preUpdateChatMessage[0]({}, chat)
  wahr("H9 Update Chat: Form (a)", ohneSchluessel(chat.content))

  const fremdTeil = '<img src="https://example.com/x.webp">'
  const fremd = { content: fremdTeil + `<img src="${TOR}">` }
  hakenListe.preUpdateChatMessage[0]({}, fremd)
  wahr("H9 Gegenprobe: fremdes HTML bleibt", fremd.content.startsWith(fremdTeil) && ohneSchluessel(fremd.content), fremd.content)

  let quelle = null
  const neu = {
    _source: { name: "J", pages: [{ _id: "a", type: "text", text: { content: `<img src="${TOR}">` } }] },
    updateSource(d) { quelle = d },
  }
  hakenListe.preCreateJournalEntry[0](neu)
  wahr("H9 Anlegen Journal: updateSource mit _id", quelle?.pages?.[0]?._id === "a" && ohneSchluessel(JSON.stringify(quelle)),
    JSON.stringify(quelle))

  einstellungen[SETTING.key] = ""
  const ohne = { content: `<img src="${TOR}">` }
  hakenListe.preUpdateChatMessage[0]({}, ohne)
  wahr("H9 ohne Schluessel: Netz tut nichts", ohne.content === `<img src="${TOR}">`)
  einstellungen[SETTING.key] = KEY
}

console.log("H10 Altseiten-Lauf")
{
  const geschrieben = []
  const seite = (id, typ, felder) => ({ _id: id, type: typ, ...felder })
  function dokument(art, quelle, eingebettet = {}) {
    return {
      constructor: { metadata: { embedded: eingebettet } },
      toObject: () => JSON.parse(JSON.stringify(quelle)),
      async update(d) { geschrieben.push([art, "update", d]); zusammenfuehren(quelle, d) },
      async updateEmbeddedDocuments(klasse, teile) {
        geschrieben.push([art, klasse, teile])
        const feld = eingebettet[klasse]
        for (const t of teile) zusammenfuehren(quelle[feld].find((e) => e._id === t._id), t)
      },
    }
  }
  function zusammenfuehren(ziel, teil) {
    for (const [k, v] of Object.entries(teil)) {
      if (v && typeof v === "object" && !Array.isArray(v) && ziel[k] && typeof ziel[k] === "object") zusammenfuehren(ziel[k], v)
      else ziel[k] = v
    }
  }
  const journalQuelle = { name: "J", pages: [seite("p1", "text", { text: { content: `<img src="${TOR}">` } }),
    seite("p2", "image", { src: TOR }), seite("p3", "text", { text: { content: "<p>x</p>" } })] }
  const actorQuelle = { name: "A", img: FREI, system: { details: { biography: { value: `<img src="${TOR}">` } } },
    items: [{ _id: "i1", system: { description: { value: `<img src="${TOR}">` } } }] }
  game.journal = [dokument("JournalEntry", journalQuelle, { JournalEntryPage: "pages" })]
  game.actors = [dokument("Actor", actorQuelle, { Item: "items", ActiveEffect: "effects" })]
  game.items = []

  const trocken = await altseitenUmstellen({ trocken: true })
  wahr("H10 trocken: 2 Dokumente, 4 Adressen", trocken.dokumente === 2 && trocken.adressen === 4, JSON.stringify(trocken))
  wahr("H10 trocken: nichts geschrieben", geschrieben.length === 0)

  const lauf = await altseitenUmstellen()
  wahr("H10 Lauf: 2 Dokumente, 4 Adressen, 0 Fehler", lauf.dokumente === 2 && lauf.adressen === 4 && lauf.fehler === 0, JSON.stringify(lauf))
  wahr("H10 Journal: nur Seiten p1 und p2", geschrieben.find((g) => g[1] === "JournalEntryPage")?.[2].map((t) => t._id).join() === "p1,p2")
  wahr("H10 Journal: kein update am Eintrag selbst", !geschrieben.some((g) => g[0] === "JournalEntry" && g[1] === "update"))
  const au = geschrieben.find((g) => g[0] === "Actor" && g[1] === "update")?.[2]
  wahr("H10 Actor: nur die Biografie", au && Object.keys(au).join() === "system" && !("img" in au) && !("items" in au), JSON.stringify(au))
  wahr("H10 Actor: Gegenstand eingebettet", geschrieben.some((g) => g[1] === "Item" && g[2][0]._id === "i1"))
  wahr("H10 Schluessel aus allen Quellen weg", ohneSchluessel(JSON.stringify([journalQuelle, actorQuelle])))

  const vorherZahl = geschrieben.length
  const zweiter = await altseitenUmstellen()
  wahr("H10 zweiter Lauf schreibt nichts", zweiter.dokumente === 0 && geschrieben.length === vorherZahl)

  journalQuelle.pages[0].text.content = `<img src="${TOR}">`
  game.user.isGM = false
  const spieler = await altseitenUmstellen()
  wahr("H10 als Spieler: nichts", spieler.dokumente === 0 && geschrieben.length === vorherZahl)
  game.user.isGM = true
  einstellungen[SETTING.key] = ""
  const ohne = await altseitenUmstellen()
  wahr("H10 ohne Schluessel: nichts", ohne.dokumente === 0 && geschrieben.length === vorherZahl)
  einstellungen[SETTING.key] = KEY

  const fehlerhaft = { constructor: {}, toObject() { throw new Error("kaputt") } }
  game.journal = [fehlerhaft, dokument("JournalEntry", journalQuelle, { JournalEntryPage: "pages" })]
  const tapfer = await altseitenUmstellen()
  wahr("H10 ein kaputtes Dokument haelt die anderen nicht auf", tapfer.fehler === 1 && tapfer.dokumente === 1, JSON.stringify(tapfer))
}

console.log("H14 Nachpruefung 17.11.2026")
{
  // Befund 1: eine Bildseite in einem neuen Journal hat noch keine _id. Sie ist
  // trotzdem ein Element der eingebetteten Sammlung und wird frei.
  const neuJ = htmlAenderung({ name: "J", pages: [{ type: "image", src: TOR }, { type: "text", text: { content: "x" } }] }).aenderung
  wahr("H14 Anlegen Journal ohne Seiten-_id: Bildseite frei", neuJ?.pages?.[0]?.src === FREI && ohneSchluessel(JSON.stringify(neuJ)),
    JSON.stringify(neuJ))
  let quelle = null
  hakenListe.preCreateJournalEntry[0]({ _source: { name: "J", pages: [{ type: "image", src: TOR }] }, updateSource(d) { quelle = d } })
  wahr("H14 preCreateJournalEntry ohne Seiten-_id: updateSource ohne Schluessel", quelle?.pages?.[0]?.src === FREI, JSON.stringify(quelle))
  // Befund 2: Einfuegen des src und Entfernen des srcset beginnen an derselben Stelle.
  const gleich = htmlSchluesselfrei(`<img srcset="${TOR} 2x" data-beneos-src="${FREI}">`).html
  wahr("H14 srcset direkt hinter <img ohne src: Tag heil, Schluessel weg",
    gleich === `<img src="${SRC_A}" data-beneos-src="${FREI}">`, gleich)
}

console.log("H15 Auflage 1: der Schreiblauf aendert nur Bildadressen")
{
  const { nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const alt = `<p>a</p><img width="600" src="${TOR}" class="x"><p>b</p>`
  const neu = htmlSchluesselfrei(alt).html
  wahr("H15 echte Wandlung gilt", nurBildadressenGetauscht(alt, neu) === true, neu)
  wahr("H15 ein Textzeichen anders: abgelehnt", nurBildadressenGetauscht(alt, neu.replace("<p>a</p>", "<p>c</p>")) === false)
  wahr("H15 ein anderes Attribut anders: abgelehnt", nurBildadressenGetauscht(alt, neu.replace('class="x"', 'class="y"')) === false)
  // Beide Werte gleich vergiftet, damit nur die Pruefung des Wertes greift.
  wahr("H15 data-beneos-src mit Toradresse: abgelehnt", nurBildadressenGetauscht(alt, neu.split(FREI).join(TOR)) === false)
  // src direkt hinter <img: das zusaetzliche Leerzeichen steht genau dort, wo
  // die Pruefung die Adresse herausnimmt.
  const kurz = `<img src="${TOR}">`
  wahr("H15 Leerzeichen im Tag dazu: abgelehnt",
    nurBildadressenGetauscht(kurz, htmlSchluesselfrei(kurz).html.replace("<img", "<img ")) === false)
  const zeile = `<img\nsrc="${TOR}"\nwidth="3">`
  wahr("H15 Zeilenumbruch vor src bleibt gueltig", nurBildadressenGetauscht(zeile, htmlSchluesselfrei(zeile).html) === true,
    htmlSchluesselfrei(zeile).html)
  wahr("H15 src ohne Fragment der freien Adresse: abgelehnt", nurBildadressenGetauscht(alt, neu.replace(SRC_A, PLATZHALTER_BILD)) === false)
  const heil = `<img data-beneos-src="${FREI}" width="5">`
  wahr("H15 Heilung ohne src gilt", nurBildadressenGetauscht(heil, htmlSchluesselfrei(heil).html) === true)
  const satz = `<img src="${TOR}" srcset="${TOR} 2x">`
  wahr("H15 entferntes srcset: abgelehnt", nurBildadressenGetauscht(satz, htmlSchluesselfrei(satz).html) === false)

  // Im Lauf: die Seite mit srcset wird nicht geschrieben, als Fehler gezaehlt
  // und mit ihrer Kennung gemeldet; die anderen Seiten gehen.
  const geschrieben = []
  const q = { name: "J", pages: [
    { _id: "s1", type: "text", text: { content: `<img src="${TOR}">` } },
    { _id: "s2", type: "text", text: { content: satz } },
    { _id: "s3", type: "image", src: TOR }] }
  game.journal = [{
    id: "jAuflage", documentName: "JournalEntry",
    constructor: { metadata: { embedded: { JournalEntryPage: "pages" } } },
    toObject: () => JSON.parse(JSON.stringify(q)),
    async update(d) { geschrieben.push(["update", d]) },
    async updateEmbeddedDocuments(k, teile) { geschrieben.push([k, teile]) },
  }]
  // Ein eigenes Feld eines Dokuments, das abweicht, geht ebenso nicht hinaus.
  game.actors = [{
    id: "aAuflage", documentName: "Actor", constructor: { metadata: { embedded: {} } },
    toObject: () => ({ name: "A", system: { bio: satz } }),
    async update(d) { geschrieben.push(["actor", d]) },
  }]
  game.items = []
  const warnungen = []
  const urWarn = console.warn
  console.warn = (...a) => { warnungen.push(a.map(String).join(" ")) }
  let lauf
  try { lauf = await altseitenUmstellen() } finally { console.warn = urWarn }
  const teile = geschrieben.find((g) => g[0] === "JournalEntryPage")?.[1] ?? []
  wahr("H15 Lauf: Seite mit srcset nicht geschrieben", teile.map((t) => t._id).join() === "s1,s3", JSON.stringify(teile.map((t) => t._id)))
  wahr("H15 Lauf: eigenes Feld mit srcset nicht geschrieben", !geschrieben.some((g) => g[0] === "actor"))
  wahr("H15 Lauf: zwei Fehler gezaehlt", lauf?.fehler === 2 && lauf?.dokumente === 1, JSON.stringify(lauf))
  wahr("H15 Lauf: Meldung nennt die Kennungen, ohne Schluessel",
    warnungen.some((w) => w.includes("jAuflage") && w.includes("s2")) && warnungen.some((w) => w.includes("aAuflage"))
    && ohneSchluessel(warnungen.join()), warnungen.join(" | "))
  const trocken = await altseitenUmstellen({ trocken: true })
  wahr("H15 trocken: dieselben Fehler, nichts geschrieben", trocken.fehler === 2 && geschrieben.length === 1, JSON.stringify(trocken))
}

console.log("H16 Fremde Flags bleiben ausserhalb des Netzes (stre-T-128, Kalt-Review W1)")
{
  // Unter `flags.<fremd>` steht die Toradresse mit Schluessel, weil ein
  // fremdes Modul sein HTML ohne unser Netz anzeigt. Weder Schreibnetz noch
  // Altseiten-Lauf duerfen sie dort in Form (a) wandeln.
  const roh = `<img src="${TOR}">`
  const MID = "beneos-module"
  const flach = { "flags.monks-active-tiles.notiz": roh, "prototypeToken.flags.monks-active-tiles.notiz": roh }
  hakenListe.preUpdateActor[0]({}, flach)
  wahr("H16 Update mit Punktpfad: fremdes Flag bleibt", flach["flags.monks-active-tiles.notiz"] === roh
    && flach["prototypeToken.flags.monks-active-tiles.notiz"] === roh, JSON.stringify(flach))
  const halb = { "prototypeToken.flags": { "monks-active-tiles": { notiz: roh } } }
  hakenListe.preUpdateActor[0]({}, halb)
  wahr("H16 Update mit Punktpfad bis flags: fremdes Flag bleibt", halb["prototypeToken.flags"]["monks-active-tiles"].notiz === roh,
    JSON.stringify(halb))
  wahr("H16 Aenderung mit Punktpfad: fremdes Flag bleibt",
    htmlAenderung({ "flags.monks-active-tiles.notiz": roh }).aenderung === null)
  const verschachtelt = { flags: { "monks-active-tiles": { notiz: roh }, [MID]: { notiz: roh } },
    prototypeToken: { flags: { "monks-active-tiles": { notiz: roh } } } }
  hakenListe.preUpdateActor[0]({}, verschachtelt)
  wahr("H16 Update verschachtelt: fremdes Flag bleibt", verschachtelt.flags["monks-active-tiles"].notiz === roh
    && verschachtelt.prototypeToken.flags["monks-active-tiles"].notiz === roh, JSON.stringify(verschachtelt))
  wahr("H16 Gegenprobe Update: das eigene Flag wird Form (a)", ohneSchluessel(verschachtelt.flags[MID].notiz))
  // Steht der eigene Namensraum selbst als Text da, ersetzt die Wandlung den
  // Wert in der Huelle; erst das Zurueckschreiben bringt ihn ins Update.
  const eigenText = { flags: { [MID]: roh } }
  hakenListe.preUpdateActor[0]({}, eigenText)
  wahr("H16 Gegenprobe Update: ein eigenes Flag als Text wird Form (a)", ohneSchluessel(eigenText.flags[MID]),
    JSON.stringify(eigenText))
  const eigenFlach = { [`flags.${MID}.notiz`]: roh }
  hakenListe.preUpdateActor[0]({}, eigenFlach)
  wahr("H16 Gegenprobe Update mit Punktpfad: das eigene Flag wird Form (a)", ohneSchluessel(eigenFlach[`flags.${MID}.notiz`]))

  const tief = htmlAenderung({ flags: { "monks-active-tiles": { teil: { flags: { [MID]: { notiz: roh } } } } } }).aenderung
  wahr("H16 unter einem fremden Flag bleibt auch ein tieferes eigenes Flag unberuehrt", tief === null, JSON.stringify(tief))

  let quelle = null
  const neu = {
    _source: { name: "A", flags: { "monks-active-tiles": { notiz: roh } }, system: { bio: roh } },
    updateSource(d) { quelle = d },
  }
  hakenListe.preCreateActor[0](neu)
  wahr("H16 Anlegen: nur das eigene Feld wird gewandelt", JSON.stringify(Object.keys(quelle ?? {})) === '["system"]',
    JSON.stringify(quelle))

  const geschrieben = []
  game.journal = []
  game.items = []
  game.actors = [{
    documentName: "Actor", id: "aFremd",
    constructor: { metadata: { embedded: { Item: "items" } } },
    toObject: () => ({ name: "A", flags: { "monks-active-tiles": { notiz: roh } },
      items: [{ _id: "i1", flags: { "monks-active-tiles": { notiz: roh } } }] }),
    async update(d) { geschrieben.push(["update", d]) },
    async updateEmbeddedDocuments(k, t) { geschrieben.push([k, t]) },
  }]
  const lauf = await altseitenUmstellen()
  wahr("H16 Altseiten: fremde Flags werden nicht geschrieben", geschrieben.length === 0 && lauf.dokumente === 0,
    JSON.stringify({ geschrieben, lauf }))
  game.actors = []
}

console.log("H17 Textnetz (stre-T-142 B2): Toradressen ausserhalb von <img>")
{
  const { textSchluesselfrei, nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const MASKE = TOR.replace(`/a/${KEY}/`, "/a/-/")
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w }
  wahr("H17 Vorbedingung: die Maske traegt kein Schluesselstueck", MASKE !== TOR && ohneSchluessel(MASKE), MASKE)
  wahr("H17 die Stufe gibt es", typeof textSchluesselfrei === "function")

  // href: die Maske, die freie Form daneben, der Linktext bleibt.
  const link = tief({ content: `<p>Siehe <a href="${TOR}" class="k">Karte</a></p>` }).content
  wahr("H17 href: Schluessel weg", ohneSchluessel(link), link)
  wahr("H17 href ist die Maske", link.includes(`href="${MASKE}"`), link)
  wahr("H17 data-beneos-href traegt die freie Form", link.includes(`data-beneos-href="${FREI}"`), link)
  wahr("H17 class und Linktext bleiben", link.includes('class="k"') && link.includes(">Karte</a></p>"), link)
  wahr("H17 href: zweiter Lauf bytegleich", tief({ content: link }).content === link)

  // Textknoten und reiner Text: rundlaufend wird es beneos://, sonst die Maske.
  const text = tief({ content: `<p>Link: ${TOR} Ende</p>` }).content
  wahr("H17 Textknoten: die freie Form", text === `<p>Link: ${FREI} Ende</p>`, text)
  const notiz = tief({ notiz: `siehe ${TOR} dort` }).notiz
  wahr("H17 reiner Text ohne HTML: die freie Form", notiz === `siehe ${FREI} dort`, notiz)
  const KAPUTT = `${GATE}/a/${KEY}/kaputt`
  const kaputt = tief({ content: `<p>x ${KAPUTT} y</p>` }).content
  wahr("H17 nicht rundlaufend: die Maske", kaputt === `<p>x ${GATE}/a/-/kaputt y</p>`, kaputt)

  // Was bleibt.
  const fremdLink = `<a href="https://example.com/a/${KEY}/x/4k/y.webp">f</a>`
  const mitNachbar = tief({ content: `${fremdLink} ${TOR}` }).content
  wahr("H17 fremder Host in href: bytegleich", mitNachbar.startsWith(fremdLink), mitNachbar)
  // Bis stre-T-147 blieb hier die Toradresse mit Schluessel stehen.
  const video = `<p>v</p><video src="${TOR}"></video>`
  const videoNeu = tief({ content: video }).content
  wahr("H17 video src: Form (m), kein Schluessel", ohneSchluessel(videoNeu)
    && videoNeu.includes(`data-beneos-src="${FREI}"`), videoNeu)
  wahr("H17 ganzer Wert bleibt bei der Feldliste", tief({ src: TOR }).src === TOR)
  const fremdFlag = { flags: { "monks-active-tiles": { notiz: `<p>${TOR}</p>` } } }
  wahr("H17 fremdes Flag bleibt", JSON.stringify(tief(fremdFlag)) === JSON.stringify(fremdFlag))
  const ohneTor = { content: "<p>Siehe <a href=\"https://example.com\">x</a> und gate.beneos.stream</p>" }
  wahr("H17 Zwei-Werte-Probe: Text ohne Toradresse bytegleich", JSON.stringify(tief(ohneTor)) === JSON.stringify(ohneTor))
  einstellungen[SETTING.key] = ""
  const ohneK = { content: `<p><a href="${TOR}">x</a> ${TOR}</p>` }
  wahr("H17 ohne Schluessel: nichts geaendert", JSON.stringify(tief(ohneK)) === JSON.stringify(ohneK))
  einstellungen[SETTING.key] = KEY

  // Anlegen und Aendern ueber das Schreibnetz.
  let quelle = null
  hakenListe.preCreateJournalEntryPage[0]({ _source: { name: "S", type: "text", text: { content: `<p><a href="${TOR}">x</a></p>` } },
    updateSource(d) { quelle = d } })
  wahr("H17 Anlegen: href gewandelt", ohneSchluessel(JSON.stringify(quelle)) && JSON.stringify(quelle).includes("data-beneos-href"),
    JSON.stringify(quelle))
  const aend = { "text.content": `<p>${TOR}</p>` }
  hakenListe.preUpdateJournalEntryPage[0]({}, aend)
  wahr("H17 Aendern: Textknoten gewandelt", aend["text.content"] === `<p>${FREI}</p>`, aend["text.content"])

  // Altseiten: nur Adressen getauscht, sonst abgewiesen.
  const alt = `<p>a <a href="${TOR}">x</a> ${TOR} b</p><img src="${TOR}">`
  const neu = tief({ c: alt }).c
  wahr("H17 Altseiten-Pruefung: Text und href getauscht gilt", nurBildadressenGetauscht(alt, neu) === true, neu)
  wahr("H17 Altseiten-Pruefung: ein Textzeichen anders: abgelehnt", nurBildadressenGetauscht(alt, neu.replace(" b</p>", " c</p>")) === false)
  wahr("H17 Altseiten-Pruefung: Schluessel im href: abgelehnt", nurBildadressenGetauscht(alt, neu.replace(`href="${MASKE}"`, `href="${TOR}"`)) === false)
  wahr("H17 Altseiten-Pruefung: href mit beneos://: abgelehnt, die Bereinigung verwuerfe den Link",
    nurBildadressenGetauscht(alt, neu.replace(`href="${MASKE}"`, `href="${FREI}"`)) === false)
  wahr("H17 Altseiten-Pruefung: data-beneos-href mit Toradresse: abgelehnt",
    nurBildadressenGetauscht(alt, neu.replace(`data-beneos-href="${FREI}"`, `data-beneos-href="${TOR}"`)) === false)
  const geschrieben = []
  const seiteQ = { _id: "t1", type: "text", text: { content: alt } }
  game.journal = [{ documentName: "JournalEntry", id: "jText",
    constructor: { metadata: { embedded: { JournalEntryPage: "pages" } } },
    toObject: () => ({ name: "J", pages: [JSON.parse(JSON.stringify(seiteQ))] }),
    async update(d) { geschrieben.push(["update", d]) },
    async updateEmbeddedDocuments(k, t) { geschrieben.push([k, t]) } }]
  game.actors = []
  game.items = []
  const lauf = await altseitenUmstellen()
  wahr("H17 Altseiten-Lauf: die Seite wird geschrieben, ohne Schluessel",
    lauf.dokumente === 1 && lauf.fehler === 0 && geschrieben.length === 1 && ohneSchluessel(JSON.stringify(geschrieben)),
    JSON.stringify({ lauf, geschrieben }))
  game.journal = []
}

console.log("H18 Kalt-Review stre-T-142: ganzer Textwert, Tags ohne Anzeigeweg, Altseiten-Gegenprobe")
{
  const { nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const MASKE = TOR.replace(`/a/${KEY}/`, "/a/-/")
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w }

  // K1: ein Textfeld, das nur die Toradresse traegt, etwa ein Chat mit einem Link.
  wahr("H18 Chat content nur die Toradresse: die freie Form", tief({ content: TOR }).content === FREI, tief({ content: TOR }).content)
  wahr("H18 Seitentext nur die Toradresse: die freie Form", tief({ text: { content: TOR } }).text.content === FREI)
  wahr("H18 flacher Pfad text.content nur die Toradresse: die freie Form", tief({ "text.content": TOR })["text.content"] === FREI)
  wahr("H18 flavor nur die Toradresse: die freie Form", tief({ flavor: ` ${TOR} ` }).flavor === ` ${FREI} `)
  const aend = htmlAenderung({ content: TOR })
  wahr("H18 Aenderung: content nur die Toradresse wird frei", aend.aenderung?.content === FREI, JSON.stringify(aend))
  wahr("H18 Zwei-Werte-Probe: img nur die Toradresse bleibt", tief({ img: TOR }).img === TOR)
  wahr("H18 Zwei-Werte-Probe: Aenderung an img nur die Toradresse: keine", htmlAenderung({ img: TOR }).aenderung === null)

  // W3: Tags ohne Anzeigeweg fuer beneos:// bleiben, der Text daneben nicht.
  const stil = `<div style="background:url(${TOR})">x</div>`
  wahr("H18 style url() bleibt (kein Anzeigeweg)", tief({ content: stil }).content === stil, tief({ content: stil }).content)
  const rahmen = `<iframe src="${TOR}"></iframe>`
  wahr("H18 iframe src bleibt (kein Anzeigeweg)", tief({ content: rahmen }).content === rahmen)
  const gemischt = tief({ content: `${stil}<p>${TOR}</p>` }).content
  wahr("H18 Zwei-Werte-Probe: Textknoten neben dem div wird frei", gemischt === `${stil}<p>${FREI}</p>`, gemischt)
  wahr("H18 Altseiten-Pruefung: style bleibt, Text frei: gilt", nurBildadressenGetauscht(`${stil}<p>${TOR}</p>`, gemischt) === true)

  // W5: die Gegenprobe nimmt nur die eigenen Adressen aus.
  const FREMD = `https://example.com/a/${KEY}/x/4k/y.webp`
  wahr("H18 Altseiten-Pruefung: fremder Link geaendert: abgelehnt",
    nurBildadressenGetauscht(`<p><a href="${FREMD}">x</a></p>`, `<p><a href="${FREMD}z">x</a></p>`) === false)
  wahr("H18 Altseiten-Pruefung: href entfernt: abgelehnt",
    nurBildadressenGetauscht(`<p><a href="${TOR}">x</a></p>`, `<p><a data-beneos-href="${FREI}">x</a></p>`) === false)
  wahr("H18 Altseiten-Pruefung: fremde Raumadresse im Text geaendert: abgelehnt",
    nurBildadressenGetauscht(`<p>${FREMD}</p>`, `<p>${FREMD}z</p>`) === false)
  wahr("H18 Zwei-Werte-Probe: eigener Link gewandelt: gilt",
    nurBildadressenGetauscht(`<p><a href="${TOR}">x</a></p>`, `<p><a href="${MASKE}" data-beneos-href="${FREI}">x</a></p>`) === true)
}

console.log("H19 Nachpruefung stre-T-142: jedes andere Tag, Textfelder, Listen, Linkziel")
{
  const { nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const MASKE = TOR.replace(`/a/${KEY}/`, "/a/-/")
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w }
  const inhalt = (html) => tief({ content: html }).content
  const ohneKey = (s) => !String(s).includes(KEY)
  wahr("H19 p title: frei", inhalt(`<p title="${TOR}">x</p>`) === `<p title="${FREI}">x</p>`)
  wahr("H19 span data-tooltip: frei", inhalt(`<span data-tooltip="${TOR}">x</span>`) === `<span data-tooltip="${FREI}">x</span>`)
  const zitat = inhalt(`<blockquote cite="${TOR}">x</blockquote>`)
  wahr("H19 blockquote cite: Schluessel weg", ohneKey(zitat), zitat)
  wahr("H19 blockquote cite: nicht beneos:", zitat === `<blockquote cite="${MASKE}">x</blockquote>`, zitat)
  const flaeche = inhalt(`<map><area href="${TOR}"></map>`)
  wahr("H19 area: Maske und data-beneos-href", flaeche === `<map><area href="${MASKE}" data-beneos-href="${FREI}"></map>`, flaeche)
  wahr("H19 Kommentar: frei", inhalt(`<!-- ${TOR} --><p>x</p>`) === `<!-- ${FREI} --><p>x</p>`)
  wahr("H19 Markdown-Autolink: frei", tief({ text: { markdown: `siehe <${TOR}>` } }).text.markdown === `siehe <${FREI}>`)
  const linkStil = `<a href="${TOR}" style="background:url(${TOR})">x</a>`
  wahr("H19 a style url() bleibt", inhalt(linkStil).includes(`style="background:url(${TOR})"`), inhalt(linkStil))
  wahr("H19 Zwei-Werte-Probe: a mit style, href maskiert", inhalt(linkStil).includes(`href="${MASKE}"`))
  wahr("H19 text.markdown nur die Toradresse: frei", tief({ text: { markdown: TOR } }).text.markdown === FREI)
  wahr("H19 image.caption nur die Toradresse: frei", tief({ image: { caption: TOR } }).image.caption === FREI)
  wahr("H19 biography.public nur die Toradresse: frei", tief({ system: { details: { biography: { public: TOR } } } }).system.details.biography.public === FREI)
  wahr("H19 Liste notes Aendern: frei", tief({ notes: [TOR] }).notes[0] === FREI)
  wahr("H19 Liste notes Anlegen: frei", htmlAenderung({ notes: [TOR] }).aenderung?.notes?.[0] === FREI)
  wahr("H19 Zwei-Werte-Probe: Liste unter Bildnamen bleibt", tief({ img: [TOR] }).img[0] === TOR)
  // Ein Systemfeld `value` kann ein Bild- oder Klangpfad sein und hat keinen Anzeigeweg.
  wahr("H19 system value nur die Toradresse bleibt (kein Anzeigeweg)",
    tief({ system: { klang: { value: TOR } } }).system.klang.value === TOR, tief({ system: { klang: { value: TOR } } }).system.klang.value)
  wahr("H19 Zwei-Werte-Probe: description.value mit Text um die Toradresse wird frei",
    tief({ system: { description: { value: `<p>${TOR}</p>` } } }).system.description.value === `<p>${FREI}</p>`)
  const FREMD = `https://example.com/a/${KEY}/x/4k/y.webp`
  wahr("H19 Altseiten-Pruefung: fremder Link bekommt data-beneos-href: abgelehnt",
    nurBildadressenGetauscht(`<p><a href="${FREMD}">x</a></p>`, `<p><a href="${FREMD}" data-beneos-href="${FREI}">x</a></p>`) === false)
  wahr("H19 Altseiten-Pruefung: data-beneos-href umgeschrieben: abgelehnt",
    nurBildadressenGetauscht(`<p><a href="${TOR}">x</a></p>`, `<p><a href="${MASKE}" data-beneos-href="${FREI.replace(/\.webp$/, "-z.webp")}">x</a></p>`) === false)
  const titelAlt = `<p title="${TOR}">${TOR}</p>`
  wahr("H19 Altseiten-Pruefung: title und Text: gilt", nurBildadressenGetauscht(titelAlt, inhalt(titelAlt)) === true, inhalt(titelAlt))
  wahr("H19 Altseiten-Pruefung: title fremd geaendert: abgelehnt",
    nurBildadressenGetauscht(`<p title="${FREMD}">x</p>`, `<p title="${FREMD}z">x</p>`) === false)
  const kommentarAlt = `<!-- ${TOR} --><p>${TOR}</p>`
  wahr("H19 Altseiten-Pruefung: Kommentar und Text: gilt", nurBildadressenGetauscht(kommentarAlt, inhalt(kommentarAlt)) === true, inhalt(kommentarAlt))
  wahr("H19 Altseiten-Pruefung: Schluessel im Kommentar stehen: abgelehnt",
    nurBildadressenGetauscht(kommentarAlt, `<!-- ${TOR} --><p>${FREI}</p>`) === false)
}
console.log("H20 stre-T-147: video, audio, source im HTML bekommen Form (m)")
{
  const { nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const { maskiere } = await import("./stream-tormaske.mjs")
  const MASKE = maskiere(TOR)
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w }
  const formM = (tag, rest = "") => `<${tag} src="${MASKE}" data-beneos-src="${FREI}"${rest}>`
  wahr("H20 Maske traegt keinen Schluessel", ohneSchluessel(MASKE) && MASKE !== TOR, MASKE)
  for (const tag of ["video", "audio"]) {
    const roh = `<${tag} src="${TOR}" controls></${tag}>`
    const soll = `${formM(tag, " controls")}</${tag}>`
    const anlegen = JSON.stringify(htmlAenderung({ text: { content: roh } }).aenderung ?? {})
    wahr(`H20 ${tag} Anlegen: Form (m)`, anlegen.includes(JSON.stringify(soll).slice(1, -1)), anlegen)
    wahr(`H20 ${tag} Update: Form (m)`, tief({ content: roh }).content === soll, tief({ content: roh }).content)
    wahr(`H20 ${tag} Altseiten-Pruefung: gilt`, nurBildadressenGetauscht(roh, soll) === true)
  }
  const quelle = `<video controls><source src="${TOR}" type="video/webm"></video>`
  wahr("H20 source: Form (m)", tief({ content: quelle }).content
    === `<video controls>${formM("source", ' type="video/webm"')}</video>`, tief({ content: quelle }).content)
  // Zwei-Werte-Probe: diese drei duerfen sich nicht aendern.
  const fremdVideo = `<video src="https://example.com/a/${KEY}/x/4k/y.webm"></video>`
  // Neben einer eigenen Adresse, sonst nimmt der Vorfilter den Text gar nicht erst.
  const nebenEigen = tief({ content: `<p>${TOR}</p>${fremdVideo}` }).content
  wahr("H20 Zwei-Werte-Probe: fremdes Video bleibt bytegleich",
    nebenEigen.endsWith(`</p>${fremdVideo}`) && ohneSchluessel(nebenEigen.replace(fremdVideo, "")), nebenEigen)
  const rahmen = `<iframe src="${TOR}"></iframe>`
  wahr("H20 Zwei-Werte-Probe: iframe bleibt bytegleich", tief({ content: rahmen }).content === rahmen)
  einstellungen[SETTING.key] = ""
  const ohne = `<video src="${TOR}"></video>`
  wahr("H20 Zwei-Werte-Probe: ohne Schluessel bleibt das Video wie bisher", tief({ content: ohne }).content === ohne)
  einstellungen[SETTING.key] = KEY
  // Die Gegenprobe: freie Form, die nicht zur Maske passt, ist abgelehnt.
  const falsch = `<video src="${MASKE}" data-beneos-src="beneos://anders/x.webm"></video>`
  wahr("H20 Altseiten-Pruefung: fremdes data-beneos-src: abgelehnt",
    nurBildadressenGetauscht(`<video src="${TOR}"></video>`, falsch) === false)
  wahr("H20 Altseiten-Pruefung: altes Video ohne Form (m) bleibt zulaessig",
    nurBildadressenGetauscht(`<video src="${TOR}"></video>`, `<video src="${TOR}"></video>`) === true)
}
console.log("H21 stre-T-147 Kalt-Review: poster, Fragment, Waechter ohne freie Form, nurGeaenderte")
{
  const { nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const { maskiere } = await import("./stream-tormaske.mjs")
  const MASKE = maskiere(TOR)
  const VPFAD = PFAD.replace(/\.webp$/, ".webm")
  const VTOR = assetUrl(REL, "4k", VPFAD)
  const VFREI = platzhalterAdresse(REL, "4k", VPFAD)
  const VMASKE = maskiere(VTOR)
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w }
  // F1: poster geht denselben Weg wie src, Maske plus data-beneos-poster.
  const mitPoster = `<video src="${VTOR}" poster="${TOR}" controls></video>`
  const posterNeu = tief({ content: mitPoster }).content
  wahr("H21 poster: kein Schluessel", ohneSchluessel(posterNeu), posterNeu)
  wahr("H21 poster: Maske und data-beneos-poster", posterNeu.includes(`poster="${MASKE}"`) && posterNeu.includes(`data-beneos-poster="${FREI}"`), posterNeu)
  wahr("H21 poster: Altseiten-Pruefung auf eigene Wandlerausgabe: gilt", nurBildadressenGetauscht(mitPoster, posterNeu) === true, posterNeu)
  wahr("H21 poster: fremdes data-beneos-poster: abgelehnt",
    nurBildadressenGetauscht(mitPoster, posterNeu.replace(`data-beneos-poster="${FREI}"`, 'data-beneos-poster="beneos://anders/x.webp"')) === false)
  // F2: ein Medienfragment bleibt an der Maske und besteht die Pruefung.
  const fragment = `<video src="${VTOR}#t=10"></video>`
  const fragmentNeu = tief({ content: fragment }).content
  wahr("H21 Fragment: Maske behaelt #t=10, kein Schluessel",
    fragmentNeu.includes(`src="${VMASKE}#t=10"`) && ohneSchluessel(fragmentNeu), fragmentNeu)
  wahr("H21 Fragment: Altseiten-Pruefung auf eigene Wandlerausgabe: gilt", nurBildadressenGetauscht(fragment, fragmentNeu) === true, fragmentNeu)
  wahr("H21 Fragment: andere Maske vor dem Fragment: abgelehnt",
    nurBildadressenGetauscht(fragment, fragmentNeu.replace(".webm#t=10", "-z.webm#t=10")) === false)
  // F3: ein Medium ohne freie Form darf weder Maske noch beneos:// noch fremd werden.
  const altVideo = `<video src="${VTOR}"></video>`
  wahr("H21 Waechter: Maske ohne data-beneos-src: abgelehnt", nurBildadressenGetauscht(altVideo, `<video src="${VMASKE}"></video>`) === false)
  wahr("H21 Waechter: src beneos:// ohne data-beneos-src: abgelehnt", nurBildadressenGetauscht(altVideo, `<video src="${VFREI}"></video>`) === false)
  wahr("H21 Waechter: src fremd umgeleitet: abgelehnt", nurBildadressenGetauscht(altVideo, '<video src="https://example.com/x.webm"></video>') === false)
  // F5: ein getauschtes Video haelt die Heilung der Bilder nicht auf.
  const getauscht = `<p><img src="${TOR}"></p><video src="https://example.com/eigen.webm" data-beneos-src="${VFREI}"></video>`
  const geheilt = htmlSchluesselfrei(getauscht).html
  wahr("H21 nurGeaenderte: unveraendertes getauschtes Video haelt die Seite nicht auf",
    geheilt !== getauscht && nurBildadressenGetauscht(getauscht, geheilt, { nurGeaenderte: true }) === true, geheilt)
  wahr("H21 nurGeaenderte Zwei-Werte-Probe: streng bleibt das getauschte Video abgelehnt",
    nurBildadressenGetauscht(getauscht, geheilt) === false)
}
console.log("H22 stre-T-148: srcset an Medientags in Form (m), je Eintrag")
{
  const { nurBildadressenGetauscht, textSchluesselfrei } = await import("./stream-html.mjs")
  const { maskiere } = await import("./stream-tormaske.mjs")
  const PFAD2 = PFAD.replace(/\.webp$/, "-2x.webp")
  const TOR2 = assetUrl(REL, "4k", PFAD2)
  const FREI2 = platzhalterAdresse(REL, "4k", PFAD2)
  const M1 = maskiere(TOR)
  const M2 = maskiere(TOR2)
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w }
  const bild = '<img src="https://example.com/a.png">'
  const pic = "<picture><source srcset=\"" + TOR + " 1x, " + TOR2 + " 2x\" type=\"image/webp\">" + bild + "</picture>"
  const neu = tief({ content: pic }).content
  wahr("H22 picture source srcset: kein Schluessel nach preUpdate", ohneSchluessel(neu), neu)
  wahr("H22 srcset: Maske je Eintrag, Deskriptor bleibt", neu.includes("srcset=\"" + M1 + " 1x, " + M2 + " 2x\""), neu)
  wahr("H22 data-beneos-srcset: freie Form je Eintrag", neu.includes("data-beneos-srcset=\"" + FREI + " 1x, " + FREI2 + " 2x\""), neu)
  wahr("H22 Textnetz: kein Schluessel", ohneSchluessel(JSON.stringify(textSchluesselfrei(pic))))
  wahr("H22 zweiter Lauf aendert nichts", tief({ content: neu }).content === neu, neu)
  wahr("H22 Altseiten-Pruefung auf eigene Wandlerausgabe: gilt", nurBildadressenGetauscht(pic, neu) === true, neu)
  wahr("H22 fremde data-beneos-srcset: abgelehnt",
    nurBildadressenGetauscht(pic, neu.replace(FREI2 + " 2x", "beneos://anders/x.webp 2x")) === false)
  wahr("H22 Deskriptor in der freien Form verschoben: abgelehnt",
    nurBildadressenGetauscht(pic, neu.replace(FREI2 + " 2x", FREI2 + " 3x")) === false)
  wahr("H22 Eintrag fehlt in der freien Form: abgelehnt",
    nurBildadressenGetauscht(pic, neu.replace(", " + FREI2 + " 2x", "")) === false)
  const allein = "<picture><source srcset=\"" + TOR + " 1x\"></picture>"
  wahr("H22 Waechter: Maske ohne data-beneos-srcset: abgelehnt",
    nurBildadressenGetauscht(allein, "<picture><source srcset=\"" + M1 + " 1x\"></picture>") === false)
  wahr("H22 Waechter: srcset beneos:// ohne data-beneos-srcset: abgelehnt",
    nurBildadressenGetauscht(allein, "<picture><source srcset=\"" + FREI + " 1x\"></picture>") === false)
  const gemischt = "<picture><source srcset=\"https://example.com/a.png 1x, " + TOR + " 2x\"></picture>"
  const gemischtNeu = tief({ content: gemischt }).content
  wahr("H22 gemischt: fremder Eintrag bleibt in beiden Attributen",
    gemischtNeu.includes("srcset=\"https://example.com/a.png 1x, " + M1 + " 2x\"")
      && gemischtNeu.includes("data-beneos-srcset=\"https://example.com/a.png 1x, " + FREI + " 2x\"") && ohneSchluessel(gemischtNeu), gemischtNeu)
  wahr("H22 gemischt: Altseiten-Pruefung gilt", nurBildadressenGetauscht(gemischt, gemischtNeu) === true, gemischtNeu)
  wahr("H22 gemischt: fremder Eintrag umgeleitet: abgelehnt",
    nurBildadressenGetauscht(gemischt, gemischtNeu.replace("srcset=\"https://example.com/a.png", "srcset=\"https://example.com/b.png")) === false)
  wahr("H22 gemischt: fremder Eintrag nur in der freien Form umgeleitet: abgelehnt",
    nurBildadressenGetauscht(gemischt, gemischtNeu.replace("data-beneos-srcset=\"https://example.com/a.png", "data-beneos-srcset=\"https://example.com/b.png")) === false)
  // Zwei-Werte-Probe: mit Toradresse aendert sich srcset, ohne bleibt es bytegleich.
  const fremd = "<picture><source srcset=\"https://example.com/a.png 1x\"></picture>"
  wahr("H22 Zwei-Werte-Probe: srcset mit Toradresse aendert sich", neu !== pic)
  wahr("H22 Zwei-Werte-Probe: fremdes srcset bleibt bytegleich", tief({ content: fremd }).content === fremd)
}
console.log("H22b stre-T-148 Kalt-Review: nicht wandelbare Eintraege, Kandidatenregel, Schreibweise")
{
  const { nurBildadressenGetauscht, srcsetTeile } = await import("./stream-html.mjs")
  const { maskiere } = await import("./stream-tormaske.mjs")
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w.content }
  const q = JSON.stringify
  const PFAD2 = PFAD.replace(/\.webp$/, "-2x.webp")
  const TOR2 = assetUrl(REL, "4k", PFAD2)
  const ALT = TOR2.replace(/^https:\/\/[^/]+/, "https://old.beneos.stream")
  const KRE = TOR.replace(/^(https:\/\/[^/]+\/)[^/]+\/[^/]+\/.*$/, "$1a/" + KEY + "/beneos_ct_0001_x/4k/a.webp")
  wahr("H22b Vorbedingung: ALT und KRE tragen den Schluessel und lassen sich maskieren",
    !ohneSchluessel(ALT) && !ohneSchluessel(KRE) && maskiere(ALT) !== ALT && maskiere(KRE) !== KRE)
  const fall = (name, html) => {
    const neu = tief({ content: html })
    wahr("H22b " + name + ": kein Schluessel", ohneSchluessel(neu), neu)
    wahr("H22b " + name + ": Altseiten-Pruefung gilt", nurBildadressenGetauscht(html, neu) === true, neu)
    wahr("H22b " + name + ": zweiter Lauf aendert nichts", tief({ content: neu }) === neu, neu)
    return neu
  }
  const p1 = fall("fruehere Basis neben wandelbarem Eintrag", "<picture><source srcset=\"" + TOR + " 1x, " + ALT + " 2x\"></picture>")
  wahr("H22b fruehere Basis: data-beneos-srcset traegt fuer sie die Maske", p1.includes("data-beneos-srcset=\"" + FREI + " 1x, " + maskiere(ALT) + " 2x\""), p1)
  fall("Kreatur im a-Raum neben wandelbarem Eintrag", "<picture><source srcset=\"" + TOR + " 1x, " + KRE + " 2x\"></picture>")
  const p3 = fall("nur nicht wandelbare Eintraege", "<picture><source srcset=\"" + KRE + " 1x\"></picture>")
  wahr("H22b nur nicht wandelbare: srcset maskiert", p3.includes("srcset=\"" + maskiere(KRE) + " 1x\""), p3)
  const bildKre = tief({ content: "<img src=\"https://example.com/a.png\" srcset=\"" + KRE + " 1x\">" })
  wahr("H22b img srcset mit nicht wandelbarer Toradresse: Schluessel weg", ohneSchluessel(bildKre), bildKre)
  const DATA = "data:image/png;base64,iVBORw0KGgo="
  wahr("H22b srcsetTeile: data:-Adresse mit Komma bleibt ein Eintrag",
    q(srcsetTeile(DATA + " 1x, " + TOR + " 2x").map((t) => t.adresse)) === q([DATA, TOR]))
  wahr("H22b srcsetTeile: Komma am Adressende ohne Deskriptor trennt",
    q(srcsetTeile(TOR + ", " + TOR2 + " 2x").map((t) => [t.adresse, t.rest])) === q([[TOR, ""], [TOR2, "2x"]]))
  const p4 = fall("data:-Adresse mit Komma", "<picture><source srcset=\"" + DATA + " 1x, " + TOR + " 2x\"></picture>")
  wahr("H22b data:-Adresse bleibt ganz", p4.includes("srcset=\"" + DATA + " 1x, ") && p4.includes("data-beneos-srcset=\"" + DATA + " 1x, "), p4)
  const p5 = fall("Komma ohne Leerraum", "<picture><source srcset=\"" + TOR + " 1x," + TOR2 + " 2x\"></picture>")
  wahr("H22b Komma ohne Leerraum: Trenner bleibt", p5.includes("srcset=\"" + maskiere(TOR) + " 1x," + maskiere(TOR2) + " 2x\""), p5)
  fall("mehrzeilig", "<picture><source srcset=\"\n  " + TOR + " 1x,\n  " + TOR2 + " 2x\n\"></picture>")
  const p6 = fall("SRCSET gross", "<PICTURE><SOURCE SRCSET=\"" + TOR + " 1x\"></PICTURE>")
  wahr("H22b SRCSET gross: Schreibung bleibt", p6.includes("SRCSET=\"" + maskiere(TOR) + " 1x\""), p6)
  const p7 = fall("ohne Anfuehrung", "<picture><source srcset=" + TOR + "></picture>")
  wahr("H22b ohne Anfuehrung: srcset bleibt ohne Anfuehrung", p7.includes("srcset=" + maskiere(TOR) + " "), p7)
  fall("einfache Anfuehrung", "<picture><source srcset='" + TOR + " 1x, " + TOR2 + " 2x'></picture>")
  const doppelt = tief({ content: "<picture><source srcset=\"https://example.com/a.png 1x\" srcset=\"" + TOR + " 1x\"></picture>" })
  wahr("H22b zweites srcset am Tag: kein Schluessel", ohneSchluessel(doppelt), doppelt)
  const ohne = (name, html) => { const neu = tief({ content: html }); wahr("H22b " + name + ": kein Schluessel", ohneSchluessel(neu), neu); return neu }
  ohne("Komma ohne Leerraum zwischen zwei Toradressen", "<picture><source srcset=\"" + TOR + "," + TOR2 + "\"></picture>")
  const lage = "<picture><source srcset=\"" + TOR + " 1x " + TOR2 + "\"></picture>"
  const lageNeu = ohne("Toradresse in der Deskriptorlage", lage)
  ohne("fremder Eintrag mit Toradresse als Deskriptor", "<picture><source srcset=\"https://example.com/a.png " + TOR + "\"></picture>")
  ohne("img: Toradresse als Deskriptor", "<img src=\"https://example.com/a.png\" srcset=\"https://example.com/b.png " + TOR + "\">")
  ohne("NBSP in der Adresse", "<picture><source srcset=\"" + TOR + "\u00A0" + TOR2 + " 1x\"></picture>")
  wahr("H22b Altseiten-Pruefung: verbliebener Schluessel in der Deskriptorlage: abgelehnt",
    nurBildadressenGetauscht(lage, "<picture><source srcset=\"" + maskiere(TOR) + " 1x " + TOR2 + "\" data-beneos-srcset=\"" + FREI + " 1x " + TOR2 + "\"></picture>") === false)
  const gleichZeichen = ohne("ohne Anfuehrung mit = im Wert", "<picture><source srcset=" + TOR + "?a=1&amp;b=2></picture>")
  wahr("H22b ohne Anfuehrung mit = im Wert: srcset bleibt ganz", gleichZeichen.includes(maskiere(TOR) + "?a=1&amp;b=2\"") && !gleichZeichen.includes("\"=1"), gleichZeichen)
  const und = ohne("ohne Anfuehrung mit &", "<picture><source srcset=" + TOR + "?x&amp;y></picture>")
  wahr("H22b ohne Anfuehrung mit &: bleibt ohne Anfuehrung", und.includes("srcset=" + maskiere(TOR) + "?x&amp;y "), und)
  ohne("zweites data-beneos-srcset mit Toradresse", "<picture><source srcset=\"" + TOR + " 1x\" data-beneos-srcset=\"x\" data-beneos-srcset=\"" + TOR2 + " 1x\"></picture>")
  const direkt = ohne("Komma direkt hinter der Adresse", "<picture><source srcset=\"" + TOR + ", " + TOR2 + " 2x\"></picture>")
  wahr("H22b Komma direkt hinter der Adresse: freie Form trennt", direkt.includes("data-beneos-srcset=\"" + FREI + ", "), direkt)
  const bildGleich = tief({ content: "<img src=\"https://example.com/a.png\" srcset=" + TOR + "?a=1&amp;b=2>" })
  wahr("H22b img ohne Anfuehrung mit = im srcset: Tag heil", ohneSchluessel(bildGleich) && !bildGleich.includes("b=2"), bildGleich)
  wahr("H22b srcsetTeile: NBSP trennt nicht",
    q(srcsetTeile("a.png\u00A0b.png 1x").map((t) => [t.adresse, t.rest])) === q([["a.png\u00A0b.png", "1x"]]))
  wahr("H22b srcsetTeile: Komma in Klammern trennt nicht",
    q(srcsetTeile("a.png 1x (q, r), b.png 2x").map((t) => [t.adresse, t.rest])) === q([["a.png", "1x (q, r)"], ["b.png", "2x"]]))
}
console.log("H23 stre-T-153: Toradresse nur unter frueherer Basis")
{
  const { nurBildadressenGetauscht } = await import("./stream-html.mjs")
  const { maskiere } = await import("./stream-tormaske.mjs")
  const tief = (wert) => { const w = JSON.parse(JSON.stringify(wert)); htmlTiefSchluesselfrei(w); return w.content }
  const ALT = TOR.replace(/^https:\/\/[^/]+/, "https://old.beneos.stream")
  const MASKE = maskiere(ALT)
  wahr("H23 Vorbedingung: ALT traegt den Schluessel, seine Maske nicht", !ohneSchluessel(ALT) && ohneSchluessel(MASKE) && MASKE !== ALT, MASKE)
  // Je Weg steht im Text NUR die fruehere Basis, nie der heutige Host.
  const WEGE = {
    "img src": `<p>x</p><img src="${ALT}" width="10">`,
    "img Fragment": `<img src="${PLATZHALTER_BILD}#${ALT}">`,
    "img data-src": `<img src="https://example.com/a.png" data-src="${ALT}">`,
    "img data-beneos-src": `<img src="https://example.com/a.png" data-beneos-src="${ALT}">`,
    "a href": `<p><a href="${ALT}">Karte</a></p>`,
    "Fliesstext": `<p>Siehe ${ALT} dort</p>`,
    "source srcset": `<picture><source srcset="${ALT} 1x"></picture>`,
    "img srcset": `<img src="https://example.com/a.png" srcset="${ALT} 2x">`,
    // Die Abkuerzung des Vorfilters darf keine Schreibweise verlieren, die `new URL` auf die Zone abbildet.
    "Fliesstext, Host gross": `<p>Siehe ${ALT.replace("https://old.beneos.stream", "https://OLD.BENEOS.STREAM")} dort</p>`,
    "Fliesstext, Host prozentkodiert": `<p>Siehe ${ALT.replace("old.beneos.stream", "old.beneos%2Estream")} dort</p>`,
    "Fliesstext, Host in Vollbreite": `<p>Siehe ${ALT.replace("old.beneos.stream", "old.beneos.ｓtream")} dort</p>`,
  }
  for (const [weg, html] of Object.entries(WEGE)) {
    wahr(`H23 ${weg}: Vorbedingung ohne heutigen Host`, !html.includes("gate.beneos.stream") && !ohneSchluessel(html), html)
    const neu = tief({ content: html })
    wahr(`H23 ${weg}: kein Schluessel`, ohneSchluessel(neu), neu)
    // Auflage 1 (orch P-13:25, H15): ein entferntes srcset und ein geaendertes data-src lehnt die
    // Altseiten-Pruefung ab, wie unter dem heutigen Host; die Seite bleibt dann ungeschrieben.
    const auflage = weg === "img data-src" || weg === "img srcset"
    wahr(`H23 ${weg}: Altseiten-Pruefung ${auflage ? "lehnt ab (Auflage 1)" : "gilt"}`, nurBildadressenGetauscht(html, neu) === !auflage, neu)
    wahr(`H23 ${weg}: zweiter Lauf aendert nichts`, tief({ content: neu }) === neu, neu)
  }
  const bild = tief({ content: WEGE["img src"] })
  wahr("H23 img src: die Maske, kein data-beneos-src", bild === `<p>x</p><img src="${MASKE}" width="10">`, bild)
  const fragment = tief({ content: WEGE["img Fragment"] })
  wahr("H23 img Fragment: die Maske, kein data-beneos-src", fragment === `<img src="${MASKE}">`, fragment)
  const daten = tief({ content: WEGE["img data-beneos-src"] })
  wahr("H23 img data-beneos-src: faellt weg, src bleibt", daten === `<img src="https://example.com/a.png">`, daten)
  const link = tief({ content: WEGE["a href"] })
  wahr("H23 a href: die Maske", link.includes(`href="${MASKE}"`), link)
  // Hook-Wege: preUpdate und preCreate (installHtmlNetz lief in H9).
  const upd = { content: WEGE["a href"] + WEGE["img src"] }
  hakenListe.preUpdateChatMessage[0]({}, upd)
  wahr("H23 preUpdate: kein Schluessel", ohneSchluessel(upd.content), upd.content)
  let quelle = null
  hakenListe.preCreateChatMessage[0]({ _source: { content: WEGE["img src"] + WEGE["Fliesstext"] + WEGE["source srcset"] }, updateSource(d) { quelle = d } })
  wahr("H23 preCreate: kein Schluessel", quelle !== null && ohneSchluessel(JSON.stringify(quelle)), JSON.stringify(quelle))
  // Altseiten: ein img, das den Schluessel behaelt, besteht die Gegenprobe nicht.
  wahr("H23 Altseiten-Pruefung: Schluessel im img src bleibt: abgelehnt", nurBildadressenGetauscht(WEGE["img src"], WEGE["img src"]) === false)
  wahr("H23 Altseiten-Pruefung: Schluessel im Fragment bleibt: abgelehnt", nurBildadressenGetauscht(WEGE["img Fragment"], WEGE["img Fragment"]) === false)
  // Kalt-Review 19.11.2026, W4: ohne data-beneos-src bleibt src oder wird seine Maske, kein anderes Ziel.
  const ANDERS = maskiere(ALT.replace("handout", "andere"))
  wahr("H23 Altseiten-Pruefung: anderes Ziel ohne freie Form: abgelehnt", nurBildadressenGetauscht(WEGE["img src"], `<p>x</p><img src="https://example.com/evil.png" width="10">`) === false)
  wahr("H23 Altseiten-Pruefung: Maske eines anderen Ziels: abgelehnt", ANDERS !== MASKE && nurBildadressenGetauscht(WEGE["img src"], `<p>x</p><img src="${ANDERS}" width="10">`) === false, ANDERS)
  wahr("H23 Altseiten-Pruefung: Fragment wird Maske: gilt", nurBildadressenGetauscht(WEGE["img Fragment"], `<img src="${MASKE}">`) === true)
  // Kalt-Review 19.11.2026, W1: Schreibweisen, die der Wandler frei macht, muss der Vorfilter durchlassen.
  const HEUTE = TOR.match(/^https:\/\/[^/]+/)[0]
  const PFAD_T = TOR.slice(HEUTE.length)
  for (const [name, html] of [
    ["heute Userinfo img", `<img src="${HEUTE.replace("://", "://u@")}${PFAD_T}">`],
    ["heute Userinfo Text", `<p>Siehe ${HEUTE.replace("://", "://u@")}${PFAD_T} dort</p>`],
    ["heute &#47; img", `<img src="${HEUTE}&#47;${PFAD_T.slice(1)}">`],
    ["heute Backslash img", `<img src="${HEUTE.replace("://", ":\\\\")}${PFAD_T}">`],
    ["heute Tab im Host img", `<img src="${HEUTE.replace("beneos", "bene\tos")}${PFAD_T}">`],
    ["frueher &#46; a href", `<p><a href="${ALT.replace("beneos.stream", "beneos&#46;stream")}">k</a></p>`],
    // W2: fuehrender Leerraum, `maskiere` ist am Anfang verankert.
    ["frueher Leerraum img src", `<img src=" ${ALT}">`],
    ["frueher Leerraum Fragment", `<img src="${PLATZHALTER_BILD}# ${ALT}">`],
    ["frueher Leerraum data-beneos-src", `<img src="https://example.com/a.png" data-beneos-src=" ${ALT}">`],
    ["frueher Leerraum a href", `<p><a href=" ${ALT}">k</a></p>`],
  ]) {
    wahr(`H23 ${name}: Vorbedingung mit Schluessel`, !ohneSchluessel(html), html)
    const neu = tief({ content: html })
    wahr(`H23 ${name}: kein Schluessel`, ohneSchluessel(neu), neu)
  }
  // Das Gedaechtnis des Vorfilters gilt je Text UND Host: derselbe Text unter anderem Host wird neu gefragt.
  {
    const html = `<p>Siehe ${HEUTE.replace("://", "://u@")}${PFAD_T} dort</p>`
    einstellungen[SETTING.base] = "https://other.beneos.stream"
    const vorher = tief({ content: html })
    einstellungen[SETTING.base] = GATE
    const nachher = tief({ content: html })
    wahr("H23 Vorfilter-Gedaechtnis: unter anderem Host unberuehrt", vorher === html, vorher)
    wahr("H23 Vorfilter-Gedaechtnis: derselbe Text unter heutigem Host wird frei", ohneSchluessel(nachher), nachher)
  }
  // Zwei-Werte-Probe: die fruehere Basis aendert sich, alles ohne Toradresse der Zone bleibt bytegleich.
  wahr("H23 Zwei-Werte-Probe: fruehere Basis aendert sich", tief({ content: WEGE["Fliesstext"] }) !== WEGE["Fliesstext"])
  // Toradressform unter fremdem Host, die Zone steht woertlich im Pfad: der Vorfilter laesst sie bis TOR_IM_TEXT, unterZone weist sie ab.
  const fremdHost = `https://example.com/a/${KEY}/beneos.stream/x.webp`
  for (const [name, html] of [
    ["ohne Toradresse", "<p>Nur Text mit <b>Fett</b> und <img src=\"https://example.com/a.png\"></p>"],
    ["fremde https-Adressen", "<p><a href=\"https://example.com/x?y=1\">a</a> https://foo.bar/z <img src=\"https://cdn.example.org/b.png\" srcset=\"https://cdn.example.org/b2.png 2x\"></p>"],
    ["fremder Host mit Zone im Pfad", `<p><a href="${fremdHost}">a</a> ${fremdHost}</p>`],
    ["fremder Host, Zone als Endung ohne Punkt", `<p>https://notbeneos.stream/a/${KEY}/x.webp</p>`],
    ["heutige Basis ohne Schluessel", `<img src="${SRC_A}" data-beneos-src="${FREI}">`],
  ]) {
    wahr(`H23 Zwei-Werte-Probe: ${name} bleibt bytegleich`, tief({ content: html }) === html, tief({ content: html }))
  }
}
console.log(`${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
process.exit(rot ? 1 : 0)
