# doppelnamen-bench

Prueft den ganzen Ordner `scripts/` darauf, dass kein Name zweimal steht, wo
der spaetere Eintrag den frueheren still frisst.

```
node tools/doppelnamen-bench/bench.mjs
node tools/doppelnamen-bench/bench.mjs --verbose
node tools/doppelnamen-bench/bench.mjs --sabotage    # muss rot werden
```

Rueckgabe 0 heisst kein Doppelname, 1 heisst mindestens einer, 2 heisst nicht
messbar. Laufzeit 7 Sekunden mit gefuelltem npm-Zwischenspeicher.

## Warum er existiert

Am 09.11.2026 stand in `BeneosSetupTour` die Methode `async complete()`
**zweimal**, in Zeile 1347 und in Zeile 1580. JavaScript nimmt den spaeteren
Eintrag, ohne ein Wort zu sagen.

Die Folge war verkehrt herum:

| Weg aus der Tour | lief die Aufraeumung? |
|---|---|
| Abbrechen ueber `exit()` | ja |
| normales Beenden ueber `complete()` | **nein** |

Damit blieb nach jeder zu Ende gespielten Tour der Ersatz von
`game.tooltip.deactivate` stehen, den `_installTourTooltipGuard` gesetzt hat,
und die Tour-Elemente blieben in der Flaeche. Die richtige Form stand zweimal
daneben: `BeneosDemoTour` und die Klasse weiter unten tragen je ein `exit` und
ein `complete` mit demselben Dreisatz.

Dazu zwei doppelte `default`-Schluessel in `beneos_utility.js`, bei
`beneos-reload-search-engine` und `beneos-ui-state`.

## Der eigentliche Befund: das Werkzeug war da und hat nicht gegriffen

`no-dupe-class-members` steht seit `OP-PRJ-195` in `eslint.config.mjs` auf
`error`. Der Bestand hatte die Regel also die ganze Zeit. Aber `lint-diff.mjs`
liest **bewusst nur die Dateien des eigenen Diffs**, und `beneos_tours.js` war
monatelang in keinem. Der Fehler fiel erst, als die Datei aus einem voellig
anderen Grund in einen Diff geriet.

Daraus folgt die Bauart: dieser Stand liest den **ganzen** Ordner und dafuer
**drei** Regeln. Das ist die Gegenrichtung zu `lint-diff.mjs`, und beide
braucht es.

| Stand | liest | Regeln | Treffer heute |
|---|---|---|---|
| `lint-diff.mjs` | nur den Diff | alle | 312 Warnungen, 0 Fehler |
| `doppelnamen-bench` | `scripts/` ganz | 3 | **0** |

Ein Lauf mit der grossen Fassung ueber den Bestand meldet 5194 Treffer
(gemessen 07.11.2026) und wird abgeschaltet. Ein Lauf mit drei Regeln meldet
null und faellt nicht auf, bis er etwas findet.

## Zwei eigene Fehlschlaege beim Bau, und beide sahen wie ein kaputter Leser aus

**Erster Entwurf: die Proben lagen unter `os.tmpdir()`.** ESLint meldete zu
allen Fehlerproben nichts, der Stand sagte "3 von 7". Grund: eine flache
ESLint-Fassung deckt nur den Baum unter ihrem Wurzelordner ab, eine Datei
daneben fiel still durch. **Eine Probe am falschen Ort ist von einer Regel,
die nicht greift, nicht zu unterscheiden.**

**Zweiter Entwurf: alle Proben in einer Datei.** Darin standen zwei Klassen
namens `A` und zwei Bindungen namens `o`, also Wiederholungen im selben
Gueltigkeitsbereich, und `function f(a, b, a)` erzeugte einen Parserfehler.
**Ein Parserfehler blendet die ganze Datei**: ESLint meldete genau eine Zeile
und nichts von den anderen Proben. Der Stand sagte "4 von 7".

Jetzt liegt je Probe eine eigene Datei im Bestand, und alle gehen in **einem**
Lauf durch ESLint, weil es mehrere Pfade annimmt und je Datei berichtet. Ein
Parserfehler in einer Probe wird ausdruecklich als kaputter Proben-Quelltext
gemeldet und nicht als Treffer gezaehlt.

## Gegenproben

| Lauf | Erwartet | Gemessen 09.11.2026 |
|---|---|---|
| Bestand heute | 0 Doppelnamen, Austritt 0 | 0, Austritt 0 |
| Selbstproben | 7 von 7 | 7 von 7 |
| `--sabotage` | Austritt 1 | Austritt 1 |
| die drei echten Stellen aus `HEAD` als Kopie unter `scripts/` | alle drei gefunden, Austritt 1 | 3 gefunden, Austritt 1 |

Die letzte Zeile ist die wichtigste: der Stand findet genau die drei Stellen,
die am 09.11.2026 wirklich im Bestand standen, und nicht nur erfundene.

## Nicht pruefbar

- **`no-dupe-args` hat keine Probe.** Ein doppelter Parametername ist im
  strengen Modus ein **Parserfehler** und kein Lintbefund, und ein Modul ist
  immer streng. ESLint meldete auf `function f(a, b, a)` genau "Parsing error:
  Argument name clash". Die Regel bleibt in der Fassung, denn eine Datei, die
  nicht als Modul gelesen wird, kaeme ohne sie durch; probierbar ist sie
  nicht.
- **Der Ordner `templates/` ist nicht gelesen.** Handlebars-Vorlagen tragen
  kein JavaScript, das ESLint liest. Ein doppeltes Attribut in einer Vorlage
  faellt hier also durch.
- **Ein Name, der zur Laufzeit zusammengesetzt wird**, faellt durch jede
  dieser Regeln. `obj[a + b] = 1` zweimal ist kein Doppelname im Quelltext.
- **Die Behebung in `BeneosSetupTour` ist nicht im Feld gefahren.** Die
  Zusammenfuehrung stellt drei Aufrufe wieder her, die vorher beim Beenden
  nicht liefen. Dass die Tour danach bis zum Ende durchlaeuft und die
  Startszene weiter oeffnet, ist am Quelltext geschlossen und nicht an einer
  laufenden Tour gemessen. Steht als offene Zeile in `OP-PRJ-222`.
- **`eslint@10.13.0` kommt ueber `npx`.** Ohne Netz und ohne
  npm-Zwischenspeicher endet der Stand mit 2, und der Vorhaken nimmt das als
  "nicht gemessen". Eine Pruefung, die nicht laufen konnte, sieht hier nicht
  wie eine bestandene aus, aber sie blockiert auch keinen Commit.
