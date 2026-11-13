/**
 * stream-platzhalter.test.mjs
 *
 * Gegenprobe zur schluesselfreien Adressform. Laeuft ohne Foundry und ohne
 * Browser:
 *
 *   node scripts/stream/stream-platzhalter.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. Seit dem 08.11.2026 schreibt der Installer in ein
 * Kundendokument nicht mehr die Toradresse samt Streamschluessel, sondern
 * `beneos://<raum>/<release>/<pfad...>`. Erst der Blob-Helfer baut daraus zur
 * Anzeige die Adresse von heute. Siehe `OP-PRJ-137` und `OP-PRJ-179`.
 *
 * DIE EINE AUSSAGE, DIE ALLES TRAEGT, ist der Umlauf: eine Datei, in die
 * schluesselfreie Form gebracht, wieder zerlegt und neu gebaut, muss
 * ZEICHENGLEICH dieselbe Toradresse ergeben wie der direkte Weg. Ohne diesen
 * Satz waere jede Einzelpruefung nur die Behauptung, zwei Bauer meinten
 * dasselbe.
 *
 * DIE GEGENFAELLE SIND DIE HAELFTE, DIE ZAEHLT:
 *
 * - Der Schluessel darf in KEINER Platzhalteradresse vorkommen. Das ist der
 *   Zweck des ganzen Umbaus, und ein Satz, der ihn nicht sucht, prueft ihn
 *   nicht.
 * - Ein Grossbuchstabe im Raum ist KEIN Raum. Gemessen am 08.11.2026: bei
 *   einem unbekannten Schema normalisiert `URL` den Host nicht klein, `C` und
 *   `c` waeren also zwei Raeume. Deshalb wird diese Form an der Zeichenkette
 *   zerlegt und `beneos://C/...` abgewiesen.
 * - Ein einziger Schraegstrich (`beneos:/c/...`) ist nicht die Form.
 * - Die Laengenregel des geteilten Raumes gilt in BEIDEN Formen. Sie ist nicht
 *   Zierwerk: die Route am Tor laesst genau fuenf Stuecke zu.
 *
 * LAEUFT IM VORHAKEN MIT, und das war beim ersten Commit NICHT so. Der
 * Haken zaehlte die Streamstaende namentlich auf, und diese Datei stand
 * in der Aufzaehlung nicht; sie lag im selben Commit, traf den Ausloeser
 * `scripts/stream/` und lief trotzdem nicht. Seit dem 08.11.2026 kommt
 * die Liste dort aus dem Verzeichnis, mit einer Mindestzahl gegen die
 * leere Suche. Was das fuer diese Datei heisst: sie muss OHNE Netz, OHNE
 * Foundry und in etwa einer Sekunde laufen, sonst haelt sie jeden Commit
 * dieses Ordners auf.
 *
 * DIE ZAHL DER AUSSAGEN STEHT AM ENDE und wird von Hand nachgezogen. Grund:
 * ein Lauf, der mittendrin stirbt, meldet sonst weniger Faelle und null rote,
 * und das ist von einem bestandenen Lauf nicht zu unterscheiden.
 */
import {
  assetUrl,
  platzhalterAdresse,
  adressSegmente,
  zerlegeAdresse,
  istPlatzhalter,
  streamBase,
  PLATZHALTER_SCHEMA,
  STREAM_RAUM_BUCHSTABE,
  SETTING,
} from "./stream-settings.mjs"

/*
 * DER HOST MUSS IN DER ERLAUBNISLISTE LIEGEN, sonst faellt `streamBase()`
 * auf die Vorgabe zurueck und diese Attrappe wirkt nicht. Meine erste
 * Fassung nahm `stream.beneos-battlemaps.com`, und `erlaubteBasis()` wies
 * ihn ab: erlaubt ist allein die Zone `beneos.stream`, gemessen in
 * `stream-basis.test.mjs`. Der Satz, der den Host in der echten Adresse
 * sucht, war dadurch rot, und ohne ihn haette die Attrappe still nichts
 * gesetzt.
 */
const GATE = "https://gate2.beneos.stream"
const SCHLUESSEL = "pk_pruefsatz_geheim"

