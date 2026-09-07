# Prüfstand: keepalive-Deckelung der Telemetrie

Misst `BeneosAnalytics._fitKeepalive` aus `scripts/beneos_analytics.js`. Die Funktion entscheidet, wie viele Ereignisse beim Schliessen der Welt oder beim Verstecken des Reiters wirklich hinausgehen.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Der zweite Aufruf fährt gegen eine Fassung ohne Deckelung und muss mit `rc=1` und drei Fehlschlägen abbrechen. Ein grüner Test, der nicht rot werden kann, belegt nichts.

Kein Foundry nötig. Die Methode ist rein: kein Netz, keine Warteschlange, keine Uhr. Der Deckel wird nicht abgeschrieben, sondern mit `extractConst` aus derselben Quelldatei gelesen, damit er nicht driften kann.

## Warum es die Funktion gibt

`fetch` lehnt einen `keepalive`-Rumpf über 64 KB ab. `MAX_BATCH` Ereignisse zu je `PAYLOAD_MAX` bleiben darunter, aber nur knapp. Eine Ablehnung würde den ganzen Stapel kosten, und zwar genau in dem Moment, in dem die Welt schliesst und nichts mehr nachgeholt werden kann. Also wird halbiert, bis es passt; was nicht mitgeht, bleibt in der Warteschlange und wandert in den Notspeicher.

Fünf Proben, zwölf Vergleiche:

| Probe | Frage |
|---|---|
| 1 | Der häufige Fall, ein kleiner Stapel, bleibt unangetastet. |
| 2 | Ein zu grosser Stapel schrumpft, statt verloren zu gehen, und `sendCount` sagt dasselbe wie der Rumpf. |
| 3 | Ein einzelnes Ereignis über dem Deckel läuft nicht in eine Endlosschleife. |
| 4 | Ein leerer Stapel ergibt gültiges JSON. |
| 5 | Der Standardwert greift, wenn kein Deckel übergeben wird. Das ist der Weg, den der Produktivcode nimmt. |

## Was der Prüfstand nicht misst

Er misst die Rechnung, nicht den Versand. Ob die Anfrage am Live-Endpunkt ankommt, ob der Unterschied zwischen `_onHide` und `_onUnload` richtig greift, und ob die Warteschlange dabei sauber bleibt, ist nur in einer laufenden Welt zu beantworten. Siehe `TC-CLD-MOD-063`.
