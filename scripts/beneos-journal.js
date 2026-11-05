/****************************************************************
 * beneos-journal.js – v1.5 (GLOBAL DELEGATION + sticky click)
 ****************************************************************/
(() => {
  'use strict';

  /* ---------- GLOBAL INTERACTIONS (once) -------------------- */
  Hooks.once('ready', () => {
    const ROOT = document;

    function getActiveLinkBtn(e) {
      const t = (e?.composedPath?.()[0]) ?? e?.target;
      return (t instanceof Element) ? t.closest('.link-square.active') : null;
    }

    function getBox(el) {
      const id = el?.dataset?.target;
      return id ? document.querySelector(`.beneos-node#${id}`) : null;
    }

    // Fallback: native title aus data-hint
    document.querySelectorAll('[data-hint]').forEach(el => {
      if (!el.getAttribute('title')) el.setAttribute('title', el.getAttribute('data-hint'));
    });

    ROOT.addEventListener('mouseenter', (e) => {
      const btn = getActiveLinkBtn(e);
      if (!btn) return;
      const box = getBox(btn);
      if (box) box.classList.add('beneos-highlight');
      btn.classList.add('is-hovered');
    }, true);

    ROOT.addEventListener('mouseleave', (e) => {
      const btn = getActiveLinkBtn(e);
      if (!btn) return;
      const box = getBox(btn);
      if (box && !box.classList.contains('beneos-sticky')) box.classList.remove('beneos-highlight');
      btn.classList.remove('is-hovered');
    }, true);

    ROOT.addEventListener('focusin', (e) => {
      const btn = getActiveLinkBtn(e);
      if (!btn) return;
      const box = getBox(btn);
      if (box) box.classList.add('beneos-highlight');
      btn.classList.add('is-hovered');
    }, true);

    ROOT.addEventListener('focusout', (e) => {
      const btn = getActiveLinkBtn(e);
      if (!btn) return;
      const box = getBox(btn);
      if (box && !box.classList.contains('beneos-sticky')) box.classList.remove('beneos-highlight');
      btn.classList.remove('is-hovered');
    }, true);

    ROOT.addEventListener('keydown', (e) => {
      const btn = getActiveLinkBtn(e);
      if (!btn) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    }, true);

    ROOT.addEventListener('click', (e) => {
      const btn = getActiveLinkBtn(e);
      if (!btn) return;
      const box = getBox(btn);
      if (!box) return;
      try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) { }
      box.classList.add('beneos-highlight', 'beneos-pulse', 'beneos-sticky');
      setTimeout(() => box.classList.remove('beneos-pulse'), 600);
      setTimeout(() => box.classList.remove('beneos-sticky', 'beneos-highlight'), 1200);
    }, true);

    console.info('[Beneos] Global interactions ready');
  });

  /* ---------- KEINE BREITENKORREKTUR MEHR ------------------- */
  /*
   * Hier stand bis zum 05.11.2026 eine Korrektur, die das Journalfenster
   * verbreiterte, wenn eine `.beneos-node-map` nicht hineinpasste. Sie wird
   * nicht repariert, sondern entfernt, und das ist ein Messergebnis.
   *
   * Sie hing an `renderJournalSheet` und `renderJournalPageSheet`, den Namen
   * aus Foundry 12. Gemessen in Fassung 13.351: keiner der beiden feuert, die
   * heutigen Namen heissen `renderJournalEntrySheet` und
   * `renderJournalEntryPageSheet`. Die Korrektur lief also seit dem Sprung auf
   * Fassung 13 nie, und `module.json` verlangt mindestens Fassung 13.
   *
   * ENTSCHEIDEND IST ABER, WAS SIE GETAN HAETTE. Am 05.11.2026 an einem Blatt
   * mit echter Knotenkarte nachgerechnet, mit denselben zwei Anweisungen:
   *
   *   Fensterbreite davor         960 px
   *   Breite der Knotenkarte      730 px, durch das CSS gedeckelt
   *                               (`max-width: calc(3*220px + 2*2.2rem)`)
   *   Bedarf nach der Formel      790 px
   *   Fensterbreite danach        960 px, also UNVERAENDERT
   *
   * Die Vorgabebreite eines Journalfensters in Fassung 13 ist breiter als die
   * Knotenkarte je werden kann. Der Zweig, der verbreitert, kann nicht mehr
   * greifen. Uebrig blieb allein die zweite Anweisung, und die klemmte den
   * Inhalt von `none` auf 730 px und nahm ihm den Rand, machte das Fenster
   * also ENGER statt breiter. Das ist das Gegenteil des Zwecks.
   *
   * Dazu entfaellt eine Gefahr: der `MutationObserver` auf der Fensterwurzel
   * lief bei jedem Render mit, und ein Blatt der Fassung 13 rendert seine
   * Seiten in einer eigenen Schleife nach.
   *
   * Wird die Knotenkarte eines Tages breiter als 790 px, gehoert die Breite
   * ins CSS der Karte und nicht in einen Haken. Paket `OP-CLD-198`.
   */
})();
