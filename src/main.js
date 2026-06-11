import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getLevel, RATING } from './levels.js';
import { WaterSim, WaterMesh } from './water.js';
import { Terrain } from './terrain.js';
import { DuckFlock } from './ducks.js';
import { ui } from './ui.js';
import * as audio from './audio.js';

// ---------------------------------------------------------------------------
// renderer / scene

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc28a);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a8a4f, 0.75);
scene.add(hemi);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 300);

// ---------------------------------------------------------------------------
// the day: lighting keyframes from morning through golden hour to dusk

const DAY_KEYS = [
  { t: 0.0, sun: 0xffeccb, ints: 2.3, elev: 38, az: -50, skyH: 0xbfe3f2, skyL: 0xe8f4e0, hemi: 0.8, bg: 0x9cc28a, env: 0.55 },
  { t: 0.45, sun: 0xfff3da, ints: 2.6, elev: 62, az: -10, skyH: 0xc4e8f7, skyL: 0xeaf6e2, hemi: 0.85, bg: 0xa3c890, env: 0.6 },
  { t: 0.8, sun: 0xffc26e, ints: 2.1, elev: 22, az: 30, skyH: 0xf2cf9a, skyL: 0xf7e3c0, hemi: 0.62, bg: 0x9aa86f, env: 0.45 },
  { t: 1.0, sun: 0xff9466, ints: 1.35, elev: 8, az: 48, skyH: 0xb88fb4, skyL: 0xe8b48a, hemi: 0.42, bg: 0x75836e, env: 0.3 },
];
const DAY_COLORS = DAY_KEYS.map((k) => ({
  sun: new THREE.Color(k.sun),
  skyH: new THREE.Color(k.skyH),
  skyL: new THREE.Color(k.skyL),
  bg: new THREE.Color(k.bg),
}));
const GOLDEN_HOUR = 25; // final seconds of double points

const cSun = new THREE.Color();
const cSkyH = new THREE.Color();
const cSkyL = new THREE.Color();
const cBg = new THREE.Color();
const sunDir = new THREE.Vector3(0.3, 0.8, 0.5).normalize();

function applyDaylight(frac) {
  let i = 0;
  while (i < DAY_KEYS.length - 2 && frac > DAY_KEYS[i + 1].t) i++;
  const a = DAY_KEYS[i], b = DAY_KEYS[i + 1];
  const ca = DAY_COLORS[i], cb = DAY_COLORS[i + 1];
  const k = THREE.MathUtils.clamp((frac - a.t) / (b.t - a.t), 0, 1);

  cSun.lerpColors(ca.sun, cb.sun, k);
  cSkyH.lerpColors(ca.skyH, cb.skyH, k);
  cSkyL.lerpColors(ca.skyL, cb.skyL, k);
  cBg.lerpColors(ca.bg, cb.bg, k);

  const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a.elev, b.elev, k));
  const az = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a.az, b.az, k));
  sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az));

  sun.color.copy(cSun);
  sun.intensity = THREE.MathUtils.lerp(a.ints, b.ints, k);
  sun.position.copy(sunDir).multiplyScalar(40);
  hemi.intensity = THREE.MathUtils.lerp(a.hemi, b.hemi, k);
  scene.background.copy(cBg);
  scene.environmentIntensity = THREE.MathUtils.lerp(a.env, b.env, k);

  if (game.water) {
    const u = game.water.material.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSkyHigh.value.copy(cSkyH);
    u.uSkyLow.value.copy(cSkyL);
  }
}

// ---------------------------------------------------------------------------
// camera framing, pan and zoom

const camTarget = new THREE.Vector3();
const CAM_ELEV = THREE.MathUtils.degToRad(64);
const camDir = new THREE.Vector3(0, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV));
let fitDist = 30; // distance that frames the whole pond
let zoomFrac = 0.5; // current zoom as a fraction of fitDist
let camDist = 15;

