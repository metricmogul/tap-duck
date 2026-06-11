import { circle, capsule, smoothUnion } from './sdf.js';

// Each level is one pond.
//   sdf(x, z)      — negative inside the water
//   bounds         — world extent the camera frames (pond + grassy margin)
//   logs           — capsules lying in the water; waves bounce off them, ducks bump into them
//   weeds          — circles of lily pads / weed that damp waves and slow ducks
//   pen            — circular holding area; `facing` is the angle (radians) of the
//                    fence opening, pointing toward open water
//   target         — ducks to pen to clear the level
//   spawnInterval  — seconds between duck deliveries
//   startDucks     — ducks afloat when the level begins
//   maxDucks       — hard cap of ducks on the pond

export const LEVELS = [
  {
    name: 'Lily Pond',
    seed: 101,
    bounds: { w: 21, h: 14.5 },
    sdf: smoothUnion(
      2.2,
      circle(0, 0, 5.0),
      circle(3.1, 1.1, 3.5),
      circle(-3.4, -0.9, 3.7),
    ),
    logs: [],
    weeds: [
      { x: -4.6, z: 2.6, r: 1.5 },
    ],
    pen: { x: 4.2, z: -1.6, r: 1.9, facing: Math.PI * 0.88 },
    target: 6,
    spawnInterval: 14,
    startDucks: 3,
    maxDucks: 12,
  },
  {
    name: 'Bramble Bend',
    seed: 202,
    bounds: { w: 23, h: 15.5 },
    sdf: smoothUnion(
      2.6,
      circle(-3.8, -2.0, 4.2),
      circle(4.0, 2.2, 4.2),
      circle(0.4, 0.2, 3.0),
    ),
    logs: [
      { x1: -1.2, z1: 2.8, x2: 2.6, z2: 1.4, r: 0.32 },
    ],
    weeds: [
      { x: -5.6, z: 0.8, r: 1.6 },
      { x: 5.2, z: -0.6, r: 1.3 },
    ],
    pen: { x: -5.4, z: -4.4, r: 1.9, facing: Math.PI * 0.32 },
    target: 8,
    spawnInterval: 13,
    startDucks: 4,
    maxDucks: 14,
  },
  {
    name: 'Hourglass Hollow',
    seed: 303,
    bounds: { w: 25, h: 14.5 },
    sdf: smoothUnion(
      1.6,
      circle(-4.8, 0.2, 4.3),
      circle(4.8, -0.2, 4.3),
      capsule(-2.5, 0, 2.5, 0, 1.6),
    ),
    logs: [
      { x1: -0.4, z1: -3.0, x2: 0.6, z2: -1.7, r: 0.3 },
      { x1: -6.8, z1: 3.0, x2: -4.2, z2: 3.8, r: 0.3 },
    ],
    weeds: [
      { x: 4.4, z: 2.6, r: 1.5 },
      { x: -7.2, z: -1.8, r: 1.2 },
    ],
    pen: { x: 7.6, z: -1.6, r: 1.9, facing: Math.PI * 0.92 },
    target: 10,
    spawnInterval: 12,
    startDucks: 4,
    maxDucks: 16,
  },
  {
    name: 'Old Mill Reach',
    seed: 404,
    bounds: { w: 23, h: 17 },
    sdf: smoothUnion(
      2.0,
      capsule(-5.2, -3.6, 4.6, -3.6, 3.3),
      capsule(4.6, -3.6, 4.6, 3.8, 3.1),
      circle(-5.6, -3.2, 3.0),
    ),
    logs: [
      { x1: 1.0, z1: -4.8, x2: 3.4, z2: -3.4, r: 0.32 },
      { x1: 5.6, z1: 0.2, x2: 4.0, z2: 1.8, r: 0.3 },
      { x1: -3.8, z1: -1.6, x2: -1.6, z2: -2.4, r: 0.28 },
    ],
    weeds: [
      { x: -6.8, z: -4.6, r: 1.6 },
      { x: 6.2, z: -4.6, r: 1.2 },
      { x: 3.4, z: 3.6, r: 1.3 },
    ],
    pen: { x: 4.6, z: 4.6, r: 1.9, facing: -Math.PI * 0.5 },
    target: 12,
    spawnInterval: 11,
    startDucks: 5,
    maxDucks: 18,
  },
];

// After the last pond the game loops, getting a touch busier each round.
export function getLevel(index) {
  const round = Math.floor(index / LEVELS.length);
  const base = LEVELS[index % LEVELS.length];
  if (round === 0) return base;
  return {
    ...base,
    name: `${base.name} ${['II', 'III', 'IV', 'V'][Math.min(round - 1, 3)] || `+${round}`}`,
    target: base.target + round * 3,
    spawnInterval: Math.max(7, base.spawnInterval - round * 1.5),
    startDucks: Math.min(base.maxDucks - 2, base.startDucks + round),
    maxDucks: base.maxDucks + round * 2,
  };
}
