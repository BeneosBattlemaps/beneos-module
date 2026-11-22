# Wachen der Domaene modul, also Modulcode, der nicht am Streaming haengt.
# Geladen vom Kern tools/haken/pre-commit (stre-T-070).
#
# KEIN EIGENSTAENDIGES SKRIPT. Der Kern laedt diese Datei mit `.`, und sie
# braucht seine Helfer `fahre`, `fahre_weich`, `werte_aus`, `meld`, dazu
# `$TMP` und `ROT`. Geladen wird nur die vorgemerkte Fassung.
#
# BESITZ. Nach main portiert diese Wachen laut stre-T-007 der Tab modu. Mit
# stre-T-070 sind sie nur umgezogen, ihr Code ist zeichengleich.
#
# KOPPLUNG. Der Satz `vorhaken.test.mjs` aus wachen/stre.sh faehrt die
# Doppelnamen- und die Globalenwache dieser Datei in einer Wegwerfkopie und
# haelt fest, dass beide den Index lesen. Seine Sabotagen setzen an den
# `fahre_weich`-Zeilen dieser Datei an (`tools/stream-sabotagen.mjs`, Satz
# `doppelwache`).

# Die Reihenfolge der Filterlisten, wenn eine der zwei Sortierstellen oder
# eine der festen Listen angefasst wird.
#
# WARUM ZWEI DATEIEN IM AUSLOESER, seit dem 08.11.2026 und mit `OP-PRJ-200`.
# Die Reihenfolge der Gittergroesse entsteht an ZWEI Stellen in ZWEI Dateien:
# `sortProperties` in `scripts/beneos_search_engine.js` und
# `#orderDropdownList` in `scripts/cloud-v2/cloud-window-v2.mjs`. Die zweite
# ueberschreibt die erste. Eine Reparatur allein in der ersten war deshalb
# wirkungslos, und ein Tor, das nur die erste beobachtet, haette das nicht
# gesehen.
#
# `scripts/cloud-v2/cloud-window-v2.mjs` loeste vor diesem Tag GAR KEINEN
# Pruefsatz aus, obwohl das Suchfenster des Kunden darin steht. Das war die
# Deckungsluecke, und sie ist hier zur Haelfte geschlossen: gemessen wird die
# Listenreihenfolge, nicht die Datei.
#
# AM 08.11.2026 WUCHS SIE von 29 auf 46 Saetze, mit `OP-PRJ-202`: die
# Zahlensortierung entschied am ersten Listeneintrag, und die Seltenheitsleiter
# kam ueber die INDIZES ihres Arrays statt ueber ihre Schluessel.
#
# Die Satzzahl in der Beschriftung veraltet still, sobald jemand einen Satz
# dazulegt, und sie faellt niemandem auf, weil der Lauf gruen bleibt. Dieselbe
# Schwaeche tragen die anderen Beschriftungen mit Satzzahl, in dieser Datei
# und in wachen/basis.sh und wachen/stre.sh. Wer eine Zahl hier liest, prueft
# sie am Lauf.
#
# Sie kostet gemessen unter einer Sekunde, kein Netz, kein Foundry.
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts/beneos_search_engine.js \
        scripts/cloud-v2/cloud-window-v2.mjs \
        tools/filter-reihenfolge-bench \
   | grep -q .
then
  meld "pre-commit: Suchfensterdateien vorgemerkt, die Filterreihenfolge laeuft mit"
  fahre "tools/filter-reihenfolge-bench/bench.mjs" "filter-reihenfolge-bench, 46 Saetze"
fi

# Die Grenze des Kundenpakets, wenn die Bauvorgabe oder die Ladeliste
# angefasst wird.
#
# WARUM SIE DAZUKOMMEN MUSSTE, am 08.11.2026 mit `OP-PRJ-217`. Die
# `.gitattributes` entscheidet, was im Kundenpaket landet, und loeste bis zu
# diesem Tag GAR KEINEN Pruefsatz aus. Sie trug seit dem 03.09.2026 eine
# Sperre und darueber den Kommentar "NOCH NICHT AM ARCHIV NACHGEMESSEN"
# samt dem Befehl fuer die Probe; die Probe hat niemand gefahren. Als sie
# lief, trug die Sperre, aber sie war die einzige: `tools/` fuhr mit 66
# Dateien ins Paket.
#
# WAS DER GEFAEHRLICHE FALL IST, und es ist nicht die vergessene Sperre.
# Eine Sperre mit zu weitem Muster nimmt dem Kunden Teile des Produkts, und
# das faellt beim Bauen NICHT auf: das Archiv entsteht ohne Fehler, es ist
# nur kleiner. Der Stand prueft deshalb beide Richtungen, und sein zweiter
# Abschnitt ist der wichtigere.
#
# WARUM `module.json` MIT IN DEN AUSLOESER MUSS. Der dritte Abschnitt haelt
# jeden Ladepfad gegen das Archiv. Kommt ein esmodule aus einem gesperrten
# Ordner dazu, installiert das Paket und schweigt dann; ohne diese Zeile
# liefe der Satz genau bei der Aenderung nicht, die ihn braucht.
#
# Er faehrt `git write-tree` und messt damit den VORGEMERKTEN Stand, nicht
# HEAD. Gemessen 0,6 Sekunden, kein Netz, kein Foundry.
if git diff --cached --name-only --diff-filter=ACM \
     -- .gitattributes module.json tools/paket-grenze-bench \
   | grep -q .
then
  meld "pre-commit: Bauvorgabe vorgemerkt, die Paketgrenze laeuft mit"
  fahre "tools/paket-grenze-bench/bench.mjs" "paket-grenze-bench"