function fitCamera(rect) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const corners = [
    new THREE.Vector3(rect.minX, 0, rect.minZ),
    new THREE.Vector3(rect.maxX, 0, rect.minZ),
    new THREE.Vector3(rect.minX, 0, rect.maxZ),
    new THREE.Vector3(rect.maxX, 0, rect.maxZ),
  ];
  let lo = 4, hi = 200;
  const v = new THREE.Vector3();
  const probe = new THREE.Vector3(cx, 0, cz);
  for (let it = 0; it < 26; it++) {
    const mid = (lo + hi) / 2;
    camera.position.copy(probe).addScaledVector(camDir, mid);
    camera.lookAt(probe);
    camera.updateMatrixWorld();
    let fits = true;
    for (const c of corners) {
      v.copy(c).project(camera);
      if (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.82) { fits = false; break; }
    }
    if (fits) hi = mid; else lo = mid;
  }
  fitDist = hi;
}

function pondRect(sim) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let j = 0; j < sim.gh; j++) {
    for (let i = 0; i < sim.gw; i++) {
      if (sim.shore[j * sim.gw + i] >= 0) continue;
      const x = (i + 0.5) * sim.cellX - sim.worldW / 2;
      const z = (j + 0.5) * sim.cellZ - sim.worldH / 2;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  const pad = 1.6;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

function clampTarget() {
  const r = game.rect;
  if (!r) return;
  camTarget.x = Math.min(Math.max(camTarget.x, r.minX), r.maxX);
  camTarget.z = Math.min(Math.max(camTarget.z, r.minZ), r.maxZ);
}

function setZoom(frac) {
  zoomFrac = THREE.MathUtils.clamp(frac, 0.16, 1.0);
}

// ---------------------------------------------------------------------------
// game state

const game = {
  state: 'intro', // intro | playing | dayEnd
  levelIndex: 0,
  level: null,
  sim: null,
  water: null,
  terrain: null,
  flock: null,
  rect: null,
  score: 0,
  elapsed: 0,
  flockCount: 0,
  flockTimer: 0,
  goldenToast: false,
  windAngle: 0,
  windVec: { x: 0, z: 0 },
};

function bestKey(index) { return `tapduck_best_${index % 4}`; }
function loadBest(index) {
  try { return parseInt(localStorage.getItem(bestKey(index)), 10) || 0; } catch { return 0; }
}
function saveBest(index, stars) {
  try {
    if (stars > loadBest(index)) localStorage.setItem(bestKey(index), String(stars));
  } catch { /* private browsing */ }
}

function buildLevel(index) {
  game.levelIndex = index;
  game.level = getLevel(index);
  game.elapsed = 0;
  game.flockCount = 0;
  game.flockTimer = 0;
  game.goldenToast = false;

  game.sim = new WaterSim(game.level);
  game.water = new WaterMesh(game.sim, sunDir);
  game.terrain = new Terrain(game.level);
  game.flock = new DuckFlock(scene, game.level, game.sim);
  scene.add(game.terrain.group, game.water.mesh);
  game.flock.spawnInitial(game.level.duckCount);

  const b = game.level.bounds;
  sun.shadow.camera.left = -b.w * 0.75;
  sun.shadow.camera.right = b.w * 0.75;
  sun.shadow.camera.top = b.h * 0.75;
  sun.shadow.camera.bottom = -b.h * 0.75;
  sun.shadow.camera.updateProjectionMatrix();

  game.rect = pondRect(game.sim);
  fitCamera(game.rect);
  camTarget.set((game.rect.minX + game.rect.maxX) / 2, 0, (game.rect.minZ + game.rect.maxZ) / 2);
  setZoom(0.5);
  camDist = fitDist * zoomFrac;

  ui.setLevelName(game.level.name);
  ui.setBest(loadBest(index));
  ui.setProgress(0, game.flock.baseTotal);
  ui.setWind(game.level.wind ? game.level.wind.angle : 0, game.level.wind ? game.level.wind.speed : 0);
  applyDaylight(0);
}

function teardownLevel() {
  if (!game.level) return;
  scene.remove(game.terrain.group, game.water.mesh);
  game.flock.dispose();
  game.terrain.dispose();
  game.water.dispose();
}

// ---------------------------------------------------------------------------
// input: tap / stroke / pan / pinch / wheel

const raycaster = new THREE.Raycaster();
const tapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const groundA = new THREE.Vector3();
const groundB = new THREE.Vector3();

function screenToGround(cx, cy, out) {
  ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(tapPlane, out);
}

const tapHistory = [];
const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
const rings = [];

function spawnRing(x, z, mult) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(ringGeo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.06, z);
  mesh.scale.setScalar(0.25);
  mesh.renderOrder = 6;
  mesh.userData.mult = mult;
  scene.add(mesh);
  rings.push({ mesh, t: 0 });
}

function doTap(cx, cy) {
  if (game.state !== 'playing') return;
  if (!screenToGround(cx, cy, hit)) return;
  const x = hit.x, z = hit.z;
  if (game.level.sdf(x, z) > 0.2) return;

  const now = performance.now() / 1000;
  for (let i = tapHistory.length - 1; i >= 0; i--) {
    if (now - tapHistory[i].t > 1.7) tapHistory.splice(i, 1);
  }
  let nearby = 0;
  for (const t of tapHistory) {
    if (Math.hypot(t.x - x, t.z - z) < 1.4) nearby++;
  }
  tapHistory.push({ x, z, t: now });

  const mult = 1 + 0.45 * Math.min(nearby, 5);
  game.sim.splash(x, z, 0.62 + nearby * 0.06, 0.3 * mult);
  spawnRing(x, z, mult);
  audio.plop(mult);
}

// gesture recognition:
//   quick press            -> tap
//   quick drag             -> stroke (a wake follows your finger)
//   hold still, then drag  -> pan; right/middle mouse drag also pans
//   two fingers            -> pan + pinch zoom; extra fingers tap
const HOLD_MS = 260;
const SLOP = 14;
const pointers = new Map();
let gesture = null;

function panBy(fromX, fromY, toX, toY) {
  const a = screenToGround(fromX, fromY, groundA);
  const b = screenToGround(toX, toY, groundB);
  if (a && b) {
    camTarget.x += groundA.x - groundB.x;
    camTarget.z += groundA.z - groundB.z;
    clampTarget();
  }
}

function strokeBegin(x, y, ts) {
  gesture.lastW = new THREE.Vector3();
  if (!screenToGround(x, y, gesture.lastW)) gesture.lastW.set(0, 0, 0);
  gesture.lastT = ts;
  audio.strokeStart();
}

function strokeStep(cx, cy, ts) {
  if (!screenToGround(cx, cy, hit)) return;
  const dtm = Math.max((ts - gesture.lastT) / 1000, 0.008);
  const dx = hit.x - gesture.lastW.x;
  const dz = hit.z - gesture.lastW.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.18) return;
  const speed = Math.min(dist / dtm, 12);
  audio.strokeMove(speed);
  // lay small displacements along the path; faster strokes dig harder.
  // moving faster than the wave speed (~3 m/s) raises a real Kelvin wake.
  const steps = Math.min(Math.ceil(dist / 0.3), 12);
  const strength = THREE.MathUtils.clamp(0.05 + speed * 0.018, 0.06, 0.2);
  for (let i = 1; i <= steps; i++) {
    const px = gesture.lastW.x + (dx * i) / steps;
    const pz = gesture.lastW.z + (dz * i) / steps;
    if (game.level.sdf(px, pz) < 0.1) game.sim.splash(px, pz, 0.42, strength);
  }
  gesture.lastW.copy(hit);
  gesture.lastT = ts;
}

