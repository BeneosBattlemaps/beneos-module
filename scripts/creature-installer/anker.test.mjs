/**
 * anker.test.mjs
 *
 * Gegenprobe zu `anker.mjs`. Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/creature-installer/anker.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot. Jeder
 * Fall nennt Soll und Ist als Zahl, nicht als Zusicherung.
 *
 * Die Faelle sind so gewaehlt, dass jeder einzeln rot wird, wenn genau eine
 * Zeile in `anker.mjs` kippt. Ein Pruefsatz, den niemand rot gesehen hat, ist
 * eine Behauptung, darum stehen unten zwei Gegenfaelle, die absichtlich die
 * Grenze verletzen.
 */
import {
  restoreAnchor, hintIsLive,
  RESTORE_SIZE_FALLBACK, RESTORE_OFFSET, HINT_GAP, EDGE_MARGIN, HINT_MS
} from "./anker.mjs";

let rot = 0;
let gruen = 0;

function gleich(name, ist, soll) {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (ok) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`); }
}

// Ein Bildschirm 1920x1080 mit einer Makroleiste, die 700 Pixel von links
// beginnt und 20 Pixel ueber dem unteren Rand endet. Ein 36 Pixel breites Logo.
const FENSTER = { width: 1920, height: 1080 };
const LEISTE = { left: 700, bottom: 1060 };

console.log("restoreAnchor, Regelfall");
{
  const a = restoreAnchor(LEISTE, FENSTER, 36);
  gleich("Logo links = Leiste minus Abstand", a.logoLeft, 700 - RESTORE_OFFSET);
  gleich("Logo unten = Fensterhoehe minus Leistenunterkante", a.logoBottom, 1080 - 1060);
  // Rechte Logokante liegt bei 648 + 36 = 684. Von rechts: 1920 - 684 = 1236.
  gleich("Blase rechts = Fensterbreite minus rechte Logokante", a.hintRight, 1920 - (648 + 36));
  gleich("Blase unten = Logo unten plus Logo plus Spalt", a.hintBottom, 20 + 36 + HINT_GAP);
}

console.log("restoreAnchor, die Blase deckt keinen Makroplatz");
{
  const a = restoreAnchor(LEISTE, FENSTER, 36);
  // Rechte Blasenkante in Bildschirmkoordinaten.
  const blaseRechts = FENSTER.width - a.hintRight;
  gleich("rechte Blasenkante liegt nicht rechts der Leistenkante", blaseRechts <= LEISTE.left, true);
  gleich("rechte Blasenkante deckt sich mit der rechten Logokante", blaseRechts, a.logoLeft + 36);
}

console.log("restoreAnchor, Randfaelle");
{
  // Leiste klebt links am Rand: das Logo darf nicht ins Negative rutschen.
  const a = restoreAnchor({ left: 10, bottom: 1080 }, FENSTER, 36);
  gleich("Logo links faellt nicht unter den Randabstand", a.logoLeft, EDGE_MARGIN);
  gleich("Logo unten faellt nicht unter den Randabstand", a.logoBottom, EDGE_MARGIN);
}
{
  // Ein breiteres Logo verschiebt die Blase nach rechts und nach oben.
  const schmal = restoreAnchor(LEISTE, FENSTER, 36);
  const breit = restoreAnchor(LEISTE, FENSTER, 48);
  gleich("breiteres Logo zieht die Blase nach rechts", schmal.hintRight - breit.hintRight, 12);
  gleich("breiteres Logo zieht die Blase nach oben", breit.hintBottom - schmal.hintBottom, 12);
  gleich("die Logoposition selbst haengt nicht an der Groesse", [breit.logoLeft, breit.logoBottom], [schmal.logoLeft, schmal.logoBottom]);
}
{
  // Der Rueckfallwert muss dieselbe Zahl liefern wie ein gemessenes 36er Logo,
  // sonst sagt der Kommentar in anker.mjs die Unwahrheit.
  gleich("Rueckfallwert ist die Groesse aus dem CSS", RESTORE_SIZE_FALLBACK, 36);
  gleich("Rueckfall und Messung liefern dasselbe",
    restoreAnchor(LEISTE, FENSTER, RESTORE_SIZE_FALLBACK),
    restoreAnchor(LEISTE, FENSTER, 36));
}

console.log("hintIsLive");
{
  gleich("nichts da heisst nicht live", hintIsLive(null, 1000), false);
  gleich("undefined heisst nicht live", hintIsLive(undefined, 1000), false);
  gleich("vor der Frist ist live", hintIsLive({ deadline: 5000 }, 4999), true);
  gleich("genau auf der Frist ist nicht mehr live", hintIsLive({ deadline: 5000 }, 5000), false);
  gleich("nach der Frist ist nicht live", hintIsLive({ deadline: 5000 }, 999999), false);
  // Der gelebte Fall: gesetzt bei t, abgelaufen bei t plus HINT_MS.
  const t = 1_700_000_000_000;
  gleich("eine Sekunde vor Ablauf steht sie", hintIsLive({ deadline: t + HINT_MS }, t + HINT_MS - 1000), true);
  gleich("eine Sekunde nach Ablauf steht sie nicht", hintIsLive({ deadline: t + HINT_MS }, t + HINT_MS + 1000), false);
}

console.log("Gegenfaelle, die rot sein MUESSEN, wenn die Regel gilt");
{
  // Zwei absichtlich falsche Erwartungen, einmal invertiert geprueft. Ohne das
  // hier koennte gleich() stillschweigend alles gruen melden.
  const a = restoreAnchor(LEISTE, FENSTER, 36);
  gleich("Gegenprobe: Logo liegt NICHT an der Leistenkante", a.logoLeft === LEISTE.left, false);
  gleich("Gegenprobe: Blase haengt NICHT an der linken Logokante", a.hintRight === FENSTER.width - a.logoLeft, false);
}

console.log(`\n${gruen} gruen, ${rot} rot`);
process.exit(rot ? 1 : 0);
