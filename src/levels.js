import { circle, capsule, smoothUnion, smoothSubtract } from './sdf.js';

// Each level is one big pond and one day at it. All 100 ducks are afloat from
// the start; the day ends at sunset (level.duration seconds) and you're rated
// bronze / silver / gold on how many you brought home.
//
//   sdf(x, z)   — negative inside the water (islands carved out with smoothSubtract)
//   logs/weeds  — obstacles; weeds also shelter ducks from wind drift
//   pen         — big holding bay; `facing` is the angle of the fence opening
//   wind        — { angle, speed, sway } gentle steady drift on the ducks
//   stream      — { points, halfWidth, speed } current along a river spine
//   duration    — seconds of daylight
//   duckCount   — ducks afloat at dawn

export const RATING = { bronze: 0.5, silver: 0.75, gold: 1.0 };

export const LEVELS = [
  {
    name: 'Grand Lake',
    seed: 1101,
    bounds: { w: 46, h: 30 },
    sdf: smoothUnion(
      4.0,
      circle(0, 0, 11),
      circle(8.5, 4, 8),
      circle(-9, -3.5, 9),
      circle(2, -7, 7),
    ),
    logs: [
      { x1: -10, z1: 6.0, x2: -5.5, z2: 7.6, r: 0.34 },
      { x1: 6, z1: -9.5, x2: 10.5, z2: -8.0, r: 0.34 },
      { x1: -14.5, z1: -7, x2: -11, z2: -9, r: 0.3 },
    ],
    weeds: [
      { x: -13, z: 2.5, r: 2.4 },
      { x: 12, z: 8, r: 2.0 },
    ],
    pen: { x: 10, z: -5, r: 2.7, facing: 2.68 },
    duration: 210,
    duckCount: 100,
  },
  {
    name: 'Winding Reach',
    seed: 2202,
    bounds: { w: 52, h: 28 },
    sdf: smoothUnion(
      2.6,
      capsule(-22, -6, -10, -8, 4.4),
      capsule(-10, -8, -2, 2, 4.0),
      capsule(-2, 2, 8, 6, 4.0),
      capsule(8, 6, 16, 2, 3.8),
      capsule(16, 2, 22, -4, 3.6),
      circle(4, -4.5, 5.0), // the calm side-bay holding the pen
    ),
    logs: [
      { x1: -14, z1: -4.5, x2: -10.5, z2: -3.2, r: 0.32 },
      { x1: 11, z1: 6.5, x2: 14.5, z2: 5.2, r: 0.3 },
    ],
    weeds: [
      { x: -20, z: -8.5, r: 2.2 },
      { x: 21, z: -5.5, r: 2.2 }, // reed bank where the current peters out
    ],
    pen: { x: 4, z: -7, r: 2.7, facing: 1.45 },
    // gentle current along the river spine; ducks drift past the bay and you
    // flick them out of the flow as they go by
    stream: {
      points: [
        { x: -22, z: -6 }, { x: -10, z: -8 }, { x: -2, z: 2 },
        { x: 8, z: 6 }, { x: 16, z: 2 }, { x: 21, z: -3.5 },
      ],
      halfWidth: 4.2,
      speed: 0.42,
    },
    duration: 240,
    duckCount: 100,
  },
  {
    name: 'Skerry Waters',
    seed: 3303,
    bounds: { w: 44, h: 30 },
    sdf: smoothSubtract(
      1.6,
      smoothUnion(
        3.5,
        circle(0, 0, 12.5),
        circle(8, 4, 8),
        circle(-9, -3, 8.5),
      ),
      circle(-2, 2, 2.1), // skerries — little islands that waves bounce off
      circle(6, -4, 1.8),
      circle(-9.5, 4.5, 1.6),
    ),
    logs: [
      { x1: -4, z1: -8.5, x2: 0, z2: -9.5, r: 0.32 },
    ],
    weeds: [
      { x: -14.5, z: -1, r: 2.2 },
      { x: 2, z: 9, r: 2.0 },
    ],
    pen: { x: 11.5, z: -3.5, r: 2.7, facing: 2.85 },
    // a steady westerly threads between the islands, pushing the flock east
    wind: { angle: 0.15, speed: 0.2, sway: 0.35 },
    duration: 240,
    duckCount: 100,
  },
  {
    name: 'Mallard Marsh',
    seed: 4404,
    bounds: { w: 46, h: 32 },
    sdf: smoothUnion(
      2.0,
      circle(-13, -8, 6.5),
      circle(9, -9, 6.8),
      circle(13, 8, 6.2),
      circle(-11, 9, 6.0),
      circle(0, 0, 4.5),
      capsule(-13, -8, 0, 0, 2.5),
      capsule(9, -9, 0, 0, 2.5),
      capsule(13, 8, 0, 0, 2.5),
      capsule(-11, 9, 0, 0, 2.5),
    ),
    logs: [
      { x1: -4.5, z1: -5, x2: -2, z2: -3, r: 0.3 },
      { x1: 4, z1: 3.5, x2: 6.5, z2: 5, r: 0.3 },
    ],
    weeds: [
      { x: -13, z: -10, r: 2.6 },
      { x: 11, z: -11, r: 2.4 },
      { x: -13, z: 11, r: 2.4 },
      { x: 1.5, z: -1.5, r: 2.0 },
      { x: 15, z: 5.5, r: 2.2 },
    ],
    // light northerly: ducks drift south unless parked in sheltering weeds
    wind: { angle: Math.PI / 2 + 0.15, speed: 0.13, sway: 0.45 },
    pen: { x: 12, z: 10, r: 2.7, facing: -2.1 },
    duration: 270,
    duckCount: 100,
  },
];

// Sample the stream's water velocity at a point (zero off the channel).
export function streamFlowAt(stream, x, z, out) {
  out.x = 0;
  out.z = 0;
  if (!stream) return out;
  const pts = stream.points;
  let best = Infinity, bx = 0, bz = 0, tx = 0, tz = 0, endFade = 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bx = px; bz = pz;
      const l = Math.sqrt(len2);
      tx = dx / l; tz = dz / l;
      // the current dies away near the very end of the spine (the reed pool)
      endFade = i === pts.length - 2 ? 1 - Math.max(0, t - 0.6) / 0.4 : 1;
    }
  }
  if (best > stream.halfWidth) return out;
  const fall = 1 - (best / stream.halfWidth) ** 2; // fastest mid-channel
  out.x = tx * stream.speed * fall * endFade;
  out.z = tz * stream.speed * fall * endFade;
  return out;
}

// Later rounds revisit the ponds with shorter days and brisker wind.
export function getLevel(index) {
  const round = Math.floor(index / LEVELS.length);
  const base = LEVELS[index % LEVELS.length];
  if (round === 0) return base;
  return {
    ...base,
    name: `${base.name} ${['II', 'III', 'IV', 'V'][Math.min(round - 1, 3)] || `+${round}`}`,
    duration: Math.max(120, base.duration - round * 20),
    wind: base.wind
      ? { ...base.wind, speed: base.wind.speed * (1 + round * 0.25) }
      : round >= 2
        ? { angle: (index * 1.7) % (Math.PI * 2), speed: 0.1 + round * 0.03, sway: 0.4 }
        : undefined,
    stream: base.stream
      ? { ...base.stream, speed: base.stream.speed * (1 + round * 0.2) }
      : undefined,
  };
}
