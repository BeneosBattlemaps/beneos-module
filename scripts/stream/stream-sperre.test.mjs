/**
 * stream-sperre.test.mjs
 *
 * Gegenprobe zu `offlineGesperrt()` in `stream-online.mjs`, der einen
 * Entscheidung hinter `OP-PRJ-144`. Laeuft ohne Foundry und ohne Browser:
 *
 *   node scripts/stream/stream-sperre.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ. Der Betreiberentscheid vom 02.11.2026 sagt: ein
 * Knopf, der sichtbar nicht geht, ist besser als einer, der ein leeres Feld
 * liefert. Daraus wurde eine Sperre fuer den Variantenwechsler und den
 * Stilumschalter im Token-HUD, und eine Sperre hat zwei Richtungen, die beide
 * schiefgehen koennen.
 *
 * DIE TEURE RICHTUNG IST DIE FALSCHE SPERRE. Wer ohne Verbindung spielt und
 * seine Kreaturen oertlich installiert hat, kann umschalten; seine Knoepfe zu
 * sperren nimmt ihm eine Funktion, die tadellos arbeitet. Dasselbe gilt fuer
 * eine Welt auf `download`. Jeder Fall hier, der `false` erwartet, prueft
 * genau das, und das sind die meisten.
 *
 * Der Lauf fasst nichts an: `game` und `navigator` werden gestellt, die
 * Einstellungen sind Felder in einem Objekt dieses Laufs.
 */

/* ------------------------------------------------------- die Buehne stellen */

const einstellungen = new Map();

globalThis.game = {
  settings: {
    get(modul, schluessel) {
      const name = `${modul}.${schluessel}`;
      if (!einstellungen.has(name)) throw new Error(`nicht registriert: ${name}`);
      return einstellungen.get(name);
    },
  },
};

// `navigator` ist in neueren node-Fassungen vorhanden und nur lesbar. Ein
// einfaches Zuweisen scheitert dort still oder wirft, deshalb der Umweg.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true },
  configurable: true,
  writable: true,
});

const { MODULE_ID, SETTING } = await import("./stream-settings.mjs");
const { offlineGesperrt, isOffline, noteResult } = await import("./stream-online.mjs");

function setze(schluessel, wert) {
  einstellungen.set(`${MODULE_ID}.${schluessel}`, wert);
}

const TOR = "https://gate.beneos.stream";
setze(SETTING.mode, true);
setze(SETTING.key, "pruefsatz-schluessel");
setze(SETTING.base, TOR);

const ADRESSE_TOR = `${TOR}/c/pruefsatz-schluessel/000-barovian_direwolf/1-top.webp`;
const ADRESSE_OERTLICH = "beneos_assets/cloud/tokens/000-barovian_direwolf/000-barovian_direwolf-1-top.webp";

/* ------------------------------------------------------------ die Werkzeuge */

let rot = 0;
let gruen = 0;

