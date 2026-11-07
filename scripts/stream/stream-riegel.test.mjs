/**
 * stream-riegel.test.mjs
 *
 * Gegenprobe zum Riegel des Adressnachzugs in `stream-settings.mjs`. Laeuft
 * ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-riegel.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. Der Nachzug laeuft seit `OP-PRJ-193` neben dem Spiel
 * und nicht mehr vor ihm, und er dauert gemessen 89 Sekunden. In diesem Fenster
 * koennen zwei angemeldete Spielleitungen ihn zweimal starten; am 06.09.2026
 * ist genau das passiert, mit zwei Erfolgsmeldungen und zwei verschiedenen
 * Zahlen fuer dasselbe Ereignis. Der Riegel liegt deshalb in der Welt.
 *
 * DIE GEFAEHRLICHE RICHTUNG IST DIE ANDERE, und sie ist der Grund fuer die
 * Haelfte der Faelle hier: ein Riegel, der zu fest haelt, sperrt den Nachzug
 * dieser Welt fuer immer, und dann behaelt die Welt dauerhaft alte Adressen.
 * Jeder Fall, der "abgelaufen" erwartet, prueft genau das. Ein Riegel, der nur
 * sperren kann, waere schlimmer als keiner.
 *
 * Der Lauf fasst nichts an: `game` wird gestellt, und die Einstellung ist ein
 * Feld in einem Objekt dieses Laufs.
 */
import {
  riegelEntscheid,
  nachzugRiegelNehmenFuerPruefsatz as riegelNehmen,
  nachzugRiegelLoesenFuerPruefsatz as riegelLoesen,
  RIEGEL_FRIST_FUER_PRUEFSATZ as FRIST,
  RIEGEL_WARTE_FUER_PRUEFSATZ as WARTE,
  SETTING,
} from "./stream-settings.mjs";

let rot = 0;
let gruen = 0;

