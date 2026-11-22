# Wachen der Domaene stre: das Streaming und die Riegel des Tors selbst.
# Geladen vom Kern tools/haken/pre-commit (stre-T-070).
#
# KEIN EIGENSTAENDIGES SKRIPT. Der Kern laedt diese Datei mit `.`, und sie
# braucht seine Helfer `fahre`, `fahre_weich`, `werte_aus`, `meld`, dazu
# `$TMP` und `ROT`. Geladen wird nur die vorgemerkte Fassung.
#
# BESITZ. Tab stre.
#
# KOPPLUNG. Die Schleife der Streamsaetze nimmt zwei Saetze aus, die auf jeden
# Commit laufen: `anker.test.mjs` aus wachen/basis.sh und
# `cloud-login-kennung.test.mjs` aus dem ersten Block dieser Datei. Wer einen
# der beiden dort entfernt, nimmt ihn aus dem ganzen Tor.

# Die Anmeldung mit der Weltkennung (stre-T-135). Der Satz liegt direkt unter
# `scripts/` und damit ausserhalb der Sammlung der Streamsaetze weiter unten;
# ohne diese Zeile liefe er in keinem Tor. Unter einer Sekunde, kein Netz.
fahre "scripts/cloud-login-kennung.test.mjs"      "cloud-login-kennung.test.mjs"

# Die Pruefsaetze des Streamings, und nur wenn ihr Gegenstand angefasst wird.
#
# WARUM ERST SEIT DEM 08.11.2026. Sie lagen in genau der Lage, die der Kopf von
# tools/haken/pre-commit beschreibt: fuenf Saetze, die gruen laufen, ohne Netz, ohne Foundry, und
# die niemand fuhr. `stream-sperre.test.mjs` kam am 07.11.2026 dazu und
# `stream-geteilt.test.mjs` am 08.11.2026 und `stream-posen.test.mjs` am
# 07.11.2026; alle drei hingen in keinem Tor.
#
# `stream-weiche.test.mjs` kam am 08.11.2026 dazu, mit `OP-PRJ-052`. Sie
# sichert `buildStreamPack`, also die Weiche, die je Datei entscheidet, ob sie
# auf die Platte des Kunden geschrieben wird oder eine Adresse bleibt. Sie hing
# in NULL von sieben Saetzen, obwohl 18,98 GB an ihr haengen.
#
# WARUM NICHT AUF JEDEN COMMIT. Gemessen am 07.11.2026 kosten die sieben
# zusammen rund 9 Sekunden, und das ist fast alles Node-Start. Dieselbe Abwaegung
# wie bei der Katalogpruefung in wachen/basis.sh: ein Tor, das man regelmaessig mit
# --no-verify umgeht, ist keines. Sie laufen deshalb, wenn eine Datei unter
# `scripts/stream/` oder `scripts/loot/` vorgemerkt ist, und das ist genau die
# Menge, die sie messen.
#
# WARUM DER INSTALLER MIT IN DEN AUSLOESER MUSS, seit dem 08.11.2026. Der neue
# Satz prueft die Vorabsonde `#preflightSizeCheck` (bis 15.11.2026 als
# Quelltextprobe, seit stre-T-108 als Lauf bis zur Sonde), und die steht in
# `scripts/cloud-v2/beneos-native-installer.mjs`. Ohne diese Zeile
# laeuft der Satz nicht, wenn genau die geprobte Datei geaendert wird, und das
# ist die Lage, in der er gebraucht wird. Es kostet die rund 10 Sekunden auch
# bei einer Installeraenderung, und das ist der Preis dafuer, dass die Probe
# kein blinder Fleck ist.
#
# AM 08.11.2026 IST `scripts/codex2/item-companion.mjs` DAZUGEKOMMEN, und zwar
# aus demselben Grund. `stream-beute.test.mjs` prueft seit `OP-PRJ-141` Teil 2
# am Quelltext, dass das Begleitfenster `karteFuerBlatt()` ruft und wartet.
# Dieser Satz lief in keinem Tor: `scripts/codex2` stand in keiner Liste, also
# haette eine Aenderung genau dort den Satz nicht ausgeloest. Ein Pruefer, der
# bei der Aenderung seines Gegenstands nicht laeuft, ist kein Pruefer.
# DER AUSLOESER DECKT DEN LESEBEREICH, UND DAS WAR ER NICHT.
#
# Gemessen am 09.11.2026 ueber alle `readFileSync`-Stellen der Saetze
# in `scripts/stream` und `scripts/loot`: sie lesen ausserdem
# `scripts/beneos_cloud.js`, `scripts/beneos_utility.js` und
# `lang/*.json`. Keine der drei stand hier. Wer die Streamweiche des
# Item-Installers in `beneos_cloud.js` aendert, haette das Tor also
# nicht geweckt, obwohl `stream-beute.test.mjs` genau diese Datei
# liest. Derselbe Befund zum dritten Mal, nach `OP-PRJ-216` am 08.11.
# und `OP-PRJ-151` am 09.11.: ein Ausloeser, der schmaler ist als der
# Lesebereich seines Satzes, ist eine Luecke und wird nie rot.
#
# SEIT stre-T-017 (15.11.2026) LADEN posen UND beute DIE GANZE IMPORTKETTE von
# `beneos_utility.js` und `beneos_cloud.js`, und vier Saetze laden die
# Attrappe in `tools/lib/`. Gemessen lagen 13 Dateien dieser Kette ausserhalb
# der alten Liste. Der Ausloeser ist deshalb `scripts` als Ganzes, dazu
# `lang`, `tools/lib` und, was stream-ersatzbild liest, `ui` und der Erzeuger
# `tools/ersatzbilder.py`. Geloeschte und umbenannte Dateien zaehlen mit
# (Filter ACMRD): eine geloeschte Datei der Importkette bricht posen und beute
# beim Laden.
#
# DER PREIS, gemessen am 15.11.2026: die zwoelf Saetze nacheinander rund 8 s
# (7,9 s hier, 8,3 bis 8,7 s in der Kaltdurchsicht). Den zahlt jetzt jeder
# Commit an einer Moduldatei. Das ist bewusst: eine schmalere Liste war
# dreimal die Luecke (siehe oben), und 8 s liegen unter den 10 s der
# Katalogpruefung, die im Kopf von tools/haken/pre-commit als Schwelle fuer
# "wird umgangen" steht.
#
# SEIT stre-T-144 (19.11.2026) GEHOERT `templates` DAZU. cloud-kaufknopf.test.mjs
# liest `templates/cloud-v2/parts/results-pane.hbs`; eine Aenderung nur an
# dieser Vorlage weckte das Tor nicht. Derselbe Befund wie oben, zum vierten Mal.
if git diff --cached --name-only --diff-filter=ACMRD \
     -- scripts lang templates tools/lib ui tools/ersatzbilder.py \
   | grep -q .