fi

# Der Satz gegen die Globalen, die Foundry 15 entfernt.
#
# Foundry 13 hat 378 Namen in Namensraeume verschoben und den alten globalen
# Namen als Uebergangshilfe stehen gelassen, `until: 15`. Gemessen am
# 09.11.2026: 31 davon sind in der installierten Foundry 14 schon ganz weg,
# und das Modul nutzt keinen dieser 31 ohne Rueckfall. Offen sind 24 Stellen
# an acht anderen Namen, und die Obergrenze haelt die Zahl.
#
# WARUM EIN STATISCHER SATZ: Foundry meldet den Zugriff nur EINMAL je Name
# und Sitzung (`once: true`). Eine Messung im Browser zeigte am 09.11.2026
# genau eine der damals sechs offenen renderTemplate-Stellen, ein zweiter
# Durchgang im selben Browser zeigte null. Der Satz findet alle sechs.
#
# Der Ausloeser deckt `scripts` GANZ, denn genau das liest der Satz. Ein
# Ausloeser, der schmaler ist als der Lesebereich seines Satzes, ist eine
# Luecke und wird nie rot; dasselbe stand am 08.11. bei `OP-PRJ-216` und am
# 09.11. bei `OP-PRJ-151`.
#
# Die Ortsliste fuer Foundry steht seit stre-T-019 in tools/foundry-orte.mjs
# und gehoert damit zum Lesebereich, also in den Ausloeser.
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts module.json tools/v15-globale-bench tools/foundry-orte.mjs \
   | grep -q .
then
  meld "pre-commit: Modulcode vorgemerkt, die Globalenwache laeuft mit"
  # KEINE ZAHL IN DIESER BESCHRIFTUNG. Sie stand hier als "Obergrenze 24" und
  # war nach dem ersten Senken der Grenze falsch, ohne dass etwas rot wurde.
  # Eine Zahl an zwei Stellen laeuft auseinander, und die Beschriftung ist die
  # Stelle, die niemand nachmisst. Die Grenze steht in `bench.mjs` und nur da.
  fahre_weich "tools/v15-globale-bench/bench.mjs" \
              "v15-globale-bench" tools/foundry-orte.mjs
fi

# Die zwei Benches, die Foundry selbst laden (stre-T-019). Bis dahin brachen
# beide ohne Argument mit Austritt 2 ab und liefen in keinem Tor.
#
# v14-import liest ohne --packs die synthetische Pruefquelle neben sich und
# prueft die V13-zu-V14-Bruecke gegen das Datenmodell der installierten
# Foundry. scene-merge-token prueft die Aufteilung der Token-Updates gegen
# den Foundry-Kern. Beide finden Foundry ueber tools/foundry-orte.mjs.
#
# fahre_weich, denn ohne Foundry enden beide mit 2: "nicht gemessen", gemeldet,
# kein Commit gesperrt und nie gruen. Der Ausloeser deckt, was der Satz liest:
# die Bruecke bzw. die Aufteilung, den Ordner der Bench und die Ortsliste.
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts/cloud-v2/beneos-v14-scene-migration.mjs tools/v14-import-bench \
        tools/foundry-orte.mjs \
   | grep -q .
then
  meld "pre-commit: V14-Bruecke vorgemerkt, die Importbench laeuft mit"
  fahre_weich "tools/v14-import-bench/bench.mjs" \
              "v14-import-bench" tools/foundry-orte.mjs
fi
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts/cloud-v2/token-delta.mjs tools/scene-merge-token-bench \
        tools/foundry-orte.mjs \
   | grep -q .
then
  meld "pre-commit: Token-Aufteilung vorgemerkt, ihre Bench laeuft mit"
  fahre_weich "tools/scene-merge-token-bench/unit.mjs" \
              "scene-merge-token-bench" tools/foundry-orte.mjs
fi

# DOPPELNAMEN IM GANZEN BESTAND, und dieser Stand geht die Gegenrichtung zu
# `lint-diff.mjs`.
#
# Gefunden am 09.11.2026: `BeneosSetupTour` trug `async complete()` ZWEIMAL,
# Zeile 1347 und 1580, und JavaScript nimmt still den spaeteren. Die Folge war
# verkehrt herum: beim Abbrechen der Tour lief die Aufraeumung, beim normalen
# Beenden nicht. Dazu zwei doppelte `default`-Schluessel in
# `beneos_utility.js`.
#
# DAS WERKZEUG DAFUER WAR DA UND HAT NICHT GEGRIFFEN. `no-dupe-class-members`
# steht seit `OP-PRJ-195` auf `error`, aber `lint-diff.mjs` liest bewusst nur
# die Dateien des eigenen Diffs, und `beneos_tours.js` war monatelang in
# keinem. Der Fehler fiel erst, als die Datei aus einem anderen Grund in einen
# Diff geriet. Darum liest dieser Stand den ganzen Ordner `scripts` und dafuer
# nur drei Regeln.
#
# `fahre_weich`, denn der Stand holt ESLint ueber `npx` und endet ohne
# Netz und ohne Zwischenspeicher mit 2. Eine Pruefung, die nicht laufen
# konnte, darf weder gruen aussehen noch einen Commit blockieren. Seit
# stre-T-157 liest er die vorgemerkte Fassung, nicht die Platte.
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts tools/doppelnamen-bench \
   | grep -q .
then
  meld "pre-commit: Modulcode vorgemerkt, die Doppelnamenwache laeuft mit"
  fahre_weich "tools/doppelnamen-bench/bench.mjs" \
              "doppelnamen-bench, erlaubt 0"
fi
