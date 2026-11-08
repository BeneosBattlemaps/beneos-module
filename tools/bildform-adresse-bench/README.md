# bildform-adresse-bench

Hält den Bildweg des Installers in `scripts/beneos_cloud.js` fest. Läuft ohne
Foundry und ohne Netz:

```
node tools/bildform-adresse-bench/bench.mjs
```

Rückgabe 0 heisst alle Sätze grün, 1 heisst mindestens einer rot. Hängt im
Vorhaken an `scripts/beneos_cloud.js` und an diesem Ordner.

## Warum er entstanden ist

`OP-PRJ-146`, 08.11.2026. Der Installer las jede Bilddatei als base64 **aus
dem JSON**. Gemessen auf der Serverseite: Median 1,19 MB je Kreatur, Maximum
**20,4 MB in einer Antwort**, ohne `Cache-Control` und ohne CDN.

`OP-PRJ-190` hat gemessen, dass `030-commoner_male` mit zwanzig Varianten sich
**nicht installieren lässt** und dass die Ursache nach vier einzeln gemessenen
Ausschlüssen nicht auffindbar ist: sie liegt auf dem Weg zwischen Hoster und
Anschluss des Kunden, wo von beiden Enden aus niemand messen kann. Eine
einzelne Antwort von 19 MB ist auf einem schlechten Weg zerbrechlich.

Der Server liefert die Dateien auf `?bildform=adresse` je Datei als Adresse,
gebaut in `9f0a9cf` in `beneos-cloud-server`.

## Der gefährlichste Teil ist nicht der Abruf

Drei Stellen fragten vor dem Hochladen `if (!X.image64) continue`. Mit
Adressen ist `image64` dort **immer** `null`, und die Bedingung wäre immer
wahr gewesen: der Installer hätte jede Datei übersprungen, **ohne eine Zeile
zu meckern**. Eine Reparatur hätte "nichts zu reparieren" gemeldet, eine
Installation wäre leer durchgelaufen, und der Kunde hätte eine Kreatur ohne
Bilder bekommen.

Darum zählt Lage C die Vorkommen von `image64` im Quelltext nach. **Die Zahl
ist der Satz, nicht die Abwesenheit:** eine Suche, die nichts findet, ist von
einer kaputten Suche nicht zu unterscheiden.

## Was am Verhalten gemessen wird und was nur am Quelltext

| Lage | Was | Wie |
|---|---|---|
| A | der Schalter und sein Anhang | Quelltext |
| B | die drei Anfragen tragen den Parameter | Quelltext |
| C | base64 liegt nur noch an einer Stelle, und die Zahl der Rufe stimmt | Quelltext |
| D | `_beneosBildDa()`, 14 Fälle | **gefahren** |
| E | `_beneosBildDatei()`, elf Fälle | **gefahren** |
| F | die Draufsicht überspringt nicht | Quelltext |
| G | die Gesamtmenge der Schreibstellen | Quelltext |

Beide Helfer werden aus der Datei **geschnitten** und mit nachgebautem `fetch`
und `File` wirklich gefahren. Ein `import` wäre falsch: die Datei ruft beim
Laden Foundry-Globale.

## Der Schalter, und warum `A2` scharf ist

`BILDFORM_ADRESSE_AN` steht auf `false`. Mit `false` verhält sich der
Installer Zeichen für Zeichen wie vorher, denn ohne den Parameter schickt auch
ein neuer Server base64.

Der Satz `A2` wird **rot**, sobald jemand ihn auf `true` stellt. Das ist
gewollt: das Umstellen ist eine Betreiberentscheidung nach einem Deploy und
einem gesehenen Lauf, nicht eine Zeile im Vorbeigehen. Wer sie stellt, ändert
den Satz mit und schreibt den Grund dazu.

Verträglich ist die Form von sich aus, in beiden Richtungen. Der Schalter
trägt etwas anderes: die **Rücknahme ohne Auslieferung**. Zwölf Schreibstellen
holen jetzt je eine eigene Antwort statt einer grossen, und das sind zwölf
Gelegenheiten zu scheitern statt einer. Dass das in der Summe besser ist, ist
gerechnet und am Kundenanschluss nicht gemessen.

## Die Draufsicht ist der einzige Sonderfall

Jede andere Schreibstelle darf bei einem Fehlschlag weitergehen: die Datei
fehlt dann, und `_beneosValidateInstalledAsset` meldet sie als fehlende
Ansicht. Die Draufsicht steuert daneben den **Prototyp**:
`_beneosTopVerfuegbar` entscheidet, ob `prototypeToken.texture` auf
`-top.webp` zeigt. Ein `continue` liesse das Feld `undefined`, und der
Prototyp zeigte auf eine Datei, die nicht da ist. Das ist der 404-Fall aus
M8.3.39, den ein Kunde als Fehlerregen in der Konsole gemeldet hat.

Lage F hält das fest, mit einer Gegenprobe (`F4`), dass die `continue`-Suche
überhaupt greift.

## Nachweis

08.11.2026: **32 Sätze gehalten, 0 Befunde.** **21 Sabotagen gefahren, 21
gefangen.**

Ein eigener Fehler ist beim ersten Lauf aufgefallen und steht als Kommentar im
Stand: der Funktionsschnitt liess das `async` weg, und `new Function` bekam
einen Rumpf mit `await` in einer Funktion ohne `async`. **Ein Schnitt, der ein
Schlüsselwort vor dem Namen vergisst, liefert gültig aussehenden Code, der
nicht läuft.**

## Nicht prüfbar

Ob ein echter Abruf am Tor die gemeinte Datei liefert, das braucht cluster031
mit Datenbank und Dateien. Ob ein Upload in Foundry ankommt, das braucht ein
laufendes Foundry mit Konto.

Ebenso nicht: ob zwölf kleine Abrufe auf dem nicht messbaren Weg aus
`OP-PRJ-190` wirklich besser tragen als eine grosse Antwort. Das ist
gerechnet, und dafür gibt es den Schalter.
