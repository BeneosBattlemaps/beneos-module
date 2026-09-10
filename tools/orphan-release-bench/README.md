# Prüfstand: verwaiste Karten und der blockierte Install

Misst `#releaseIsOrphan` aus `scripts/cloud-v2/cloud-window-v2.mjs` und `trackInstallBlocked` aus `scripts/beneos_analytics.js`.

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

Probe 1. `_releaseIndex` wird **ohne `await`** geholt, der erste Durchlauf sieht also regelmässig `null`. Und eine **leere Map** ist wahrheitswertig, fällt also durch einen blossen Null-Schutz; erreichbar ohne Fehler auf unserer Seite, weil `listReleases()` bei einer Antwort ohne Liste `data.releases || []` liefert. Gemessen: Index null 3 von 3 Karten sichtbar, Index vollständig 2 von 3, Index **leer 0 von 3**. Ein Urteil an dieser Stelle würde die **gesamte Kartenliste leeren**, und zwar bevorzugt bei Kunden mit langsamer Leitung. Kein Index heisst deshalb kein Urteil, und die Probe hält das fest.

Der Fix soll zwei kaputte Kacheln entfernen. Wenn er stattdessen 2145 entfernt, ist er schlimmer als der Fehler.

## Die zweite Hälfte: warum das Ereignis einen eigenen Namen hat

Der erste Entwurf liess `trackInstallBlocked` auf `install_error` reiten, weil `api-analytics.php` nur bekannte Namen annimmt und den Rest still verwirft, mit HTTP 200 und `accepted: 0` (gemessen am 07.09.2026).

Das war der bequeme Weg und der falsche. `_trigger-install-health.php` zählt **jede** Zeile mit diesem Namen gegen einen Vierzehn-Tage-Mittelwert und verschickt eine Mail. Genau so hat `trackAssetRefused` am 26.08.2026 fünfzig Läufe lang Fehlalarm erzeugt, und der Beschluss vom 30.08.2026 war ein **eigener Name**, ausdrücklich nicht eine höhere Schwelle. Ein blockierter Klick ist so wenig ein Installationsfehler wie eine Ablehnung.

Also `install_blocked`, und daraus folgt eine Reihenfolge: **Server zuerst.** Solange der Name nicht in `$ALLOWED_EVENTS` steht, verwirft `api-analytics.php:240` das Ereignis still. Das ist harmlos, es kommt nur nichts an. Umgekehrt wäre es ein Fehlalarm.

Acht Proben, vierundzwanzig Vergleiche:

| Probe | Frage |
|---|---|
| 1 | **Ohne geladenen Index gilt nichts als verwaist**, und eine **leere Map** zählt als kein Index. Die gefährliche Stelle. |
| 2 | Mit Index wird unterschieden: bekanntes Release, Einzelkarte, `bm_0999`. |
| 3 | Ohne `release_dir` kein Urteil, und ein Leerzeichen am Rand ändert nichts. |
| 4 | Genau ein Ereignis, und es heisst `install_blocked`. |
| 5 | **Nicht** `install_error`, und keine Fehlerkategorie im Rumpf. Sonst schlägt die Wache an. |
| 6 | Releaseverzeichnis, Grund und Fassung reisen mit. Ohne sie wäre das Ereignis zählbar, aber nicht auffindbar. |
| 7 | Drosselung: derselbe Fall zählt nicht zweimal, ein anderes Release schon. |
| 8 | Alle vier Gründe kommen unverändert an und sind hinterher trennbar. |

## Was `--alt` abdeckt und was nicht

Der Nachbau ersetzt nur `#releaseIsOrphan`, deshalb wird dort genau **eine** Probe rot. Für `trackInstallBlocked` gibt es keinen Nachbau: die Funktion existierte vorher nicht, und dieser Weg sendete **gar nichts**. Ein Nachbau von nichts wäre eine Erfindung.

Genau diese Stille ist der Grund, warum der Fehler zwei Wochen lief, ohne dass wir ihn kannten.

## Was der Prüfstand nicht misst

Ob die zwei Kacheln in einer laufenden Welt wirklich verschwinden und ob die neue Meldung erscheint. Nur auf V13 und V14 zu beantworten, siehe `TC-CLD-MOD-066`.
