/**
 * foundry-attrappe.mjs - das gemeinsame Geruest der Stream-Pruefsaetze, die
 * Verhalten am echten Modulcode pruefen statt seinen Quelltext zu lesen.
 * Seit 14.11.2026, stre-T-017.
 *
 * WARUM ES DIESE DATEI GIBT. Sechs Stream-Pruefsaetze lasen ihren Pruefling
 * als Text (Befund B6 der Stream-Inventur vom 12.11.2026). Eine Textprobe
 * bleibt gruen, wenn das Verhalten kaputt ist, und sie spricht auch auf einen
 * Kommentar an. Diese Datei gibt den Saetzen, was sie brauchen, um den echten
 * Code zu laden und zu rufen:
 *
 *   - `pruefstand(titel)`: `gleich`, `struktur`, `dokument`, `abschnitt`,
 *     `ende`. Ausgabe wie in jedem Stream-Satz (`  ok   ` und `  ROT  `),
 *     damit der Haken und `tools/stream-sabotagen.mjs` sie lesen koennen.
 *   - `installiereFoundry(optionen)`: Foundry-Globale, die das Modul beim
 *     LADEN beruehrt (Hooks, document, FormApplication, Dialog, Application,
 *     foundry.applications.api.ApplicationV2, CONFIG), dazu `game` mit
 *     Einstellungen nach Tabelle und `ui` mit aufgezeichneten Meldungen. Was
 *     keiner dieser Teile kennt, ist ein Allesfresser: jede Eigenschaft wieder
 *     eine Attrappe, aufrufbar und als Klasse erweiterbar.
 *   - `netz(antworter)`: ersetzt `globalThis.fetch`. Jede Adresse, fuer die der
 *     Antworter `undefined` liefert, zaehlt als fremder Abruf und macht den
 *     Satz in `ende()` rot. Der Antworter darf eine Response liefern oder
 *     `{ wirf: "<text>" }` fuer einen Netzfehler.
 *
 * DREI ARTEN VON PROBEN, und sie werden getrennt gezaehlt:
 *
 *   - Verhalten (`gleich`): ein Aufruf des echten Codes und sein Ergebnis.
 *   - Struktur (`struktur`): eine Aussage, die selbst strukturell ist, etwa
 *     "genau eine Definition" oder "Datei X importiert Y". Ein Aufruf kann sie
 *     nicht zeigen. Der Name traegt das Praefix `[Struktur] `.
 *   - Dokument (`dokument`): ein Kommentar oder Kopftext soll einen Satz
 *     tragen. Der Name traegt das Praefix `[Dokument] `. Betreiberentscheid
 *     vom 14.11.2026: behalten, als Doku markiert.
 *
 * Diese Datei liegt unter `tools/` und geht damit nicht an Kunden
 * (`.gitattributes`: `tools/ export-ignore`). Sie ist kein Pruefsatz und
 * endet deshalb nicht auf `.test.mjs`; der Haken sammelt sie nicht.
 */

// ------------------------------------------------------------- Pruefstand

export function pruefstand(titel) {
  let gruen = 0;
  let rot = 0;
  const namen = new Set();
  const zahl = { verhalten: 0, struktur: 0, dokument: 0 };
  console.log(titel);
  function pruefe(name, ist, soll) {
    if (namen.has(name)) {
      rot += 1;
      console.log(`  ROT  doppelter Probenname: ${name}`);
      return;
    }
    namen.add(name);
    const ok = Object.is(ist, soll) || (ist === soll);
    if (ok) {
      gruen += 1;
      console.log(`  ok   ${name}`);
    } else {
      rot += 1;
      console.log(`  ROT  ${name}\n       soll ${JSON.stringify(soll)}\n       ist  ${JSON.stringify(ist)}`);
    }
  }
  return {
    gleich(name, ist, soll) { zahl.verhalten += 1; pruefe(name, ist, soll); },
    struktur(name, ist, soll) { zahl.struktur += 1; pruefe(`[Struktur] ${name}`, ist, soll); },
    dokument(name, ist, soll) { zahl.dokument += 1; pruefe(`[Dokument] ${name}`, ist, soll); },
    abschnitt(text) { console.log(""); console.log(text); },
    ende() {
      if (fremd.length > 0) {
        rot += 1;
        console.log(`  ROT  fremde Abrufe: ${fremd.length} (${fremd.slice(0, 3).join(", ")})`);
      }
      console.log("");
      console.log(`Verhalten ${zahl.verhalten}, Struktur ${zahl.struktur}, Dokument ${zahl.dokument}`);
      console.log(`${gruen} gruen, ${rot} rot`);
      process.exit(rot === 0 ? 0 : 1);
    },
  };
}

// ------------------------------------------------------------- Allesfresser

