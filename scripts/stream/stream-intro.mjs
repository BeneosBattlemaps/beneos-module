/**
 * The one-time explanation of how Beneos delivers maps.
 *
 * WAS SICH AM 2026-09-03 GEAENDERT HAT.
 *
 * Bis hierhin war Streaming eine geschlossene Beta, und diese Datei hiess
 * `stream-guard.mjs`. Sie stellte vor der ersten Aktivierung eine Frage mit
 * zwei Ausgaengen, und ein Nein hielt den Installationsweg an. Das war richtig,
 * solange offen war, ob Streaming ueberhaupt traegt.
 *
 * Jetzt ist Streaming die normale Auslieferung. Die Umschaltung haengt an der
 * Modulfassung: wer das neue Modul faehrt, faehrt die neue Auslieferung. Es
 * gibt keinen Wanderungslauf durch fremde Welten und keine zweite Betriebsart,
 * zwischen der ein Kunde waehlen muesste.
 *
 * WARUM DIE FRAGE ZUR ERKLAERUNG WIRD, UND NICHT NUR VERSCHWINDET.
 *
 * Eine Frage ohne Ausgang ist keine Frage. Haette der Dialog seine zwei Knoepfe
 * behalten, waere ein Nein folgenlos geblieben, und der Kunde haette gelernt,
 * dass seine Antwort nichts bedeutet. Genau die Sorte Meldung, die der
 * Betreiber am 2026-09-03 abgestellt haben wollte: fragen nur dann, wenn die
 * Antwort etwas aendert.
 *
 * Was bleibt, ist eine Mitteilung mit einem Knopf. Sie erklaert einmal je Welt,
 * was mit den schweren Dateien passiert, was ein Verbindungsverlust kostet und
 * wo der Weg zurueck in den Offline-Betrieb liegt. Danach nie wieder.
 *
 * Bereits installierte Releases werden dabei nicht angefasst. Sie liegen auf
 * der Platte, wie sie liegen, und belegen keinen Platz im Offline-Kontingent.
 *
 * ZWEI TEXTE SEIT DEM 2026-09-16.
 *
 * Seit der Server je Konto den Auslieferungsweg vorgeben kann, gibt es Kunden,
 * fuer die jeder Satz des Streaming-Textes falsch ist: bei ihnen liegt nichts
 * beim Tor, ein Verbindungsverlust kostet nichts, und "Keep offline" ist
 * gegenstandslos. Sie bekommen deshalb einen eigenen Text.
 *
 * Unterdrueckt wird der Dialog ausdruecklich NICHT. Wer auf einem Sonderweg
 * laeuft, soll das einmal lesen; sonst meldet er sich im Support mit "warum ist
 * das bei mir anders", und niemand weiss es auf Anhieb.
 */

import { downloadMode, MODULE_ID, SETTING } from "./stream-settings.mjs"

const DialogV2 = () => foundry.applications?.api?.DialogV2

const t = (key) => game.i18n?.localize?.(key) ?? key

/** Hat diese Welt die Erklaerung schon gesehen? */
export function introSeen() {
  try { return Boolean(game.settings.get(MODULE_ID, SETTING.introSeen)) } catch (_) { return false }
}

/**
 * Einmal je Welt erklaeren, dann nie wieder.
 *
 * Kein Rueckgabewert, an dem etwas haengt, und kein Ausgang, der den Aufrufer
 * anhaelt: die Erklaerung informiert, sie entscheidet nichts. Faellt der Dialog
 * aus irgendeinem Grund aus, laeuft der Weltstart trotzdem weiter, und der
 * Vermerk bleibt ungesetzt, damit der naechste Start es erneut versucht.
 */
export async function explainOnce() {
  if (introSeen()) return
  if (!game.user?.isGM) return

  const D = DialogV2()
  if (!D) return

  // Der Download-Weg bekommt seinen eigenen Text. Der Streaming-Text traegt fuer
  // ihn keinen einzigen richtigen Satz: es bleibt nichts beim Tor, ein
  // Verbindungsverlust kostet nichts, und der Offline-Vorrat ist unbenutzt.
  const dl = downloadMode()
  const content = dl
    ? `
    <p><strong>${t("BENEOS.Stream.Intro.Download.Lead")}</strong></p>
    <p>${t("BENEOS.Stream.Intro.Download.What")}</p>
    <p>${t("BENEOS.Stream.Intro.Download.Cost")}</p>
    <p>${t("BENEOS.Stream.Intro.Existing")}</p>`
    : `
    <p><strong>${t("BENEOS.Stream.Intro.Lead")}</strong></p>
    <p>${t("BENEOS.Stream.Intro.What")}</p>
    <p>${t("BENEOS.Stream.Intro.Cost")}</p>
    <p>${t("BENEOS.Stream.Intro.Offline")}</p>
    <p>${t("BENEOS.Stream.Intro.Existing")}</p>`

  // rejectClose: false, weil das Schliessen ueber das Kreuz dasselbe bedeutet
  // wie der Knopf, naemlich gelesen. Ohne diese Zeile wirft DialogV2 beim
  // Schliessen, und die Erklaerung kaeme bei jedem Weltstart wieder.
  const gezeigt = await D.prompt({
    window: { title: t("BENEOS.Stream.Intro.Title") },
    content,
    ok: { label: t("BENEOS.Stream.Intro.Ok") },
    rejectClose: false,
  }).then(() => true).catch(() => false)

  if (gezeigt) await game.settings.set(MODULE_ID, SETTING.introSeen, true)
}
