# Prüfstand: wohin die Bilder gehen, die eine Szene zum Zeichnen braucht

Misst `buildStreamPack` aus `scripts/stream/stream-install.mjs` und die ausgelieferte Vorgabe von `beneos-stream-pin-stills` aus `scripts/stream/stream-settings.mjs`.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Kein Foundry und kein Netz nötig.

## Worum es geht

Das Manifest markiert je Datei mit `pin`, ob eine Szene sie braucht, **bevor sie überhaupt zeichnen kann**: Hintergrund, Kachelbilder und das Standbild jedes Videos an diesen Stellen.

Bis zum 29.10.2026 stand der Schalter auf aus, und für die Messphase war das richtig: die reine Form sollte gemessen werden, bevor ein Kompromiss gemacht wird. Nur sagte die Erklärung beim ersten Weltstart die ganze Zeit wörtlich:

> Every scene carries a still picture, so a lost connection costs motion and nothing else.

Mit dem Schalter auf aus war das Standbild selbst eine Toradresse. Der Satz war also nur wahr, solange der Zwischenspeicher sie noch hielt. Eine Szene, die noch nie offen war, zeichnete ohne Verbindung **gar nichts**, und der Manifestbauer sagt das auch so: *"Die Szene zeichnet nichts, bis das Video ankommt"* (`tools/generate-stream-manifest.php`, `sm_pins`).

Betreiberentscheid vom 29.10.2026: Standbilder werden lokal heruntergeladen, damit nicht die ganze Oberfläche leer bleibt, wenn die WebM-Dateien nicht kommen.

## Was es kostet, am Ursprung gemessen

| | |
|---|---|
| bm_0119, 4K, 29 Szenen | 21,6 MB Standbilder gegen 811,8 MB Video |
| dieselbe Variante in HD | 21,5 MB, praktisch gleich |
| Stichprobe über 12 Releases | 110,1 MB gegen 6.192,7 MB, also **1,78 Prozent** |
| Spanne je Release | 0,8 MB bei 3 Szenen bis 21,6 MB bei 29 |

## Was dieser Stand misst und was nicht

Gemessen wird die **Verteilung**: landet ein vorgemerktes Bild in `packInfo`, wird also heruntergeladen, oder in `streamTargets`, bleibt also eine Adresse.

Die Adressrechnung selbst ist gestellt. `assetUrl` und `installedPath` hängen an Foundry-Globalen, und ihre Form ist hier nicht die Frage.

Drei Gegenproben gehören dazu, ohne die ein grüner Lauf nichts beweist: der Schalter auf aus muss das Standbild zur Adresse machen, der Download-Betrieb muss alles lokal legen und **null** Adressen stehen lassen, und `--alt` muss an der Vorgabe fallen.

## Wirkt erst bei der nächsten Installation

`buildStreamPack` liest den Schalter, während es die Dateiliste baut. Ein bereits installiertes Release wird davon nicht berührt. Wer seine alten Releases auch lokal haben will, installiert sie neu oder hält sie offline.