function pinchInit() {
  const [p1, p2] = [...pointers.values()];
  return {
    mode: 'pinch',
    midX: (p1.x + p2.x) / 2,
    midY: (p1.y + p2.y) / 2,
    spread: Math.max(Math.hypot(p1.x - p2.x, p1.y - p2.y), 1),
  };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (game.state !== 'playing') return;
  renderer.domElement.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (e.pointerType === 'mouse' && e.button !== 0) {
    gesture = { mode: 'pan', id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    return;
  }
  if (pointers.size === 1) {
    gesture = {
      mode: 'pending', id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      t0: e.timeStamp, // generation time — immune to frame-processing lag
    };
  } else if (pointers.size === 2) {
    if (gesture && gesture.mode === 'stroke') audio.strokeEnd();
    gesture = pinchInit();
  } else {
    doTap(e.clientX, e.clientY); // third finger: just splash
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (!gesture) return;

  if (gesture.mode === 'pinch') {
    if (pointers.size < 2) return;
    const [p1, p2] = [...pointers.values()];
    const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    const spread = Math.max(Math.hypot(p1.x - p2.x, p1.y - p2.y), 1);
    panBy(gesture.midX, gesture.midY, midX, midY);
    setZoom(zoomFrac * gesture.spread / spread);
    gesture.midX = midX; gesture.midY = midY; gesture.spread = spread;
    return;
  }
  if (gesture.id !== e.pointerId) return;

  if (gesture.mode === 'pending') {
    const moved = Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0);
    if (moved > SLOP) {
      if (e.timeStamp - gesture.t0 < HOLD_MS) {
        gesture.mode = 'stroke';
        strokeBegin(gesture.x0, gesture.y0, e.timeStamp);
      } else {
        gesture.mode = 'pan';
      }
    }
  }
  if (gesture.mode === 'stroke') strokeStep(e.clientX, e.clientY, e.timeStamp);
  else if (gesture.mode === 'pan') panBy(gesture.lastX, gesture.lastY, e.clientX, e.clientY);
  gesture.lastX = e.clientX;
  gesture.lastY = e.clientY;
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.mode === 'pinch') {
    if (pointers.size === 1) {
      const [[id, p]] = [...pointers.entries()];
      gesture = { mode: 'pan', id, lastX: p.x, lastY: p.y };
    } else if (pointers.size === 0) {
      gesture = null;
    }
    return;
  }
  if (gesture.id !== e.pointerId) return;
  if (gesture.mode === 'pending' && e.type === 'pointerup'
    && e.timeStamp - gesture.t0 < 320) {
    doTap(gesture.x0, gesture.y0);
  }
  if (gesture.mode === 'stroke') audio.strokeEnd();
  gesture = null;
}
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  setZoom(zoomFrac * Math.exp(e.deltaY * 0.001));
}, { passive: false });

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// scoring