function gleich(name, ist, soll) {
  const ok = ist === soll;
  if (ok) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`); }
}

function wahr(name, bedingung) {
  gleich(name, Boolean(bedingung), true);
}

/**
 * Eine gestellte Welt. `aufSetzen` erlaubt es, waehrend des Wartens eine
 * fremde Schreibung einzuschieben, und genau das ist der Rennfall.
 */
function stelleWelt({ start = "", aufSetzen = null } = {}) {
  const laden = { [SETTING.nachzugRiegel]: start };
  const protokoll = [];
  globalThis.game = {
    userId: "pruefsatz-leitung",
    settings: {
      get: (_modul, schluessel) => laden[schluessel],
      set: async (_modul, schluessel, wert) => {
        laden[schluessel] = wert;
        protokoll.push(wert);
        if (aufSetzen) aufSetzen(laden, protokoll.length);
      },
    },
  };
  globalThis.foundry = { utils: { randomID: (n) => "x".repeat(Number(n) || 8) } };
  return { laden, protokoll };
}

const JETZT = 1_800_000_000_000;

console.log("Der Entscheid allein, ohne jede Welt");
{
  gleich("leer heisst frei", riegelEntscheid("", JETZT), "frei");
  gleich("null heisst frei", riegelEntscheid(null, JETZT), "frei");
  gleich("frische fremde Marke heisst besetzt",
    riegelEntscheid(`andere|${JETZT - 1000}|abc`, JETZT), "besetzt");
  gleich("eine Sekunde vor der Frist noch besetzt",
    riegelEntscheid(`andere|${JETZT - (FRIST - 1000)}|abc`, JETZT), "besetzt");
  gleich("eine Sekunde nach der Frist abgelaufen",
    riegelEntscheid(`andere|${JETZT - (FRIST + 1000)}|abc`, JETZT), "abgelaufen");
}

console.log("");
console.log("Die Gegenrichtung: was NICHT dauerhaft sperren darf");
{
  gleich("Marke ohne Zeitteil gilt als abgelaufen",
    riegelEntscheid("kaputt", JETZT), "abgelaufen");
  gleich("Marke mit Text statt Zeit gilt als abgelaufen",
    riegelEntscheid("andere|gestern|abc", JETZT), "abgelaufen");
  gleich("Marke mit Zeit null gilt als abgelaufen",
    riegelEntscheid("andere|0|abc", JETZT), "abgelaufen");
  gleich("Marke mit negativer Zeit gilt als abgelaufen",
    riegelEntscheid("andere|-5|abc", JETZT), "abgelaufen");
  gleich("Marke aus der Zukunft gilt als abgelaufen, nicht als besetzt",
    riegelEntscheid(`andere|${JETZT + 999_999_999}|abc`, JETZT), "abgelaufen");
}

console.log("");
console.log("Nehmen und Loesen in einer gestellten Welt");

async function fahre() {
  {
    const { laden, protokoll } = stelleWelt({ start: "" });
    const marke = await riegelNehmen();
    wahr("freie Welt gibt eine Marke", marke && marke !== "ohne-riegel");
    gleich("die Marke steht in der Einstellung", laden[SETTING.nachzugRiegel], marke);
    gleich("genau eine Schreibung", protokoll.length, 1);
    wahr("die Marke traegt die eigene Nutzerkennung", String(marke).startsWith("pruefsatz-leitung|"));
    await riegelLoesen(marke);
    gleich("nach dem Loesen steht nichts mehr", laden[SETTING.nachzugRiegel], "");
  }

  {
    const { laden, protokoll } = stelleWelt({ start: `andere|${Date.now() - 1000}|abc` });
    const marke = await riegelNehmen();
    gleich("frische fremde Marke sagt ab", marke, "");
    gleich("und es wird NICHT geschrieben", protokoll.length, 0);
    wahr("die fremde Marke steht unberuehrt", String(laden[SETTING.nachzugRiegel]).startsWith("andere|"));
  }

  {
    const { laden } = stelleWelt({ start: `andere|${Date.now() - (FRIST + 60_000)}|abc` });
    const marke = await riegelNehmen();
    wahr("abgelaufene fremde Marke wird uebernommen", marke && marke !== "ohne-riegel");
    gleich("und die eigene steht danach", laden[SETTING.nachzugRiegel], marke);
  }

  {
    // DER RENNFALL. Waehrend gewartet wird, schreibt eine andere Sitzung ihre
    // Marke. Es gibt genau einen Endwert, also darf nur eine durchkommen, und
    // diese hier muss absagen.
    const { laden } = stelleWelt({
      start: "",
      aufSetzen: (l, nr) => {
        if (nr === 1) l[SETTING.nachzugRiegel] = `andere|${Date.now()}|zzz`;
      },
    });
    const marke = await riegelNehmen();
    gleich("verlorenes Rennen sagt ab", marke, "");
    wahr("die fremde Marke bleibt stehen", String(laden[SETTING.nachzugRiegel]).startsWith("andere|"));
  }

  {
    // Loesen darf NUR die eigene Marke treffen. Hat eine andere Sitzung den
    // Riegel in der Zwischenzeit uebernommen, gaebe ein blindes Leeren ihren
    // Lauf frei.
    const { laden } = stelleWelt({ start: "" });
    const marke = await riegelNehmen();
    laden[SETTING.nachzugRiegel] = `andere|${Date.now()}|yyy`;
    await riegelLoesen(marke);
    wahr("fremde Marke wird beim Loesen nicht angefasst",
      String(laden[SETTING.nachzugRiegel]).startsWith("andere|"));
  }

  {
    // Keine Einstellungen da, etwa weil der Modus mitten in der Sitzung
    // umgelegt wurde. Dann wird GELAUFEN und nicht abgesagt: eine Welt mit
    // alten Adressen ist der Schaden, den dieser Lauf behebt.
    globalThis.game = { userId: "ohne" };
    const marke = await riegelNehmen();
    gleich("ohne Einstellungen wird ohne Riegel gelaufen", marke, "ohne-riegel");
    await riegelLoesen(marke);
    gleich("und das Loesen tut dann nichts", typeof marke, "string");
  }
}

await fahre();

console.log("");
console.log(`${gruen} gruen, ${rot} rot`);
console.log(`Frist ${FRIST} ms, Wartezeit nach dem Schreiben ${WARTE} ms`);
if (rot === 0) {
  console.log("Gegenprobe bestanden: 5 Faelle MUSSTEN \"abgelaufen\" ergeben, "
    + "sonst koennte eine einzige kaputte Marke den Nachzug dieser Welt fuer immer sperren.");
}
process.exit(rot === 0 ? 0 : 1);
