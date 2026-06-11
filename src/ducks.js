import * as THREE from 'three';
import { capsule, sdfGradient } from './sdf.js';

// Plastic ducks: built from primitives with a clearcoat material, floated on
// the simulated water surface and pushed around by its gradient.

const DUCK_RADIUS = 0.3;
const WAVE_FORCE = 36;
const MAX_SPEED = 3.4;

const VARIANTS = [
  { name: 'yellow', weight: 0.86, body: 0xffc93c, points: 10 },
  { name: 'pink', weight: 0.1, body: 0xf585b6, points: 25 },
  { name: 'golden', weight: 0.04, body: 0xe9b53a, points: 50, metal: true },
];

const materialCache = new Map();
function bodyMaterial(variant) {
  if (!materialCache.has(variant.name)) {
    materialCache.set(variant.name, new THREE.MeshPhysicalMaterial({
      color: variant.body,
      roughness: variant.metal ? 0.25 : 0.38,
      metalness: variant.metal ? 0.75 : 0,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
    }));
  }
  return materialCache.get(variant.name);
}

let sharedParts = null;
function getParts() {
  if (sharedParts) return sharedParts;
  sharedParts = {
    body: new THREE.SphereGeometry(0.3, 24, 18),
    head: new THREE.SphereGeometry(0.185, 20, 16),
    tail: new THREE.SphereGeometry(0.13, 14, 10),
    beak: new THREE.CylinderGeometry(0.035, 0.085, 0.13, 10),
    eye: new THREE.SphereGeometry(0.026, 8, 8),
    shadow: new THREE.CircleGeometry(0.34, 20),
    beakMat: new THREE.MeshPhysicalMaterial({
      color: 0xff7c1f, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2,
    }),
    eyeMat: new THREE.MeshStandardMaterial({ color: 0x241d14, roughness: 0.25 }),
    shadowMat: new THREE.MeshBasicMaterial({
      color: 0x0a2018, transparent: true, opacity: 0.2, depthWrite: false,
    }),
  };
  return sharedParts;
}

function buildDuckMesh(variant) {
  const p = getParts();
  const mat = bodyMaterial(variant);
  const g = new THREE.Group();

  const body = new THREE.Mesh(p.body, mat);
  body.scale.set(0.95, 0.75, 1.25);
  body.position.y = 0.16;
  g.add(body);

  const tail = new THREE.Mesh(p.tail, mat);
  tail.scale.set(0.75, 0.9, 1);
  tail.position.set(0, 0.3, -0.34);
  tail.rotation.x = 0.7;
  g.add(tail);

  const head = new THREE.Mesh(p.head, mat);
  head.position.set(0, 0.46, 0.17);
  g.add(head);

  const beak = new THREE.Mesh(p.beak, p.beakMat);
  beak.position.set(0, 0.44, 0.36);
  beak.rotation.x = Math.PI / 2 + 0.12;
  g.add(beak);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(p.eye, p.eyeMat);
    eye.position.set(side * 0.105, 0.52, 0.3);
    g.add(eye);
  }

  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

function pickVariant(rng) {
  let r = rng();
  for (const v of VARIANTS) {
    if (r < v.weight) return v;
    r -= v.weight;
  }
  return VARIANTS[0];
}

export class DuckFlock {
  constructor(scene, level, sim) {
    this.scene = scene;
    this.level = level;
    this.sim = sim;
    this.ducks = [];
    this.grad = { x: 0, z: 0 };
    this.logFns = level.logs.map((l) => capsule(l.x1, l.z1, l.x2, l.z2, l.r));
    this.captured = []; // filled by update(), read by the game loop
    this.dropSplashes = 0; // ducks that hit the water this frame
  }

  get afloatCount() {
    return this.ducks.filter((d) => d.state === 'float' || d.state === 'dropping').length;
  }

  findOpenSpot() {
    const { w, h } = this.level.bounds;
    const pen = this.level.pen;
    for (let i = 0; i < 80; i++) {
      const x = (Math.random() - 0.5) * w * 0.85;
      const z = (Math.random() - 0.5) * h * 0.85;
      if (this.level.sdf(x, z) > -0.9) continue;
      if (Math.hypot(x - pen.x, z - pen.z) < pen.r + 1.4) continue;
      let blocked = false;
      for (const lf of this.logFns) if (lf(x, z) < 0.5) { blocked = true; break; }
      for (const d of this.ducks) {
        if (Math.hypot(x - d.x, z - d.z) < 0.9) { blocked = true; break; }
      }
      if (!blocked) return { x, z };
    }
    return null;
  }