/*
 * DIE NAMEN DER EINSTELLUNGEN KOMMEN AUS `SETTING` UND SIND NICHT GETIPPT.
 *
 * Meine erste Fassung dieser Attrappe hat sie geraten (`"streamKey"` statt
 * `"beneos-stream-key"`). Die Folge war still und genau die gefaehrliche
 * Sorte: `streamKey()` gab eine leere Zeichenkette, die Toradressen trugen
 * `/c//` mit einem leeren Stueck, und der Satz "kein Streamschluessel darin"
 * war GRUEN, weil in der Adresse ueberhaupt kein Schluessel stand. Gefangen hat
 * das allein die Gegenprobe, die verlangt, dass die ECHTE Toradresse den
 * Schluessel enthaelt.
 */
globalThis.game = {
  settings: {
    get(_modul, name) {
      if (name === SETTING.key) return SCHLUESSEL
      if (name === SETTING.base) return GATE
      if (name === SETTING.mode) return true
      return ""
    },
  },
  i18n: { localize: (s) => s, format: (s) => s },
}

let rot = 0
let gruen = 0
let aussagen = 0

function gleich(name, ist, soll) {
  aussagen++
  const ok = JSON.stringify(ist) === JSON.stringify(soll)
  if (ok) { gruen++; console.log(`  ok   ${name}`) }
  else {
    rot++
    console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}`
      + `\n       ist  ${JSON.stringify(ist)}`)
  }
}

/*
 * DIE HERKUNFT DER FUNKTIONEN WIRD GEFRAGT, und zwar bevor irgendetwas
 * gemessen wird.
 *
 * Ohne diese Frage ist ein Lauf gegen eine kaputte Kopie von einem Lauf gegen
 * den Bestand nicht zu unterscheiden: eine Einstiegsdatei, die die Funktion
 * nicht exportiert, wirft erst beim Aufruf, und wer eine Sabotage faehrt,
 * liest dann einen roten Lauf als Treffer. Derselbe Mangel lag bis zum
 * 08.11.2026 in zwei Pruefstaenden des Servers.
 */
for (const [name, f] of Object.entries({
  assetUrl, platzhalterAdresse, adressSegmente, zerlegeAdresse, istPlatzhalter,
})) {
  if (typeof f !== "function") {
    console.log(`NICHT PRUEFBAR: "${name}" ist keine Funktion, sondern `
      + `${typeof f}. Der Lauf messe nichts und bricht ab.`)
    process.exit(2)
  }
}
if (typeof PLATZHALTER_SCHEMA !== "string" || !PLATZHALTER_SCHEMA) {
  console.log("NICHT PRUEFBAR: PLATZHALTER_SCHEMA fehlt oder ist leer.")
  process.exit(2)
}

/*
 * Je Raum eine Probe. Der geteilte Raum braucht eine echte Pruefsumme von 64
 * Zeichen, sonst faellt er in den Kartenzweig.
 */
const PROBEN = {
  karte: { release: "beneos_bm_0113", variant: "4k", pfad: "karte.webp" },
  kreatur: {
    release: "beneos_ct_000-barovian_direwolf",
    variant: "",
    pfad: "000-barovian_direwolf-1-journal.webp",
  },
  beute: {
    release: "beneos_lt_000-sunblade",
    variant: "",
    pfad: "000-sunblade-front.webp",
  },
  geteilt: {
    release: "shared",
    variant: "b".repeat(64),
    pfad: "foundry_bm_ui.webp",
    // Seit T-056: das Release, ueber das das Tor das Recht prueft.
    traeger: { release: "beneos_bm_0113", variant: "4k" },
  },
}

console.log("Jeder Raum hat eine schluesselfreie Form, und sie traegt den "
  + "Raumbuchstaben")
{
  for (const [raum, buchstabe] of Object.entries(STREAM_RAUM_BUCHSTABE)) {
    const p = PROBEN[raum]
    gleich(`Raum "${raum}" hat eine Probe`, !!p, true)
    if (!p) continue
    const a = platzhalterAdresse(p.release, p.variant, p.pfad, p.traeger)
    gleich(`"${raum}" beginnt mit dem Schema und dem Buchstaben`,
      a.startsWith(`${PLATZHALTER_SCHEMA}//${buchstabe}/`), true)
  }
  /*
   * DIE GESAMTMENGE, und nicht nur die Raeume, die ich aufgezaehlt habe. Die
   * Schleife darueber laeuft ueber die Tabelle; sie kann nicht sehen, dass die
   * Tabelle einen Raum NICHT nennt, den `adressSegmente` baut. Die Gegenzahl
   * entsteht deshalb am Quelltext, an derselben Stelle wie in
   * `stream-maske.test.mjs` und aus demselben Grund.
   */
  const ausTabelle = Object.values(STREAM_RAUM_BUCHSTABE).sort().join(",")
  gleich("vier Raeume, und ich habe fuer jeden eine Probe",
    Object.keys(PROBEN).sort().join(","),
    Object.keys(STREAM_RAUM_BUCHSTABE).sort().join(","))
  gleich("die Buchstaben der Tabelle sind die vier erwarteten",
    ausTabelle, "a,c,l,s")
}