function gleich(name, ist, soll) {
  const ok = ist === soll;
  if (ok) { gruen++; console.log(`  ok   ${name}`); }
  else { rot++; console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`); }
}

/* ------------------------------------------- Teil 1: mit Verbindung, nichts sperrt */

console.log("\nMit Verbindung sperrt nichts");
gleich("der Anfangszustand ist nicht offline", isOffline(), false);
gleich("eine Toradresse ist nicht gesperrt", offlineGesperrt(ADRESSE_TOR), false);
gleich("ein oertlicher Pfad ist nicht gesperrt", offlineGesperrt(ADRESSE_OERTLICH), false);

/* ------------------------------------------------- Teil 2: ohne Verbindung */

// Der Browser meldet sich selbst als ohne Netz. Das ist der eine Fall, der in
// `noteResult` keine Bestaetigung braucht, und damit der kuerzeste Weg in den
// Zustand `offline`, ohne eine Sonde zu fahren.
globalThis.navigator.onLine = false;
noteResult(false, "pruefsatz");

console.log("\nOhne Verbindung");
gleich("der Zustand ist jetzt offline", isOffline(), true);
gleich("eine Toradresse ist GESPERRT", offlineGesperrt(ADRESSE_TOR), true);

/* ---------- Teil 3: die teure Richtung, falsche Sperren muessen ausbleiben */

console.log("\nOhne Verbindung bleibt ungesperrt, was ohne Verbindung geht");
gleich("ein oertlich installierter Pfad bleibt frei", offlineGesperrt(ADRESSE_OERTLICH), false);
gleich("ein leerer Text sperrt nicht", offlineGesperrt(""), false);
gleich("null sperrt nicht", offlineGesperrt(null), false);
gleich("undefined sperrt nicht", offlineGesperrt(undefined), false);
gleich("eine Zahl sperrt nicht", offlineGesperrt(0), false);

// Der Fall, der den leeren Text gefaehrlich macht: `String.includes("")` ist
// fuer JEDE Adresse wahr. Lieferte `hostVomTor()` je einen leeren Text, waere
// jede Flaeche der Welt gesperrt. Die Zeile darueber prueft die Eingabeseite,
// diese hier die Ausgabeseite derselben Falle.
gleich("ein fremder Host bleibt frei", offlineGesperrt("https://example.invalid/bild.webp"), false);
gleich("ein Foundry-eigener Pfad bleibt frei", offlineGesperrt("/icons/svg/mystery-man.svg"), false);

/* ------------------- Teil 4: die Welt, die gar nicht streamt, wird nie gesperrt */

console.log("\nEine Welt ohne Streaming wird nie gesperrt, auch nicht offline");
setze(SETTING.mode, false);
gleich("Schalter aus: Toradresse bleibt frei", offlineGesperrt(ADRESSE_TOR), false);
setze(SETTING.mode, true);
setze(SETTING.key, "");
gleich("Schalter an, aber kein Schluessel: Toradresse bleibt frei", offlineGesperrt(ADRESSE_TOR), false);
setze(SETTING.key, "pruefsatz-schluessel");
gleich("Schluessel zurueck: wieder gesperrt", offlineGesperrt(ADRESSE_TOR), true);

/* ---------------- Teil 5: gesperrt wird gegen das Tor DIESER Welt, nicht gegen einen Namen */

console.log("\nGesperrt wird gegen das Tor dieser Welt");
setze(SETTING.base, "https://pruefstand.beneos.stream");
gleich("Adresse des Pruefstandstors ist gesperrt",
  offlineGesperrt("https://pruefstand.beneos.stream/c/k/000-x/1-top.webp"), true);
gleich("Adresse des Vorgabetors ist NICHT gesperrt, diese Welt kennt es nicht",
  offlineGesperrt(ADRESSE_TOR), false);
setze(SETTING.base, TOR);

/* ----------------------------------------------- Teil 6: eine Einstellung fehlt */

console.log("\nFehlende Einstellungen");
// `read()` faengt den Wurf und nimmt den Rueckfallwert. Fuer den Schalter ist
// der Rueckfall `false`, also wird nicht gesperrt. Das ist die richtige Seite:
// eine Welt, deren Schalter sich nicht lesen laesst, soll ihre Knoepfe behalten.
einstellungen.delete(`${MODULE_ID}.${SETTING.mode}`);
gleich("Schalter nicht lesbar: nichts gesperrt", offlineGesperrt(ADRESSE_TOR), false);
setze(SETTING.mode, true);
// Fuer die Basis ist der Rueckfall das Vorgabetor, nicht ein leerer Text.
// Genau das haelt die `includes`-Falle aus Teil 3 geschlossen.
einstellungen.delete(`${MODULE_ID}.${SETTING.base}`);
gleich("Basis nicht lesbar: das Vorgabetor gilt und sperrt", offlineGesperrt(ADRESSE_TOR), true);
gleich("Basis nicht lesbar: ein oertlicher Pfad bleibt frei", offlineGesperrt(ADRESSE_OERTLICH), false);

/* ------------------------------------------------------------------ Schluss */

console.log(`\n${gruen} bestanden, ${rot} gescheitert`);
if (rot > 0) {
  console.log("\nNICHT GEPRUEFT, und das gehoert dazu: die Sperre im Token-HUD selbst.");
}
console.log(
  "\nNicht pruefbar ohne Foundry: dass das Symbol im HUD wirklich grau wird und\n"
  + "dass der Klick verworfen wird. Das sind zwei Zeilen in `beneos_module.js` und\n"
  + "eine Regel in `css/beneos.css`, und sie stehen in TC-PRJ-STR-274.\n"
  + "Ebenfalls nicht pruefbar: der Zweig `if (!tor) return false`. `streamBase()`\n"
  + "faellt immer auf das Vorgabetor zurueck, ein leerer Host ist also nicht\n"
  + "erreichbar. Teil 6 zeigt das, der Zweig bleibt als Vorsorge stehen."
);
process.exit(rot > 0 ? 1 : 0);