then
  meld "pre-commit: Streamdateien vorgemerkt, die Streampruefsaetze laufen mit"
  # DIE LISTE KOMMT AUS DEM VERZEICHNIS UND IST NICHT AUFGEZAEHLT, seit dem
  # 08.11.2026.
  #
  # Bis dahin standen die Staende hier namentlich, und genau das ist am selben
  # Tag aufgefallen: `stream-platzhalter.test.mjs` entstand mit `OP-PRJ-137`,
  # lag im selben Commit, traf den Ausloeser `scripts/stream/` und lief
  # TROTZDEM nicht, weil niemand die Aufzaehlung erweitert hatte. Der Commit
  # meldete acht gruene Staende und nannte den neunten nicht; nichts war rot.
  #
  # Eine Aufzaehlung dessen, was laufen SOLL, kann nie bemerken, dass etwas
  # Neues dazugekommen ist. Sie ist beim naechsten Stand wieder zu kurz. Die
  # Gesamtmenge dagegen nimmt jeden neuen Stand von selbst mit.
  #
  # DIE MINDESTZAHL IST KEIN SCHMUCK. Eine Suche, die nichts findet, ist von
  # einer kaputten Suche nicht zu unterscheiden, und dann liefe dieser Block
  # still durch und meldete nur seine Kopfzeile. Die Zahl ist der Stand vom
  # 08.11.2026, also elf Staende; sie wird nach UNTEN gesichert und nicht
  # nach oben, damit ein neuer Stand sie nicht bricht. Sie stand bis zum
  # Nachmittag des 08.11.2026 auf neun und ist mit `stream-bilder.test.mjs`
  # und `stream-ersatzbild.test.mjs` nachgezogen; wer sie stehen laesst,
  # laesst den Verlust zweier Staende durchgehen.
  #
  # WAS EIN STAND HIER ERFUELLEN MUSS: ohne Netz, ohne Foundry, ohne
  # Datenbank, und in rund einer Sekunde. Wer einen Stand baut, der das nicht
  # kann, legt ihn nirgends unter `scripts/` als `*.test.mjs` ab, sonst haelt
  # er jeden Commit an einer Moduldatei auf.
  #
  # BEIDE ORDNER, UND DAS WAR AM 2026-11-09 EIN BEFUND. Der Ausloeser
  # darueber nennt `scripts/stream` UND `scripts/loot` seit `OP-PRJ-141`,
  # diese Sammlung las aber nur den Streamordner. `OP-PRJ-216` legte den
  # ersten Stand unter `scripts/loot/` ab, und er waere nie gefahren worden:
  # der Commit haette den Haken ausgeloest, der Haken haette elf Staende
  # gefahren und den zwoelften nicht gesehen. Dieselbe Klasse wie der Befund
  # vom 2026-11-08, wo die Sammlung die Streamstaende namentlich aufzaehlte
  # und den neuen nicht kannte; dort war es eine Liste, hier ein Ordner.
  #
  # ALLE ORDNER, seit stre-T-144 (19.11.2026). Zum dritten Mal dieselbe Klasse:
  # vier Saetze unter `scripts/cloud-v2/` (cloud-kaufknopf, install-badge,
  # item-tooltip) und `scripts/canvas/` (map-sharpen-curve) liefen in keinem
  # Tor, weil die Sammlung zwei feste Ordner las. Ein dritter fester Ordner
  # waere beim naechsten wieder zu kurz. Die Sammlung nimmt deshalb jeden
  # `*.test.mjs` unter `scripts/` in jeder Tiefe; ohne `:(glob)` greift `*`
  # in der Pfadangabe ueber Schraegstriche hinweg.
  #
  # AUS DEM INDEX, NICHT AUS DEM BAUM: ein vorgemerkter neuer Satz laeuft mit,
  # ein fremder unverfolgter Satz im Arbeitsbaum haelt den Commit nicht auf
  # (dieselbe Begruendung wie bei `git show :<pfad>` im Abschnitt Syntax von
  # tools/haken/pre-commit).
  #
  # Ausgenommen sind nur die zwei Saetze, die auf jeden Commit laufen,
  # `anker.test.mjs` aus wachen/basis.sh und `cloud-login-kennung.test.mjs`
  # aus dem ersten Block dieser Datei;
  # sonst liefen sie doppelt. Das ist eine Ausnahmeliste, keine Aufzaehlung
  # dessen, was laufen soll. Der Preis der vier: rund 1,8 s, gemessen hier.
  STAENDE=$(git ls-files -- 'scripts/*.test.mjs' \
            | grep -vxF -e scripts/creature-installer/anker.test.mjs \
                        -e scripts/cloud-login-kennung.test.mjs \
            | sort)
  ANZAHL=$(printf '%s\n' "$STAENDE" | grep -c 'test\.mjs$')
  # Die Mindestzahl ist der Stand vom 19.11.2026: 23 unter `stream/`, zwei
  # unter `loot/`, drei unter `cloud-v2/`, einer unter `canvas/`. Sie sichert
  # nach unten und waechst mit, wenn jemand sie nachzieht; eine Suche, die
  # nichts findet, ist von einer kaputten Suche nicht zu unterscheiden.
  if [ "$ANZAHL" -lt 29 ]; then
    meld "pre-commit: ABBRUCH, nur $ANZAHL Pruefsaetze unter scripts"
    meld "            gefunden, erwartet mindestens 29."
    meld "            Entweder ist die Suche kaputt oder ein Stand ist"
    meld "            verschwunden; beides ist ein Befund und keine"
    meld "            bestandene Pruefung."
    exit 1
  fi
  # DIE VERTRAGSSAETZE (stream-vertrag-*, stre-T-021) lesen einen Nachbarklon
  # per git show und geben 2 zurueck, wenn er fehlt: nicht gemessen, kein
  # Befund, aber gemeldet (werte_aus). Jeder andere Stand bleibt bei fahre,
  # wo jeder Austritt ungleich 0 ROT ist.
  for datei in $STAENDE
  do
    case "$datei" in
      scripts/stream/stream-vertrag-*.test.mjs)
        if [ -f "$datei" ]; then
          node "$datei" > "$TMP/lauf" 2>&1
          werte_aus "$?" "$(basename "$datei")"
        else
          fahre "$datei" "$(basename "$datei")"
        fi
        ;;
      *)
        fahre "$datei" "$(basename "$datei")"
        ;;
    esac
  done
