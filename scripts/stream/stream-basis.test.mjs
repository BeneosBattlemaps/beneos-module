/**
 * stream-basis.test.mjs
 *
 * Gegenprobe zu `erlaubteBasis()` in `stream-settings.mjs`. Laeuft ohne Foundry
 * und ohne Browser:
 *
 *   node scripts/stream/stream-basis.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * Warum dieser Pruefsatz: die Basis jeder Toradresse kommt aus der Antwort des
 * Servers (`ensureStreamKey`, Feld `base`). Ohne Erlaubnisliste biegt eine
 * einzige geaenderte Zeichenkette alle Bild- und Kreaturenadressen auf einen
 * fremden Ursprung um, und der Streamschluessel geht in der Adresse mit. Siehe
 * `OP-PRJ-176`.
 *
 * Jeder Fall nennt Soll und Ist. Die Haelfte der Faelle MUSS abgelehnt werden;
 * das sind die Gegenfaelle, und ohne sie waere der Pruefsatz eine Behauptung.
 */
import { erlaubteBasis, GATE_DEFAULT_BASE } from "./stream-settings.mjs";

let rot = 0;
let gruen = 0;

function gleich(name, ist, soll) {
  const ok = ist === soll;
  if (ok) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`); }
}

console.log("Angenommen wird, was im Zonennamen des Hauses liegt");
{
  gleich("das Tor selbst", erlaubteBasis("https://gate.beneos.stream"), "https://gate.beneos.stream");
  gleich("Schraegstrich am Ende fallen gelassen", erlaubteBasis("https://gate.beneos.stream/"), "https://gate.beneos.stream");
  gleich("mehrere Schraegstriche am Ende", erlaubteBasis("https://gate.beneos.stream///"), "https://gate.beneos.stream");
  gleich("Leerraum rundherum", erlaubteBasis("  https://gate.beneos.stream  "), "https://gate.beneos.stream");
  gleich("ein zweites Tor derselben Zone", erlaubteBasis("https://gate2.beneos.stream"), "https://gate2.beneos.stream");
  gleich("die Zone selbst", erlaubteBasis("https://beneos.stream"), "https://beneos.stream");
  gleich("Grossschreibung im Host", erlaubteBasis("https://GATE.Beneos.Stream"), "https://GATE.Beneos.Stream");
  gleich("die Vorgabe ist selbst erlaubt", erlaubteBasis(GATE_DEFAULT_BASE), GATE_DEFAULT_BASE);
}

console.log("Abgelehnt wird alles andere, und Ablehnung heisst leere Zeichenkette");
{
  gleich("fremder Host", erlaubteBasis("https://boese.example.com"), "");
  gleich("fremder Host mit unserem Namen davor", erlaubteBasis("https://gate.beneos.stream.example.com"), "");
  gleich("fremder Host mit unserem Namen als Pfad", erlaubteBasis("https://example.com/gate.beneos.stream"), "");
  gleich("Host, der nur aehnlich endet", erlaubteBasis("https://xbeneos.stream"), "");
  gleich("ohne Verschluesselung", erlaubteBasis("http://gate.beneos.stream"), "");
  gleich("mit Benutzernamen im Ursprung", erlaubteBasis("https://wer:was@gate.beneos.stream"), "");
  gleich("keine Adresse", erlaubteBasis("gate.beneos.stream"), "");
  gleich("leer", erlaubteBasis(""), "");
  gleich("fehlt ganz", erlaubteBasis(undefined), "");
  gleich("Unfug", erlaubteBasis("://"), "");
  gleich("javascript-Weg", erlaubteBasis("javascript:alert(1)"), "");
  gleich("Datenweg", erlaubteBasis("data:text/html,x"), "");
}

console.log(`\n${gruen} gruen, ${rot} rot`);
process.exit(rot === 0 ? 0 : 1);
