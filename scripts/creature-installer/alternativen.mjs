/**
 * alternativen.mjs
 *
 * Die Regeln, nach denen sich entscheidet, ob eine Beneos-Kreatur zu einer
 * Szene GEHOERT oder ihr nur VORGESCHLAGEN wird.
 *
 * Es sind ZWEI Regeln, weil zwei verschiedene Fragen gestellt werden. Beide
 * werden immer ABGELEITET, nie gespeichert: ein Flag im Szenendokument wuerde
 * veralten und die Markierung an der falschen Kreatur zeigen.
 *
 * **Regel 1, die Lade: was traegt die ALT-Marke?** `istPlatziert()`. Eine
 * Beneos-Kreatur ist eine Alternative genau dann, wenn sie weder auf der Karte
 * platziert ist (keine `positions`) noch einer freien Kreatur eins zu eins
 * zugewiesen wurde (kein `replacedBy`-Ziel). Die Lade beantwortet damit
 * "gehoert das zum Entwurf dieser Karte".
 *
 * **Regel 2, die Karteninstallation: was wird im voraus geholt?**
 * `zuInstallierendeSchluessel()`. Hier zaehlt allein die Zuweisung. Eine
 * Kreatur mit eigener Position gehoert zwar zum Entwurf, kostet aber Leitung
 * und Platte fuer etwas, das erst auf Knopfdruck auf die Karte kommt.
 *
 * **Warum die beiden auseinanderlaufen duerfen, und zwar gefahrlos.** Gemessen
 * am 2026-09-15 ueber alle 143 Pakete: 59 Eintraege tragen `positions`, und
 * KEINER von ihnen steht als Token in `scene.tokens[]`. Kein Paket liefert
 * Beneos-Kreaturen als fertige Tokens aus. Gesetzt werden sie erst durch
 * "Place Beneos Creatures on Map", und dieser Weg holt fehlende Kreaturen
 * selbst nach. Eine nicht vorab installierte Kreatur hinterlaesst also kein
 * Loch auf der Karte, sie kommt einen Klick spaeter.
 *
 * Betreiberentscheid vom 2026-09-15. Davor galt Regel 1 auch fuer die
 * Installation; gemessen holte das ueber alle Pakete 55 statt 31 Kreaturen,
 * im Ausreisser bm_0114 allein 24 statt 0.
 *
 * Diese Datei kennt weder Foundry noch Oberflaeche. Sie rechnet nur auf dem
 * Szenen-Flag `flags["beneos-module"].creatureInstaller`.
 */

/** Stabile Identitaet eines Kreatureintrags, auch als Ziel einer Zuweisung. */
export function entryKey(e) {
  return e?.fullId || e?.tokenKey || e?.name || null;
}

/**
 * Alle Plaetze eines Eintrags auf der Leinwand. Traegt das `positions[]`-Modell
 * und hebt Alteintraege mit flachen `x`/`y`-Feldern darauf an. Jeder Platz
 * fuehrt sein eigenes `hidden`.
 */
export function positionsOf(entry) {
  if (Array.isArray(entry?.positions) && entry.positions.length) return entry.positions;
  if (entry?.x != null && entry?.y != null) {
    return [{ x: entry.x, y: entry.y, elevation: entry.elevation, rotation: entry.rotation, width: entry.width, height: entry.height, hidden: !!entry.hidden, disposition: entry.disposition }];
  }
  return [];
}

/**
 * Die Schluessel der Beneos-Kreaturen, die einer freien Kreatur eins zu eins
 * zugewiesen sind. Sie stehen zwar ohne eigene Position da, gehoeren aber zur
 * Szene: sie nehmen den Platz ihrer freien Kreatur ein.
 */
export function zugewieseneSchluessel(ci) {
  const out = new Set();
  for (const s of (Array.isArray(ci?.srdCreatures) ? ci.srdCreatures : [])) {
    if (s?.replacedBy) out.add(entryKey(s.replacedBy));
  }
  return out;
}

/** Steht dieser Eintrag auf der Karte? Platziert oder zugewiesen genuegt. */
export function istPlatziert(entry, zugewiesen) {
  if (positionsOf(entry).length > 0) return true;
  return !!(zugewiesen && zugewiesen.has(entryKey(entry)));
}

/**
 * Die `tokenKey`-Werte der Beneos-Kreaturen, die eine Karteninstallation im
 * voraus aus der Cloud holt: ausschliesslich die, die einer freien Kreatur
 * eins zu eins zugewiesen sind.
 *
 * Alles andere kommt auf Knopfdruck, entweder ueber das Plus in der Lade oder
 * ueber "Place Beneos Creatures on Map". Die Begruendung samt Messung steht
 * oben im Kopf dieser Datei.
 *
 * Eintraege ohne `tokenKey` fallen weg: ohne Schluessel liesse sich aus der
 * Cloud ohnehin nichts holen.
 */
export function zuInstallierendeSchluessel(ci) {
  const zugewiesen = zugewieseneSchluessel(ci);
  const out = new Set();
  for (const e of (Array.isArray(ci?.beneosCreatures) ? ci.beneosCreatures : [])) {
    if (!zugewiesen.has(entryKey(e))) continue;
    const k = (e?.tokenKey != null) ? String(e.tokenKey).trim() : "";
    if (k) out.add(k);
  }
  return out;
}