fi

# Die Sprachwache, wenn eine Sprachdatei oder eine Streamvorlage angefasst
# wird.
#
# WARUM SIE DAZUKOMMEN MUSSTE. Sie existiert seit dem 29.10.2026 und hing in
# keinem Tor. Am 07.11.2026 kam ihre vierte Aussage dazu, naemlich dass jeder
# Streamtext in der SCHREIBWEISE seiner Sprache steht; der Anlass waren 111
# Werte in neun Sprachen, die die ausgeschriebene Form statt des
# Sonderzeichens trugen, "waehrend" und "Qualitaet" im Deutschen, "conexion"
# im Spanischen, "nao" im Portugiesischen. Kein Lauf war deswegen rot, weil
# niemand nachsah.
#
# AM 08.11.2026 WUCHS IHRE MENGE von 101 auf 2614 Schluessel, mit
# `OP-PRJ-201`. Sie prueft jetzt jeden ausgelieferten Textbaustein und nicht
# nur die des Streamings; der Anlass waren 19 weitere Werte, darunter die
# Meldung "Beneos Cloud ist nicht erreichbar" in ALLEN acht Sprachen. Deshalb
# damals 16 Saetze statt 14.
#
# AM 08.11.2026 KAM DER PLATZHALTERSATZ DAZU, `OP-PRJ-151`. Er prueft, dass
# jeder Platzhalter in jeder Sprache zeichengleich steht, und zwar in BEIDEN
# Formen: die geschweifte von Foundry mit 198 Schluesseln und die aeltere
# Prozentform mit 6. Das verlangte `OP-PRJ-151` von Anfang an; gemessen hat es
# bis dahin niemand, und die Lage war dabei sauber. Ein falsch geschriebener
# Platzhalter laesst den Satz richtig aussehen und zeigt an der Stelle des
# Werts woertlich `{name}` oder gar nichts. Deshalb 37 Saetze statt 16.
#
# AM 09.11.2026 KAM DIE ANDERE RICHTUNG DAZU, Abschnitt 6, `OP-PRJ-151`.
# Abschnitt 5 vergleicht die dreizehn Uebersetzungen GEGENEINANDER. Steht
# in allen dreizehn dasselbe `{seconds}`, das kein Aufrufer liefert, ist er
# gruen und der Kunde liest woertlich `{seconds}`. Abschnitt 6 fragt
# deshalb, ob der Aufrufer jeden Platzhalter seines Textes nennt: gemessen
# 166 Schluessel, 0 Befunde, 12 von 12 Sabotagen gefangen. Deshalb 55
# Saetze statt 37.
#
# UND DER AUSLOESER MUSSTE MITWACHSEN, sonst waere der neue Satz tot.
# Abschnitt 6 liest `scripts`, `templates` und `tools` GANZ, denn dort
# stehen die Aufrufstellen. Der Ausloeser nannte nur `lang`,
# `templates/stream` und den Standordner. Wer eine Aufrufstelle in
# `scripts/beneos_cloud.js` aendert und dabei einen Platzhalter weglaesst,
# haette das Tor nie geweckt. Dasselbe ist am 08.11.2026 bei `OP-PRJ-216`
# gemessen worden: ein Ausloeser, der schmaler ist als der Lesebereich
# seines Satzes, ist eine Luecke, und sie wird nie rot.
#
# Sie kostet gemessen 0,9 Sekunden ueber drei Laeufe, kein Netz, kein
# Foundry. Der breitere Ausloeser weckt sie bei fast jedem Commit, und das
# ist der Preis dafuer, dass sie den Bereich deckt, den sie liest.
if git diff --cached --name-only --diff-filter=ACM \
     -- lang templates scripts tools \
   | grep -q .
