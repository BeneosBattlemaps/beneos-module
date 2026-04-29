# Welle B-1 — Implementation Summary für Programmierer-Review

> Stand: 2026-04-29. Alle Änderungen liegen im aktuellen Branch im Foundry-V13-Datapath. Kein Build-Step (ESM + Handlebars + Hot-Reload), keine `module.json`-Änderungen, kein Server-/Backend-Touch. Manuelle Tests in Foundry V13/V14 erforderlich (das Modul hat keine Test-Suite).

## Wellen-Übersicht (alle vier abgeschlossen)

| Welle | Thema | Issue-IDs |
|---|---|---|
| **B-1a** | Cloud-Schicht-Härtung — kleine Bug-Fixes ohne UI-Change | B1, B2, B5, C3, C5, E4, E7, F1 |
| **B-1b** | Idempotenz-Lock — verhindert parallele Pipelines bei Mehrfach-Klick | E3 |
| **B-1c** | Soft-Refresh statt Close+Reopen — kein Flicker, keine gestapelten Welcome-Boxes | C2 |
| **B-1d** | Smooth Drag&Drop für Tokens — Local-Drag ohne Duplikat, Cloud-Drag-to-Canvas in einem Schritt | (UX-Erweiterung, kein Schwachstellen-ID) |

Issue-IDs referenzieren den Schwachstellen-Katalog in `memory\beneos_cloud_known_issues.md` (User-Memory) bzw. das Briefing in `docs/cloud-ux-briefing.md`.

## Thematische Zusammenfassung der Änderungen

### Cloud-Layer-Stabilität (B-1a)
- Mehrhyphen-Item/Spell-Keys werden jetzt korrekt erkannt (`replaceAll`)
- `availableContent` startet als sauberes Objekt — keine `undefined`-Errors mehr in den ersten Sekunden nach Foundry-Start
- `checkAvailableContent()` ist jetzt async/await, login wartet darauf — UI sieht populated Daten beim ersten Render
- Setting-Updates bei Asset-Imports nur noch wenn der Compendium-Document tatsächlich erstellt wurde
- `noWorldImport`-Flag wird bei jedem Single-Install-Eingang zurückgesetzt (kein "leftover state" nach Batch-Crash)
- FilePicker-Tippfehler im Battlemap-Upload-Pfad korrigiert (war Dead-Code, aber jetzt vorbereitet für spätere Cloud-Battlemap-Integration)
- `encodeURIComponent` an allen URL-Build-Stellen — Asset-Keys mit Sonderzeichen funktionieren wieder
- 24 hardcoded englische Notifications → `game.i18n.localize/format()` mit neuen `BENEOS.Cloud.Notification.*` Keys (in alle 13 Lang-Files mit englischem Initial-Text gepflegt; Übersetzungen können später nachgepflegt werden ohne Code-Änderung)

### Idempotenz (B-1b)
- Neues Set `inflightImports` auf `BeneosCloud` verhindert dass Doppel-Klick auf "Install" parallele Pipelines startet
- 4-5x Klick spawnte vorher 4-5 parallele Importe → Compendium-Duplikate, "Cannot delete journal: id does not exist"-Errors, mehrere übereinander gerenderte Search-Engines. Jetzt: erster Klick startet, weitere zeigen "X is already being imported"-Notification

### Render-Smoothness (B-1c)
- `BeneosSearchEngineLauncher.softRefresh(typeAsset, key)` als Ersatz für `closeAndSave() + setTimeout(100) + new Launcher().render()` an drei single-install-Pfaden
- Nutzt zwei bestehende Helpers (`refresh()` und `processSelectorSearch()`) die bisher nicht aktiv genutzt wurden — keine neue Architektur
- Welcome-Box (`showBattlemapNotice`) Flag von `this.battlemapNoticeShown` auf `game.beneos.battlemapNoticeShownThisSession` gehoben — überlebt close+reopen, erscheint pro Foundry-Session höchstens einmal
- Batch-Install-Pfad bewusst unverändert — close+reopen am Ende ist dort akzeptables UX

### Drag&Drop-UX (B-1d)
- Lokal-Drag (installiertes Token auf Canvas): dragstart setzt Welt-Actor-UUID statt Compendium-UUID via Flag-Lookup. Foundry erstellt nur ein Token an Drop-Position, kein Duplikat-Actor mehr im Actor-Browser
- Cloud-Drag (nicht installiertes Token auf Canvas): neue Pipeline mit Phantom-Marker im dataTransfer + `dropCanvasData`-Hook + `pendingCanvasDrops`-Map auf BeneosCloud + drain nach erfolgreichem Import. Multi-Drop-fähig (3 Drags = 3 Tokens), Install-Fehler verwirft pending drops mit Notification
- Items/Spells unverändert (kein Canvas-Drop-Konzept in Foundry)

## Angefasste Dateien

```
scripts/
├─ beneos_cloud.js              [B-1a: ~8 Stellen | B-1b: 4 Funktionen + neuer Lock | B-1c: 3 Stellen | B-1d: ~5 neue Methoden + 2 cleanup-Stellen]
├─ beneos_search_engine.js      [B-1c: neue softRefresh-Methode + Welcome-Box-Flag | B-1d: dragstart-Handler komplett überarbeitet]
└─ beneos_module.js             [B-1d: neuer dropCanvasData-Hook am Ende]

lang/{en,de,fr,es,it,pt-BR,pt-PT,pl,cs,ca,ja,ko,zh-TW}.json
                                [+25 neue BENEOS.Cloud.Notification.* Keys, 422 Keys total]
```

