import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getLevel } from './levels.js';
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

const sunDir = new THREE.Vector3(5, 11, 4).normalize();
const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.copy(sunDir).multiplyScalar(22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a8a4f, 0.75));

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 200);

// The whole pond always fits on screen (no scrolling — keeps it cosy and
// every duck visible). Binary-search the camera distance until the level
// bounds fit comfortably inside the frustum.
const CAM_ELEV = THREE.MathUtils.degToRad(64);
const camDir = new THREE.Vector3(0, Math.sin(CAM_ELEV), Math.cos(CAM_ELEV));
const camTarget = new THREE.Vector3();
let camDist = 20;

// Frame the actual water (plus a sliver of bank), not the whole level bounds,
// and leave headroom for the HUD cards at the top and bottom of the screen.
function fitCamera(rect) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  camTarget.set((rect.minX + rect.maxX) / 2, 0, (rect.minZ + rect.maxZ) / 2);
  const corners = [
    new THREE.Vector3(rect.minX, 0, rect.minZ),
    new THREE.Vector3(rect.maxX, 0, rect.minZ),
    new THREE.Vector3(rect.minX, 0, rect.maxZ),
    new THREE.Vector3(rect.maxX, 0, rect.maxZ),
  ];
  let lo = 4, hi = 120;
  const v = new THREE.Vector3();
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    camera.position.copy(camTarget).addScaledVector(camDir, mid);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    let fits = true;
    for (const c of corners) {
      v.copy(c).project(camera);
      if (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.82) { fits = false; break; }
    }
    if (fits) hi = mid; else lo = mid;
  }
  camDist = hi;
}

// Bounding rectangle of the water itself, scanned from the sim grid.
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
  const pad = 1.6; // a strip of bank so pens and reeds stay in frame
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

// ---------------------------------------------------------------------------
// level lifecycle

const game = {
  state: 'intro', // intro | playing | done
  levelIndex: 0,
  level: null,
  sim: null,
  water: null,
  terrain: null,
  flock: null,
  score: 0,
  penned: 0,
  combo: 0,
  lastCaptureAt: -10,
  spawnTimer: 0,
};

function buildLevel(index) {
  game.levelIndex = index;
  game.level = getLevel(index);
  game.penned = 0;
  game.combo = 0;
  game.spawnTimer = game.level.spawnInterval;

  game.sim = new WaterSim(game.level);
  game.water = new WaterMesh(game.sim, sunDir);
  game.terrain = new Terrain(game.level);
  game.flock = new DuckFlock(scene, game.level, game.sim);
  scene.add(game.terrain.group, game.water.mesh);
  game.flock.spawn(game.level.startDucks);

  const b = game.level.bounds;
  sun.shadow.camera.left = -b.w * 0.75;
  sun.shadow.camera.right = b.w * 0.75;
  sun.shadow.camera.top = b.h * 0.75;
  sun.shadow.camera.bottom = -b.h * 0.75;
  sun.shadow.camera.updateProjectionMatrix();

  game.rect = pondRect(game.sim);
  fitCamera(game.rect);
  ui.setLevelName(game.level.name);
  ui.setProgress(0, game.level.target);
}

function teardownLevel() {
  if (!game.level) return;
  scene.remove(game.terrain.group, game.water.mesh);
  game.flock.dispose();
  game.terrain.dispose();
  game.water.dispose();
}

// ---------------------------------------------------------------------------
// tapping

const raycaster = new THREE.Raycaster();
const tapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();

// recent taps; tapping the same spot repeatedly builds bigger waves
const tapHistory = [];

const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
const rings = []; // { mesh, t }

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

function onTap(e) {
  if (game.state !== 'playing') return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(tapPlane, hit)) return;
  const x = hit.x, z = hit.z;
  if (game.level.sdf(x, z) > 0.2) return; // tapped the grass

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
  game.sim.splash(x, z, 0.5 + nearby * 0.05, 0.16 * mult);
  spawnRing(x, z, mult);
  audio.plop(mult);
}

renderer.domElement.addEventListener('pointerdown', onTap);

// ---------------------------------------------------------------------------
// scoring & spawning

function handleCaptures(captured) {
  const now = performance.now() / 1000;
  for (const d of captured) {
    game.combo = now - game.lastCaptureAt < 2.5 ? game.combo + 1 : 1;
    game.lastCaptureAt = now;
    const points = d.variant.points + (game.combo - 1) * 5;
    game.score += points;
    game.penned++;
    audio.squeak(game.combo);
    const where = new THREE.Vector3(d.x, 0.5, d.z);
    const label = game.combo > 1 ? `+${points} x${game.combo}` : `+${points}`;
    ui.floater(label, where, camera, d.variant.name === 'golden' ? '#ffe27a' : undefined);
  }
  if (captured.length) {
    ui.setScore(game.score);
    ui.setProgress(game.penned, game.level.target);
    if (game.penned >= game.level.target) finishLevel();
  }
}

function upcomingSpawnCount() {
  const afloat = game.flock.afloatCount;
  const room = Math.max(0, game.level.maxDucks - afloat);
  return Math.min(1 + Math.floor(afloat / 3), 5, room);
}

function finishLevel() {
  game.state = 'done';
  audio.fanfare();
  setTimeout(() => {
    ui.showLevelDone(game.level.name, game.score, () => {
      teardownLevel();
      buildLevel(game.levelIndex + 1);
      game.state = 'playing';
    });
  }, 700);
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
    // water physics at a fixed 60 Hz regardless of display rate
    simAccum += dt;
    let steps = 0;
    while (simAccum >= 1 / 60 && steps < 4) {
      game.sim.step();
      simAccum -= 1 / 60;
      steps++;
    }
    if (steps === 4) simAccum = 0;

    // an occasional puff of breeze keeps the surface alive
    breezeTimer -= dt;
    if (breezeTimer <= 0) {
      breezeTimer = 2.5 + Math.random() * 4;
      const spot = game.flock.findOpenSpot();
      if (spot) game.sim.splash(spot.x, spot.z, 1.6, 0.012);
    }

    const captured = game.flock.update(dt, time);
    if (game.state === 'playing') {
      handleCaptures(captured);
      if (game.flock.dropSplashes > 0) audio.plop(0.8);

      game.spawnTimer -= dt;
      if (game.spawnTimer <= 0) {
        game.spawnTimer = game.level.spawnInterval;
        const n = upcomingSpawnCount();
        if (n > 0) {
          game.flock.spawn(n);
          audio.pop();
        }
      }
      ui.setSpawn(game.spawnTimer, upcomingSpawnCount());
      ui.setDuckCount(game.flock.afloatCount);
    }

    game.water.update(time);
    game.terrain.update(time, game.sim);
  }

  // tap-ring feedback
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

  // gentle idle drift so the scene breathes
  camera.position.copy(camTarget).addScaledVector(camDir, camDist);
  camera.position.x += Math.sin(time * 0.13) * 0.3;
  camera.position.z += Math.cos(time * 0.09) * 0.2;
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (game.rect) fitCamera(game.rect);
});

// prevent double-tap zoom on touch devices
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------------------------------------------------------------------------

// ?level=N jumps straight to a pond — handy for trying out later levels
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
