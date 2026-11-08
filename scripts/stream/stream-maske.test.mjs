/**
 * stream-maske.test.mjs
 *
 * Gegenprobe zu BEIDEN Schluesselmasken in `stream-report.mjs`,
 * `ohneSchluesselImText()` fuer Fliesstext und `ohneSchluessel()` fuer eine
 * Adresse. Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-maske.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * Warum dieser Pruefsatz: der Kern schreibt jede geladene Textur als
 * `Loaded <Adresse> (x%)` in die Konsole, und bei einer gestreamten Karte
 * steht dort die vollstaendige Toradresse samt Streamschluessel. Die Huelle um
 * `console.*` nimmt das Schluesselstueck heraus. Eine Maskierung, die nicht
 * trifft, gibt die Rohzeile durch, ohne dass irgendetwas rot wird, und genau
 * das ist die Fehlerart, die man nur mit Gegenfaellen findet. Siehe
 * `OP-PRJ-169`.
 *
 * Die Gegenfaelle sind die Haelfte, die zaehlt: ein Text, der wie eine
 * Toradresse aussieht, aber auf einem fremden Host liegt, darf NICHT angefasst
 * werden, und ein Text ohne Adresse muss zeichengleich zurueckkommen.
 *
 * AM 08.11.2026 WUCHS DIESER STAND VON 18 AUF 54 SAETZE, mit `OP-PRJ-203`, und
 * der Anlass war ein gemessenes Leck. Dieser Stand kannte die Raeume `/a/` und
 * `/c/`, und die Maske kannte sie auch. Am selben Tag entstanden `/l/` fuer
 * Beute und `/s/` fuer geteilte Dateien, beide tragen den Schluessel an
 * derselben Stelle, und die Maske liess ihn STEHEN. Gemessen mit einem
 * erfundenen Schluessel in der gemessenen Kernzeile `Loaded <adresse> (50%)`:
 * bei `/a/` und `/c/` fiel er, bei `/l/` und `/s/` stand er noch darin.
 *
 * NICHTS WAR DABEI ROT, und das ist die eigentliche Lehre. Ein Stand, der eine
 * Teilmenge prueft, ist von einem vollstaendigen nicht zu unterscheiden,
 * solange die Teilmenge reicht. Darum prueft dieser Stand jetzt nicht nur die
 * vier Raeume, sondern auch ihre ANZAHL: er zaehlt roh am Quelltext, wie viele
 * Raumbuchstaben `assetUrl()` wirklich baut, und haelt das gegen
 * `STREAM_RAUM_BUCHSTABE`. Ein fuenfter Raum macht diesen Stand rot, bevor er
 * ein Leck werden kann.
 *
 * Die Gegenzahl entsteht an einer ANDEREN Stelle als die Tabelle, naemlich am
 * Quelltext von `assetUrl()` und `zerlegeAdresse()`. Eine Zaehlung, die
 * dieselbe Liste zweimal liest, bestaetigt nur sich selbst.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ohneSchluessel, ohneSchluesselImText } from "./stream-report.mjs";
import {
  streamBase,
  STREAM_RAUM_BUCHSTABE,
  assetUrl,
  platzhalterAdresse,
} from "./stream-settings.mjs";

/**
 * Je Raum eine Probe, mit der beide Bauer gefuettert werden.
 *
 * Der geteilte Raum braucht eine echte Pruefsumme von 64 Zeichen,
 * sonst faellt er in den Kartenzweig; das ist keine Zier, sondern
 * die Bedingung seines Erkennungssatzes.
 */
const RAUMPROBE = {
  karte: { release: "bm_0113", variant: "hd", pfad: "karte.webp" },
  kreatur: {
    release: "beneos_ct_000-goblin",
    variant: "",
    pfad: "000-goblin-1-journal.webp",
  },
  beute: {
    release: "beneos_lt_000-schwert",
    variant: "",
    pfad: "000-schwert-front.webp",
  },
  geteilt: {
    release: "shared",
    variant: "a".repeat(64),
    pfad: "foundry_bm_ui.webp",
  },
};

const HIER = dirname(fileURLToPath(import.meta.url));

let rot = 0;
let gruen = 0;

