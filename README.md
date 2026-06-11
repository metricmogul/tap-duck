# Tap Duck 🦆

A cosy browser game. Plastic ducks have escaped onto the pond — tap the
water to send out ripples and gently herd them into the wooden pen.

## How it plays

- **Tap the pond** to heave up a mound of water that collapses into a
  travelling ripple ring. The water is a real height-field wave simulation:
  ripples propagate, reflect off the shoreline and floating logs, and die
  away in the weed beds.
- **Ducks ride the waves.** Wave crests shove them down their leading face —
  exactly the field you can see is the field that pushes them.
- **Tap the same spot quickly** to stack ripples into bigger waves.
- **Herd ducks into the glowing pen** to score. Chained captures build a
  combo. Keep an eye out for rare pink (25) and golden (50) ducks.
- **A countdown shows when the next ducks arrive** — and the more ducks
  still afloat, the more get delivered. Clear the pond before it crowds.
- Four ponds — Lily Pond, Bramble Bend, Hourglass Hollow and Old Mill
  Reach — each a different shape with its own logs, weeds and pen, then
  the loop continues at a brisker pace.

The whole pond always fits on one screen, so every duck stays in view.
Works with mouse or touch.

## Running it

```bash
npm install
npm run dev      # local dev server
npm run build    # static build in dist/
npm run preview  # serve the build
```

Handy during development: `?level=N` starts on pond N (0–3), and
`?debug=1` exposes the game state as `window.__tapduck`.

## How it's made

- [Three.js](https://threejs.org/) for rendering; no other runtime deps.
- `src/water.js` — CPU wave-equation simulation on a grid, shared by the
  water shader (height texture → displaced surface, fresnel sky
  reflection, shoreline foam, sun glints) and the duck physics.
- `src/levels.js` + `src/sdf.js` — ponds are signed-distance fields, used
  for the sim boundary, duck collision, terrain basin and ground texture.
- `src/terrain.js` — displaced ground plane forms the banks and pond bed;
  grass/sand/mud, stones, reeds, lily pads, bark-textured logs and the pen
  fence are all generated procedurally.
- `src/ducks.js` — clearcoat plastic ducks built from primitives; they bob,
  tilt with the wave normal and steer to face their motion.
- `src/audio.js` — every sound (plops, rubber-duck squeaks, birdsong,
  ambience) is synthesised with WebAudio; there are no asset files at all.