then
  meld "pre-commit: Sprach- oder Aufrufdateien vorgemerkt, die Sprachwache laeuft mit"
  fahre "tools/stream-sprachen-bench/bench.mjs" "stream-sprachen-bench, 55 Saetze"
fi

# Der Satzprozess des Sabotagelaeufers (stre-T-126), wenn er oder der Laeufer
# angefasst wird. Er faehrt den Laeufer selbst viermal und kostet gemessen
# 10,5 s; das ist zu viel fuer jeden Commit an tools/lib, deshalb nicht in der
# Sammlung oben, sondern bedingt wie die Katalogpruefung in wachen/basis.sh.
# Seit stre-T-015 gehoeren der Bench-Laeufer und die gemeinsame Ersetzung
# dazu, mit dem Satz des Bench-Laeufers (seine Selbstprobe, rund 5 s). Die
# Laeufer selbst faehrt der Haken nicht, sie brauchen Minuten.
if git diff --cached --name-only --diff-filter=ACM \
     -- tools/lib/kindlauf.mjs tools/lib/kindlauf.test.mjs \
        tools/lib/ersetze.mjs tools/stream-sabotagen.mjs \
        tools/bench-sabotagen.mjs tools/bench-sabotagen.test.mjs \
   | grep -q .
then
  meld "pre-commit: Sabotagelaeufer vorgemerkt, die Saetze kindlauf und bench-sabotagen laufen mit"
  fahre "tools/lib/kindlauf.test.mjs" "kindlauf.test.mjs, 57 Saetze"
  fahre "tools/bench-sabotagen.test.mjs" "bench-sabotagen.test.mjs"