function gleich(name, ist, soll) {
  const ok = ist === soll;
  if (ok) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`); }
}

function ohneTreffer(name, text) {
  gleich(name, ohneSchluesselImText(text), text);
}

const B = streamBase();
const K = "sk_live_7f3a9c21d4e5b6a7";
const SHA = "a".repeat(64);

console.log(`Basis dieses Laufs: ${B}`);
console.log("");

console.log("Der Schluessel verschwindet, der Rest bleibt stehen");
{
  gleich("Kartenroute, nackte Adresse",
    ohneSchluesselImText(`${B}/a/${K}/bm_0042/night/map.webm`),
    `${B}/a/-/bm_0042/night/map.webm`);
  gleich("Kreaturenroute",
    ohneSchluesselImText(`${B}/c/${K}/beneos_ct_goblin/goblin-1-top.webp`),
    `${B}/c/-/beneos_ct_goblin/goblin-1-top.webp`);
  gleich("die gemessene Zeile des Kerns",
    ohneSchluesselImText(`Loaded ${B}/a/${K}/bm_0042/night/map.webm (50%)`),
    `Loaded ${B}/a/-/bm_0042/night/map.webm (50%)`);
  gleich("Abfragezeichenkette dahinter bleibt",
    ohneSchluesselImText(`${B}/a/${K}/bm_0042/night/map.webm?sig=abc`),
    `${B}/a/-/bm_0042/night/map.webm?sig=abc`);
  gleich("zwei Adressen in einer Zeile, beide maskiert",
    ohneSchluesselImText(`${B}/a/${K}/x/y.webp und ${B}/c/${K}/z/q.webp`),
    `${B}/a/-/x/y.webp und ${B}/c/-/z/q.webp`);
  gleich("in Anfuehrungszeichen, der Schluessel endet am Zeichen",
    ohneSchluesselImText(`fetch("${B}/a/${K}/x/y.webp") failed`),
    `fetch("${B}/a/-/x/y.webp") failed`);
  gleich("in spitzen Klammern",
    ohneSchluesselImText(`<img src=${B}/a/${K}/x/y.webp>`),
    `<img src=${B}/a/-/x/y.webp>`);
  gleich("zweimal maskieren aendert nichts mehr",
    ohneSchluesselImText(ohneSchluesselImText(`${B}/a/${K}/x/y.webp`)),
    `${B}/a/-/x/y.webp`);
}

console.log("");
console.log("Gegenfaelle: was NICHT angefasst werden darf");
{
  ohneTreffer("ein Satz ohne jede Adresse", "Beneos Stream | Speicher: 12 MB geraeumt");
  ohneTreffer("ein fremder Host mit derselben Pfadform",
    "https://example.test/a/geheim/x/y.webp");
  ohneTreffer("ein oertlicher Pfad des Kunden",
    "/a/beneos_assets/cloud/tokens/x/y.webp");
  ohneTreffer("ein Windowspfad mit a im Ordnernamen",
    "D:/PNP_Game/a/4711/map.webm");
  ohneTreffer("die Basis allein, ohne Raum",
    `${B}/catalog/etwas`);
  ohneTreffer("der Freiweg traegt keinen Schluessel und bleibt unberuehrt",
    `${B}/free/bm_0042/night/map.webm`);
  ohneTreffer("leere Zeichenkette", "");
}

console.log("");
console.log("Form und Randfaelle");
{
  gleich("null wird zu der Zeichenkette null, nicht zu einem Absturz",
    ohneSchluesselImText(null), "null");
  gleich("eine Zahl kommt als Text zurueck", ohneSchluesselImText(42), "42");
  gleich("die Maskierung ist idempotent am schon maskierten Text",
    ohneSchluesselImText(`${B}/a/-/x/y.webp`), `${B}/a/-/x/y.webp`);
}


console.log("");
console.log("Die zwei Raeume, die am 08.11.2026 dazukamen");
{
  gleich("Beute, nackte Adresse",
    ohneSchluesselImText(`${B}/l/${K}/beneos_lt_sword/sword-front.webp`),
    `${B}/l/-/beneos_lt_sword/sword-front.webp`);
  gleich("Beute, die gemessene Zeile des Kerns",
    ohneSchluesselImText(`Loaded ${B}/l/${K}/beneos_lt_sword/sword-front.webp (50%)`),
    `Loaded ${B}/l/-/beneos_lt_sword/sword-front.webp (50%)`);
  gleich("geteilt, nackte Adresse",
    ohneSchluesselImText(`${B}/s/${K}/shared/${SHA}/foundry_bm_ui.webp`),
    `${B}/s/-/shared/${SHA}/foundry_bm_ui.webp`);
  gleich("geteilt, die gemessene Zeile des Kerns",
    ohneSchluesselImText(`Loaded ${B}/s/${K}/shared/${SHA}/foundry_bm_ui.webp (50%)`),
    `Loaded ${B}/s/-/shared/${SHA}/foundry_bm_ui.webp (50%)`);
  gleich("alle vier Raeume in einer Zeile",
    ohneSchluesselImText(
      `${B}/a/${K}/r/v/f.webm ${B}/c/${K}/r/f.webp `
      + `${B}/l/${K}/r/f.webp ${B}/s/${K}/shared/${SHA}/f.webp`),
    `${B}/a/-/r/v/f.webm ${B}/c/-/r/f.webp `
      + `${B}/l/-/r/f.webp ${B}/s/-/shared/${SHA}/f.webp`);
}

console.log("");
console.log("Kein Raumbuchstabe bleibt uebrig: der Schluessel faellt in JEDEM");
{
  // DIE PROBE LAEUFT UEBER DIE TABELLE und nicht ueber eine Liste in dieser
  // Datei. Kommt ein fuenfter Raum dazu, wird er hier automatisch mitgeprueft,
  // und es gibt keinen Zustand, in dem dieser Block eine Teilmenge prueft und
  // dabei gruen bleibt.
  for (const [name, b] of Object.entries(STREAM_RAUM_BUCHSTABE)) {
    const adresse = `${B}/${b}/${K}/release/irgendwas/datei.webp`;
    const aus = ohneSchluesselImText(`Loaded ${adresse} (50%)`);
    gleich(`Raum ${name} (/${b}/): der Schluessel steht nicht mehr darin`,
      aus.includes(K), false);
    gleich(`Raum ${name} (/${b}/): der Buchstabe steht noch darin`,
      aus.includes(`/${b}/-`), true);
  }
}

console.log("");
console.log("ohneSchluessel, die Maske am Meldekanal");
{
  // DIESE FUNKTION WAR BIS ZUM 08.11.2026 GAR NICHT GEMESSEN, obwohl sie die
  // ist, die jede Meldung an das Tor durchlaeuft. Ihr Buchstabe kam aus einer
  // zweiteiligen Frage, `t.raum === "kreatur" ? "c" : "a"`, und damit erschien
  // jede Beutedatei und jede geteilte Datei im Meldekanal als KARTENdatei.
  gleich("Karte behaelt ihre Variante",
    ohneSchluessel(`${B}/a/${K}/beneos_bm_0042/night/map.webm`),
    `${B}/a/-/beneos_bm_0042/night/map.webm`);
  gleich("Kreatur hat keine Variante und bekommt kein leeres Stueck",
    ohneSchluessel(`${B}/c/${K}/beneos_ct_goblin/goblin-1-top.webp`),
    `${B}/c/-/beneos_ct_goblin/goblin-1-top.webp`);
  gleich("Beute steht unter /l/ und nicht unter /a/",
    ohneSchluessel(`${B}/l/${K}/beneos_lt_sword/sword-front.webp`),
    `${B}/l/-/beneos_lt_sword/sword-front.webp`);
  gleich("geteilt steht unter /s/ und behaelt seine Pruefsumme",
    ohneSchluessel(`${B}/s/${K}/shared/${SHA}/foundry_bm_ui.webp`),
    `${B}/s/-/shared/${SHA}/foundry_bm_ui.webp`);
  gleich("die Abfragezeichenkette fliegt weg, weil der Vergleich am Pfad haengt",
    ohneSchluessel(`${B}/a/${K}/r/v/f.webm?sig=abc`),
    `${B}/a/-/r/v/f.webm`);
  gleich("zweimal maskieren aendert nichts mehr",
    ohneSchluessel(ohneSchluessel(`${B}/l/${K}/beneos_lt_sword/sword-front.webp`)),
    `${B}/l/-/beneos_lt_sword/sword-front.webp`);
  gleich("ein oertlicher Pfad bleibt, wie er ist",
    ohneSchluessel("beneos_assets/cloud/tokens/x/y.webp"),
    "beneos_assets/cloud/tokens/x/y.webp");
  gleich("leere Eingabe wird eine leere Zeichenkette",
    ohneSchluessel(null), "");
}

console.log("");
console.log("Der Rueckfall gibt keinen Schluessel heraus");
{
  // DER GEFAEHRLICHE WEG, und er ist der Grund fuer den Rueckfall auf die
  // Textmaske. Eine Toradresse, die `zerlegeAdresse()` NICHT zerlegt, etwa
  // weil ihr ein Pfadstueck fehlt, kam vorher UNVERAENDERT heraus, also mit
  // Schluessel. Ein Raum, den die Tabelle noch nicht kennt, ebenso.
  const kurz = `${B}/a/${K}/nur_release`;
  gleich("eine Kartenadresse mit zu wenig Segmenten verliert den Schluessel",
    ohneSchluessel(kurz).includes(K), false);
  const fremderRaum = `${B}/x/${K}/release/datei.webp`;
  gleich("ein Raumbuchstabe, den die Tabelle nicht kennt, bleibt unberuehrt",
    ohneSchluessel(fremderRaum), fremderRaum);
  gleich("und genau das ist der Grund fuer den naechsten Satz: ein Buchstabe "
    + "AUS der Tabelle verliert ihn",
    ohneSchluessel(`${B}/s/${K}/shared/nicht_hex/datei.webp`).includes(K), false);
}

console.log("");
console.log("Die Gesamtmenge: die Tabelle gegen den Quelltext");
{
  // WARUM DIESER BLOCK EXISTIERT. Alles darueber prueft die Raeume, die die
  // Tabelle NENNT. Keiner dieser Saetze kann sehen, dass ein Raum FEHLT, denn
  // eine Schleife ueber eine zu kurze Liste laeuft fehlerfrei durch. Genau so
  // ist das Leck entstanden, das dieses Paket behoben hat.
  //
  // Die Gegenzahl kommt deshalb aus einer anderen Datei und aus einer anderen
  // Form: den Buchstaben, die `assetUrl()` wirklich in eine Adresse schreibt.
  const setQuelle = readFileSync(join(HIER, "stream-settings.mjs"), "utf8");

  /*
   * AM 08.11.2026 ZOG DIESE ZAEHLUNG UM, mit `OP-PRJ-137`, und der Umzug ist
   * selbst der Beleg, dass sie arbeitet. Die Raumentscheidung lag bis dahin im
   * Rumpf von `assetUrl` als `${kopf}/c/`; seit dem Umbau liegt sie in
   * `adressSegmente()` als `return ["c",`, weil eine ZWEITE Form derselben
   * Adresse dazugekommen ist, naemlich die schluesselfreie Platzhalterform.
   * Diese Zaehlung wurde dabei leer, und der Satz darunter, der genau das
   * prueft, wurde rot. Ohne ihn waere der Mengenvergleich still auf null
   * gegen null gelaufen.
   */
  const abUrl = setQuelle.slice(setQuelle.indexOf("export function adressSegmente"));
  const bisEnde = abUrl.slice(0, abUrl.indexOf("\nexport "));
  const gebaut = [...bisEnde.matchAll(/return \["([a-z])",/g)].map((m) => m[1]);

  // GEGENPROBE AUF DIE GEGENPROBE. Eine Suche, die nichts findet, ist von
  // einer kaputten Suche nicht zu unterscheiden, und dann waere der
  // Mengenvergleich darunter immer gruen.
  gleich("die rohe Zaehlung findet ueberhaupt Buchstaben", gebaut.length > 0, true);
  gleich("der Schnitt endet vor dem naechsten Export",
    bisEnde.includes("export function assetUrl"), false);

  const ausTabelle = Object.values(STREAM_RAUM_BUCHSTABE);
  gleich("adressSegmente baut genau so viele Raeume, wie die Tabelle nennt",
    gebaut.length, ausTabelle.length);
  gleich("und es sind dieselben",
    [...new Set(gebaut)].sort().join(","), [...ausTabelle].sort().join(","));

  /*
   * DIE ZWEITE FORM MUSS DIESELBEN RAEUME TRAGEN, und dieser Satz entsteht zur
   * LAUFZEIT und nicht am Quelltext. Der Grund ist die Fehlerart, die sonst
   * durchkommt: `platzhalterAdresse` koennte `adressSegmente` aufrufen und
   * trotzdem eine andere Adresse bauen, etwa indem sie ein Stueck weglaesst.
   * Eine Zaehlung am Quelltext saehe davon nichts, weil die Buchstaben ja in
   * derselben Funktion stehen.
   *
   * Gemessen wird deshalb gegen die ECHTE Ausgabe beider Bauer, je Raum eine
   * Adresse, und verglichen wird das Stueck hinter dem Schema.
   */
  for (const [name, buchstabe] of Object.entries(STREAM_RAUM_BUCHSTABE)) {
    const probe = RAUMPROBE[name];
    const mitKey = assetUrl(probe.release, probe.variant, probe.pfad);
    const ohneKey = platzhalterAdresse(probe.release, probe.variant, probe.pfad);
    gleich(`beide Bauer nennen fuer "${name}" den Buchstaben "${buchstabe}"`,
      [mitKey.slice(streamBase().length + 1).split("/")[0],
        ohneKey.slice("beneos://".length).split("/")[0]].join("|"),
      `${buchstabe}|${buchstabe}`);
    // Die eigentliche Aussage: dieselbe Datei, zwei Formen, und das Stueck
    // hinter dem Schluessel ist zeichengleich. Bei `assetUrl` wird der
    // Schluessel herausgeschnitten, bei der Platzhalterform ist er nie da.
    const teileMit = mitKey.slice(streamBase().length + 1).split("/");
    teileMit.splice(1, 1);
    gleich(`und dieselbe Datei in beiden Formen, Raum "${name}"`,
      teileMit.join("/"), ohneKey.slice("beneos://".length));
  }

  /*
   * DIE PLATZHALTERFORM DARF DIE MASKE NICHT BESCHAEFTIGEN. Sie traegt keinen
   * Schluessel, also ist an ihr nichts zu maskieren, und wer sie trotzdem
   * zerschneidet, macht aus einer gueltigen Dokumentadresse eine kaputte.
   *
   * Das ist ein Gegenfall und keine Messung des Neubaus: er muss gruen sein,
   * BEVOR irgendetwas die Form in ein Dokument schreibt.
   */
  for (const name of Object.keys(STREAM_RAUM_BUCHSTABE)) {
    const probe = RAUMPROBE[name];
    const ohneKey = platzhalterAdresse(probe.release, probe.variant, probe.pfad);
    gleich(`die Maske laesst die Platzhalterform des Raumes "${name}" stehen`,
      ohneSchluessel(ohneKey), ohneKey);
    gleich(`und auch im Fliesstext, Raum "${name}"`,
      ohneSchluesselImText(`Loaded ${ohneKey} (50%)`),
      `Loaded ${ohneKey} (50%)`);
  }
  gleich("kein Buchstabe steht doppelt in der Tabelle",
    new Set(ausTabelle).size, ausTabelle.length);

  // Dieselbe Frage von der anderen Seite: die RaumNAMEN der Tabelle sind die,
  // die `zerlegeAdresse()` zurueckgibt. Weicht ein Name ab, findet
  // `ohneSchluessel` den Buchstaben nicht und faellt still auf die Textmaske
  // zurueck, was den Schluessel zwar nimmt, aber die kanonische Form verliert.
  const abZerlege = setQuelle.slice(setQuelle.indexOf("export function zerlegeAdresse"));
  const namen = [...abZerlege.matchAll(/raum:\s*"([a-z]+)"/g)].map((m) => m[1]);
  gleich("die rohe Zaehlung findet ueberhaupt Raumnamen", namen.length > 0, true);
  gleich("die Tabellenschluessel sind die Raumnamen aus zerlegeAdresse",
    Object.keys(STREAM_RAUM_BUCHSTABE).sort().join(","),
    [...new Set(namen)].sort().join(","));
}

console.log("");
console.log("Die Maske liest ihre Buchstaben aus der Tabelle, nicht aus sich selbst");
{
  // WAS DIESER SATZ FAENGT, das kein Verhaltenssatz faengt: jemand schreibt die
  // Buchstaben wieder fest in die Maske. Das Verhalten waere heute identisch,
  // und der naechste Raum wuerde wieder lecken.
  const repQuelle = readFileSync(join(HIER, "stream-report.mjs"), "utf8");
  const nurCode = repQuelle.split("\n").filter((z) => {
    const x = z.trim();
    return x !== "" && !x.startsWith("//") && !x.startsWith("*") && !x.startsWith("/*");
  }).join("\n");

  gleich("der Kommentarfilter nimmt wirklich etwas weg",
    nurCode.length < repQuelle.length, true);
  gleich("die Maske nennt STREAM_RAUM_BUCHSTABE",
    nurCode.includes("STREAM_RAUM_BUCHSTABE"), true);
  gleich("kein festgeschriebenes (a|c) mehr im Code",
    nurCode.includes("(a|c)"), false);
  gleich("ohneSchluessel entscheidet nicht mehr zweiteilig am Raumnamen",
    /raum === "kreatur"/.test(nurCode), false);
  gleich("der Rueckfall von ohneSchluessel geht durch die Textmaske",
    /if \(!buchstabe\) return ohneSchluesselImText/.test(nurCode), true);
}

console.log("");
console.log(`${gruen} gruen, ${rot} rot`);
if (rot === 0) {
  console.log("Gegenprobe bestanden: 8 Faelle MUSSTEN unveraendert durchgehen, "
    + "sonst wuerde diese Maskierung fremde Texte zerschneiden.");
  console.log(`Gesamtmenge geprueft: ${Object.keys(STREAM_RAUM_BUCHSTABE).length} `
    + "Raeume, roh am Quelltext von adressSegmente nachgezaehlt. Ein fuenfter macht "
    + "diesen Stand rot.");
}
process.exit(rot === 0 ? 0 : 1);
