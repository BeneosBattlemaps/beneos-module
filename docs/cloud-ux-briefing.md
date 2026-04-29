# Beneos Cloud — UX-Härtungs-Briefing für den Programmierer

> **Zweck:** Liste konkreter Modul-seitiger Verbesserungen, die die Wahrnehmung der Beneos Cloud durch Endnutzer schärfen. Stand: 2026-04-29. Diese Datei begleitet die Phase A der Modernisierung — sie ist ausschließlich ein Diskussions-Dokument, kein Implementierungsauftrag.

## 1. Architektur-Bewertung in einem Satz

Das Konzept (Patreon-Webhook-Replica → eigene User-DB → pseudonyme `foundryId` → server-individuelle Asset-Liste) ist **solide und skalierbar**. Die rauhen Kanten liegen ausschließlich auf der **Code-/UX-Schicht im Modul** und sind mit gezielten kleinen Eingriffen zu beheben — kein Refactor des Datenflusses nötig.

## 2. Beneos-Zugriffs-Modell (zur Klarstellung für künftige Code-Entscheidungen)

| Status | Was sieht der User |
|---|---|
| Nicht eingeloggt | Login-Form, kein Cloud-Inhalt |
| Eingeloggt, Free-Account | Free-User-sichtbare Tokens (Server-individuelle Liste) |
| Eingeloggt, Paid-Patron (alle Tiers gleich) | Volle Asset-Bibliothek |
| Eingeloggt, mit Loyalty-Tokens | Zusätzlich die Loyalty-Items, die sein Account zum Stichtag der Veröffentlichung zugewiesen bekam |

**Wichtig**: Es gibt **keine** Differenzierung zwischen Paid-Tiers (kein Tier sieht "100 Tokens", ein anderer "200"). Das vereinfacht jede Filter-Logik im Modul — der Server liefert pro Account fertig die korrekte Liste, das Modul **rendert nur, was kommt**.

## 3. Leitprinzip: "in dubio pro reo"

Bei jeder Entscheidung "soll ich dem User diesen Inhalt zeigen oder nicht?" gilt:

- **Bei Unsicherheit / Loading**: optimistisch zeigen, nicht sperren.
- **Bei abgelaufener Verfügbarkeit**: erst beim Klick blockieren, nicht vorher.
- **Bei Race-Conditions**: lieber kurz "Lade…" als sofort "Nicht verfügbar".

Es ist immer leichter, einem User später zu sagen "geht doch nicht", als ihn fälschlich auszuschließen.

## 4. Konkrete Härtungspunkte (priorisiert)

### Welle 1 — schnelle Modul-Hygiene (kein UI-Wechsel, keine Server-Änderung)

Diese Punkte sind **kleine, lokale Edits**. Jeder Punkt = ein paar Zeilen, mit Inline-Komment der die Issue-ID nennt (z.B. `// Fix #B5: replaceAll instead of replace, see beneos-search-engine skill`).

| ID | Wo | Was | Wirkung |
|---|---|---|---|
| **B1** | `beneos_cloud.js:139` | `availableContent = []` → `{ tokens:[], items:[], spells:[] }` | "Ich bin eingeloggt, sehe nichts"-Fall in den ersten Sekunden eliminiert |
| **B2** | `beneos_cloud.js:279` | `checkAvailableContent()` gibt Promise zurück; UI kann darauf warten | UI zeigt "Lade Cloud-Inhalte…" statt fälschlich "nicht verfügbar" |
| **B5** | `beneos_cloud.js:202, 215` | `replace("-","_")` → `replaceAll("-","_")` | Items mit ≥2 Bindestrichen werden korrekt als verfügbar erkannt (heute stiller Bug) |
| **C3** | `beneos_cloud.js:770–776` | Setting-Update nur bei erfolgreichem Actor-Create (Guard-Check) | UI zeigt nicht mehr "installiert" für Tokens, deren Compendium-Eintrag nicht entstand |
| **C5** | `beneos_cloud.js:315` | `noWorldImport`-Flag nach Batch zurücksetzen | Single-Install nach Batch landet wieder im Actors-Folder |
| **E2** | `beneos_cloud.js:782` | Settings-Write atomisch machen oder pro Asset-Key statt komplettes JSON | Parallel-Installs verlieren nicht mehr halbe Tracking-Daten |
| **E4** | `beneos_cloud.js:979` | Den doppelten `.FilePicker`-Pfad verifizieren — sieht nach Tippfehler aus | **Verdacht auf Produktionsbug** — Battlemap-Upload könnte heute kaputt sein |
| **E7** | mehrere URLs | `encodeURIComponent()` an allen URL-Build-Stellen | Asset-Keys mit Sonderzeichen funktionieren wieder |
| **F1** | viele `ui.notifications.*` | Hardcoded English → `game.i18n.localize("BENEOS.Cloud.…")` mit Keys in allen 13 Sprachen | Verletzt heute den eigenen Beneos-Sprachen-Standard |