fi

# Die Dateipruefung des Kreaturen-Installers, wenn sie angefasst wird.
#
# WARUM SIE DAZUKOMMEN MUSSTE, am 08.11.2026 mit `OP-PRJ-170`.
# `scripts/beneos_cloud.js` loeste bis zu diesem Tag GAR KEINEN Pruefsatz aus,
# obwohl der Kreaturen-Installer darin steht. Das ist dieselbe Deckungsluecke,
# die `scripts/cloud-v2/cloud-window-v2.mjs` bis zum selben Tag hatte.
#
# WAS DARIN UNGESCHUETZT LAG. Die Waisenpruefung probte bis zum 05.11.2026 jede
# Texturadresse auf der Platte und baute dazu `"/" + protoSrc`. Aus einer
# Toradresse wurde `/https://gate...`, das antwortet 404, und JEDE gestreamte
# Kreatur bekam `missing_files`; das Fenster legte dem Spielleiter dann die
# Dokumente zum Loeschen vor, die in Ordnung sind. Dieselbe Zeile schickte den
# Streamschluessel in das Zugriffsprotokoll des eigenen Servers. Behoben in
# `7e96c69`, und bis zum 08.11.2026 hing daran kein Pruefsatz: eine entfernte
# Zeile und der Fehler waere zurueck, ohne dass etwas rot wird.
#
# Der Stand zaehlt auch die ANZAHL der HEAD-Proben in der Datei, heute genau
# eine. Eine zweite macht ihn rot, denn so ist der Fehler entstanden: die gute
# Probe lag schon in derselben Datei, die Waisenpruefung hat sie nicht benutzt.
#
# Die Satzzahl in der Beschriftung veraltet still. Dieselbe Schwaeche tragen
# die anderen Beschriftungen mit Satzzahl. Wer eine Zahl hier liest, prueft
# sie am Lauf.
#
# Sie kostet gemessen unter einer Sekunde, kein Netz, kein Foundry.
if git diff --cached --name-only --diff-filter=ACM \
     -- scripts/beneos_cloud.js tools/waisen-adressform-bench \
   | grep -q .
then
  meld "pre-commit: Kreaturen-Installer vorgemerkt, die Adressform laeuft mit"
  fahre "tools/waisen-adressform-bench/bench.mjs" "waisen-adressform-bench"
fi

