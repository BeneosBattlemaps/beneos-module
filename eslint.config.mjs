/**
 * ESLint fuer das Beneos-Modul, mit genau einer Aufgabe: einen Namen finden,
 * den es nicht gibt.
 *
 * WARUM ES DIESE DATEI GIBT. Bis zum 07.11.2026 war `node --check` die einzige
 * Maschinenpruefung des Repositories, und die sagt nur, ob eine Datei
 * grammatisch lesbar ist. Am 06.11.2026 hat das Geld gekostet: beim Umbau in
 * `OP-PRJ-192` blieb ein herausgezogener Funktionsrumpf auf `mappings` stehen,
 * das beim Aufrufer liegen geblieben war. `node --check` sagte ok, der
 * Pruefsatz lief mit 29 von 29, und erst der echte Lauf am Teststand meldete
 * `ReferenceError: mappings is not defined`. Dieser Lauf dauert 92 Sekunden.
 * Siehe `OP-PRJ-195`.
 *
 * WIE SIE BENUTZT WIRD. Nicht ueber den Bestand, sondern ueber eine
 * Dateiliste, naemlich die des eigenen Diffs:
 *
 *   node tools/lint-diff.mjs
 *
 * Betreiberentscheid 07.11.2026. Der Grund ist nicht Bequemlichkeit: ein Lauf
 * ueber den Bestand meldet 5194 Treffer in 131 Dateien, gemessen am
 * 07.11.2026, und praktisch alle sind Globale von Foundry und des Browsers.
 * Eine Pruefung, die beim ersten Lauf einen Berg ausschuettet, wird abgeschaltet.
 *
 * ES GIBT KEIN `node_modules` IN DIESEM REPOSITORY, und das ist Absicht. Der
 * Modulordner liegt in einem laufenden Foundry-Datenverzeichnis und wird von
 * dort ausgeliefert; ein Abhaengigkeitsbaum darin waere oeffentlich lesbar und
 * ginge im schlimmsten Fall mit in die ausgelieferte Fassung. `lint-diff.mjs`
 * holt ESLint deshalb ueber `npx` in einer festen Fassung, und die liegt im
 * Zwischenspeicher von npm, ausserhalb des Repositories. Fuer den Fall, dass
 * doch jemand installiert, steht `node_modules/` in der `.gitignore`.
 *
 * DIE GLOBALENLISTE IST GEMESSEN UND NICHT GERATEN. Sie entstand am 07.11.2026
 * aus einem Lauf ueber `scripts/**` und `tools/**` ganz ohne Liste: 100
 * verschiedene Namen, jeder einzeln angesehen. Zwei davon waren keine Globalen,
 * sondern ein echter Fund, und der steht als eigener Punkt im Wiki. Wer die
 * Liste erweitert, soll denselben Weg gehen und nicht einfach anhaengen: ein
 * Name, der hier faelschlich steht, nimmt der Pruefung genau ihre Aufgabe.
 */

/** Was der Browser mitbringt. */
const browser = {
  AbortController: "readonly",
  AbortSignal: "readonly",
  Blob: "readonly",
  CSS: "readonly",
  DOMException: "readonly",
  DOMParser: "readonly",
  DocumentFragment: "readonly",
  Element: "readonly",
  Event: "readonly",
  File: "readonly",
  FormData: "readonly",
  HTMLElement: "readonly",
  HTMLVideoElement: "readonly",
  Headers: "readonly",
  Image: "readonly",
  IntersectionObserver: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  MutationObserver: "readonly",
  Node: "readonly",
  ResizeObserver: "readonly",
  Response: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  TransformStream: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Worker: "readonly",
  atob: "readonly",
  btoa: "readonly",
  caches: "readonly",
  cancelAnimationFrame: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  crypto: "readonly",
  document: "readonly",
  fetch: "readonly",
  getComputedStyle: "readonly",
  localStorage: "readonly",
  location: "readonly",
  navigator: "readonly",
  onmessage: "writable",
  performance: "readonly",
  postMessage: "readonly",
  queueMicrotask: "readonly",
  requestAnimationFrame: "readonly",
  requestIdleCallback: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  structuredClone: "readonly",
  window: "readonly",
}

