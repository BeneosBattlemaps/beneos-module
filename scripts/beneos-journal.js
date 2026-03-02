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

  /* ---------- RESIZE PER SHEET RENDER ----------------------- */
  function resizeSheet(app, html) {
    const map = html[0]?.querySelector?.('.beneos-node-map');
    if (!map) return;
    const need = map.scrollWidth + 60;
    const curW = app.element?.width?.() ?? 0;
    if (curW < need) {
      const pos = foundry.utils.deepClone(app.position);
      pos.width = need;
      pos.minWidth = need;
      app.setPosition(pos);
    }
    $(html).find('.journal-entry-content, .journal-page-content')
      .css({ maxWidth: need - 60, margin: 0 });
  }

  function observeSheet(app, html) {
    // sofort versuchen
    resizeSheet(app, html);
    // zur Sicherheit nach DOM-Änderung erneut
    const ob = new MutationObserver(() => resizeSheet(app, html));
    ob.observe(html[0], { childList: true, subtree: true });
    setTimeout(() => ob.disconnect(), 1500); // kurz beobachten, dann aus
  }

  Hooks.on('renderJournalSheet', observeSheet);
  Hooks.on('renderJournalPageSheet', observeSheet);
})();
