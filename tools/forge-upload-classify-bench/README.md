# Prüfstand: Einordnung eines gescheiterten Uploads

Misst `#diagnoseFailedUpload`, `uploadFailureMessage` und `classifyTransferError` aus `scripts/cloud-v2/beneos-native-installer.mjs`. Diese drei entscheiden, welche Ursache ein Kunde für eine nicht installierte Datei zu lesen bekommt.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Der zweite Aufruf fährt gegen einen **Nachbau** der Fassung vor dem Fix, die auf The Forge sofort aufgab, und muss mit `rc=1` und acht Fehlschlägen abbrechen. Ein grüner Test, der nicht rot werden kann, belegt nichts.

Kein Foundry nötig. Kategorien, Fehlerklasse, Klassifizierer und die beiden Textbauer werden nicht abgeschrieben, sondern mit `extractBlock` und `extractMethod` aus derselben Quelldatei gelesen, damit sie nicht driften können. **Gestubbt wird ausschliesslich `ForgeAPI`**, also das fremde System; jede Zeile Beneos-Code kommt geschnitten aus der Quelle.

## Warum es den Prüfstand gibt

Der Installer hatte auf The Forge einen Zweig, der jede Diagnose übersprang:

```js
if (this._isForge) return unknown()
```

Die Begründung war richtig, aber zu breit. Auf The Forge gibt es kein `POST /upload`, das man mit einer Wegwerfdatei befragen könnte, und eine solche Sonde würde nur das bezahlte Kontingent des Kunden kosten. Die **Grösse** braucht dafür aber keine Sonde: The Forge nennt die Grenze je Datei selbst.

Am 09.09.2026 auf `beneos.forge-vtt.com` gemessen, Foundry 14.365:

- `ForgeAPI.status()` liefert `quotas.upload`, dort `262.144.000` Byte, also 250 MiB.
- Gegen `assets/create` gemessen: `quotas.upload + 1` antwortet `File size is above acceptable limits.`, `quotas.upload` selbst geht durch. Die Grenze ist also **einschliesslich**, und `>` ist der richtige Vergleich.
- The Forge prüft die Grösse, **bevor** Bytes fliessen: `uploadToForge` sendet zuerst `assets/create` mit `{path, size, etag}`.

Was das gekostet hat, im Datensee am selben Tag gezählt: 296 gescheiterte Dateien in 54 Läufen in 24 Forge-Welten, **alle** unter `unknown`, kein einziges `toolarge`. In 35 der 54 Läufe scheiterte genau eine Datei, während 11 bis 204 andere im selben Lauf durchgingen. Der Bericht riet jedes Mal zum Wiederholen, was bei einer Grössengrenze nie gelingen kann.

Acht Proben, sechsundzwanzig Vergleiche:

| Probe | Frage |
|---|---|
| 1 | Der Kundenfall bekommt eine Kategorie, eine Meldung mit beiden Zahlen, und die gelesene Grenze landet im Ergebnis für den Bericht. |
| 2 | **Genau auf der Grenze** ist nicht zu gross, ein Byte darüber schon. Die einzige Stelle, an der ein `>` gegen `>=` unsichtbar bliebe. Zusätzlich: die Meldung darf sich dabei nicht selbst widersprechen. |
| 3 | Eine kleine Datei, die auf The Forge scheitert, bleibt `unknown`. Ein volles Assetkonto darf nicht in ein Grössenproblem umbenannt werden. |
| 4 | Schweigt die Forge-API, scheitert sie, oder fehlt `quotas.upload`, wird nichts erfunden, auch nicht bei 661 MB. Drei getrennte Wege. |
| 5 | Drei gleichzeitig scheiternde Dateien fragen das fremde System **genau einmal**. |
| 6 | Der selbstgehostete Weg bleibt in der Einordnung unangetastet und fragt die Forge-API gar nicht erst. |
| 7 | Die drei Rückgabeformen von `FilePicker.upload` heissen verschieden, auch selbstgehostet. |
| 8 | Der Wortlaut, den The Forge sendet, wird als `toolarge` gelesen, ohne den nginx-Fall oder einen gewöhnlichen Netzfehler zu verschieben. Und der Textbauer bleibt unter dem Kappungspunkt der Telemetrie. |

## Warum die Meldung Bytes nennt und nicht MB

Weil die beiden Zahlen ein einziges Byte auseinanderliegen können, und das ist hier kein Randfall, sondern **der** Fall. In MB gerundet ergibt eine Datei von `Grenze + 1` den Satz `250 MB is over the 250 MB limit`. Das liest sich wie ein Fehler in unserem Code statt wie eine Grenze im Tarif. Die MB-Zahl bleibt als Zusatz stehen, aber nur aus der Grenze abgeleitet, wo Rundung nicht lügen kann. Probe 2 prüft beide Seiten davon.

## Eine bewusste Verhaltensänderung, auch für Selbstgehostete

Foundrys eigener FilePicker gibt ebenfalls `false` zurück, wenn der Wirt mit `{error}` antwortet. Deren `sample_message` lautet ab 14.4.9 `upload refused by host (...)` statt `upload returned no path`. Das ist gewollt, weil der alte Satz dort schlicht falsch war: es lag ein Grund vor, Foundry hat ihn dem Kunden gezeigt und dann verworfen. Wer eine Zeitreihe über `sample_message` fährt, findet den Stichtag in der Telemetrie-Seite des Wikis.

## Was `--alt` nicht abdeckt

Der Nachbau ersetzt nur `#diagnoseFailedUpload`. Die Textbauer und der Klassifizierer laufen in beiden Betriebsarten gegen den aktuellen Code, deshalb bleiben die reinen Textproben auch mit `--alt` grün. Das ist kein Fehler des Prüfstands: `uploadFailureMessage` und `forgeSizeRefusalMessage` gab es vorher gar nicht, und ein Nachbau einer Funktion, die nicht existierte, wäre eine Erfindung.

## Was der Prüfstand nicht misst

Er misst die Einordnung, nicht den Weg dorthin. Ob `ForgeAPI.status()` in einer laufenden Welt antwortet, ob der Bericht den Forge-Text zeigt und ob `Erneut versuchen` verschwindet, ist nur auf einer Forge-Instanz zu beantworten. Ebenso ungemessen: ob `quotas.upload` bei einem **anderen** Tarif dieselbe Bedeutung hat. Gemessen wurde ein einziges Konto, unseres.
