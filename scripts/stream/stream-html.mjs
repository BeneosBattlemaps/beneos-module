/**
 * stream-html.mjs
 *
 * Kein Streamschluessel im HTML der Kundendokumente (stre-T-116).
 *
 * WARUM. Seit stre-T-102 stehen Kacheln, Szenen, Klaenge und Akteure
 * schluesselfrei (`beneos://`) auf der Platte. Im HTML der Journalseiten stand
 * aber weiter die Toradresse MIT Schluessel, weil Foundrys Bereinigung ein
 * `src` mit dem Schema `beneos://` verwirft. Ein exportiertes Journal gab damit
 * den Schluessel weiter.
 *
 * WIE. Ein Bild im HTML bekommt die Form (a):
 *
 *   <img src="PLATZHALTER_BILD" data-beneos-src="beneos://a/...">
 *
 * `data-*` und das Schema `data:` laesst die Bereinigung stehen, gemessen am
 * 17.11.2026 in v13 13.351 und v14 14.367 (Anlegen, Update, Editor-Speichern,
 * Export, Import). Das echte Bild setzt erst die Anzeige ein, ueber
 * `blobFuer` in `stream-bilder.mjs`, und nur im DOM.
 *
 * DAS AUSSEHEN VOR DEM TAUSCH KOMMT NIE AUS DEN DATEN. Der Platzhalter ist fuer
 * alle Bilder derselbe neutrale Wert; wie die Flaeche vor dem Tausch aussieht,
 * sagt allein die CSS-Regel auf `img[data-beneos-src]` (Auftrag P-04:01:17,
 * Vorgabe 1). Eine spaetere Entscheidung zum Aussehen tauscht nur die Regel.
 *
 * AM SCHLUESSEL, NICHT AM MODUS. Ohne Schluessel tut nichts hier etwas: die
 * Pruefung steckt in `schluesselfreiAdresse`, und jeder Einstieg fragt
 * zusaetzlich `streamKey()` vorab. Ein Bestandskunde der Download-Wege merkt
 * nichts.
 */

import { MODULE_ID, schluesselfreiAdresse, streamKey, streamHost, leinwandAdresse, GATE_ZONE } from "./stream-settings.mjs"
import { TOR_IM_TEXT, maskiere, wandle, istMaskiert, unterZone } from "./stream-tormaske.mjs"

/*
 * FREMDE FLAGS BLEIBEN AUSSERHALB DES NETZES (stre-T-128). Unter
 * `flags.<fremdes Modul>` steht die Toradresse mit Schluessel, weil das fremde
 * Modul sein HTML ohne unser Netz anzeigt; Form (a) waere dort ein leeres Bild.
 * Dieselbe Regel wie in `applyStreamAddresses` (`stream-install.mjs`): einmal
 * fremd, immer fremd darunter, darum wird der ganze Zweig uebergangen.
 *
 * Zwei Schreibweisen kommen an: verschachtelt (`{flags: {ns: ...}}`, auch
 * unter `prototypeToken`) und als Punktpfad aus einem Update
 * (`"flags.ns.feld"`, `"prototypeToken.flags.ns"`).
 */
const FREMDER_FLAGPFAD = /(?:^|\.)flags\.([^.]+)/
function fremderFlagpfad(k) {
  const m = FREMDER_FLAGPFAD.exec(k)
  return !!m && m[1] !== MODULE_ID
}
function istFlagsSchluessel(k) { return k === "flags" || k.endsWith(".flags") }
/** Nur das eigene Flag eines `flags`-Objekts; fremde Namensraeume fallen weg. */
function nurEigeneFlags(flags) {
  const aus = {}
  if (MODULE_ID in flags) aus[MODULE_ID] = flags[MODULE_ID]
  return aus
}

/**
 * Der Platzhalter: ein durchsichtiges SVG von einem Pixel, als `data:`-Adresse
 * OHNE `;base64`.
 *
 * Nicht base64, weil der Editor beim Einfuegen jede Adresse
 * `data:<bild>;base64,` als eingefuegtes Bild hochlaedt (Foundry
 * `common/prosemirror/image-plugin.mjs`, `_extractBase64Images`, v13 :154).
 * Jedes Kopieren eines Bildes legte sonst eine Datei `pasted-image.png` in der
 * Kundenwelt ab. Ohne Anfuehrungszeichen im Wert, damit er in einfach wie
 * doppelt gefasste Attribute passt.
 */
export const PLATZHALTER_BILD =
  "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%221%22%20height=%221%22/%3E"

/**
 * Das `src` der Form (a): der Platzhalter, dahinter die schluesselfreie Adresse
 * als Fragment.
 *
 * WARUM DAS FRAGMENT. Zwei Editorwege bauen den Bildknoten neu und werfen
 * dabei die erhaltenen Attribute weg, `data-beneos-src` eingeschlossen: der
 * Bilddialog (`_insertImagePrompt`, v13 und v14) und das verlinkte Bild
 * (`image_link`, v13). Uebrig bleibt nur das `src`. Ein fuer alle Bilder
 * gleicher Platzhalter koennte danach nicht mehr sagen, welches Bild gemeint
 * war; mit dem Fragment setzt das Schreibnetz das Attribut beim Speichern
 * zurueck (Kalt-Review 17.11.2026, kritisch). Das Aussehen aendert das
 * Fragment nicht, ein Fragment einer `data:`-Adresse laedt nichts.
 */
export function platzhalterMit(frei) {
  return `${PLATZHALTER_BILD}#${frei}`
}

/**
 * Die schluesselfreie Adresse eines Bildes in Form (a), oder null.
 *
 * `data-beneos-src` geht vor, das Fragment des Platzhalters ist der Rueckweg,
 * wenn ein Editorweg das Attribut verloren hat. Ein kopiertes Bild aus einer
 * Anzeige traegt ein `blob:` oder gar kein `src` mehr; dann zaehlt nur das
 * Attribut. Jedes andere `src` ist nicht Form (a), auch wenn ein Attribut
 * daneben steht: dann hat jemand das Bild bewusst getauscht.
 */
export function formAAdresse(src, daten) {
  const s = typeof src === "string" ? src : ""
  const d = typeof daten === "string" && daten.startsWith("beneos://") ? daten : null
  if (s.startsWith(PLATZHALTER_BILD)) {
    if (d) return d
    const rest = s.slice(PLATZHALTER_BILD.length)
    return rest.startsWith("#beneos://") ? rest.slice(1) : null
  }
  if (!s || s.startsWith("blob:")) return d
  return null
}