function isGoldenHour() {
  return game.level.duration - game.elapsed <= GOLDEN_HOUR;
}

function handleCaptures(captured) {
  for (const d of captured) {
    game.flockCount++;
    game.flockTimer = 2.0;
    let points = d.variant.points + Math.min((game.flockCount - 1) * 5, 60);
    if (isGoldenHour()) points *= 2;
    game.score += points;
    audio.squeak(Math.min(game.flockCount, 8));
    const where = new THREE.Vector3(d.x, 0.5, d.z);
    const gold = d.variant.name === 'golden' || isGoldenHour();
    ui.floater(`+${points}`, where, camera, gold ? '#ffe27a' : undefined);
  }
  if (captured.length) {
    if (game.flockCount === 4 || game.flockCount === 8 || game.flockCount === 14) {
      ui.toast(`Flock of ${game.flockCount}!`);
    }
    ui.setScore(game.score);
    ui.setProgress(Math.min(game.flock.clearedBase, game.flock.baseTotal), game.flock.baseTotal);
  }
}

function endDay() {
  game.state = 'dayEnd';
  audio.fanfare();
  const total = game.flock.baseTotal;
  const cleared = Math.min(game.flock.clearedBase, total);
  const stars = cleared >= total * RATING.gold ? 3
    : cleared >= total * RATING.silver ? 2
      : cleared >= total * RATING.bronze ? 1 : 0;
  const isBest = stars > loadBest(game.levelIndex);
  saveBest(game.levelIndex, stars);
  setTimeout(() => {
    ui.showDayEnd(
      { levelName: game.level.name, cleared, total, stars, score: game.score, isBest },
      () => {
        teardownLevel();
        buildLevel(game.levelIndex + 1);
        game.state = 'playing';
      },
    );
  }, 800);
}

