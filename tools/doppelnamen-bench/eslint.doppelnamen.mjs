/**
 * Eigene, bewusst winzige ESLint-Fassung fuer `tools/doppelnamen-bench`.
 *
 * WARUM NICHT DIE GROSSE `eslint.config.mjs`. Die traegt die Globalenliste
 * und `no-undef`, und ein Lauf damit ueber den Bestand meldet 5194 Treffer
 * (gemessen 07.11.2026). Eine Pruefung, die beim ersten Lauf einen Berg
 * ausschuettet, wird abgeschaltet; genau darum liest `lint-diff.mjs` nur den
 * Diff. Dieser Stand geht den anderen Weg: er liest den GANZEN Bestand und
 * dafuer nur drei Regeln, die heute null Treffer haben.
 *
 * WARUM GENAU DIESE DREI. Alle drei melden einen Doppelnamen, bei dem ein
 * spaeterer Eintrag einen frueheren still ueberschreibt. JavaScript sagt dazu
 * nichts, und beim Lesen faellt es nicht auf, weil die beiden Eintraege weit
 * auseinander liegen koennen. Am 09.11.2026 standen drei solche Stellen im
 * Bestand, und eine davon war ein echter Kundenfehler: zwei `complete()` in
 * `BeneosSetupTour`, wodurch die Aufraeumung nach einer zu Ende gespielten
 * Tour nie lief.
 */
export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: {
      "no-dupe-class-members": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
    },
  },
]
