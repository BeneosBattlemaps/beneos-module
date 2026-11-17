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

  einstellungen[SETTING.key] = ""
  wahr("H11 ohne Schluessel keine Heilung", htmlSchluesselfrei(dialog).html === dialog)
  einstellungen[SETTING.key] = KEY
}

console.log("H12 Robustheit des Tags (Kalt-Review W2)")
{
  const gross = htmlSchluesselfrei(`<img alt="a > b" src="${TOR}">`)
  wahr("H12 '>' in einem Attribut davor: gewandelt", ohneSchluessel(gross.html) && gross.html.includes(`src="${SRC_A}"`) && gross.html.includes('alt="a > b"'), gross.html)
  const gross2 = htmlSchluesselfrei(`<IMG SRC="${TOR}">`)
  wahr("H12 Grossschreibung: gewandelt", ohneSchluessel(gross2.html) && gross2.zahl === 1, gross2.html)
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
  const lazy = htmlSchluesselfrei(`<img data-src="${TOR}" src="${TOR}">`)
  wahr("H12 data-src davor: src gewandelt, data-src unberuehrt",
    lazy.html === `<img data-src="${TOR}" src="${SRC_A}" data-beneos-src="${FREI}">`, lazy.html)
  wahr("H12 data-src mit Schluessel gezaehlt", lazy.andere === 1, `andere ${lazy.andere}`)
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

console.log(`${aussagen} Aussagen, ${gruen} gruen, ${rot} rot`)
process.exit(rot ? 1 : 0)
