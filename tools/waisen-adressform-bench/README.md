# Prüfstand: die Dateiprüfung des Kreaturen-Installers

Misst `scripts/beneos_cloud.js`.

## Ausführen

```
node bench.mjs
```

Kein Foundry und kein Netz nötig. 31 Sätze, Laufzeit unter einer Sekunde.

## Worum es geht

Die Waisenaufräumung prüft für jede installierte Kreatur, ob ihre Dateien noch
auf der Platte liegen. Bis zum 05.11.2026 tat sie das mit einer HEAD-Probe auf
`"/" + protoSrc`, und das war falsch, sobald die Adresse ans Tor zeigte:

| Was entstand | Folge |
|---|---|
| `/https://gate...` | antwortet 404 |
| jede gestreamte Kreatur | bekam `missing_files` |
| das Fenster | legte dem Spielleiter genau die Dokumente zum Löschen vor, die in Ordnung sind |
| dieselbe Zeile | schickte den Streamschlüssel in das Zugriffsprotokoll des eigenen Servers und als rote 404-Zeile in die Browserkonsole |

Behoben ist das in `7e96c69`. **Daran hing bis zum 08.11.2026 kein einziger
Prüfsatz**, und `scripts/beneos_cloud.js` löste im Vorhaken gar keinen aus.
Eine entfernte Zeile und der Fehler wäre zurück, ohne dass etwas rot wird.

## Die vier Aussagen

1. **Die Formunterscheidung trennt Tor von Örtlich**, und sie wird aus der
   Datei geschnitten und wirklich gefahren, mit der echten `zerlegeAdresse()`
   daneben statt mit einer Attrappe. Alle vier Raumbuchstaben sind dabei.
2. **Die Weiche steht vor der Probe.** Eine Toradresse gilt als vollständig,
   nur ein örtlicher Pfad wird geprobt, und eine leere Adresse bleibt ein
   Fehler.
3. **Die Datei führt genau eine HEAD-Probe**, und sie liegt in
   `_beneosProbeInstalledFile` mit Unterpfad, Zwischenspeicherbruch,
   Stummelschutz und HTML-Erkennung.
4. **Der fremde Host ist festgehalten, nicht behoben.** Siehe unten.

## Der wichtigste Satz prüft eine Anzahl

Alles andere prüft die eine Probe, die es heute gibt. Keiner dieser Sätze kann
sehen, dass jemand eine **zweite** HEAD-Probe dazuschreibt, und genau so ist
der Fehler entstanden: die gute Probe lag schon in derselben Datei, die
Waisenprüfung hat sie nur nicht benutzt.

Der Stand zählt deshalb roh nach, wie viele HEAD-Proben die Datei führt, heute
eine. Eine zweite macht ihn rot. Wer sie braucht, prüft dann von Hand, ob sie
die vier Eigenschaften oben trägt, und zieht die Zahl nach.

## Warum ein fremder Host als Toradresse gilt

Das sah beim Bauen nach einer Lücke aus, und der erste Entwurf hielt das
Gegenteil fest. Das Nachmessen hat ihn widerlegt: es ist eine begründete
Arbeitsteilung, und sie steht im Quelltext beider Funktionen.

| Funktion | prüft den Host | Begründung |
|---|---|---|
| `zerlegeAdresse()` | nein | Sie heilt Vorratseinträge, die unter einer früheren Basisadresse angelegt wurden. Mit Hostprüfung wäre jeder Eintrag aus einer alten Basis unlesbar statt heilbar |
| `ohneSchluesselImText()` | ja, als Teil des Musters | Ohne ihn würde `/a/x/` in jedem fremden Text getroffen, etwa in einem Dateipfad des Kunden |

Praktische Folge: eine Kreatur, deren Texturadresse auf einem fremden Host mit
Kartenform liegt, wird nicht geprobt und erscheint nicht als `missing_files`.
Das ist milder als die Alternative, nämlich eine HEAD-Probe an einen fremden
Host zu schicken.

Diese Sätze halten das fest, damit die nächste Sitzung es nicht wieder als
Fehler liest und eine Hostprüfung einbaut, die Bestandsvorräte zerstört.

## Rot gesehen

14 Sabotagen gefahren, **14 gefangen**. Zwei davon haben den Stand selbst
verbessert, weil sie beim ersten Lauf durchkamen:

```
die Forge-Ausnahme verschwindet                  DURCHGEKOMMEN
```

Der Satz prüfte `/_beneosUsingTheForge/` ohne Wortgrenze, und
`_beneosUsingTheForgeXX` enthält den alten Namen als Teilstring. Er zählt jetzt
die **Aufrufstellen** statt des Namens. Ein Satz, der auf einen Namen zielt,
muss die Grenze mitnennen.

```
der Erklaertext zitiert die alte Zeile woertlich  ROT beim ersten Lauf
```

Diese Behauptung war falsch: der Kommentar nennt die Folge (`/https://gate...`)
und nicht die Zeile. Der Satz ist weg, der Kommentarfilter geblieben, und zwei
Sätze belegen jetzt, dass er wirkt und dass es ohne ihn einen Fehlalarm gäbe.

## Wenn du die Prüfung änderst

Der Vorhaken fährt diesen Stand, sobald `scripts/beneos_cloud.js` oder dieser
Ordner vorgemerkt ist. Die Satzzahl in der Hakenbeschriftung veraltet still;
wer eine Zahl dort liest, prüft sie am Lauf.
