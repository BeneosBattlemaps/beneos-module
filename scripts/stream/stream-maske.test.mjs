/**
 * stream-maske.test.mjs
 *
 * Gegenprobe zu `ohneSchluesselImText()` in `stream-report.mjs`. Laeuft ohne
 * Foundry und ohne Browser:
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
 */
import { ohneSchluesselImText } from "./stream-report.mjs";
import { streamBase } from "./stream-settings.mjs";

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
console.log(`${gruen} gruen, ${rot} rot`);
if (rot === 0) {
  console.log("Gegenprobe bestanden: 7 Faelle MUSSTEN unveraendert durchgehen, "
    + "sonst wuerde diese Maskierung fremde Texte zerschneiden.");
}
process.exit(rot === 0 ? 0 : 1);
