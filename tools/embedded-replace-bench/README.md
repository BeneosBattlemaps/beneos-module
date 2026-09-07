# Prüfstand: eingebettete Sammlungen ersetzen

Misst `_deleteEmbeddedTolerant` und `_replaceEmbedded` aus `scripts/beneos_cloud.js`. Beide sind der Kern der Kreaturen-Aktualisierung, und beide waren vorher die Stelle, an der eine einzige veraltete Dokumentkennung die ganze Aktualisierung eines Aktors abgebrochen hat.

## Ausführen

```
node bench.mjs
node bench.mjs --alt
```

Der zweite Aufruf ist der wichtigere. Er fährt dieselben Proben gegen die Fassung **vor** dem Fix und muss mit genau der Meldung abbrechen, die der Kunde gemeldet hat:

```
Error: ActiveEffect "dnd5edeafened000" does not exist!
```

Ein grüner Test, der nicht rot werden kann, belegt nichts. Deshalb gehört der `--alt`-Lauf zu jeder Messung dazu.

Kein Foundry nötig, keine Welt, keine Installation. Die Methoden werden zur Laufzeit aus `beneos_cloud.js` geschnitten, nach Klammern gezählt und nicht nach Zeilennummern. Verschiebt sich der Code im Modul, misst der Prüfstand weiter die richtige Stelle; verschwindet eine Methode, bricht er mit einer klaren Meldung ab statt stillschweigend das Falsche zu messen.

## Was gemessen wird

Foundrys Stapel-Löschung ist ganz oder gar nicht. `ServerDatabaseBackend._deleteDocuments` läuft mit `Array.map` über die Kennungsliste und wirft beim ersten Dokument, das serverseitig schon weg ist. Die anderen fünfzig werden dann ebenfalls nicht gelöscht.

Das trifft uns, weil dnd5e ActiveEffects von sich aus entfernt und das nicht abwartet. `updateBloodied`, `updateEncumbrance` und `_onUpdateExhaustion` antworten auf ein `Actor#update` mit einem ungewarteten `effect.delete()`, `Item5e._onDelete` und `ActiveEffect5e._onDelete` kaskadieren genauso. Unser eigenes `update()` und das Löschen der Items sind genau das, was diese Reaktionen auslöst. Zwischen dem Lesen der Kennungsliste und dem Absenden der Löschung kann ein Effekt serverseitig also verschwinden, während der Client ihn noch führt.

Sieben Proben, sechzehn Vergleiche:

| Probe | Frage |
|---|---|
| 1 | Der Normalfall bleibt ein einziger Aufruf, es wird nichts langsamer. |
| 2 | Eine verschwundene Kennung reisst die anderen nicht mehr mit. |
| 3 | Eine dauerhaft nicht löschbare Kennung wird benannt statt verschluckt. |
| 4 | Eine leere Liste kostet keinen Netzwerkaufruf. |
| 5 | Ersetzen im Normalfall meldet keine Befunde. |
| 6 | Eine verschwundene Kennung stoppt das Neuanlegen nicht. |
| 7 | Eine überlebende Kennung lässt die `keepId`-Anlage nicht scheitern. |

## Was der Prüfstand nicht misst

Er misst die beiden Methoden, nicht die Aktualisierung darum herum. Ob der `world.beneos`-Flag mit den `rendering`-Werten am Ende wirklich geschrieben wird, wenn vorher etwas schiefging, ist eine Frage an `_propagateTokenUpdateToWorld` und nur in einer laufenden Welt zu beantworten.

Er misst auch nicht, was den Effekt beim Kunden hat verschwinden lassen. Der Mechanismus ist belegt, der Einzelfall nicht.
