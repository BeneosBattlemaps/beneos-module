/****************************************************************
 * beneos-journal.js  –  v1.3 + minWidth-Fix
 * -------------------------------------------------------------
 *  • Node-Hover (Box) + Button-Hover (Ziel-Highlight & Pulse)
 *  • Auto-Resize: Fenster an Map-Breite anpassen
 *      – setzt zusätzlich min-width, damit User nicht schmaler zieht
 ****************************************************************/

/* ---------- Hover & Pulse ---------------------------------- */
function enableInteractions($beneos){
  /* Box direkt unter Maus */
  $beneos.on('mouseenter','.beneos-node',  e=>$(e.currentTarget).addClass('beneos-highlight'))
         .on('mouseleave','.beneos-node',  e=>$(e.currentTarget).removeClass('beneos-highlight'));

  /* Link-Quadrate */
  const BTN = '.link-square.active, .link-square.active *';
  $beneos.on('mouseover', BTN, e=>{
        const id=$(e.currentTarget).closest('.link-square').data('target');
        $beneos.find(`.beneos-node#${id}`).addClass('beneos-highlight');
      })
      .on('mouseout',  BTN, e=>{
        const id=$(e.currentTarget).closest('.link-square').data('target');
        $beneos.find(`.beneos-node#${id}`).removeClass('beneos-highlight');
      })
      .on('click',     BTN, e=>{
        const id=$(e.currentTarget).closest('.link-square').data('target');
        const $box=$beneos.find(`.beneos-node#${id}`);
        if(!$box.length) return;
        $box[0].scrollIntoView({behavior:'smooth',block:'center'});
        $box.addClass('beneos-pulse');
        setTimeout(()=>$box.removeClass('beneos-pulse'),600);
      });
}

/* ---------- Auto-Resize ------------------------------------ */
function resizeSheet(app, html){
  const $map = $(html).find('.beneos-node-map');      // Grid-Container
  if(!$map.length) return;

  const need = $map[0].scrollWidth + 60;              // Inhalt + Puffer
  const curW = app.element.width() ?? 0;

  if(curW < need){
    const pos = foundry.utils.deepClone(app.position);
    pos.width    = need;
    pos.minWidth = need;                              // ← neuer Fix
    app.setPosition(pos);
  }

  /* Beneos-Page auf volle Breite */
  $(html).find('.journal-entry-content, .journal-page-content')
        .css({ maxWidth: need - 60, margin: 0 });
}

/* ---------- Observer pro Sheet ----------------------------- */
function observeSheet(app, html){
  const ob = new MutationObserver(()=>{
    const $beneos = $(html).find('.beneos-journal');
    if(!$beneos.length) return;
    enableInteractions($beneos);
    resizeSheet(app, html);
    ob.disconnect();                                  // nur einmal
  });
  ob.observe(html[0], { childList:true, subtree:true });
}

/* Hooks */
Hooks.on('renderJournalSheet',     observeSheet);
Hooks.on('renderJournalPageSheet', observeSheet);

/* -------------------------------------------------------------
 * OPTIONALE „Zeit-Regime“ – Beispiele, falls du später
 * wiederkehrende Aktionen brauchst.  Standardmäßig inaktiv.
 * ----------------------------------------------------------- */
/*
Hooks.once('ready', () => {
  // wiederkehrend alle 5 min etwas prüfen?
  // setInterval(()=> { console.log('Beneos heartbeat'); }, 300_000);
});
*/

