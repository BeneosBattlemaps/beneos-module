# Prüfstand: verwaiste Karten

Misst `#releaseIsOrphan` aus `scripts/cloud-v2/cloud-window-v2.mjs`.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Kein Foundry und kein Netz nötig.

## Worum es geht

Die Suchdatenbank auf dem CDN und die installierbaren Releases aus `list_releases` sind zwei unabhängige Quellen, und **nichts prüft sie gegeneinander**. Ein Katalogeintrag kann sein Release überleben oder nie eines gehabt haben.

Am 27.08.2026 kamen zwei solche Einträge in den veröffentlichten Katalog. Sie zeigten eine Kachel mit Install-Knopf, ihr Vorschaubild lieferte 404, und der Klick brach ab mit `Beneos Cloud is unreachable`. Die Cloud hatte im selben Moment 145 Releases geliefert.

Gemessen am 10.09.2026 gegen die Live-Daten: **2 von 2145** Katalogeinträgen zeigen auf ein unbekanntes Release, beide `bm_0999`. Alle anderen treffen eines der 145. Die Prüfung ist deshalb genau und nicht breit.

## Die Probe, auf die es ankommt

Probe 1. `_releaseIndex` wird **ohne `await`** geholt, der erste Durchlauf sieht also regelmässig `null`. Ein Urteil an dieser Stelle würde die **gesamte Kartenliste leeren**, und zwar bevorzugt bei Kunden mit langsamer Leitung. Kein Index heisst deshalb kein Urteil, und die Probe hält das fest.

Der Fix soll zwei kaputte Kacheln entfernen. Wenn er stattdessen 2145 entfernt, ist er schlimmer als der Fehler.

Drei Proben, zwölf Vergleiche:

| Probe | Frage |
|---|---|
| 1 | **Ohne geladenen Index gilt nichts als verwaist.** Die gefährliche Stelle. |
| 2 | Mit Index wird unterschieden: bekanntes Release, Einzelkarte, `bm_0999`. |
| 3 | Ohne `release_dir` gibt es nichts nachzuschlagen, also kein Urteil. |

## Was `--alt` abdeckt und was nicht

Der Nachbau ersetzt `#releaseIsOrphan` durch die Fassung, die es vorher gab: keine. Rot wird dort genau die Probe, die den Kundenfall trägt.

## Was der Prüfstand nicht misst

Ob die zwei Kacheln in einer laufenden Welt wirklich verschwinden und ob die neue Meldung erscheint. Nur auf V13 und V14 zu beantworten, siehe `TC-CLD-MOD-066`.