console.log("Der Umlauf, und er ist die Aussage, die alles traegt")
{
  for (const [raum, p] of Object.entries(PROBEN)) {
    const direkt = assetUrl(p.release, p.variant, p.pfad, p.traeger)
    const ohne = platzhalterAdresse(p.release, p.variant, p.pfad, p.traeger)
    const t = zerlegeAdresse(ohne)
    gleich(`"${raum}": die schluesselfreie Form ist zerlegbar`, !!t, true)
    if (!t) continue
    gleich(`"${raum}": und sie nennt denselben Raum`, t.raum, raum)
    const zurueck = assetUrl(t.release, t.variant, t.pfad, t.traeger)
    gleich(`"${raum}": der Umlauf ergibt zeichengleich dieselbe Toradresse`,
      zurueck, direkt)
  }
}

console.log("Der Schluessel kommt in keiner schluesselfreien Form vor")
{
  for (const [raum, p] of Object.entries(PROBEN)) {
    const ohne = platzhalterAdresse(p.release, p.variant, p.pfad, p.traeger)
    gleich(`"${raum}": kein Streamschluessel darin`,
      ohne.includes(SCHLUESSEL), false)
    gleich(`"${raum}": und auch kein Tor-Host`,
      ohne.includes(streamBase()), false)
  }
  /*
   * GEGENPROBE AUF DIE GEGENPROBE. Zwei Suchen, die nichts finden, sind von
   * zwei kaputten Suchen nicht zu unterscheiden. Dieselben zwei Suchen MUESSEN
   * in der echten Toradresse treffen, sonst sucht der Satz darueber nach einer
   * Zeichenkette, die nirgends vorkommt.
   */
  const p = PROBEN.kreatur
  const direkt = assetUrl(p.release, p.variant, p.pfad, p.traeger)
  gleich("die echte Toradresse traegt den Schluessel, sonst sucht der Satz "
    + "darueber ins Leere", direkt.includes(SCHLUESSEL), true)
  gleich("und den Host", direkt.includes(streamBase()), true)
}

console.log("istPlatzhalter: was die Form ist und was sie nicht ist")
{
  gleich("die gebaute Form", istPlatzhalter(
    platzhalterAdresse("beneos_ct_x", "", "y.webp")), true)
  gleich("das Schema gross geschrieben zaehlt auch",
    istPlatzhalter("BENEOS://c/x/y.webp"), true)
  gleich("eine echte Toradresse ist keine", istPlatzhalter(
    assetUrl("beneos_ct_x", "", "y.webp")), false)
  gleich("ein einziger Schraegstrich ist nicht die Form",
    istPlatzhalter("beneos:/c/x/y.webp"), false)
  gleich("ein fremdes Schema ist es nicht",
    istPlatzhalter("fremd://c/x/y.webp"), false)
  gleich("ein oertlicher Pfad ist es nicht",
    istPlatzhalter("beneos_assets/cloud/tokens/x/y.webp"), false)
  gleich("die leere Zeichenkette", istPlatzhalter(""), false)
  gleich("nichts", istPlatzhalter(null), false)
  gleich("eine Zahl", istPlatzhalter(42), false)
  /*
   * Das Schema allein macht keine Adresse. `beneos://` ohne alles waere
   * formal die Form, hat aber keine Stuecke; `zerlegeAdresse` muss sie
   * abweisen, und DAS ist der Satz, der zaehlt.
   */
  gleich("das nackte Schema gilt als Form", istPlatzhalter("beneos://"), true)
  gleich("ist aber nicht zerlegbar", zerlegeAdresse("beneos://"), null)
}