### Welle 2 — Vorzumerken, später mit Server-Programmierer

| ID | Was | Begründung |
|---|---|---|
| **A10** | Login-Credentials von URL-Query auf POST-Body umstellen | Passwort landet sonst in Browser-History und Server-Access-Logs |
| **G2** | jQuery-Stellen (z.B. `$().html()` in Zeile 843) auf vanilla JS migrieren | jQuery in Foundry V14 deprecated — sonst stiller Breaker bei V14-Wechsel |

### Welle 3 — Mit dem neuen Design (V2)

Diese Punkte sollen **nicht ins V1 nachgerüstet** werden, sondern Teil der ApplicationV2-Migration sein, weil sie UX-Lifecycle-Themen sind:

- **A2/A3** Sichtbares Login-Feedback (Spinner, Timeout-Notification, Disable-State auf Login-Button während Vorgang)
- **A5/A6** `window.location.reload()` ersetzen durch saubere Re-Rendering-Logik
- **A9** Server-Antwort `result: "session_expired"` (Server-Seite einbeziehen) → Modul triggert Re-Login-Modal
- **C2** Search-Engine bewahrt Filter, Scroll-Position und Tab nach jedem Install (heute volles close+reopen)

### Welle 4 — Architektur-Reife (langfristig)

Diese Punkte sind **kein "muss"** für Q2/Q3, aber sie zahlen sich aus, wenn ihr auf 5x Patron-Volumen wachst:

- **Server-Antwort verreichern**: `/foundry-manager.php?check=1` könnte zusätzlich liefern: `is_free_user` (boolean), `loyalty_token_count` (für Display), `quota_used_bytes`, `server_time`. Das spart künftige zusätzliche Calls.
- **Zentrale `canUserAccess(asset)`-Funktion** im Modul — vereinfachte Form: "Server hat es in der Liste? → ja." Plus Sonderregel für Free-User-Tokens, falls die client-seitig entschieden werden.
- **Ein einheitlicher `import…(category, key)`-Eingang** statt vier separate Funktionen — die Duplikation in `importTokenToCompendium`/`importItemToCompendium`/`importSpellToCompendium` (~70% identische Logik in je 100–180 Zeilen) ist heute der größte Wartbarkeits-Schmerz.

## 5. Was bewusst NICHT getan wird

Diese Punkte sind absichtlich **nicht** in der Liste, mit Begründung:

| Verworfen | Warum |
|---|---|
| Live-Patreon-Status-Re-Poll während Session | Status-Änderungen mid-Session sind selten, nächster Login fängt sie ab. In-dubio-pro-reo: User behält im Zweifel Zugriff bis zum nächsten Login. |
| Tier-basierte UI-Filterung | Gibt es im Geschäftsmodell nicht (alle Paid-Tiers sehen dasselbe). Free-vs-Paid + Loyalty-Tokens werden eh schon korrekt vom Server abgebildet. |
| Asset-Liste während Session aktualisieren | Selten neue Inhalte mid-Session, Foundry-Reload ist akzeptabler Refresh-Punkt. |

## 6. Risiken bei Nicht-Tun

Wenn keine der Härtungen erfolgt, akzeptieren wir:

- "Ich bin eingeloggt aber sehe nichts" beim Foundry-Start (B1+B2) — heutiger Support-Klassiker, leicht zu beheben.
- Items mit Mehrfach-Bindestrichen sind unsichtbar (B5) — wächst mit Content-Volumen.
- Battlemap-Upload möglicherweise produktiv kaputt (E4) — **dringend prüfen**.
- Falsche "installiert"-Anzeige für gescheiterte Imports (C3) — User wundert sich beim Drag-Drop.
- Stille Login-Fehler bei Netzwerkausfällen (A2/A3) — User klicken hilflos mehrfach.
- Sprach-Inkonsistenz für DE/FR/usw. User (F1) — Markenwahrnehmung leidet.

## 7. Verweise

- Vollständiger Schwachstellenkatalog (A1–J3) mit allen Severity-Stufen: Memory `beneos_cloud_known_issues.md`
- Cloud-Endpoint-Inventar: Memory `beneos_cloud_communication.md`
- UI-Architektur: Memory `beneos_search_engine_architecture.md`
- Tiefes Skill-Dokument für künftige Code-Arbeit: Skill `beneos-search-engine`
- Plan-Datei mit Phase-A/B-Trennung: `C:\Users\Beneos\.claude\plans\dieses-video-vermutlich-wei-dynamic-mist.md`
- Zukünftiges Design (V2): `D:\PNP_Game\Foundry VTT\FoundryVTT\Beneos Foundry VTT Module Design 2.0\handoff\INTEGRATION.md`
