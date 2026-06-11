# Tap Duck 🦆

A cosy browser game. A hundred plastic ducks are adrift on the pond —
ripple the water and bring as many home to the pen as you can before the
sun sets.

## How it plays

- **Tap the pond** to raise a ripple ring; tap the same spot quickly to
  stack bigger waves. **Swipe** to carve a wake behind your finger — move
  faster than the waves (~3 m/s) and you get a real Kelvin wake, like a
  little speedboat.
- The water is a height-field wave simulation: ripples cross the whole
  pond, bounce off the banks, logs and islands, fade in the weed beds, and
  push the ducks by wave momentum (−∂u/∂t·∇u) — reflected waves shove
  ducks on the way back too.
- **One level is one day.** The light wanders from morning through noon
  into a warm dusk; when the sun sets you're rated bronze / silver / gold
  (50 / 75 / 100 ducks home) and move on. The final 25 seconds are the
  **golden hour** — every capture pays double. Clear all 100 early and a
  bonus flock of golden ducks tips in.
- Sweep several ducks into the pen on one wave for **flock bonuses**, and
  keep captures coming to build the **chain multiplier** (×2–×5, cools off
  if you go quiet). Bounce a duck off a log into the pen for a **bank
  shot**; send one in from across the pond for a **long drive**. Rare pink
  (25) and golden (50) ducks pay more — but goldens flee your waves.
- The flock has personalities: **mama ducks** trail broods of ducklings
  (pen the mama and the brood follows her in) and **sleepy ducks** doze
  through ripples until a proper wave wakes them.
- The day has a cast and a diary: **a goose** crash-lands mid-morning and
  barges honking through your rafts — panic it with a big wave and shove
  it home for a fat bonus. **Bread tosses** cluster ducks for fifteen
  seconds; **rain showers** pay 1.5× while they last; a frog potters
  between the lily pads.
- Some ponds have weather: a **steady wind** that drifts the flock (weed
  beds give shelter), or a **river current** that carries ducks past the
  pen's calm side-bay — flick them out of the flow as they pass.

Four ponds: **Grand Lake** (calm), **Winding Reach** (the river),
**Skerry Waters** (islands and a crosswind), **Mallard Marsh** (weedy
pool maze with a light breeze) — then the days get shorter and the wind
picks up.

### Controls

| Gesture | Action |
| --- | --- |
| Tap | Ripple |
| Quick drag | Stroke a wake |
| Hold still, then drag | Pan around the pond |
| Two fingers / right-drag | Pan |
| Pinch / scroll wheel | Zoom |

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

- [Three.js](https://threejs.org/) for rendering; no other runtime deps,
  no asset files — every texture and sound is generated procedurally.
- `src/water.js` — CPU wave-equation sim shared by the water shader and
  the duck physics. Taps are volume-neutral (a mound ringed by a trough)
  so sustained tapping can't raise the pond's level.
- `src/ducks.js` — the whole flotilla is three `InstancedMesh` draw calls
  (bodies, beaks, eyes) regardless of duck count. Ducks bob, wobble on an
  underdamped tilt spring, and steer to face their motion.
- `src/levels.js` + `src/sdf.js` — ponds are signed-distance fields;
  islands are carved with smooth subtraction; the river current is a flow
  field along a polyline spine.
- `src/terrain.js` — displaced ground plane (banks, basin, islands) with
  painted grass/sand/mud, stones, reeds, lily pads, logs, the pen fence.
- `src/main.js` — day-cycle lighting keyframes, gesture recognition
  (tap / stroke / pan / pinch), scoring and ratings.
- `src/audio.js` — WebAudio synthesis: plops, squeaks, the stroke swoosh,
  birdsong and chimes.