# Der Bildweg des Installers, wenn er angefasst wird.
#
# WARUM ER DAZUKOMMEN MUSSTE, am 08.11.2026 mit `OP-PRJ-146`. Der Installer
# hat jede Bilddatei als base64 AUS DEM JSON gelesen, Maximum gemessen 20,4 MB
# in EINER Antwort. Der Server liefert sie seit `9f0a9cf` auf Verlangen als
# Adresse.
#
# WAS DARIN DER GEFAEHRLICHSTE TEIL IST, und es ist nicht der Abruf. Drei
# Stellen fragten vor dem Hochladen `if (!X.image64) continue`. Mit Adressen
# ist `image64` dort IMMER null, und die Bedingung waere immer wahr gewesen:
# der Installer haette jede Datei uebersprungen, ohne eine Zeile zu meckern.
# Eine Reparatur haette "nichts zu reparieren" gemeldet, und ein Kunde haette
# eine Kreatur ohne Bilder bekommen. Der Stand zaehlt deshalb die Vorkommen
# von `image64` nach; die ZAHL ist der Satz, nicht die Abwesenheit.
#
# Der Stand faehrt `_beneosBildDa()` und `_beneosBildDatei()` WIRKLICH, mit
# geschnittenem Code und nachgebautem `fetch`. Zwei Lagen haengen am
# Verhalten, vier am Quelltext.
#
# `A2` ist absichtlich scharf: er wird rot, sobald `BILDFORM_ADRESSE_AN` auf
# `true` steht. Das Umstellen ist eine Betreiberentscheidung nach einem Deploy
# und einem gesehenen Lauf, und wer sie trifft, aendert den Satz mit.
#
# Die Satzzahl in der Beschriftung veraltet still. Wer eine Zahl hier liest,
# prueft sie am Lauf.
#
# Sie kostet gemessen unter einer Sekunde, kein Netz, kein Foundry.
if git diff --cached --name-only --diff-filter=ACM      -- scripts/beneos_cloud.js tools/bildform-adresse-bench    | grep -q .
then
  meld "pre-commit: Bildweg des Installers vorgemerkt, der Stand laeuft mit"
  fahre "tools/bildform-adresse-bench/bench.mjs" "bildform-adresse-bench, 32 Saetze"
fi

# DER HAKEN SELBST (stre-T-157). Wird er angefasst, faehrt sein eigener Satz
# mit: er baut einen eigenen Index und haelt fest, dass die zwei Waechter
# in wachen/modul.sh (Doppelnamen und Globale) den Index lesen und nicht die
# Platte und dass die Syntax in der
# Ladeform geprueft wird. Seine Sabotagen stehen in
# `tools/stream-sabotagen.mjs`, Satz `doppelwache`.
#
# Der Ausloeser deckt alles, was der Satz liest: auch die zwei Benches und
# den Pruefstand, sonst liefe eine Aenderung an der Bench ohne die Proben von
# stre-T-158. Austritt 2 sperrt nicht, wie bei `fahre_weich`. Der Satz faehrt
# diesen Haken in einer Wegwerfkopie, in der jeder hier gefahrene Satz, auch
# dieser, ein Stub ist; er ruft sich darum nicht selbst wieder auf.
if git diff --cached --name-only --diff-filter=ACM \
     -- tools/haken tools/doppelnamen-bench tools/v15-globale-bench \
        tools/lib/foundry-attrappe.mjs tools/foundry-orte.mjs \
   | grep -q .
then
  meld "pre-commit: Vorhaken oder seine Benches vorgemerkt, sein Satz laeuft mit"
  if [ -f "tools/haken/vorhaken.test.mjs" ]; then
    node "tools/haken/vorhaken.test.mjs" > "$TMP/lauf" 2>&1
    werte_aus "$?" "vorhaken.test.mjs"
  elif git cat-file -e "HEAD:tools/haken/vorhaken.test.mjs" 2>/dev/null; then
    meld "pre-commit: vorhaken.test.mjs fehlt im Arbeitsbaum, HEAD kennt sie aber"
    ROT=$((ROT + 1))
  fi
fi

# DER PUSH-RIEGEL (stre-T-028). Wird er angefasst, faehrt sein Satz mit: er
# pusht in Wegwerfdepots und haelt fest, dass stream-beta ohne Versionssprung
# durchgeht und mit Versionssprung nur samt passendem Tag. Er ist langsam,
# deshalb nur bei Aenderung am Riegel, seiner Bruecke oder der module.json, deren
# Adressen er prueft. Seine Sabotagen: `tools/stream-sabotagen.mjs --satz vorpush`.
if git diff --cached --name-only --diff-filter=ACM \
     -- tools/haken/pre-push tools/haken/pre-push.mjs tools/haken/bruecke-pre-push \
        tools/haken/vorpush.test.mjs module.json \
   | grep -q .
then
  meld "pre-commit: Push-Riegel oder module.json vorgemerkt, sein Satz laeuft mit"
  if [ -f "tools/haken/vorpush.test.mjs" ]; then
    node "tools/haken/vorpush.test.mjs" > "$TMP/lauf" 2>&1
    werte_aus "$?" "vorpush.test.mjs"
  elif git cat-file -e "HEAD:tools/haken/vorpush.test.mjs" 2>/dev/null; then
    meld "pre-commit: vorpush.test.mjs fehlt im Arbeitsbaum, HEAD kennt sie aber"
    ROT=$((ROT + 1))
  fi