// Ein ganzes Tag, Anfuehrungszeichen beachtet: ein `>` in einem Attributwert
// beendet es nicht (Kalt-Review W2).
const IMG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const ANDERE_RE = /<(?:video|source|audio)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
// Ein Tag, ein Textstueck dazwischen, oder eine einzelne spitze Klammer.
const TAG_ODER_TEXT_RE = /<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g
const FREIE_FORM_IM_TEXT = /beneos:\/\/[^\s"'<>]+/gi
// Das Textnetz (Nachpruefung stre-T-142): Links bekommen Maske und
// `data-beneos-href`; diese Tags behalten ihre Adressen, `<img>` hat die
// Bildstufe, `<iframe>` keinen Anzeigeweg fuer beneos://; in jedem anderen
// Tag werden die Attribute frei, Adressattribute maskiert, `style` bleibt.
//
// MEDIEN, stre-T-147: `<video>`, `<audio>` und `<source>` behielten bis
// dahin die Toradresse mit Schluessel, und der Installer schrieb sie so in
// jedes Journal (gemessen 19.11.2026). Sie gehen jetzt den Weg der Links:
// `src` maskiert, die freie Form in `data-beneos-src`. Abspielbar macht
// sie `medienAnzeigen` in `stream-bilder.mjs`, das `src` nur im DOM
// setzt. Ohne Blob: ein Video laedt sonst ganz, bevor es spielt.
const LINK_TAGS = new Set(["a", "area"])
const MEDIEN_TAGS = new Set(["video", "audio", "source"])
// stre-T-147: je Medientag die Adresse und ihre freie Form. `srcset` (an
// `<source>` in `<picture>`) ist eine Liste und geht je Eintrag denselben Weg,
// mit der freien Form in `data-beneos-srcset` (stre-T-148, `medienSrcset`).
export const MEDIEN_PAARE = [["src", "data-beneos-src"], ["poster", "data-beneos-poster"]]
const MEDIEN_LASSEN = ["srcset", "data-beneos-srcset", ...MEDIEN_PAARE.flat()]
const TEXTNETZ_LAESST = new Set(["img", "iframe"])
const ADRESS_ATTRIBUTE = new Set(["href", "src", "cite"])
// Beginnt wie ein Tag und ist keines: Kommentar oder Markdown-Autolink.
const KEIN_TAG = /^<(?:!--|[a-z][a-z0-9+.-]*:)/i
function tagName(tag) { return /^<\s*([a-z][a-z0-9-]*)/i.exec(tag)?.[1]?.toLowerCase() ?? "" }
// Ein Attribut: Name, wahlweise mit Wert in doppelten, einfachen oder ohne
// Anfuehrungszeichen. Gelesen wird nach Namen, nie nach Teilzeichenkette;
// sonst traefe `src` auch `data-src` oder `data-beneos-src`.
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** Die Attribute eines Tags, mit Lage im Tag und entschluesseltem Wert. */
function attribute(tag) {
  const liste = []
  const ende = tag.length - 1
  // Hinter dem Tagnamen beginnen, sonst zaehlte er als Attribut.
  ATTR_RE.lastIndex = /^<[a-z]+/i.exec(tag)?.[0].length ?? ende
  let m
  while ((m = ATTR_RE.exec(tag)) && m.index < ende) {
    const roh = m[2] ?? m[3] ?? m[4] ?? ""
    liste.push({
      name: m[1].toLowerCase(),
      anfang: m.index,
      ende: m.index + m[0].length,
      anfuehrung: m[2] !== undefined ? '"' : m[3] !== undefined ? "'" : "",
      wert: entschluesseln(roh),
    })
  }
  return liste
}

const BENANNT = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }
/** HTML-Entitaeten eines Attributwertes (Kalt-Review W3). */
function entschluesseln(s) {
  if (!s.includes("&")) return s
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt));/gi, (ganz, dez, hex, name) => {
    if (name) return BENANNT[name.toLowerCase()]
    const code = dez ? Number(dez) : parseInt(hex, 16)
    try { return String.fromCodePoint(code) } catch (_) { return ganz }
  })
}

/** Ein Attribut zum Schreiben, mit der Anfuehrung des Bestandes. */
function attributText(name, wert, anfuehrung) {
  const a = anfuehrung || '"'
  let w = wert.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  w = a === '"' ? w.replace(/"/g, "&quot;") : w.replace(/'/g, "&#39;")
  return `${name}=${a}${w}${a}`
}

/**
 * Ein `srcset` als Liste seiner Kandidaten (stre-T-148), nach der Regel
 * des HTML-Standards: die Adresse reicht bis zum naechsten Leerraum, ein Komma
 * an ihrem Ende trennt, der Deskriptor reicht bis zum naechsten Komma. Ein
 * Komma in der Adresse (`data:`) bleibt deshalb in ihr (Kalt-Review W3).
 * Leerraum ist nur ASCII-Leerraum, ein Komma in Klammern trennt den Deskriptor
 * nicht (Nachpruefung 19.11.2026, Befund 7).
 * `anfang` und `ende` sind der Versatz der Adresse im Wert.
 */
const SRCSET_LEER = /[\t\n\f\r ]/
export function srcsetTeile(wert) {
  const s = String(wert ?? "")
  const teile = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && (SRCSET_LEER.test(s[i]) || s[i] === ",")) i++
    if (i >= s.length) break
    let j = i
    while (j < s.length && !SRCSET_LEER.test(s[j])) j++
    let ende = j
    while (ende > i && s[ende - 1] === ",") ende--
    let k = ende
    let klammer = false
    if (ende === j) {
      while (k < s.length && (klammer || s[k] !== ",")) {
        if (s[k] === "(") klammer = true
        else if (s[k] === ")") klammer = false
        k++
      }
    }
    teile.push({ adresse: s.slice(i, ende), rest: s.slice(ende, k).trim(), anfang: i, ende })
    i = ende === j ? k + 1 : j
  }
  return teile
}

/**
 * Der Wert mit jeder Adresse durch `neu(adresse)` ersetzt. Trenner,
 * Leerraum und Deskriptoren bleiben zeichengleich (Kalt-Review W4).
 */
export function srcsetTausch(wert, neu) {
  let aus = String(wert ?? "")
  for (const t of srcsetTeile(aus).reverse()) aus = aus.slice(0, t.anfang) + neu(t.adresse) + aus.slice(t.ende)
  return aus
}

/**
 * Traegt ein `srcset` eine Toradresse mit Schluessel? Jede, die sich
 * wandeln oder maskieren laesst, auch eine unter frueherer Basis oder mit
 * gescheitertem Rundlauf (Kalt-Review K1, K2), und an jeder Stelle des Werts,
 * auch in der Deskriptorlage (Nachpruefung 19.11.2026, Befund 1). Das Tag
 * erreicht diese Pruefung, sobald der Vorfilter (`zoneImText`) eine Toradresse
 * unter einem Host der Zone findet, heutig oder frueher (stre-T-153).
 */
function srcsetMitTor(wert) {
  return (String(wert ?? "").match(TOR_IM_TEXT) ?? []).some((a) => wandle(a) !== a)
}


/**
 * Ein Attribut ohne Anfuehrung, dessen Wert `ATTR_RE` an einem `=` beendet:
 * der Wert reicht bis zum Leerraum oder Tagende (Nachpruefung 19.11.2026,
 * Befund 3). Sonst kaeme eine Einfuegung mitten in den Wert.
 */
function ganzerWert(tag, a) {
  if (!a || a.anfuehrung) return a
  const rest = /^[^\t\n\f\r >]*/.exec(tag.slice(a.ende))[0]
  return rest ? { ...a, wert: a.wert + entschluesseln(rest), ende: a.ende + rest.length } : a
}

