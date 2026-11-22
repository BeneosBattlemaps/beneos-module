# Wachen der Domaene basis, geladen vom Kern tools/haken/pre-commit
# (stre-T-070).
#
# KEIN EIGENSTAENDIGES SKRIPT. Der Kern laedt diese Datei mit `.`, und sie
# braucht seine Helfer `fahre`, `fahre_weich`, `werte_aus`, `meld`, dazu
# `$TMP` und `ROT`. Geladen wird nur die vorgemerkte Fassung.
#
# BESITZ. Diese drei Wachen stehen auch im Haken auf main, und der gehoert dem
# Tab modu. Mit stre-T-070 sind sie nur umgezogen, ihr Code ist zeichengleich.
#
# KOPPLUNG. `anker.test.mjs` laeuft hier auf jeden Commit. Die Schleife der
# Streamsaetze in wachen/stre.sh nimmt ihn deshalb aus; wer ihn hier entfernt,
# nimmt ihn aus dem ganzen Tor.

fahre "scripts/creature-installer/anker.test.mjs" "anker.test.mjs, 22 Saetze"
fahre "tools/v14-import-bench/unit.mjs"           "v14-import unit.mjs, 53 Saetze"

# Die teure nur, wenn ihr Gegenstand angefasst wird.
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts/beneos_search_engine.js scripts/beneos_utility.js \
   | grep -q .
then
  meld "pre-commit: Katalogdateien vorgemerkt, die 10s-Pruefung laeuft mit"
  fahre "tools/pruefe-katalog-offline.mjs" "pruefe-katalog-offline.mjs, 7 Saetze"
fi
