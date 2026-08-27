/**
 * alternativen.mjs
 *
 * Die eine Regel, nach der sich entscheidet, ob eine Beneos-Kreatur zu einer
 * Szene GEHOERT oder ihr nur VORGESCHLAGEN wird.
 *
 *   Eine Beneos-Kreatur ist eine Alternative genau dann, wenn sie weder auf der
 *   Karte platziert ist (keine `positions`) noch einer freien Kreatur eins zu
 *   eins zugewiesen wurde (kein `replacedBy`-Ziel).
 *
 * Die Regel wird immer ABGELEITET, nie gespeichert. Ein Flag im Szenendokument
 * wuerde veralten und die Markierung an platzierten Kreaturen zeigen.
 *
 * Zwei sehr verschiedene Stellen brauchen sie, und sie muessen sich einig sein:
 * der Drawer, der die Markierung zeichnet, und der Karteninstallierer, der
 * entscheidet, welche Kreaturen er ueberhaupt aus der Cloud holt. Laufen die
 * beiden auseinander, installiert die Karte etwas anderes, als die Lade zeigt.
 * Deshalb steht die Regel hier und nicht in einem der beiden.
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
 * Die `tokenKey`-Werte aller Beneos-Kreaturen, die auf dieser Szene wirklich
 * stehen. Alternativen bleiben draussen.
 *
 * Eintraege ohne `tokenKey` fallen weg: ohne Schluessel liesse sich aus der
 * Cloud ohnehin nichts holen.
 */
export function platzierteBeneosSchluessel(ci) {
  const zugewiesen = zugewieseneSchluessel(ci);
  const out = new Set();
  for (const e of (Array.isArray(ci?.beneosCreatures) ? ci.beneosCreatures : [])) {
    if (!istPlatziert(e, zugewiesen)) continue;
    const k = (e?.tokenKey != null) ? String(e.tokenKey).trim() : "";
    if (k) out.add(k);
  }
  return out;
}