// ---------------------------------------------------------------------------
// main loop

const clock = new THREE.Clock();
let simAccum = 0;
let breezeTimer = 3;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (game.level) {
    simAccum += dt;
    let steps = 0;
    while (simAccum >= 1 / 60 && steps < 4) {
      game.sim.step();
      simAccum -= 1 / 60;
      steps++;
    }
    if (steps === 4) simAccum = 0;

    // wind: steady with a slow sway in direction and strength
    const wind = game.level.wind;
    if (wind) {
      game.windAngle = wind.angle
        + Math.sin(time * 0.17) * wind.sway * 0.5
        + Math.sin(time * 0.043 + 1.7) * wind.sway * 0.5;
      const spd = wind.speed * (0.75 + 0.25 * Math.sin(time * 0.11 + 3));
      game.windVec.x = Math.cos(game.windAngle) * spd;
      game.windVec.z = Math.sin(game.windAngle) * spd;
      game.flock.wind = game.windVec;
      if (game.state === 'playing') ui.setWind(game.windAngle, spd);
    } else {
      game.flock.wind.x = 0;
      game.flock.wind.z = 0;
    }

    // breeze gusts ruffle the surface, biased downwind
    breezeTimer -= dt;
    if (breezeTimer <= 0) {
      breezeTimer = 2.0 + Math.random() * 3.5;
      const spot = game.flock.findOpenSpot();
      if (spot) game.sim.splash(spot.x, spot.z, 1.6, 0.012 + (wind ? wind.speed * 0.02 : 0));
    }

    const captured = game.flock.update(dt, time);

    if (game.state === 'playing') {
      game.elapsed += dt;
      handleCaptures(captured);
      if (game.flock.dropSplashes > 0) audio.plop(0.7);

      game.flockTimer -= dt;
      if (game.flockTimer <= 0) game.flockCount = 0;

      const timeLeft = game.level.duration - game.elapsed;
      if (!game.goldenToast && timeLeft <= GOLDEN_HOUR) {
        game.goldenToast = true;
        ui.toast('Golden hour — double points!', 'gold');
        audio.chime();
      }

      // cleared the pond early? a bonus flock of golden ducks tips in
      if (game.flock.clearedBase >= game.flock.baseTotal
        && game.flock.afloatCount === 0 && timeLeft > 8) {
        const n = game.flock.spawnBonus(10);
        if (n > 0) {
          ui.toast('Bonus flock — golden ducks!', 'gold');
          audio.pop();
        }
      }

      ui.setClock(timeLeft, game.elapsed / game.level.duration, isGoldenHour());
      applyDaylight(Math.min(game.elapsed / game.level.duration, 1));
      if (timeLeft <= 0) endDay();
    }

    game.water.update(time);
    game.terrain.update(time, game.sim);
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.t += dt;
    const k = r.t / 0.5;
    if (k >= 1) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      rings.splice(i, 1);
    } else {
      r.mesh.scale.setScalar(0.25 + k * 1.5 * r.mesh.userData.mult);
      r.mesh.material.opacity = 0.55 * (1 - k);
    }
  }

  camDist += (fitDist * zoomFrac - camDist) * Math.min(1, dt * 9);
  camera.position.copy(camTarget).addScaledVector(camDir, camDist);
  if (!gesture || gesture.mode === 'pending') {
    camera.position.x += Math.sin(time * 0.13) * 0.12;
    camera.position.z += Math.cos(time * 0.09) * 0.08;
  }
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (game.rect) fitCamera(game.rect);
});

// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const startLevel = Math.max(0, parseInt(params.get('level'), 10) || 0);
if (params.has('debug')) window.__tapduck = game;
buildLevel(startLevel);
ui.setScore(0);
ui.showIntro(() => {
  audio.ensure();
  game.state = 'playing';
});
animate();