## Inline-Kommentar-Anker

Jeder Edit hat einen Inline-Kommentar mit Issue-ID — sucht im Editor nach `// Fix #` um alle Änderungen zu finden:

- `// Fix #B1:` — initial-state shape (1×)
- `// Fix #B2:` — async checkAvailableContent (3×)
- `// Fix #B5:` — replaceAll handles multi-hyphen (5×)
- `// Fix #C2:` — soft refresh / welcome box flag (5×)
- `// Fix #C3:` — settings update only on success (4×)
- `// Fix #C5:` — noWorldImport reset (3×)
- `// Fix #E3:` — idempotency lock (5+×)
- `// Fix #E4:` — FilePicker.upload typo (1×)
- `// Fix #E7:` — encodeURIComponent (1× block-comment)
- `// Fix #F1:` — chat HTML i18n (1×)
- `// Fix #B-1d` — drag&drop refactor (mehrere)

## Was bewusst NICHT angefasst wurde

- **Templates** (`templates/*.html`) — gehören zur UI-Schicht, kommen mit V2-Design (Welle B-3+)
- **CSS** (`css/beneos.css`) — dito V2
- **`module.json`** — keine Manifest-Änderungen nötig (kein neues File, keine neuen Dependencies)
- **Batch-Install-Pfad** — close+reopen am Ende bewusst belassen, weil langwieriger Vorgang mit Progress-Chat eh ein "fertig"-Reset erwartet
- **Asset-Removal-Pfade** in `beneos_utility.js` (3×) und `beneos_compendium.js` (1×) — selten benutzt, "Engine schließt sich"-Verhalten dort akzeptabel
- **`closeAndSave()`-Methode selbst** — wird noch in den Asset-Removal-Pfaden gebraucht, deshalb nicht entfernt
- **jQuery-Stellen** (G2 — V14-Risiko) — separater V14-Migrations-Pass
- **Login auf POST** (A10) — braucht Server-Anpassung, später koordiniert
- **Patreon-Live-Refresh** (A8) — verworfen per "in-dubio-pro-reo"-Direktive

## Test-Vorgehen

Manuelle Tests im Foundry V13 WORK-Datapath. Empfohlene Sequenz:

1. **Smoke**: Foundry starten, Modul aktivieren, Console clean
2. **Login + Search-Engine**: einloggen, Welcome-Box erscheint einmal, "Got it" — sollte für die Session weg sein
3. **Single-Token-Install via Klick**: kein Flicker, Token-Badge wechselt zu "installed", keine Welcome-Box-Wiederholung, Scroll-Position bleibt
4. **Mehrfach-Klick auf "New"-Token**: erste Klick startet Install, weitere zeigen "is already being imported"-Notification, KEINE Compendium-Duplikate
5. **Drag&Drop installierter Token auf Canvas**: nur EIN Token an Drop-Position, KEIN Duplikat-Actor im Actor-Browser
6. **Drag&Drop Cloud-Token auf Canvas**: Notification "Importing... will appear at drop position", nach 3-5s erscheint Token an der gedroppten Position
7. **Multi-Drag desselben Cloud-Tokens**: 3× verschiedene Stellen droppen → 3 Tokens an 3 Positionen nach Install
8. **Foundry-Sprache wechseln**: Notifications kommen aus Lang-File (Englisch initial — kann der Programmierer oder ich später lokalisieren)
9. **Tour**: 16-Schritt-Tour läuft unverändert — wir haben keine Tour-Selektoren angefasst
10. **V14-Smoke**: Zweite Foundry-Instanz im SYNC-Datapath — identisches Verhalten

## Architektur-Entscheidungen die wert sind zu wissen

1. **Welcome-Box-Strategie**: Box erscheint nur einmal pro Foundry-Session (nicht mehr nach jedem Install). Permanent dismissed via existing `beneos-bmap-notice-dismissed` Setting. Kein neues Setting eingeführt.
2. **Cloud-Drag-Hook**: Nur `dropCanvasData` registriert (nicht `preCreateToken` oder andere). Phantom-Marker im dataTransfer ist `{ beneosCloudPending: true, beneosTokenKey: "..." }` — eindeutig genug, kein Konflikt mit Foundry-Standard-Drops.
3. **Pending-Drops-Map**: Lebt nur in-memory auf `BeneosCloud`-Singleton. Bei Foundry-Reload weg — akzeptabel, weil pending drops eh nur ~5 Sekunden existieren.
4. **In-dubio-pro-reo-Direktive** (User-Wunsch): Bei Status-Unsicherheit (Loading, Race) optimistisch zeigen, nicht sperren. Spiegelt sich in B1+B2 wider — UI zeigt Inhalte sobald irgendwie möglich, nicht "nicht verfügbar" als Default.

## Verwandte Doku im Repo

- `docs/cloud-ux-briefing.md` — strategisches Briefing zu User-Wahrnehmung und Härtungs-Roadmap
- `docs/design-2.0-mapping.md` — Mapping vom geplanten V2-Design auf bestehende Codestellen (Welle B-3+ Kontext)

Falls beim Review Fragen zu konkreten Stellen aufkommen — die Inline-Kommentare verweisen auf den Issue-Katalog mit Hintergrund (`memory/beneos_cloud_known_issues.md` bei Beneos lokal). Bei diagnostischen Fragen einfach Logfile + Screenshot — ich kann punktuelle Rollbacks pro `// Fix #X:`-Anker anbieten.
