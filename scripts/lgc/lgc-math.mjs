// Shared math helpers for the Live Game Control: log-scale distance
// slider, continuous-degree direction picker, intensity-class mapping.
// Single source of truth so Composer, Active-Ping-Card and the player
// Sense-Compass all agree on the numbers.

export const DIST_MAX_FT = 52800;   // 10 miles
export const SLIDER_MAX  = 1000;    // input range 0..1000

// Logarithmic mapping. value 0 -> 0 ft, value 1000 -> 52800 ft.
// Lower 30% of the slider stays under 5280 ft (1 mile), so the GM has
// fine control in the close range used for the scavenger-hunt feel.
export function sliderToFeet(value) {
  const v = Math.max(0, Math.min(SLIDER_MAX, Number(value) || 0));
  const ft = Math.exp((v / SLIDER_MAX) * Math.log(DIST_MAX_FT + 1)) - 1;
  return Math.round(ft);
}

export function feetToSlider(ft) {
  const f = Math.max(0, Math.min(DIST_MAX_FT, Number(ft) || 0));
  const v = Math.log(f + 1) / Math.log(DIST_MAX_FT + 1) * SLIDER_MAX;
  return Math.round(v);
}

// Human-readable label: feet under 1 mile, miles (1 decimal) above.
export function formatDistance(ft) {
  const f = Math.max(0, Math.round(Number(ft) || 0));
  if (f < 5280) return `${f.toLocaleString("en-US")} ft`;
  const mi = f / 5280;
  return `${mi.toFixed(mi >= 10 ? 0 : 1)} mi`;
}

// 16-point compass for the sector readout. 22.5° wedges.
const COMPASS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];
export function degToSector(deg) {
  const d = ((Number(deg) || 0) % 360 + 360) % 360;
  const idx = Math.round(d / 22.5) % 16;
  return COMPASS_16[idx];
}

// 8-cardinal map used by the legacy schema. N=0°, NE=45°, ... NW=315°.
export const CARDINAL_TO_DEG = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};
export const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// Human-readable cardinal name for chat-whispers. Maps 8-way short
// codes to spelled-out compass directions ("NE" -> "North East").
export const CARDINAL_FULL = {
  N: "North", NE: "North East", E: "East", SE: "South East",
  S: "South", SW: "South West", W: "West", NW: "North West",
};

// Coarse distance bucket for chat whispers. Three tiers per user
// request: within 1 mile, within 3 miles, within 5 miles. Distances
// beyond 5 miles still classify as "within 5 miles" because the slider
// caps at 10 miles and the whisper is a vibe, not a measurement.
export function coarseDistanceBucket(ft) {
  const f = Math.max(0, Number(ft) || 0);
  if (f <= 5280)  return "close";    // within 1 mile
  if (f <= 15840) return "mid";      // within 3 miles
  return "far";                       // within 5 miles
}

// Attunement-gated maximum detection range. The more attuned items
// of the same Origin the character carries, the further the Sense
// Compass can pick up echoes (standard "progression = more reach"
// pattern, per user direction):
//   1 attuned  -> within 1 mile
//   2 attuned  -> within 3 miles
//   3+ attuned -> within 5 miles (the full slider range)
export function attunementRangeFt(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return 0;
  if (n === 1) return 5280;    // 1 mile
  if (n === 2) return 15840;   // 3 miles
  return 26400;                 // 5 miles
}

// Compass-Tab readout: narrative distance text shown to the player.
// Returns the i18n key suffix that maps to BENEOS.LGC.Compass.Dist.<x>.
// Splits the "close" bucket into "very-close" (<= 0.1 mi) so the
// player gets a stronger cue when the source is right next to them.
export function compassDistanceKey(ft) {
  const f = Math.max(0, Number(ft) || 0);
  if (f <= 528)   return "VeryClose";    // < 0.1 mi
  if (f <= 5280)  return "Close";        // within 1 mi
  if (f <= 15840) return "WithinThree";  // within 3 mi
  return "WithinFive";                    // within 5 mi
}

// Legacy bucket labels — kept for backward-compat with older pings.
const LEGACY_DIST = { close: 5280, mid: 15840, far: 26400 };

// Reader: given any ping document (old or new schema), return a
// normalized {distanceFt, directionDeg}. Used by Sense-Compass + UI.
export function migratePing(p) {
  const distanceFt = (p?.distanceFt != null)
    ? Math.round(Number(p.distanceFt))
    : (LEGACY_DIST[p?.distance] ?? 15840);
  const directionDeg = (p?.directionDeg != null)
    ? ((Number(p.directionDeg) % 360) + 360) % 360
    : (CARDINAL_TO_DEG[p?.direction] ?? 0);
  return { ...p, distanceFt, directionDeg };
}

// Intensity tier from feet — drives Compass animation speed.
// close   <= 1 mi:   needle thrashes, fast pulse
// mid     <= 3 mi:   erratic
// far     <= 5 mi:   subtle quiver
// distant <= 10 mi:  almost still
export function distanceIntensity(ft) {
  const f = Math.max(0, Number(ft) || 0);
  if (f <= 5280)  return "close";
  if (f <= 15840) return "mid";
  if (f <= 26400) return "far";
  return "distant";
}

// Snap an arbitrary mouse-derived angle (0..360) to the nearest 8-way
// cardinal, used by the cardinal quick-pick buttons in the composer.
export function snapToCardinal(deg) {
  const d = ((Number(deg) || 0) % 360 + 360) % 360;
  const idx = Math.round(d / 45) % 8;
  return CARDINALS[idx];
}

// Mouse-event → angle in degrees, N=0, clockwise. Center comes from
// the .dir-cross element's bounding rect.
export function mouseToDeg(ev, crossEl) {
  if (!crossEl) return 0;
  const r = crossEl.getBoundingClientRect();
  const cx = r.left + r.width  / 2;
  const cy = r.top  + r.height / 2;
  const dx = ev.clientX - cx;
  const dy = ev.clientY - cy;
  const rad = Math.atan2(dy, dx);
  // atan2 has 0 pointing east (+x). Convert to 0=N, clockwise.
  let deg = rad * 180 / Math.PI + 90;
  if (deg < 0) deg += 360;
  return deg % 360;
}