/** Was Foundry VTT mitbringt. */
const foundryGlobals = {
  Actor: "readonly",
  AudioHelper: "readonly",
  CONFIG: "readonly",
  Canvas: "readonly",
  CanvasAnimation: "readonly",
  ChatMessage: "readonly",
  ControlsLayer: "readonly",
  Dialog: "readonly",
  DrawingsLayer: "readonly",
  FilePicker: "readonly",
  Folder: "readonly",
  FormApplication: "readonly",
  Hooks: "readonly",
  Item: "readonly",
  JournalEntry: "readonly",
  PIXI: "readonly",
  PreciseText: "readonly",
  Ray: "readonly",
  Roll: "readonly",
  Scene: "readonly",
  Tour: "readonly",
  canvas: "readonly",
  foundry: "readonly",
  fromUuid: "readonly",
  game: "readonly",
  loadTemplates: "readonly",
  renderTemplate: "readonly",
  saveDataToFile: "readonly",
  ui: "readonly",
}

/**
 * Was andere Module mitbringen, und was dieses Modul selbst als Globales
 * anlegt.
 *
 * `beneosFX` und die `BENEOS_*`-Konstanten stehen als `let` beziehungsweise
 * `const` auf der obersten Ebene von `scripts/beneosfx.js`, dem einzigen
 * klassischen Skript dieses Moduls. Das legt sie in die globale lexikalische
 * Umgebung, und die liest auch Modulcode. Sie sind also wirklich da, auch wenn
 * keine Datei sie exportiert.
 */
const fremd = {
  $: "readonly",
  BENEOS_DEATH_FILTER_IDS: "readonly",
  BENEOS_DEATH_MARKER_ID: "readonly",
  BENEOS_DEATH_SCOPES: "readonly",
  BENEOS_DEATH_SCOPE_DEFAULT: "readonly",
  BENEOS_DEFAULT_TOKEN_PATH: "readonly",
  BENEOS_MODULE_ID: "readonly",
  BENEOS_MODULE_NAME: "readonly",
  ForgeAPI: "readonly",
  ForgeVTT: "readonly",
  Handlebars: "readonly",
  TokenMagic: "readonly",
  beneosFX: "readonly",
  jQuery: "readonly",
  libWrapper: "readonly",
}

/** Was Node mitbringt, fuer die Pruefsaetze und die Werkzeuge. */
const node = {
  Buffer: "readonly",
  process: "readonly",
}

export default [
  {
    // Fremdcode. `fflate` ist eingekauft und wird nicht von uns gepflegt.
    ignores: [
      "node_modules/**",
      "scripts/lib/**",
      "docs/**",
      "packs/**",
      "dev/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...browser, ...foundryGlobals, ...fremd, ...node },
    },
    linterOptions: {
      // Eine abgeschaltete Regel ist eine Entscheidung und soll stehen bleiben
      // duerfen, ohne dass die Pruefung darueber meckert.
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // Die eine Regel, um die es geht.
      "no-undef": "error",
      // Zwei Mitnahmen, die denselben Fehler aus der anderen Richtung fangen:
      // ein Umbau, der eine Hilfsvariable stehen laesst, und ein Rumpf, der
      // nach einer Rueckgabe weiterlaeuft.
      //
      // `caughtErrorsIgnorePattern` ist GEMESSEN und nicht Geschmack: ohne ihn
      // meldet ein Lauf ueber fuenf Streamdateien 68 Warnungen, und 67 davon
      // sind `catch (_)` beziehungsweise `catch (_e)`, also die hier
      // eingefuehrte Schreibweise fuer "dieser Fehlschlag wird absichtlich
      // ausgesessen", jedes Mal mit einem Kommentar daneben. Eine Pruefung mit
      // 67 erwarteten Warnungen wird ueberblaettert, und dabei geht die eine
      // Zeile verloren, um die es geht.
      //
      // `catch (e)` mit unbenutztem `e` bleibt dagegen eine Warnung, und das
      // ist Absicht: wer den Fehler benennt und dann nicht anfasst, hat ihn
      // vermutlich vergessen und nicht verworfen.
      // `ignoreRestSiblings` deckt eine Schreibweise, die hier Absicht ist:
      // `const { urls, ...rest } = e` holt `urls` NUR heraus, damit es nicht in
      // `rest` landet (`stream-offline.mjs:218`, mit Begruendung daneben). Die
      // Variable wird nie gelesen, und das ist der Zweck.
      "no-unused-vars": ["warn", {
        args: "none",
        varsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      "no-unreachable": "error",
      // Eine doppelte Deklaration und eine doppelte Eigenschaft sind in einem
      // Bestand dieser Groesse fast immer ein Fluechtigkeitsfehler.
      "no-dupe-keys": "error",
      "no-dupe-class-members": "error",
      "no-redeclare": "error",
    },
  },
]