  spawn(n) {
    const spawned = [];
    for (let i = 0; i < n; i++) {
      const spot = this.findOpenSpot();
      if (!spot) break;
      const variant = pickVariant(Math.random);
      const mesh = buildDuckMesh(variant);
      const shadow = new THREE.Mesh(getParts().shadow, getParts().shadowMat.clone());
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 3;
      this.scene.add(mesh, shadow);
      const duck = {
        mesh, shadow, variant,
        x: spot.x, z: spot.z,
        vx: 0, vz: 0,
        y: 1.6 + Math.random() * 0.7, vy: 0,
        yaw: Math.random() * Math.PI * 2,
        pitch: 0, roll: 0, pitchV: 0, rollV: 0,
        bobPhase: Math.random() * Math.PI * 2,
        wanderPhase: Math.random() * Math.PI * 2,
        state: 'dropping',
        penT: 0,
        scale: 1.05 + Math.random() * 0.18,
      };
      mesh.scale.setScalar(duck.scale);
      this.ducks.push(duck);
      spawned.push(duck);
    }
    return spawned;
  }

  update(dt, time) {
    this.captured.length = 0;
    this.dropSplashes = 0;
    const sim = this.sim;
    const pen = this.level.pen;

    for (const d of this.ducks) {
      if (d.state === 'penned') {
        d.penT += dt;
        const t = Math.min(d.penT / 0.85, 1);
        d.mesh.scale.setScalar(d.scale * (1 - t * t));
        d.mesh.position.y = sim.heightAt(d.x, d.z) - t * 0.45;
        d.mesh.rotation.y += dt * (4 + t * 14);
        d.shadow.scale.setScalar(Math.max(0.001, 1 - t));
        if (t >= 1) d.state = 'dead';
        continue;
      }
      if (d.state === 'dropping') {
        d.vy -= 9.8 * dt;
        d.y += d.vy * dt;
        const surf = sim.heightAt(d.x, d.z);
        if (d.y <= surf) {
          d.y = surf;
          sim.splash(d.x, d.z, 0.45, 0.1);
          d.state = 'float';
          this.dropSplashes++;
        }
        d.mesh.position.set(d.x, d.y + 0.02, d.z);
        d.shadow.position.set(d.x, 0.03, d.z);
        d.shadow.material.opacity = Math.max(0.05, 0.2 - d.y * 0.06);
        continue;
      }
      if (d.state !== 'float') continue;

      // --- forces from the water surface ---
      // Crests shove the duck down their leading face; troughs barely pull.
      // Without this asymmetry a passing ripple nets out to ~zero drift.
      sim.gradientAt(d.x, d.z, this.grad);
      const h = sim.heightAt(d.x, d.z);
      const crest = h > 0 ? Math.min(1.8, 0.35 + h * 26) : 0.12;
      d.vx += -this.grad.x * WAVE_FORCE * crest * dt;
      d.vz += -this.grad.z * WAVE_FORCE * crest * dt;

      // a slow idle wander keeps still ducks alive
      d.vx += Math.sin(time * 0.4 + d.wanderPhase) * 0.06 * dt;
      d.vz += Math.cos(time * 0.31 + d.wanderPhase * 1.7) * 0.06 * dt;

      // drag, heavier in weeds
      let dragK = 0.85;
      for (const w of this.level.weeds) {
        const dist = Math.hypot(d.x - w.x, d.z - w.z);
        if (dist < w.r) dragK += 2.4 * (1 - dist / w.r);
      }
      const dragF = Math.exp(-dt * dragK);
      d.vx *= dragF;
      d.vz *= dragF;

      const sp = Math.hypot(d.vx, d.vz);
      if (sp > MAX_SPEED) {
        d.vx = (d.vx / sp) * MAX_SPEED;
        d.vz = (d.vz / sp) * MAX_SPEED;
      }

      d.x += d.vx * dt;
      d.z += d.vz * dt;

      // --- collisions ---
      // shoreline
      const sd = this.level.sdf(d.x, d.z);
      if (sd > -DUCK_RADIUS) {
        sdfGradient(this.level.sdf, d.x, d.z, this.grad);
        const push = sd + DUCK_RADIUS;
        d.x -= this.grad.x * push;
        d.z -= this.grad.z * push;
        const vn = d.vx * this.grad.x + d.vz * this.grad.z;
        if (vn > 0) {
          d.vx -= this.grad.x * vn * 1.5;
          d.vz -= this.grad.z * vn * 1.5;
        }
      }
      // logs
      for (let li = 0; li < this.logFns.length; li++) {
        const lf = this.logFns[li];
        const ld = lf(d.x, d.z);
        if (ld < DUCK_RADIUS) {
          sdfGradient(lf, d.x, d.z, this.grad);
          const push = DUCK_RADIUS - ld;
          d.x += this.grad.x * push;
          d.z += this.grad.z * push;
          const vn = d.vx * this.grad.x + d.vz * this.grad.z;
          if (vn < 0) {
            d.vx -= this.grad.x * vn * 1.5;
            d.vz -= this.grad.z * vn * 1.5;
          }
        }
      }

      // pen capture
      if (Math.hypot(d.x - pen.x, d.z - pen.z) < pen.r * 0.68) {
        d.state = 'penned';
        d.penT = 0;
        this.captured.push(d);
      }
    }

    // duck/duck soft separation
    for (let i = 0; i < this.ducks.length; i++) {
      const a = this.ducks[i];
      if (a.state !== 'float') continue;
      for (let j = i + 1; j < this.ducks.length; j++) {
        const b = this.ducks[j];
        if (b.state !== 'float') continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minD = 0.56;
        if (dist < minD && dist > 1e-5) {
          dx /= dist; dz /= dist;
          const push = (minD - dist) * 0.5;
          a.x -= dx * push; a.z -= dz * push;
          b.x += dx * push; b.z += dz * push;
          const rel = (b.vx - a.vx) * dx + (b.vz - a.vz) * dz;
          if (rel < 0) {
            a.vx += dx * rel * 0.45; a.vz += dz * rel * 0.45;
            b.vx -= dx * rel * 0.45; b.vz -= dz * rel * 0.45;
          }
        }
      }
    }

    // --- visuals: bob, tilt with the wave normal, face the direction of travel
    for (const d of this.ducks) {
      if (d.state !== 'float') continue;
      const h = sim.heightAt(d.x, d.z);
      d.mesh.position.set(d.x, h * 0.85 + 0.02 + Math.sin(time * 2.1 + d.bobPhase) * 0.012, d.z);

      // Underdamped spring toward the wave slope: ducks rock and wobble for a
      // moment after each wave instead of gliding stiffly over it.
      sim.gradientAt(d.x, d.z, this.grad);
      const targetPitch = THREE.MathUtils.clamp(this.grad.z * 1.6, -0.65, 0.65);
      const targetRoll = THREE.MathUtils.clamp(-this.grad.x * 1.6, -0.65, 0.65);
      d.pitchV += ((targetPitch - d.pitch) * 38 - d.pitchV * 4.5) * dt;
      d.rollV += ((targetRoll - d.roll) * 38 - d.rollV * 4.5) * dt;
      // a strong crest gives an extra random jolt
      const slope = Math.hypot(this.grad.x, this.grad.z);
      if (slope > 0.25 && Math.random() < dt * 9) {
        d.pitchV += (Math.random() - 0.5) * 2.4;
        d.rollV += (Math.random() - 0.5) * 2.4;
      }
      d.pitch = THREE.MathUtils.clamp(d.pitch + d.pitchV * dt, -0.8, 0.8);
      d.roll = THREE.MathUtils.clamp(d.roll + d.rollV * dt, -0.8, 0.8);

      const sp = Math.hypot(d.vx, d.vz);
      if (sp > 0.12) {
        const targetYaw = Math.atan2(d.vx, d.vz);
        let dy = targetYaw - d.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        d.yaw += dy * Math.min(1, dt * 3.2);
      } else {
        d.yaw += Math.sin(time * 0.23 + d.wanderPhase) * dt * 0.25;
      }
      d.mesh.rotation.set(d.pitch, d.yaw, d.roll, 'YXZ');

      d.shadow.position.set(d.x, h + 0.012, d.z);
      d.shadow.scale.setScalar(d.scale);
    }

    // sweep the dead
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      const d = this.ducks[i];
      if (d.state === 'dead') {
        this.scene.remove(d.mesh, d.shadow);
        d.shadow.material.dispose();
        this.ducks.splice(i, 1);
      }
    }

    return this.captured;
  }

  dispose() {
    for (const d of this.ducks) {
      this.scene.remove(d.mesh, d.shadow);
      d.shadow.material.dispose();
    }
    this.ducks.length = 0;
  }
}