fi

# DER KENNUNGSRIEGEL (stre-T-047). Wird er angefasst, faehrt sein Satz mit: er
# committet in Wegwerfdepots und haelt fest, dass auf dem Stand von stream-beta
# kein Commit ohne Kennung in der Klammer des Betreffs entsteht, und dass main
# und Merges frei bleiben. Ausgeloest auch von module.json, an deren Manifest die
# Huelle den Stand erkennt. Seine Sabotagen:
# `tools/stream-sabotagen.mjs --satz betreffkennung`.
if git diff --cached --name-only --diff-filter=ACM \
     -- tools/haken/commit-msg tools/haken/commit-msg.mjs tools/haken/bruecke-commit-msg \
        tools/haken/commit-msg.test.mjs module.json \
   | grep -q .
then
  meld "pre-commit: Kennungsriegel oder module.json vorgemerkt, sein Satz laeuft mit"
  if [ -f "tools/haken/commit-msg.test.mjs" ]; then
    node "tools/haken/commit-msg.test.mjs" > "$TMP/lauf" 2>&1
    werte_aus "$?" "commit-msg.test.mjs"
  elif git cat-file -e "HEAD:tools/haken/commit-msg.test.mjs" 2>/dev/null; then
    meld "pre-commit: commit-msg.test.mjs fehlt im Arbeitsbaum, HEAD kennt sie aber"
    ROT=$((ROT + 1))
  fi
fi

# Das Messwerkzeug fuer das Tag-ZIP der Beta (stre-T-028) misst nach einem
# Push, ob Betatester das Modul bekommen. Sein Satz laeuft ohne Netz und
# schnell. Seine Sabotagen: `tools/stream-sabotagen.mjs --satz betazip`.
if git diff --cached --name-only --diff-filter=ACM \
     -- tools/pruefe-beta-zip.mjs tools/pruefe-beta-zip.test.mjs \
   | grep -q .
then
  meld "pre-commit: Messwerkzeug Beta-ZIP vorgemerkt, sein Satz laeuft mit"
  if [ -f "tools/pruefe-beta-zip.test.mjs" ]; then
    node "tools/pruefe-beta-zip.test.mjs" > "$TMP/lauf" 2>&1
    werte_aus "$?" "pruefe-beta-zip.test.mjs"
  elif git cat-file -e "HEAD:tools/pruefe-beta-zip.test.mjs" 2>/dev/null; then
    meld "pre-commit: pruefe-beta-zip.test.mjs fehlt im Arbeitsbaum, HEAD kennt sie aber"
    ROT=$((ROT + 1))
  fi
fi

# Die Teilung des Hakens in Kern und Wachendateien (stre-T-070). Wird der Kern,
# eine Wachendatei oder dieser Satz angefasst, faehrt er mit: keine Wache ist
# beim Umzug verloren, der Code jedes alten Blocks steht zeichengleich in der
# Datei seiner Domaene, und der Lader laedt nur die vorgemerkte, syntaktisch
# heile Fassung. Geloeschte und umbenannte Dateien zaehlen mit (Filter ACMRD),
# denn das Entfernen einer Wachendatei ist genau der Fall, den er faengt.
# Austritt 2 heisst nicht messbar (kein git oder sh) und sperrt nicht. Rund
# 15 s, deshalb nur bei Beruehrung. Seine Sabotagen: `tools/stream-sabotagen.mjs
# --satz wachen`.
if git diff --cached --name-only --diff-filter=ACMRD \
     -- tools/haken/pre-commit tools/haken/wachen tools/haken/wachen.test.mjs \
   | grep -q .
then
  meld "pre-commit: Kern oder Wachendatei vorgemerkt, der Satz der Teilung laeuft mit"
  if [ -f "tools/haken/wachen.test.mjs" ]; then
    node "tools/haken/wachen.test.mjs" > "$TMP/lauf" 2>&1
    werte_aus "$?" "wachen.test.mjs"
  elif git cat-file -e "HEAD:tools/haken/wachen.test.mjs" 2>/dev/null; then
    meld "pre-commit: wachen.test.mjs fehlt im Arbeitsbaum, HEAD kennt sie aber"
    ROT=$((ROT + 1))
  fi
fi
