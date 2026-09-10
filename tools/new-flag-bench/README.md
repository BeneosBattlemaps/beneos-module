# Prüfstand: wer bekommt das NEU-Abzeichen

Misst `ensureBattlemapNewFlags`, `isProvisionalEntry` und `releaseDayOf` aus `scripts/cloud-v2/home/home-controller.mjs`, dazu `beneosIsProvisional`, `beneosNewestReleaseMs` und `beneosComputeNewUpdate` aus `scripts/beneos_search_engine.js`.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Der zweite Aufruf fährt einen **Nachbau** der alten Regel und muss mit `rc=1` und zehn Fehlschlägen abbrechen. Seine Ausgabe zeigt wörtlich den Kundenfehler: die zwei Sonden tragen das Abzeichen, die echte Welle nicht.

Kein Foundry und **kein Netz** nötig.

## Die Proben laufen gegen echte Daten

`katalog-auszug.json` ist ein Auszug aus der **Live-Suchdatenbank**, gezogen am 10.09.2026: die zwei Sonden, sechs Einträge aus Release 115, drei aus 114, und der eine ältere Eintrag mit `needs_tagging`. Echte Schlüssel, echte Daten, echte Kennzeichen.

Erfundene Proben hätten den Fehler nicht gefunden, denn er hängt an einer Kombination, auf die man nicht kommt: **die höchste Nummer trägt das älteste Datum.**

## Was schiefging

Die alte Regel nahm das **Maximum aller Zahlenpräfixe** im Katalogschlüssel:

```js
if (r > maxRelease) maxRelease = r      // r = 999
...
if (r === maxRelease) data.isNew = true
```

Am 27.08.2026 kamen zwei vorläufige Einträge mit dem Präfix `999` in den veröffentlichten Katalog. Ab da war das Maximum 999. Gemessen am 10.09.2026, live:

| | |
|---|---|
| NEU-Abzeichen bekamen | **2 Einträge**, beide ohne Vorschaubild und ohne Release dahinter |
| NEU bekämen ohne sie | **28 Einträge** aus Release 115 |
| Dauer | zwei Wochen, bei jedem Kunden |

Gemeldet hat es niemand als Fehler. Ein fehlendes Abzeichen erzeugt keine Meldung. Der eine Kunde, der es ansprach, fragte, warum wir Neuerscheinungen nicht oben anzeigen, und wurde als Funktionswunsch beantwortet.

## Die neue Regel, und warum sie zwei Wächter hat

Das **Datum** entscheidet, nicht die Nummer. Verglichen werden `YYYY-MM-DD`-Zeichenketten statt geparster Zeitpunkte: ISO-Tage sortieren als Text chronologisch, und eine ganze Welle trägt genau dieselbe Zeichenkette, also kann keine Zeitzone die Gruppe zerreissen.

Dazu werden **vorläufige Einträge übersprungen**, erkennbar an `needs_tagging` oder `match_source.strategy === "provisional"`.

Beide Wächter sind nötig, und das ist keine Vorsicht, sondern gemessen: der Katalogbauer stempelt einen selbst erzeugten Eintrag mit dem **heutigen** Datum (`catalog-lib.php`, `'release_date' => date('Y-m-d')`). Der nächste Fehleintrag wäre also automatisch die neueste Welle. Das Datum allein hätte den Fehler nur verschoben, nicht behoben. Probe 3 fährt genau diesen Fall.

**Kein Rückfall auf die alte Regel**, wenn kein Datum zu finden ist. Nichts zu markieren ist unsichtbar, das Falsche zu markieren ist der Fehler, der hierher geführt hat.

Acht Proben, siebzehn Vergleiche:

| Probe | Frage |
|---|---|
| 1 | **Der Kundenfall**, mit den echten Werten: keine Sonde trägt NEU, die Welle 115 schon. |
| 2 | Die Vorbedingung selbst geprüft: die Sonde hat die höhere Nummer **und** das ältere Datum. |
| 3 | Eine Sonde mit dem **jüngsten** Datum bekommt trotzdem kein NEU. Das ist der Wächter, der das Datum allein nicht hätte. |
| 4 | `provisional` über `match_source` zählt genauso, und dann rückt die nächste echte Welle nach. |
| 5 | Ohne brauchbares Datum wird nichts markiert, statt auf die Nummer zurückzufallen. |
| 6 | Leerer Katalog und ein leerer Eintrag werfen nicht. |
| 7 | Markierungen aus einem früheren Durchlauf verschwinden. |
| 8 | **Die zweite Stelle:** die Kacheln der Kartenliste. Sie ging schon über das Datum und war deshalb heute nicht betroffen, filterte vorläufige Einträge aber nicht. |

## Was `--alt` nicht abdeckt

Probe 8 misst `beneos_search_engine.js`, und dafür gibt es keinen Nachbau: dort war die Regel nie falsch, nur unvollständig. Die Probe entfällt im `--alt`-Lauf, statt dort grün zu scheinen.

## Was der Prüfstand nicht misst

Ob die NEU-Leiste in einer laufenden Welt tatsächlich die 28 zeigt. Das ist nur auf V13 und V14 zu beantworten, siehe `TC-CLD-MOD-066`.
