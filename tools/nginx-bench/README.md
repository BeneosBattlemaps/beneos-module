# nginx-Pruefstand: HTTP 413 messen statt behaupten

Stellt echtes nginx vor eine laufende Foundry-Instanz, damit der Fall eines
selbstgehosteten Kunden hinter einem Reverse Proxy gemessen werden kann. Ohne
diesen Aufbau ist jede Aussage ueber 413 eine Ableitung aus Code.

Der Anlass: ein Kunde meldete am 2026-09-01 auf Discord HTTP 413 und musste die
Ursache in seiner eigenen Browser-Konsole finden, weil der Installer sie als
`unknown` verschluckte.

## Was gebraucht wird

- Eine laufende Foundry-Instanz mit geoeffneter Welt. Kein Docker, kein WSL,
  keine Installation, keine Administratorrechte.
- nginx fuer Windows als ZIP von <https://nginx.org/download/>. Gemessen wurde
  mit `nginx-1.30.4.zip`, dem stabilen Zweig. Der Hauptzweig (ungerade zweite
  Zahl, etwa 1.31.x) taugt auch, ist aber nicht das, was beim Kunden laeuft.

## Aufbau

```
Browser oder Messskript  ->  127.0.0.1:8443 (nginx)  ->  127.0.0.1:30000 (Foundry V13)
                         ->  127.0.0.1:8444 (nginx)  ->  127.0.0.1:30001 (Foundry V14)
```

Zwei Buehnen, weil eine Buehne allein kein Ergebnis ist. Welche Instanz auf
welchem Port liegt, entscheidet ihr `--dataPath`, nicht der Port und nicht der
Weltname. Vor dem Messen die Prozesse fragen:

```powershell
Get-CimInstance Win32_Process -Filter "Name='Foundry Virtual Tabletop.exe'" |
  ForEach-Object { $_.CommandLine }
```

Die Instanz, deren `dataPath` auf den Arbeitsbaum zeigt, ist die einzige, die
den zu pruefenden Code laedt. Alle anderen messen einen anderen Stand.

## Starten

`nginx.conf` und `limit.conf` aus diesem Verzeichnis nach `conf\` im entpackten
nginx legen, dann:

```powershell
$r = "<pfad>\nginx-1.30.4"
Start-Process -FilePath "$r\nginx.exe" -ArgumentList @('-p',$r,'-c','conf\nginx.conf') -WindowStyle Hidden
```

`Start-Process` ist noetig: nginx laeuft unter Windows im Vordergrund und
blockiert sonst die Sitzung.

Stoppen:

```powershell
& "$r\nginx.exe" -p $r -c conf\nginx.conf -s quit
```

## Messen

`bench-413.mjs` schickt echte multipart-Uploads an `/upload` und laesst die
Antwort durch genau die Funktionen laufen, die im Modul entscheiden. Es wird
nichts nachgestellt: kein erfundener Fehlertext, kein angenommener Statuscode.

```powershell
node bench-413.mjs <nginx-verzeichnis> <isolat.mjs> 30000 8443 "V13"
node bench-413.mjs <nginx-verzeichnis> <isolat.mjs> 30001 8444 "V14"
```

Das Isolat sind `INSTALL_ERROR`, `classifyTransferError` und
`errorBodyExcerpt`, aus `scripts/cloud-v2/beneos-native-installer.mjs`
herausgeschnitten. Der Umweg ist noetig, weil die Datei Foundry-Globale
voraussetzt und ausserhalb des Browsers nicht laedt.

Das Skript wechselt `client_max_body_size` zwischen `1m`, `8m` und `0` und laedt
nginx zwischen den Laeufen neu. Am Ende steht die Grenze wieder auf `1m`.

## Was gemessen wurde, 2026-09-01

Beide Buehnen deckungsgleich, V13 13.351 in `universe-test` und V14 14.360 in
`v13test3`, je zwoelf Faelle:

| Grenze | 100 KB | 2 MB | 10 MB |
|---|---|---|---|
| ohne Proxy | durch | durch | durch |
| `1m` | durch | **413, toolarge** | **413, toolarge** |
| `8m` | durch | durch | **413, toolarge** |
| `0` | durch | durch | durch |

Die Zeile `8m` ist die wichtige: dort laesst die Vorabpruefung mit ihrer festen
2-MB-Sonde den Lauf zu Recht durch, und die Ablehnung faellt erst je Asset an.
Beide Wege werden also getrennt belegt.

`bench-vorher-nachher.mjs` faehrt dieselbe echte Antwort durch den Stand vor
der Aenderung und den danach:

- `JSON.parse` auf die 413-Seite wirft `SyntaxError`. Damit ist am lebenden
  Objekt belegt, warum `FilePicker.upload` in `file-picker.mjs:488` ein leeres
  Objekt zurueckgibt und der Statuscode verloren geht, bevor das Modul ihn
  sieht. Sein eigener 413-Zweig in Zeile 483 prueft auf einen `HttpError`, den
  blankes `fetch` nie wirft: toter Code.
- Vorher `unknown`, und zwar auch dann noch, wenn man ihm Status UND Rumpf
  gibt. Nachher `toolarge`.
- Der Ausschnitt der Fehlerseite ist 70 Zeichen lang und enthaelt
  `nginx/1.30.4`. Genau deshalb geht er nur in die Konsole und nicht in die
  Fehlermeldung, die als `sample_message` in die Telemetrie wandert.

## Die Oberflaeche, gemessen am 2026-09-01

Angemeldet als GM in `universe-test` ueber `http://127.0.0.1:8443`, also durch
den Proxy, bei `client_max_body_size 1m`. Installiert wurde Release 110 in der
Fassung HD, 47 Szenen, 514 MB.

| Behauptung | Ergebnis |
|---|---|
| Abbruch vor dem ersten Download | belegt, `0/0 assets installed, 0 asset(s) and 0 document(s) failed` |
| Bericht nennt Ursache und Einstellung | belegt, Ueberschrift nennt HTTP 413, Text nennt `client_max_body_size 0;` |
| Knopf Erneut versuchen fehlt | belegt, nur `Copy report`, `Ask on Discord`, `Close` |
| keine Nebenwirkung in der Welt | belegt, 53 Szenen und 132 Aktoren vor und nach dem Lauf |

Der Weg dorthin, falls jemand ihn wiederholen will: als GM anmelden, dann in
der Konsole

```js
const api = await import('/modules/beneos-module/scripts/cloud-v2/beneos-release-install-api.mjs')
await api.installReleaseByNumber(110)
```

Der Bestaetigungsdialog fragt nach der Qualitaet; HD waehlen, damit ein
unerwarteter Durchlauf nicht 1,2 GB kostet.

## Was dieser Pruefstand NICHT misst

- **Den Weg je Asset.** Er greift nur, wenn die Grenze zwischen der 2-MB-Sonde
  und der Assetgroesse liegt. Dann laedt der Installer die Dateien erst
  vollstaendig aus der Cloud, bevor der Proxy sie ablehnt, der Nachweis kostet
  also die volle Uebertragung und installiert das Release in eine Pruefwelt.
  Bewusst nicht gefahren: `#serverRefusesSize` ist in beiden Wegen dieselbe
  Funktion und oben gegen echtes nginx belegt. Ungemessen bleiben damit der
  Sondierungsdeckel `MAX_SIZE_PROBES` und der Ausschluss aus der Reparatur.
- **Die Oberflaeche auf V14.** Die HTTP-Ebene ist dort deckungsgleich gemessen,
  der Bericht selbst nicht.

Prueffall: TC-CLD-MOD-061 im Wiki.