/** Ein Attribut mit neuem Wert; Name, Schreibung und Anfuehrung wie im Tag. */
function attributWert(tag, a, wert) {
  const roh = tag.slice(a.anfang, a.ende)
  const kopf = /^[^\s"'>\/=]+\s*=\s*/.exec(roh)?.[0] ?? a.name + "="
  if (!a.anfuehrung && /^[^\s"'=<>`]+$/.test(wert)) return kopf + wert.replace(/&/g, "&amp;")
  return kopf + attributText("", wert, a.anfuehrung).slice(1)
}

/**
 * Steht im Text eine Toradresse unter einem Host der Zone, heutig oder frueher
 * (stre-T-153)? Ein Vergleich mit dem heutigen Host allein liess eine
 * Toradresse unter frueherer Basis mit Schluessel stehen.
 *
 * Zwei Wege, und einer genuegt. Der heutige Host im Text, wie bisher: er faengt
 * auch Schreibweisen, die `TOR_IM_TEXT` nicht als Adresse erkennt (Kalt-Review
 * 19.11.2026, W1). Oder eine Toradresse, fuer die `unterZone` gilt, im Text
 * oder in seiner entschluesselten Fassung (`&#47;` in einem Attribut).
 * `unterZone` prueft den Host ueber `new URL`, also auch in Gross- und
 * Kleinschreibung (stre-T-122) und prozentkodiert.
 *
 * Der Vorfilter ist weiter als der Wandler, nicht deckungsgleich: was er
 * durchlaesst, kann der Wandler unveraendert zurueckgeben. Eine fruehere Basis
 * in einer Schreibweise, die `TOR_IM_TEXT` nicht findet, erreicht weder ihn
 * noch den Wandler.
 *
 * Vor dem Regex die Abkuerzung, damit eine grosse Seite mit fremden Links so
 * wenig kostet wie bisher: ein Host der Zone steht woertlich im Text, oder ein
 * Host einer Adresse ist kodiert (`%`), zerrissen (Tab, LF, CR) bzw. nicht
 * ASCII, was `new URL` auf die Zone abbilden kann. Nur dann laeuft
 * `TOR_IM_TEXT`, und `new URL` nur fuer einen Treffer, der selbst diese Probe
 * besteht. `kandidat` und `textKandidat` fragen meist nach demselben Text,
 * darum merkt sich `zoneImText` die letzte Antwort je Text und Host.
 */
const ZONE_WOERTLICH = new RegExp(GATE_ZONE.replace(/\./g, "\\."), "i")
// Ein Host (wie in `TOR_IM_TEXT`, auch hinter `\`) mit `%`, Tab, LF, CR oder
// einem Zeichen ausserhalb von ASCII.
const HOST_KODIERT = /https?:[/\\]*[^/\\\s"'<>%\x80-￿]*(?:%|[\t\n\r]|(?!\s)[\x80-￿])/i
const vielleichtZone = (s) => ZONE_WOERTLICH.test(s) || HOST_KODIERT.test(s)
const torInZone = (text) => (text.match(TOR_IM_TEXT) ?? []).some((a) => vielleichtZone(a) && unterZone(a))
// Tab, LF und CR in einer Adresse entfernt `new URL`, der Wandler gibt die
// Adresse dann frei; der Vorfilter prueft sie deshalb auch ohne diese Zeichen.
// Nur im Schema oder Host, damit eine Adresse am Zeilenende nicht zaehlt.
const ADRESSE_ZERRISSEN = /https?:[/\\]*[^/\\\s"'<>]*[\t\n\r]/i
function zoneInFassung(text, host) {
  if (!vielleichtZone(text)) return false
  if (torInZone(text)) return true
  if (!ADRESSE_ZERRISSEN.test(text)) return false
  const ohne = text.replace(/[\t\n\r]/g, "")
  return hostImText(ohne, host) || torInZone(ohne)
}
// Der heutige Host ohne Ruecksicht auf Gross- und Kleinschreibung, als Muster
// statt `toLowerCase()`: das kopierte bei jedem Aufruf die ganze Seite.
let hostQuelle = null
let hostMuster = null
function hostImText(text, host) {
  if (host !== hostQuelle) {
    hostQuelle = host
    hostMuster = host ? new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
  }
  return !!hostMuster && hostMuster.test(text)
}
let letzteFrage = { text: null, host: null, ja: false }
function zoneImText(text) {
  const host = streamHost()
  if (letzteFrage.text === text && letzteFrage.host === host) return letzteFrage.ja
  // Der heutige Host liegt immer in der Zone (`streamBase` geht ueber
  // `erlaubteBasis`); wo er steht, steht also auch die Zone, und die ist billiger.
  const ja = (ZONE_WOERTLICH.test(text) && hostImText(text, host)) || zoneInFassung(text, host) || (text.includes("&") && zoneInFassung(entschluesseln(text), host))
  letzteFrage = { text, host, ja }
  return ja
}

/**
 * Lohnt das Zerlegen? Haelt es von den gewoehnlichen Feldwerten fern, die nie
 * HTML mit einer Toradresse oder mit Form (a) sind.
 */
function kandidat(text) {
  // `src` ohne Ruecksicht auf Gross- und Kleinschreibung: `<IMG SRC=...>` ist
  // gueltiges HTML.
  if (typeof text !== "string" || !text.includes("<") || !/src/i.test(text)) return false
  return text.includes("data-beneos-src") || text.includes(PLATZHALTER_BILD) || zoneImText(text)
}

/**
 * Ein Bild-Tag in Form (a). Rueckgabe ohne Aenderung, wenn nichts zu tun ist.
 *
 * Zwei Faelle: eine Toradresse mit Schluessel wird gewandelt; ein Bild, das
 * schon Form (a) ist, aber ein Editorweg beschaedigt hat, wird geheilt (Attribut
 * aus dem Fragment, Platzhalter statt `blob:` oder fehlendem `src`).
 */
function bildTag(tag) {
  const attr = attribute(tag)
  // Ganze Werte auch ohne Anfuehrung mit `=` (stre-T-154), sonst kaeme die
  // Einfuegung mitten in den Wert.
  const src = ganzerWert(tag, attr.find((a) => a.name === "src"))
  const daten = ganzerWert(tag, attr.find((a) => a.name === "data-beneos-src"))
  let frei = null
  let geheilt = false
  // Wo eine Toradresse mit Schluessel stehen kann: im `src`, im Fragment eines
  // Platzhalters, in `data-beneos-src`. Jede davon wird frei; im Fragment und
  // im Attribut steht danach nie Schluessel oder Toradresse (Bedingung orch,
  // P-12:54:43), auch wenn jemand eine solche Form einfuegt.
  const fragment = src?.wert.startsWith(`${PLATZHALTER_BILD}#`) ? src.wert.slice(PLATZHALTER_BILD.length + 1) : null
  for (const adresse of [src?.wert, fragment, daten?.wert]) {
    if (frei || !adresse) continue
    const f = schluesselfreiAdresse(adresse)
    if (f !== adresse) frei = f
  }
  // Die uebrigen Attribute, unabhaengig vom src. Ein `srcset` mit Toradresse
  // zoege der Browser dem `src` vor, und der Schluessel bliebe im HTML; es
  // faellt weg (Kalt-Review W2). Jedes andere Attribut, dessen ganzer Wert eine
  // Toradresse ist, etwa `data-src`, bekommt die freie Form (Nachpruefung
  // 17.11.2026, Befund 4), unter frueherer Basis die Maske (stre-T-153). Text
  // um eine Adresse, etwa in `alt`, bleibt stehen, wie bisher.
  const weitere = []
  for (const a of attr) {
    if (a.name === "src" || a.name === "data-beneos-src" || !a.wert) continue
    if (a.name === "srcset") {
      const g = ganzerWert(tag, a)
      if (!srcsetMitTor(g.wert)) continue
      let anfang = a.anfang
      while (anfang > 0 && /\s/.test(tag[anfang - 1])) anfang--
      weitere.push([anfang, g.ende, ""])
      continue
    }
    const f = wandle(a.wert)
    if (f !== a.wert) weitere.push([a.anfang, a.ende, attributText(a.name, f, a.anfuehrung || '"')])
  }
  if (!frei) {
    frei = formAAdresse(src?.wert ?? null, daten?.wert ?? null)
    const schonFormA = !!frei && src?.wert === platzhalterMit(frei) && daten?.wert === frei
    if (!frei || schonFormA) {
      if (!frei) weitere.push(...bildMaske(tag, src, fragment, daten))
      return weitere.length ? { tag: ersetze(tag, weitere), zahl: 1, heil: 0 } : { tag, zahl: 0, heil: 0 }
    }
    geheilt = true
  }
  const anfuehrung = src?.anfuehrung || daten?.anfuehrung || '"'
  const srcText = attributText("src", platzhalterMit(frei), anfuehrung)
  const datenText = attributText("data-beneos-src", frei, daten?.anfuehrung || anfuehrung)
  const tausch = [...weitere]
  if (daten) tausch.push([daten.anfang, daten.ende, datenText])
  if (src) tausch.push([src.anfang, src.ende, daten ? srcText : `${srcText} ${datenText}`])
  else tausch.push([4, 4, ` ${srcText}`])
  return { tag: ersetze(tag, tausch), zahl: 1, heil: geheilt ? 1 : 0 }
}

/*
 * Die Maske eines alten `src` fuer die Gegenprobe, bewusst ohne `maskiere`:
 * eine Pruefung, die den Wandler aufruft, haette denselben Fehler wie er.
 * Das Fragment des Platzhalters zaehlt als Adresse.
 */
const MASKE_VON = /^(\s*https?:\/\/[^/\s"'<>]+\/[a-z]\/)[^/?#\s"'<>]+/i
function maskeVon(wert) {
  if (typeof wert !== "string") return wert
  const w = wert.startsWith(`${PLATZHALTER_BILD}#`) ? wert.slice(PLATZHALTER_BILD.length + 1) : wert
  return w.replace(MASKE_VON, "$1-")
}

/** Traegt der Wert eine Toradresse mit Schluessel, die sich maskieren laesst? */
function mitSchluessel(wert) {
  return (String(wert ?? "").match(TOR_IM_TEXT) ?? []).some((x) => maskiere(x) !== x)
}

/*
 * Ein Bild, dessen Toradresse mit Schluessel sich nicht frei machen laesst
 * (fruehere Basis, gescheiterter Rundlauf): `src` wird die Maske, ein
 * `data-beneos-src` mit Schluessel faellt weg. Das Bild zeigt danach nichts,
 * wie im Export: tot statt undicht (stre-T-153, Betreiberentscheid 19.11.2026).
 */
function bildMaske(tag, src, fragment, daten) {
  const tausch = []
  const adresse = fragment ?? src?.wert
  // Ueber `TOR_IM_TEXT`, nicht `maskiere` am ganzen Wert: der ist am Anfang
  // verankert und liesse einen Wert mit fuehrendem Leerraum stehen.
  if (src && adresse && mitSchluessel(adresse)) {
    tausch.push([src.anfang, src.ende, attributText("src", adresse.replace(TOR_IM_TEXT, maskiere), src.anfuehrung || '"')])
  }
  if (mitSchluessel(daten?.wert)) {
    let anfang = daten.anfang
    while (anfang > 0 && /\s/.test(tag[anfang - 1])) anfang--
    tausch.push([anfang, daten.ende, ""])
  }
  return tausch
}

/*
 * Ersetzungen nach Lage im Tag, von hinten, damit die Lagen davor gelten. Bei
 * gleichem Anfang zuerst das laengere Stueck: ein Einfuegen an Stelle 4 und
 * ein Entfernen ab Stelle 4 zerschnitten sonst das Tag (Nachpruefung
 * 17.11.2026, Befund 2).
 */
function ersetze(tag, tausch) {
  let neu = tag
  for (const [anfang, ende, text] of [...tausch].sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    neu = neu.slice(0, anfang) + text + neu.slice(ende)
  }
  return neu
}

/**
 * Auflage 1 (orch P-13:25): der Schreiblauf ueber Altseiten darf nachweislich
 * nur Bildadressen aendern. Wahr nur, wenn der Text nach der Wandlung bis auf
 * `src` und `data-beneos-src` der Bilder zeichengleich ist, jedes gewandelte
 * Bild die freie Form traegt und `src` deren Platzhalter ist.
 *
 * Bewusst unabhaengig vom Wandler geprueft: ein Fehler dort, der ein Zeichen
 * ausserhalb dieser beiden Werte aendert, wird hier abgelehnt, auch ein
 * entferntes `srcset` oder ein geaendertes `data-src`.
 *
 * `nurGeaenderte` (stre-T-122): die Pruefung der freien Form gilt nur fuer
 * Bilder, die sich gegenueber `alt` an derselben Stelle geaendert haben. Ein
 * Bild, das die Spielleitung absichtlich getauscht hat (eigenes `src`,
 * `data-beneos-src` steht noch), bleibt zeichengleich und haelt die Seite
 * dann nicht auf. Die Gleichheit ausserhalb der Adressen gilt weiter fuer alles.
 */
export function nurBildadressenGetauscht(alt, neu, { nurGeaenderte = false } = {}) {
  if (typeof alt !== "string" || typeof neu !== "string") return false
  const ohneAttribute = (tag, namen) => {
    let t = tag
    const weg = attribute(tag).filter((a) => namen.includes(a.name))
    // Genau ein Trennzeichen davor geht mit, so wie der Wandler es setzt.
    // Mehr zu nehmen verdeckte ein zusaetzliches Leerzeichen im Tag.
    for (const a of weg.sort((x, y) => y.anfang - x.anfang)) {
      const anfang = a.anfang > 0 && /\s/.test(t[a.anfang - 1]) ? a.anfang - 1 : a.anfang
      t = t.slice(0, anfang) + t.slice(a.ende)
    }
    return t
  }
  // stre-T-142 B2 und Kalt-Review W5: ausserhalb von `TEXTNETZ_LAESST` steht jede
  // Adresse unter einem Host der Zone fuer sich, ob Toradresse, Maske oder
  // freie Form; eine fremde Adresse zaehlt Zeichen fuer Zeichen. In
  // `TEXTNETZ_LAESST` zaehlt jedes Zeichen. Das `href` eines Links bleibt im
  // Vergleich, damit ein entfernter oder umgeschriebener Link auffaellt; nur
  // das neue `data-beneos-href` faellt weg, sein Ziel prueft
  // `nurLinkUndTextGetauscht`.
  const marke = (s) => s.replace(TOR_IM_TEXT, (a) => (unterZone(a) ? "\u0000" : a)).replace(FREIE_FORM_IM_TEXT, "\u0000")
  const ohneAdressen = (html) => html.replace(TAG_ODER_TEXT_RE, (stueck) => {
    if (!stueck.startsWith("<")) return marke(stueck)
    const name = tagName(stueck)
    if (name === "img") return ohneAttribute(stueck, ["src", "data-beneos-src"])
    // Ein Medium wie ein Link: die Adressen bleiben als Marke im Vergleich, damit
    // eine Umleitung auf eine fremde Adresse auffaellt (Kalt-Review F3).
    if (MEDIEN_TAGS.has(name)) return marke(ohneAttribute(stueck, [...MEDIEN_PAARE.map(([, d]) => d), "data-beneos-srcset"]))
    if (LINK_TAGS.has(name)) return marke(ohneAttribute(stueck, ["data-beneos-href"]))
    if (TEXTNETZ_LAESST.has(name)) return stueck
    return marke(stueck)
  })
  if (ohneAdressen(alt) !== ohneAdressen(neu)) return false
  if (!nurLinkUndTextGetauscht(neu, nurGeaenderte ? new Set(alt.match(TAG_ODER_TEXT_RE) ?? []) : null)) return false
  const host = streamHost()
  const altTags = alt.match(IMG_RE) ?? []
  for (const [i, tag] of (neu.match(IMG_RE) ?? []).entries()) {
    if (nurGeaenderte && altTags[i] === tag) continue
    const attr = attribute(tag)
    // Weder `src` (mit dem Fragment des Platzhalters) noch `data-beneos-src`
    // behaelt eine Toradresse mit Schluessel (stre-T-153).
    const neuSrc = attr.find((a) => a.name === "src")?.wert
    const daten = attr.find((a) => a.name === "data-beneos-src")?.wert
    if (mitSchluessel(neuSrc) || mitSchluessel(daten)) return false
    if (daten === undefined) {
      // Ohne freie Form bleibt `src`, wie es war, oder wird seine Maske: ein
      // anderes Ziel darf hier nicht entstehen (Kalt-Review 19.11.2026, W4).
      const altSrc = altTags[i] === undefined ? undefined : attribute(altTags[i]).find((a) => a.name === "src")?.wert
      if (neuSrc !== altSrc && neuSrc !== maskeVon(altSrc)) return false
      continue
    }
    if (!daten.startsWith("beneos://") || (host && daten.toLowerCase().includes(host)) || schluesselfreiAdresse(daten) !== daten) return false
    if (attr.find((a) => a.name === "src")?.wert !== platzhalterMit(daten)) return false
  }
  return true
}

/**
 * Wandelt jede Bild-Toradresse mit Schluessel in Form (a) und heilt
 * beschaedigte Form (a). Rein bis auf das Lesen der Einstellungen.
 *
 * Alle anderen Attribute bleiben zeichengleich, auch `width` und `height`.
 * Eine fremde Adresse oder eine Adresse unter fremder Basis laesst
 * `schluesselfreiAdresse` stehen, und damit bleibt das Tag bytegleich.
 *
 * `<video>`, `<audio>` und `<source>` wandelt diese Stufe nicht: ein Bild als
 * Platzhalter spielte dort nicht, und keines davon geht ueber den Blob-Weg.
 * Sie bekommen im Textnetz Form (m), siehe dort. Gefundene mit Schluessel
 * werden in `andere` gezaehlt (Bestand am 17.11.2026: 0). Ein
 * anderes Attribut eines Bildes mit Toradresse, etwa `data-src`, wird frei.
 *
 * @returns {{html: string, zahl: number, heil: number, andere: number}}
 *   zahl: geaenderte Bilder, heil: davon geheilte
 */
export function htmlSchluesselfrei(html) {
  if (!streamKey() || !kandidat(html)) return { html, zahl: 0, heil: 0, andere: 0 }
  let zahl = 0
  let heil = 0
  let andere = 0
  const neu = html.replace(IMG_RE, (tag) => {
    const r = bildTag(tag)
    zahl += r.zahl
    heil += r.heil
    return r.tag
  })
  for (const tag of html.match(ANDERE_RE) ?? []) {
    const src = attribute(tag).find((a) => a.name === "src")
    if (src && schluesselfreiAdresse(src.wert) !== src.wert) andere++
  }
  return { html: zahl ? neu : html, zahl, heil, andere }
}

/*
 * DAS TEXTNETZ (stre-T-142 B2). Die Bildstufe oben wandelt nur `<img>`; eine
 * Toradresse in einem Link oder im Text stand mit Schluessel auf der Platte.
 *
 * `href` bekommt NIE `beneos://`: Foundrys Bereinigung verwirft jedes `href`
 * ausserhalb von `ALLOWED_URL_SCHEMES` (v13 common/constants.mjs:1809, v14
 * :1923), der Link waere tot (gemessen am 18.11.2026 in v13 13.351). Ein Link
 * bekommt darum die Maske (Schluesselstueck `-`) und die freie Form daneben in
 * `data-beneos-href`; den Klick loest `stream-bilder.mjs` auf, nur im DOM.
 *
 * Was bleibt:
 * - `<img>` gehoert der Bildstufe (Form (a)).
 * - `<video>`, `<audio>`, `<source>` (stre-T-147): Form (m). `src` und `poster`
 *   tragen die Maske, `data-beneos-src` und `data-beneos-poster` die freie Form;
 *   die Toradresse mit Schluessel setzt `medienAnzeigen` in `stream-bilder.mjs`
 *   nur im DOM. `srcset` geht je Eintrag denselben Weg, die freie Form steht in
 *   `data-beneos-srcset` (stre-T-148).
 * - Ein ganzer Wert, der nur eine Toradresse ist, gehoert den Feldlisten der
 *   Leinwand und `seitenSrc`. Er hat dort einen Anzeigeweg oder bleibt bewusst
 *   stehen (Videoseite, Karte); hier zu wandeln braeche seine Anzeige.
 *   Ausgenommen sind Textfelder (`TEXT_FELDER`, Kalt-Review K1): ein Chat, der nur
 *   einen Link traegt, ist Text und wird frei wie jeder andere.
 * - `style` mit `url()` und `<iframe>`: dort gibt es keinen Anzeigeweg fuer
 *   beneos://, sie bleiben (Kalt-Review W3). Jedes andere Tag
 *   wird frei wie Text, etwa `title` oder `data-tooltip` (Nachpruefung).
 * - Fremde Flags, wie oben.
 */
const GANZE_TORADRESSE = new RegExp(`^${TOR_IM_TEXT.source}$`, "i")

/*
 * Die Textfelder, deren ganzer Wert auch eine einzelne Toradresse sein darf:
 * der letzte Teil des Schluessels, auch in flachen Pfaden wie `text.content`.
 * ChatMessage content und flavor, JournalEntryPage text.content.
 * `value` fehlt bewusst: der Schluessel kennt hier nur den letzten Teil, und
 * ein Systemfeld `system.<x>.value` kann ein Bild- oder Klangpfad ohne
 * Anzeigeweg sein. Beschreibungen (system.description.value) werden trotzdem
 * frei, sobald Text oder HTML um die Adresse steht; nur ein Wert, der allein
 * aus einer Toradresse besteht, bleibt dort stehen (der Export maskiert ihn).
 */
const TEXT_FELDER = new Set(["content", "flavor", "text", "markdown", "caption", "description", "public", "notes", "biography", "chat"])
function istTextfeld(schluessel) {
  return typeof schluessel === "string" && TEXT_FELDER.has(schluessel.slice(schluessel.lastIndexOf(".") + 1))
}

/** Hat der Text eine Toradresse unter einem Host der Zone (stre-T-153)? */
function textKandidat(text) {
  return typeof text === "string" && zoneImText(text)
}

/** Eine Toradresse mit Schluessel im Text: frei, sonst die Maske. */
function imText(text, zaehler) {
  return text.replace(TOR_IM_TEXT, (adresse) => {
    const neu = wandle(adresse)
    if (neu !== adresse) zaehler.n++
    return neu
  })
}

/**
 * Ein `<a>`-Tag: `href` maskiert, die freie Form in `data-beneos-href`.
 * Ein Medientag geht denselben Weg je Paar aus `MEDIEN_PAARE`; `lassen` nennt
 * die Attribute, die dabei nicht frei werden.
 */
function linkTag(tag, zaehler, haupt = "href", datenName = "data-beneos-href", lassen = []) {
  const attr = attribute(tag)
  // Ganze Werte auch ohne Anfuehrung mit `=` (stre-T-154), wie srcset in T-148.
  const href = ganzerWert(tag, attr.find((a) => a.name === haupt))
  const daten = ganzerWert(tag, attr.find((a) => a.name === datenName))
  const tausch = []
  let frei = null
  if (href?.wert) {
    const f = schluesselfreiAdresse(href.wert)
    // Je Treffer, nicht am ganzen Wert: `maskiere` ist verankert und liesse
    // einen Wert mit fuehrendem Leerraum stehen (Kalt-Review 19.11.2026, W2).
    const maske = href.wert.replace(TOR_IM_TEXT, maskiere)
    if (f !== href.wert) frei = f
    if (maske !== href.wert) tausch.push([href.anfang, href.ende, attributText(haupt, maske, href.anfuehrung)])
  }
  // Ein eingefuegtes Attribut mit Toradresse wird frei wie der Text.
  if (daten?.wert && !frei) {
    const f = wandle(daten.wert)
    if (f !== daten.wert) frei = f
  }
  if (frei) {
    const text = attributText(datenName, frei, daten?.anfuehrung || href?.anfuehrung || '"')
    if (daten) tausch.push([daten.anfang, daten.ende, text])
    else if (href) tausch.push([href.ende, href.ende, ` ${text}`])
  }
  for (const a of attr) {
    if (a.name === haupt || a.name === datenName || a.name === "style" || lassen.includes(a.name) || !a.wert) continue
    const z = { n: 0 }
    const neu = imText(a.wert, z)
    if (z.n) tausch.push([a.anfang, a.ende, attributText(a.name, neu, a.anfuehrung)])
  }
  const neu = tausch.length ? ersetze(tag, tausch) : tag
  if (neu !== tag) zaehler.n++
  return neu
}

/** Ein Medientag, stre-T-147: jedes Paar aus `MEDIEN_PAARE` in Form (m). */
function medienTag(tag, zaehler) {
  const z = { n: 0 }
  let neu = tag
  // Die uebrigen Attribute macht schon der erste Aufruf frei, `srcset` folgt danach.
  for (const [haupt, datenName] of MEDIEN_PAARE) neu = linkTag(neu, z, haupt, datenName, MEDIEN_LASSEN)
  neu = medienSrcset(neu)
  if (neu !== tag) zaehler.n++
  return neu
}

/**
 * `srcset` eines Medientags in Form (m), stre-T-148: jeder Eintrag mit
 * Toradresse bekommt die Maske, `data-beneos-srcset` traegt je Eintrag die
 * freie Form, und wo der Rundlauf scheitert, dieselbe Maske. Ein Eintrag ohne
 * Toradresse steht in beiden gleich; ersetzt werden nur die Adressen. Den
 * Schluessel setzt `medienAnzeigen` nur im DOM. Ohne Toradresse im Wert bleibt
 * das Tag zeichengleich. Ein zweites `srcset`, das der Browser nicht liest, wird
 * nur maskiert.
 */
function medienSrcset(tag) {
  const attr = attribute(tag)
  const [satz, ...weitere] = attr.filter((a) => a.name === "srcset").map((a) => ganzerWert(tag, a))
  const [daten, ...weitereDaten] = attr.filter((a) => a.name === "data-beneos-srcset")
  const tausch = []
  for (const a of weitere) {
    const maske = a.wert.replace(TOR_IM_TEXT, maskiere)
    if (maske !== a.wert) tausch.push([a.anfang, a.ende, attributWert(tag, a, maske)])
  }
  // Ein zweites data-beneos-srcset liest niemand; eine Toradresse darin wird frei (Befund 4).
  for (const a of weitereDaten) {
    const z = { n: 0 }
    const neu = imText(a.wert, z)
    if (z.n) tausch.push([a.anfang, a.ende, attributText("data-beneos-srcset", neu, a.anfuehrung)])
  }
  if (satz?.wert && srcsetMitTor(satz.wert)) {
    const maske = satz.wert.replace(TOR_IM_TEXT, maskiere)
    if (maske !== satz.wert) tausch.push([satz.anfang, satz.ende, attributWert(tag, satz, maske)])
    // Gewandelt wird je Toradresse, nicht je Adressstueck: stehen zwei in einem
    // Stueck (`a,b` ohne Leerraum), kaeme sonst der Schluessel der zweiten kodiert
    // in die freie Form der ersten (Nachpruefung 19.11.2026, Befund 1). Erst je
    // Adresse, damit ein Komma am Adressende Trenner bleibt, dann der Rest des Werts.
    const frei = srcsetTausch(satz.wert, (a) => a.replace(TOR_IM_TEXT, wandle)).replace(TOR_IM_TEXT, wandle)
    const freiText = attributText("data-beneos-srcset", frei, daten?.anfuehrung || satz.anfuehrung || '"')
    if (daten) tausch.push([daten.anfang, daten.ende, freiText])
    else tausch.push([satz.ende, satz.ende, ` ${freiText}`])
  } else if (daten?.wert) {
    // Eine eingefuegte freie Form mit Toradresse wird frei wie der Text.
    const z = { n: 0 }
    const neu = imText(daten.wert, z)
    if (z.n) tausch.push([daten.anfang, daten.ende, attributText("data-beneos-srcset", neu, daten.anfuehrung)])
  }
  return tausch.length ? ersetze(tag, tausch) : tag
}

/** Ein anderes Tag: Adressattribute maskiert, die uebrigen frei, `style` bleibt. */
function tagFrei(tag, zaehler) {
  const tausch = []
  for (const a of attribute(tag)) {
    if (a.name === "style" || !a.wert) continue
    const z = { n: 0 }
    const neu = ADRESS_ATTRIBUTE.has(a.name)
      ? a.wert.replace(TOR_IM_TEXT, (x) => { const m = maskiere(x); if (m !== x) z.n++; return m })
      : imText(a.wert, z)
    if (z.n) tausch.push([a.anfang, a.ende, attributText(a.name, neu, a.anfuehrung)])
  }
  if (!tausch.length) return tag
  zaehler.n++
  return ersetze(tag, tausch)
}

/**
 * Macht die Toradressen eines Textes schluesselfrei, ausser in den Tags von
 * `TEXTNETZ_LAESST` und in `style`.
 * Fuer jeden eigenen String, HTML oder nicht. Laeuft nach der Bildstufe.
 *
 * @returns {{text: string, zahl: number}} zahl: geaenderte Adressen und Links
 */
export function textSchluesselfrei(text, schluessel = "") {
  if (!streamKey() || !textKandidat(text)) return { text, zahl: 0 }
  if (!istTextfeld(schluessel) && GANZE_TORADRESSE.test(text.trim())) return { text, zahl: 0 }
  const zaehler = { n: 0 }
  const neu = text.replace(TAG_ODER_TEXT_RE, (stueck) => {
    if (!stueck.startsWith("<")) return imText(stueck, zaehler)
    if (KEIN_TAG.test(stueck)) return imText(stueck, zaehler)
    const name = tagName(stueck)
    if (LINK_TAGS.has(name)) return linkTag(stueck, zaehler)
    if (MEDIEN_TAGS.has(name)) return medienTag(stueck, zaehler)
    if (TEXTNETZ_LAESST.has(name)) return stueck
    return tagFrei(stueck, zaehler)
  })
  return zaehler.n ? { text: neu, zahl: zaehler.n } : { text, zahl: 0 }
}

/**
 * Die Gegenprobe fuer den Altseiten-Lauf, unabhaengig vom Wandler: ausserhalb
 * von `TEXTNETZ_LAESST` und `style` steht keine Toradresse mehr, die sich frei
 * machen liesse, kein Adressattribut zeigt auf `beneos://`, denn das verwirft
 * die Bereinigung, und ein `data-beneos-href` zeigt auf dasselbe Ziel wie die
 * Maske im `href` daneben (Nachpruefung).
 */
function nurLinkUndTextGetauscht(neu, unveraendert = null) {
  for (const stueck of neu.match(TAG_ODER_TEXT_RE) ?? []) {
    const istTag = stueck.startsWith("<") && !KEIN_TAG.test(stueck)
    const name = istTag ? tagName(stueck) : ""
    if (TEXTNETZ_LAESST.has(name)) continue
    const attr = istTag ? attribute(stueck) : []
    // Ein Medium mit alter Toradresse bleibt zulaessig, wie vor stre-T-147: die
    // Heilung nimmt nur Bilder, und eine Seite darf an einem alten Video nicht
    // scheitern. Steht Form (m), muessen Maske und freie Form zusammenpassen;
    // ohne freie Form darf die Adresse weder Maske noch `beneos:` sein, denn
    // dann spielte das Medium nicht mehr (Kalt-Review F3). Ein unveraendertes
    // Medium prueft `nurGeaenderte` nicht, wie ein unveraendertes Bild (F5).
    if (MEDIEN_TAGS.has(name)) {
      if (unveraendert?.has(stueck)) continue
      for (const [haupt, datenName] of MEDIEN_PAARE) {
        const wert = attr.find((a) => a.name === haupt)?.wert ?? ""
        const frei = attr.find((a) => a.name === datenName)?.wert
        if (frei ? !eigenerLink(wert, frei) : istMaskiert(wert) || /^beneos:/i.test(wert)) return false
      }
      if (!srcsetPasst(attr)) return false
      continue
    }
    const werte = istTag ? attr.filter((a) => a.name !== "style") : [{ name: "", wert: stueck }]
    for (const a of werte) {
      if (ADRESS_ATTRIBUTE.has(a.name) && /^beneos:/i.test(a.wert)) return false
      for (const adresse of a.wert.match(TOR_IM_TEXT) ?? []) {
        if (!istMaskiert(adresse) && schluesselfreiAdresse(adresse) !== adresse) return false
      }
    }
    const daten = attr.find((a) => a.name === "data-beneos-href")?.wert
    if (daten && !eigenerLink(attr.find((a) => a.name === "href")?.wert ?? "", daten)) return false
  }
  return true
}

/**
 * `srcset` und `data-beneos-srcset` passen Eintrag fuer Eintrag zusammen
 * (stre-T-148): gleiche Zahl, gleicher Deskriptor, eine freie Form gehoert zu
 * ihrer Maske, jeder andere Eintrag steht in beiden gleich und laesst sich
 * weder wandeln noch maskieren (Fremdadresse oder Maske ohne Rundlauf). Ohne freie Form darf kein Eintrag Maske oder `beneos:` sein,
 * wie bei `src` (Kalt-Review F3).
 */
function srcsetPasst(attr) {
  const leck = (w) => (String(w ?? "").match(TOR_IM_TEXT) ?? []).some((x) => maskiere(x) !== x)
  if (attr.some((a) => (a.name === "srcset" || a.name === "data-beneos-srcset") && leck(a.wert))) return false
  const satz = srcsetTeile(attr.find((a) => a.name === "srcset")?.wert)
  const daten = attr.find((a) => a.name === "data-beneos-srcset")?.wert
  if (daten === undefined) return satz.every((t) => !istMaskiert(t.adresse) && !/^beneos:/i.test(t.adresse))
  const frei = srcsetTeile(daten)
  if (frei.length !== satz.length) return false
  return frei.every((f, i) => f.rest === satz[i].rest && (/^beneos:/i.test(f.adresse)
    ? eigenerLink(satz[i].adresse, f.adresse)
    : f.adresse === satz[i].adresse && wandle(f.adresse) === f.adresse))
}

/**
 * Zeigt die freie Form auf dasselbe Ziel wie die Maske, unter einem Host der Zone?
 * Ein Anhang ab `?` oder `#` an der Maske (`#t=10`) zaehlt nicht mit: die freie
 * Form traegt ihn nicht (Kalt-Review F2).
 */
function eigenerLink(href, daten) {
  if (!istMaskiert(href) || !unterZone(href)) return false
  const maske = maskiere(leinwandAdresse(daten))
  return href === maske || (href.startsWith(maske) && /^[?#]/.test(href.slice(maske.length)))
}

/** Beide Stufen auf einen String: Bilder, dann der uebrige Text. */
function stringSchluesselfrei(wert, schluessel = "") {
  let neu = wert
  let zahl = 0
  if (kandidat(neu)) {
    const r = htmlSchluesselfrei(neu)
    if (r.zahl) { neu = r.html; zahl += r.zahl }
  }
  const t = textSchluesselfrei(neu, schluessel)
  if (t.zahl) { neu = t.text; zahl += t.zahl }
  return { neu, zahl }
}

/**
 * Die Bildadresse einer Journalseite (`pages[].src`), nur bei Seiten vom Typ
 * `image`. Video- und PDF-Seiten gehen nie ueber den Blob-Weg und laden ihre
 * Adresse direkt; eine schluesselfreie Form zeigte dort nichts.
 *
 * @returns {string|undefined} die neue Adresse, oder undefined ohne Aenderung
 */
export function seitenSrc(typ, src) {
  if (typ !== "image" || typeof src !== "string" || !streamKey()) return undefined
  const frei = schluesselfreiAdresse(src)
  return frei === src ? undefined : frei
}

/**
 * Wandelt alle HTML-Strings eines Wertes AN ORT UND STELLE, tief ueber Objekte
 * und Listen. Deckt damit jedes HTML-Feld ohne Feldliste ab, auch flache
 * Pfade wie `{"text.content": "..."}` aus einem Update.
 *
 * @returns {number} wie viele Adressen gewandelt wurden
 */
export function htmlTiefSchluesselfrei(wert, _tiefe = 0, _eltern = "") {
  if (_tiefe > 40 || !wert || typeof wert !== "object") return 0
  let zahl = 0
  // Ein Listenelement zaehlt unter dem Namen seiner Liste (Nachpruefung).
  const name = (k) => (Array.isArray(wert) ? _eltern : k)
  for (const k of Object.keys(wert)) {
    if (fremderFlagpfad(k)) continue
    const v = wert[k]
    if (istFlagsSchluessel(k) && isObj(v)) {
      // Eine Huelle mit nur dem eigenen Namensraum, an Ort und Stelle
      // gewandelt und zurueckgeschrieben; ein String darin wird ersetzt.
      const huelle = nurEigeneFlags(v)
      zahl += htmlTiefSchluesselfrei(huelle, _tiefe + 1)
      Object.assign(v, huelle)
      continue
    }
    if (typeof v === "string") {
      const r = stringSchluesselfrei(v, name(k))
      if (r.zahl) { wert[k] = r.neu; zahl += r.zahl }
    } else if (v && typeof v === "object") {
      zahl += htmlTiefSchluesselfrei(v, _tiefe + 1, name(k))
    }
  }
  return zahl
}

/**
 * Die kleinste Aenderung, die einen Quellwert schluesselfrei macht, fuer
 * `updateSource` oder `update`. Der Quellwert selbst bleibt unberuehrt.
 *
 * Listen aus Elementen mit eindeutiger `_id` (eingebettete Dokumente) gehen als
 * Teilaenderungen `{_id, ...}` hinaus, nur die geaenderten. Eine andere Liste
 * geht ganz hinaus, als Kopie mit den gewandelten Werten. Dieselbe Regel wie
 * beim Anlegen in `stream-leinwand.mjs`.
 *
 * Eine Seite (`type` und `src` im selben Objekt) bekommt dazu `seitenSrc`.
 *
 * @returns {{aenderung: object|null, zahl: number}}
 */
export function htmlAenderung(quelle, { streng = false } = {}) {
  const zaehler = { zahl: 0, streng, abweichung: false }
  const d = differenz(quelle, zaehler, 0, true)
  return { aenderung: d === undefined ? null : d, zahl: zaehler.zahl, abweichung: zaehler.abweichung }
}

/*
 * `dokument`: der Wert ist ein Dokument (die Wurzel, oder ein Element einer
 * eingebetteten Sammlung) bzw. eine Liste direkt an einem Dokument.
 *
 * Teilaenderungen nach `_id` gibt es NUR fuer Listen direkt an einem Dokument,
 * denn nur dort stehen Foundrys eingebettete Sammlungen (`pages`, `items`,
 * `effects`, `results`, `cards`), die nach `_id` zusammenfuehren. Eine Liste
 * mit `_id` tiefer, etwa `system.advancement`, ist ein gewoehnliches Feld; ein
 * Teil davon ersetzte die ganze Liste (Kalt-Review W5).
 *
 * `seite`: der Wert ist ein Dokument oder ein Element einer Liste direkt an
 * einem Dokument; nur dort gilt `type` mit `src` als Seite. Das ist eine
 * eigene Rolle neben `dokument`: eine Bildseite in einem neuen Journal hat noch
 * keine `_id`, ihre Liste geht ganz hinaus, und sie ist trotzdem eine Seite
 * (Nachpruefung 17.11.2026, Befund 1).
 */
function differenz(wert, zaehler, tiefe, dokument, seite = dokument, schluessel = "") {
  if (tiefe > 40) return undefined
  if (typeof wert === "string") {
    const r = stringSchluesselfrei(wert, schluessel)
    if (!r.zahl) return undefined
    if (zaehler.streng && !nurBildadressenGetauscht(wert, r.neu)) zaehler.abweichung = true
    zaehler.zahl += r.zahl
    return r.neu
  }
  if (Array.isArray(wert)) {
    const ids = wert.map((e) => e?._id)
    const eindeutig = dokument && ids.length > 0 && ids.every((id) => typeof id === "string" && id) && new Set(ids).size === ids.length
    // Nur die Elemente einer eingebetteten Sammlung sind Dokumente. Eine Liste,
    // die ganz hinausgeht, geht auch darunter ganz.
    const teile = wert.map((e) => differenz(e, zaehler, tiefe + 1, eindeutig, dokument, schluessel))
    if (teile.every((t) => t === undefined)) return undefined
    if (eindeutig) return teile.flatMap((t, i) => (t === undefined ? [] : [{ ...t, _id: ids[i] }]))
    return wert.map((e, i) => (teile[i] === undefined ? kopie(e) : (isObj(e) ? zusammen(kopie(e), teile[i]) : teile[i])))
  }
  if (isObj(wert)) {
    const aus = {}
    for (const [k, v] of Object.entries(wert)) {
      if (fremderFlagpfad(k)) continue
      if (istFlagsSchluessel(k) && isObj(v)) {
        const t = differenz(nurEigeneFlags(v), zaehler, tiefe + 1, false)
        if (t !== undefined) aus[k] = t
        continue
      }
      const unten = dokument && Array.isArray(v)
      const t = differenz(v, zaehler, tiefe + 1, unten, unten, k)
      if (t !== undefined) aus[k] = t
    }
    if (seite) {
      const src = seitenSrc(wert.type, wert.src)
      if (src !== undefined) { aus.src = src; zaehler.zahl++ }
    }
    return Object.keys(aus).length ? aus : undefined
  }
  return undefined
}

function isObj(w) { return !!w && typeof w === "object" && !Array.isArray(w) }
function kopie(w) { return w && typeof w === "object" ? JSON.parse(JSON.stringify(w)) : w }
function zusammen(ziel, teil) {
  for (const [k, v] of Object.entries(teil)) {
    ziel[k] = isObj(v) && isObj(ziel[k]) ? zusammen(ziel[k], v) : v
  }
  return ziel
}

/**
 * Die Arten, deren HTML das Schreibnetz und der Altseiten-Lauf pruefen: jede
 * Art mit HTML-Feldern, die der Installer schreibt, dazu der Chat als
 * Vorsorge (Bestand 0). Eingebettete Dokumente feuern beim eigenen Anlegen und
 * Aendern ihre eigenen Haken; deshalb stehen Tabellenergebnisse, Karten und
 * Effekte mit HTML-Feldern hier selbst (Kalt-Review W4). Der Altseiten-Lauf
 * nimmt sie ueber ihr Elterndokument mit.
 */
export const HTML_ARTEN = Object.freeze(["JournalEntry", "JournalEntryPage", "Actor", "Item", "ChatMessage", "RollTable",
  "TableResult", "Cards", "Card", "ActiveEffect"])

/**
 * Das Schreibnetz fuer HTML (Messung M5 vom 17.11.2026 war rot: eine
 * eingefuegte Toradresse mit Schluessel stand nach dem Speichern so auf der
 * Platte). Jede Schluessel-Toradresse in HTML wird beim Schreiben in Form (a)
 * gewandelt, auch wenn der Editor sie liefert.
 *
 * Gleiches Muster wie das Netz in `stream-leinwand.mjs`: beim Update an Ort und
 * Stelle im Aenderungsobjekt, beim Anlegen ueber `updateSource`, ohne
 * Schluessel ein Fruehausstieg, und ein Fehler haelt das Speichern nie auf.
 * Eigene Funktion statt Eintraege in `SCHREIB_FELDER`: jenes Netz arbeitet mit
 * Feldlisten und verlangt je Art einen Eintrag in `LEINWAND_FELDER`; ein
 * Eintrag ohne diesen warf im `init` (Kalt-Review des Plans, 17.11.2026).
 *
 * Unbedingt eingebaut, am Schluessel geprueft, wie die Leinwand.
 */
let netzGesetzt = false
export function installHtmlNetz() {
  if (netzGesetzt) return
  netzGesetzt = true
  for (const art of HTML_ARTEN) {
    Hooks.on(`preUpdate${art}`, (doc, aenderung) => {
      if (!streamKey()) return
      try { htmlTiefSchluesselfrei(aenderung) } catch (_) { /* das Speichern geht vor */ }
      try { seitenImUpdate(art, doc, aenderung) } catch (_) { /* das Speichern geht vor */ }
    })
    Hooks.on(`preCreate${art}`, (doc) => {
      if (!streamKey()) return
      try {
        const { aenderung } = htmlAenderung(doc?._source)
        if (aenderung) doc.updateSource(aenderung)
      } catch (_) { /* das Anlegen geht vor */ }
    })
  }
}

/**
 * `src` einer Bildseite im Update. Der Typ steht im Update nur, wenn er sich
 * aendert; sonst gilt der des Dokuments bzw. der eingebetteten Seite.
 */
function seitenImUpdate(art, doc, aenderung) {
  if (art === "JournalEntryPage") {
    const typ = aenderung.type ?? doc?.type
    const neu = seitenSrc(typ, aenderung.src)
    if (neu !== undefined) aenderung.src = neu
    return
  }
  if (art === "JournalEntry" && Array.isArray(aenderung.pages)) {
    for (const seite of aenderung.pages) {
      if (!isObj(seite)) continue
      const typ = seite.type ?? doc?.pages?.get?.(seite._id)?.type
      const neu = seitenSrc(typ, seite.src)
      if (neu !== undefined) seite.src = neu
    }
  }
}

/**
 * Altseiten beim Start (Entscheid E4): stellt Dokumente um, die vor stre-T-116
 * eine Toradresse mit Schluessel ins HTML bekommen haben.
 *
 * Nur fuer den GM und nur mit Schluessel. Schreibt je Dokument nur die
 * geaenderten Felder, eingebettete Dokumente gebuendelt ueber
 * `updateEmbeddedDocuments`. Nach dem ersten Lauf findet er nichts mehr und
 * kostet einen Durchlauf ueber die Sammlungen.
 *
 * Nur die Weltsammlungen, keine Kompendien.
 *
 * @param {{trocken?: boolean}} optionen trocken: nur zaehlen, nichts schreiben
 * @returns {Promise<{dokumente:number, adressen:number, fehler:number, trocken:boolean}>}
 */
export async function altseitenUmstellen({ trocken = false } = {}) {
  const bericht = { dokumente: 0, adressen: 0, fehler: 0, trocken }
  if (!streamKey() || !globalThis.game?.user?.isGM) return bericht
  const g = globalThis.game
  for (const sammlung of [g.journal, g.actors, g.items, g.tables, g.cards, g.messages]) {
    for (const doc of sammlung ?? []) {
      try {
        const quelle = doc.toObject()
        const eingebettet = doc.constructor?.metadata?.embedded ?? {}
        const eigen = { ...quelle }
        for (const feld of Object.values(eingebettet)) delete eigen[feld]
        // Auflage 1 (orch P-13:25): je Dokument und je eingebetteter Seite
        // geprueft, ob nur Bildadressen getauscht wurden. Sonst wird dieser
        // Teil nicht geschrieben, als Fehler gezaehlt und mit Kennung gemeldet.
        const abgewiesen = (wo) => {
          bericht.fehler++
          console.warn(`Beneos Stream | Altseiten: ${doc.documentName ?? "Dokument"} ${doc.id ?? "?"}${wo}`
            + " nicht geschrieben, der Text wich ausser den Bildadressen ab")
        }
        let { aenderung, zahl, abweichung } = htmlAenderung(eigen, { streng: true })
        if (aenderung && abweichung) { abgewiesen(""); aenderung = null; zahl = 0 }
        const kinder = []
        let kinderZahl = 0
        for (const [klasse, feld] of Object.entries(eingebettet)) {
          const teile = []
          for (const kind of Array.isArray(quelle[feld]) ? quelle[feld] : []) {
            const r = htmlAenderung(kind, { streng: true })
            if (!r.aenderung) continue
            if (r.abweichung || !kind?._id) { abgewiesen(` ${klasse} ${kind?._id ?? "?"}`); continue }
            kinderZahl += r.zahl
            teile.push({ ...r.aenderung, _id: kind._id })
          }
          if (teile.length) kinder.push([klasse, teile])
        }
        if (!aenderung && !kinder.length) continue
        bericht.dokumente++
        bericht.adressen += zahl + kinderZahl
        if (trocken) continue
        if (aenderung) await doc.update(aenderung)
        for (const [klasse, teile] of kinder) await doc.updateEmbeddedDocuments(klasse, teile)
      } catch (_) {
        bericht.fehler++
      }
    }
  }
  console.log(`Beneos Stream | Altseiten${trocken ? " (trocken)" : ""}: ${bericht.dokumente} Dokumente, `
    + `${bericht.adressen} Adressen, ${bericht.fehler} Fehler`)
  return bericht
}