console.log("Ein Grossbuchstabe im Raum ist kein Raum")
{
  /*
   * GEMESSEN AM 08.11.2026, und das ist der Grund fuer die Zerlegung an der
   * Zeichenkette: `new URL("beneos://C/x/y").host` gibt ein GROSSES `C`
   * zurueck, weil `URL` bei einem unbekannten Schema nicht normalisiert. Wer
   * diese Form ueber `URL` zerlegte und den Host klein schriebe, haette zwei
   * Schreibweisen fuer einen Raum; wer ihn nicht klein schriebe, haette einen
   * Raum, den der Bauer nie baut.
   */
  gleich("beneos://C/... ist nicht zerlegbar",
    zerlegeAdresse("beneos://C/beneos_ct_x/y.webp"), null)
  gleich("beneos://A/... auch nicht",
    zerlegeAdresse("beneos://A/bm_0113/4k/y.webp"), null)
  gleich("der kleine Buchstabe dagegen schon",
    zerlegeAdresse("beneos://c/beneos_ct_x/y.webp")?.raum, "kreatur")
}

console.log("Die Laengenregel des geteilten Raumes gilt in beiden Formen")
{
  /*
   * SIEBEN STUECKE SEIT T-056, in beiden Formen: die Platzhalterform hat kein
   * Schluesselstueck, `zerlegeAdresse` fuellt es mit einem Strich auf. Die
   * alte fuenfteilige Form ohne Release gilt als fremd, wie am Tor.
   */
  const sha = "c".repeat(64)
  gleich("sieben Stuecke mit echter Pruefsumme gehen durch",
    zerlegeAdresse(`beneos://s/beneos_bm_0113/4k/shared/${sha}/datei.webp`)?.variant, sha)
  gleich("die alte Form ohne Release nicht",
    zerlegeAdresse(`beneos://s/shared/${sha}/datei.webp`), null)
  gleich("eine zu kurze Pruefsumme nicht",
    zerlegeAdresse("beneos://s/beneos_bm_0113/4k/shared/abc/datei.webp"), null)
  gleich("ein achtes Stueck nicht",
    zerlegeAdresse(`beneos://s/beneos_bm_0113/4k/shared/${sha}/tief/datei.webp`), null)
  gleich("ein falscher Raumname nicht",
    zerlegeAdresse(`beneos://s/beneos_bm_0113/4k/fremd/${sha}/datei.webp`), null)
  // Gegenprobe: dieselben Faelle in der Toradressform. Weicht einer ab,
  // tragen die zwei Formen zwei Regeln.
  gleich("und dasselbe in der Toradressform, kurz",
    zerlegeAdresse(`${GATE}/s/${SCHLUESSEL}/beneos_bm_0113/4k/shared/abc/datei.webp`), null)
  gleich("und dasselbe in der Toradressform, alte Form",
    zerlegeAdresse(`${GATE}/s/${SCHLUESSEL}/shared/${sha}/datei.webp`), null)
  gleich("und dasselbe in der Toradressform, lang",
    zerlegeAdresse(`${GATE}/s/${SCHLUESSEL}/beneos_bm_0113/4k/shared/${sha}/datei.webp`)?.variant,
    sha)
}

