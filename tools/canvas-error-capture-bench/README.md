# Prüfstand: was die Fehlererfassung behält und was sie verwirft

Misst `_stackChain`, `_isBeneosError`, `_hookErrorReason`, `_canvasBudgetLeft`, `_stackTopLine` und `_kuerzeStackZeile` aus `scripts/beneos_analytics.js`.

Der Entscheidungsweg wird **geschnitten, nicht nachgebaut**: `_hookErrorReason` ist genau dafür eine eigene Funktion. Eine nachgebaute Fassung im Prüfstand wäre eine zweite Wahrheit, die driftet, und ausgerechnet an der Stelle, die festlegt, wie viel fremder Verkehr auf unser Konto geht.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Der zweite Aufruf fährt einen **Nachbau** der Fassung vor dem Fix, die nur den äussersten Stack sah, und muss mit `rc=1` und vierzehn Fehlschlägen abbrechen. Ein grüner Test, der nicht rot werden kann, belegt nichts.

Kein Foundry nötig. Alle geprüften Funktionen sind rein.

## Warum es den Prüfstand gibt

Foundry **wirft** diese Fehlerart nicht, es **wickelt sie ein**. `Hooks.onError` baut (V14 `client/helpers/hooks.mjs:184`, in V13 identisch):

```js
if ( msg ) error = new Error(`${msg}. ${error.message}`, { cause: error });
```

und feuert erst danach den Hook. Der Stack der Hülle zeigt auf `hooks.mjs` und nennt niemanden. Der Stack, der den Verursacher nennt, liegt in `cause`.

Unser Fänger prüfte `err.stack`. Damit fiel **jeder eingewickelte Fehler durch, auch jeder eigene**. Am 09.09.2026 im Datensee gezählt: über 3.150 Fehlerereignisse, davon **null** mit einem gescheiterten Zeichenvorgang der Primärgruppe. Nicht weil es nicht vorkommt, sondern weil wir es nie sehen konnten.

Der Anlass war ein Patron, dessen Canvas nach einer Beneos-Installation schwarz blieb. Die Meldung nannte den Verursacher die ganze Zeit, in Foundrys eigener Zuschreibung `[Detected N packages: ...]`, und wir haben sie verworfen.

Acht Proben, sechsundzwanzig Vergleiche:

| Probe | Frage |
|---|---|
| 1 | **Der Kern.** Hülle ohne eigenen Rahmen, `cause` mit einem: wird erkannt, und zwar als `beneos`, nicht als `canvas`. Vorher verworfen. |
| 2 | Ein fremder Fehler gilt nicht als unserer, wird bei `Canvas#draw` aber trotzdem genommen. Das ist der Unterschied zwischen Absicht und Sammelstelle. |
| 3 | **Die Gegenprobe.** Ein gewöhnlicher Fremdfehler ohne Canvas-Bezug bleibt draussen, auch eingewickelt, auch mit leerer `location`. Ohne diese Probe könnte die Änderung unbemerkt zur Sammelstelle für fremdes Rauschen werden. |
| 4 | Die `cause`-Kette terminiert bei einem Zyklus und wird bei zehn Gliedern auf drei gedeckelt. `cause` ist das, was der Werfer hineingelegt hat, nicht das, worauf wir uns verlassen können. |
| 5 | `stack_top_line` nennt die Zeile aus `cause` und trägt **weder Wirt noch Port**, auch bei einem Rahmen im Foundry-Kern, wo kein `modules/` steht. |
| 6 | Nur echte Rahmen. Ein Stapel ohne Rahmen liefert nichts, statt die Meldungszeile durchzureichen. |
| 7 | Der Deckel je Sitzung greift. |
| 8 | Die Zuschreibung wird abgetrennt, in Mehrzahl- und Einzahlform. |

## Zwei Dinge, die beim Prüfen erst richtiggestellt wurden

**`Canvas#draw` hat zwei Erzeuger, nicht einen.** Gemessen in `client/canvas/board.mjs` der V14: der Gruppen-Zeichenvorgang bei `:1219` und das **Laden von Texturen** bei `:1193`. Beide tragen dieselbe `location` und unterscheiden sich nur in der Meldung. Der zweite Zweig ist genau der, den eine kaputte Beneos-Datei auslöst. Die Telemetrie nimmt bewusst beide; das Fenster in `beneos-canvas-guard.js` prüft zusätzlich die Meldung, weil der Satz "das liegt nicht an Beneos" im Texturzweig falsch wäre.

**`[Detected N packages: ...]` kommt von libWrapper, nicht von Foundry.** Gesucht in V13 und V14 unter `client/` und `common/`: kein Treffer. Erzeuger ist `lib-wrapper.js`. Daraus folgt eine Einschränkung, die vorher überschätzt wurde: die Zuschreibung erscheint **nur**, wenn der Fehler durch einen von libWrapper verwalteten Rahmen lief. Ihr Fehlen beweist nichts, und im Fenster ist der Fall ohne Paketnamen der Regelfall.

## Ein Nebenfund, den Probe 5 sichtbar macht

Die alte Fassung fiel auf `lines[1]` des äussersten Stacks zurück, ungekürzt. In `--alt` schlagen deshalb drei Proben *"ohne Wirt"* fehl: dort stand die volle Adresse samt Wirt und Port. Auf The Forge ist die Unterdomäne der **Name des Kunden**, selbstgehostet ist es seine Adresse. Vor dieser Änderung wurde das Ereignis gar nicht gesendet, der Austritt wäre also hier erst entstanden.

`_kuerzeStackZeile` schneidet jetzt ab dem ersten `modules/` oder `systems/`, und wo keines von beiden vorkommt, fällt der Ursprung der Adresse weg. Danach läuft die Zeile noch durch `sanitize`. Das hat zwei Wirkungen: Zeilen desselben Pakets gruppieren sich unabhängig davon, wo die Welt läuft, und kein Hostname reist mit.

## Was der Prüfstand nicht misst

Er misst die Entscheidung, nicht den Weg dorthin. Ob Foundry den Hook in einer laufenden Welt wirklich so feuert, ob das Fenster aus `beneos-canvas-guard.js` erscheint und ob die Warteschlange danach genau ein Ereignis trägt, ist nur in einer Welt zu beantworten. Siehe `TC-CLD-MOD-065`.