function allesfresser(name = "?") {
  const ziel = function () {};
  return new Proxy(ziel, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => "";
      if (k === "prototype") return t.prototype;
      if (k === "then") return undefined;
      if (typeof k === "symbol") return undefined;
      return allesfresser(`${name}.${String(k)}`);
    },
    apply() { return allesfresser(`${name}()`); },
    construct() { return allesfresser(`new ${name}`); },
  });
}

// ------------------------------------------------------------- Foundry

/** Aufgezeichnete Hook-Anmeldungen und ein Weg, sie zu feuern. */
export const haken = {
  liste: [],
  on(name, fn) { this.liste.push({ name, fn, einmal: false }); return this.liste.length; },
  once(name, fn) { this.liste.push({ name, fn, einmal: true }); return this.liste.length; },
  off() {},
  callAll() { return true; },
  call() { return true; },
  namen() { return this.liste.map((h) => h.name); },
  async rufe(name, ...args) {
    const ergebnisse = [];
    for (const h of this.liste.filter((x) => x.name === name)) {
      // Wie in Foundry: ein `once`-Haken feuert genau einmal.
      if (h.einmal) this.liste.splice(this.liste.indexOf(h), 1);
      ergebnisse.push(await h.fn(...args));
    }
    return ergebnisse;
  },
};

/** Aufgezeichnete Meldungen an den Nutzer. */
export const meldungen = [];

/**
 * Setzt die Foundry-Globalen. `einstellungen` ist eine Tabelle von
 * Einstellungsnamen (ohne Modulpraefix) auf Werte; `get(modul, name)` liest
 * daraus, ein unbekannter Name wirft wie in Foundry.
 */
export function installiereFoundry({ einstellungen = {} } = {}) {
  class Basis { constructor(...a) { this.args = a; } static get defaultOptions() { return {}; } }
  const g = globalThis;
  g.Hooks = haken;
  g.FormApplication = class FormApplication extends Basis {};
  g.Application = class Application extends Basis {};
  g.Dialog = class Dialog extends Basis {};
  Object.defineProperty(g, "foundry", {
    configurable: true,
    writable: true,
    value: {
      applications: { api: { ApplicationV2: class ApplicationV2 extends Basis {}, HandlebarsApplicationMixin: (k) => k } },
      utils: {
        randomID: () => "zufall0000000000",
        mergeObject: (a, b) => Object.assign({}, a, b),
        deepClone: (x) => JSON.parse(JSON.stringify(x)),
        getProperty: (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o),
        setProperty: (o, p, v) => {
          const t = p.split(".");
          let x = o;
          for (const k of t.slice(0, -1)) x = x[k] ??= {};
          x[t.at(-1)] = v;
          return true;
        },
      },
    },
  });
  g.CONFIG = { debug: { hooks: false } };
  g.CONST = allesfresser("CONST");
  g.document = {
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, classList: { add() {}, remove() {} } }),
    head: { appendChild() {} },
    body: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  g.ui = {
    notifications: {
      info: (t) => { meldungen.push({ art: "info", text: String(t) }); },
      warn: (t) => { meldungen.push({ art: "warn", text: String(t) }); },
      error: (t) => { meldungen.push({ art: "error", text: String(t) }); },
    },
  };
  g.canvas = allesfresser("canvas");
  // `ours()` in stream-fetch.mjs loest Adressen gegen die Seite auf.
  g.location = { href: "http://localhost:30000/game", origin: "http://localhost:30000", host: "localhost:30000" };
  g.game = {
    userId: "nutzer",
    user: { isGM: true, id: "nutzer" },
    settings: {
      get(modul, name) {
        if (!(name in einstellungen)) throw new Error(`unbekannte Einstellung ${modul}.${name}`);
        return einstellungen[name];
      },
      async set(modul, name, wert) { einstellungen[name] = wert; return wert; },
      register() {},
    },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: new Map(),
  };
  return { einstellungen };
}

// ------------------------------------------------------------- Netz

const abrufe = [];
const fremd = [];
let antworter = () => undefined;

/**
 * Ersetzt `globalThis.fetch`. Der Antworter bekommt `(adresse, optionen)`.
 * Er gibt eine Response, `{ wirf: "<text>" }` fuer einen Netzfehler, oder
 * `undefined`: dann ist die Adresse fremd und der Satz wird rot.
 */
export function netz(fn) {
  antworter = fn;
  globalThis.fetch = async (eingabe, optionen = {}) => {
    const adresse = typeof eingabe === "string" ? eingabe : (eingabe && eingabe.url) || String(eingabe);
    abrufe.push({ adresse, optionen });
    const r = await antworter(adresse, optionen);
    if (r === undefined) {
      fremd.push(adresse);
      return new Response("fremd", { status: 599 });
    }
    if (r && r.wirf) throw new TypeError(r.wirf);
    return r;
  };
}

/** Leert das Abrufprotokoll und gibt zurueck, was seit dem letzten Mal kam. */
export function nimmAbrufe() {
  const kopie = abrufe.slice();
  abrufe.length = 0;
  return kopie;
}