console.log("Ein Unterpfad behaelt seine Schraegstriche, ein Sonderzeichen "
  + "wird kodiert")
{
  const a = platzhalterAdresse("beneos_bm_0113", "4k", "tief/drin/karte.webp")
  gleich("der Unterpfad steht ganz darin",
    a, `${PLATZHALTER_SCHEMA}//a/beneos_bm_0113/4k/tief/drin/karte.webp`)
  gleich("und er kommt beim Zerlegen zurueck",
    zerlegeAdresse(a)?.pfad, "tief/drin/karte.webp")
  const b = platzhalterAdresse("beneos_ct_x", "", "mit raum & zeichen.webp")
  gleich("ein Leerzeichen wird kodiert", b.includes(" "), false)
  gleich("und kommt dekodiert zurueck",
    zerlegeAdresse(b)?.pfad, "mit raum & zeichen.webp")
  // Der fuehrende Schraegstrich faellt, in beiden Formen gleich.
  gleich("ein fuehrender Schraegstrich im Pfad faellt",
    platzhalterAdresse("beneos_ct_x", "", "/y.webp"),
    platzhalterAdresse("beneos_ct_x", "", "y.webp"))
}

console.log("Beide Bauer nehmen dieselbe Raumentscheidung, gemessen an der "
  + "Ausgabe")
{
  /*
   * WARUM DAS NICHT SCHON OBEN STEHT. Der Umlauf prueft, dass aus der
   * schluesselfreien Form dieselbe Toradresse wird. Er wuerde aber auch gruen
   * bleiben, wenn BEIDE Bauer denselben falschen Raum waehlten. Dieser Satz
   * haelt die Segmentliste dagegen, also die Stelle, an der die Entscheidung
   * wirklich faellt.
   */
  for (const [raum, p] of Object.entries(PROBEN)) {
    const seg = adressSegmente(p.release, p.variant, p.pfad, p.traeger)
    gleich(`"${raum}": die Segmentliste nennt den Buchstaben zuerst`,
      seg[0], STREAM_RAUM_BUCHSTABE[raum])
    gleich(`"${raum}": und die schluesselfreie Form ist genau diese Liste`,
      platzhalterAdresse(p.release, p.variant, p.pfad, p.traeger),
      `${PLATZHALTER_SCHEMA}//${seg.join("/")}`)
    /*
     * Und die Toradresse ist dieselbe Liste mit dem Schluessel an zweiter
     * Stelle. Das ist die Aussage, die eine neue Form daran hindert, den
     * Schluessel woanders einzusetzen.
     */
    const mit = seg.slice()
    mit.splice(1, 0, encodeURIComponent(SCHLUESSEL))
    gleich(`"${raum}": und die Toradresse traegt den Schluessel an zweiter `
      + "Stelle", assetUrl(p.release, p.variant, p.pfad, p.traeger),
      `${streamBase()}/${mit.join("/")}`)
  }
}

/*
 * DAS JOURNALBILD IM SPIEGEL WIRD IN `stream-posen.test.mjs` GEPRUEFT, und
 * nicht hier. `journalbildImSpiegel()` lebt in `stream-posen.mjs`, und diese
 * Datei zieht ein Browsermodul nach; wer sie ohne Foundry laden will, braucht
 * die Probekopie, die jener Stand schon baut. Eine zweite Kopie waere eine
 * zweite Nachbildung desselben Bestands.
 *
 * Der Zusammenhang gehoert trotzdem genannt: die schluesselfreie Form unten
 * wird nur dann in ein Journaldokument geschrieben, wenn die Posenliste das
 * Bild NENNT. Das Tor hat fuer Kreaturen keinen Rueckfall auf den Ursprung.
 */
console.log("")
console.log(`${gruen} gruen, ${rot} rot`)
console.log(`Aussagen: ${aussagen}. Weicht diese Zahl ab, ist der Lauf `
  + "mittendrin gestorben oder ein Fall ist verschwunden; beides sieht ohne "
  + "diese Zeile wie ein bestandener Lauf aus.")
console.log("Nicht geprueft: dass ein `<img>` mit dieser Form im laufenden "
  + "Foundry wirklich ein Bild zeigt. Das braucht Foundry und steht als "
  + "TC-PRJ-STR-301 im Katalog. Geprueft ist die Adressrechnung, nicht die "
  + "Anzeige.")
process.exit(rot ? 1 : 0)
