import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { capsule, sdfGradient } from './sdf.js';
import { streamFlowAt } from './levels.js';

// A hundred plastic ducks, drawn with three InstancedMeshes (bodies, beaks,
// eyes) — three draw calls no matter how many ducks are afloat. They ride the
// simulated water: wave momentum flux pushes them, wind and stream drift them,
// and an underdamped tilt spring makes them wobble over every crest.

const DUCK_RADIUS = 0.3;
const WAVE_FORCE = 55; // coefficient on the wave-momentum push -(du/dt)·∇u
const MAX_SPEED = 3.4;

const VARIANTS = [
  { name: 'yellow', weight: 0.88, color: new THREE.Color(0xffc93c), points: 10 },
  { name: 'pink', weight: 0.09, color: new THREE.Color(0xf585b6), points: 25 },
  { name: 'golden', weight: 0.03, color: new THREE.Color(0xf7b733), points: 50 },
];
// brood ducks aren't drawn from the weighted pool
const MAMA = { name: 'mama', color: new THREE.Color(0xa97e4f), points: 40 };
const DUCKLING = { name: 'duckling', color: new THREE.Color(0xffe9a0), points: 5 };

const BROODS = 5; // mamas afloat at dawn
const BROOD_SIZE = 3; // ducklings each
const SLEEPY_FRACTION = 0.14;

function pickVariant(rng) {
  let r = rng();
  for (const v of VARIANTS) {
    if (r < v.weight) return v;
    r -= v.weight;
  }
  return VARIANTS[0];
}

// --- merged duck geometry (built once) --------------------------------------

function buildGeometries() {
  const body = new THREE.SphereGeometry(0.3, 20, 14);
  body.scale(0.95, 0.75, 1.25);
  body.translate(0, 0.16, 0);

  const tail = new THREE.SphereGeometry(0.13, 12, 8);
  tail.scale(0.75, 0.9, 1);
  tail.rotateX(0.7);
  tail.translate(0, 0.3, -0.34);

  const head = new THREE.SphereGeometry(0.185, 18, 14);
  head.translate(0, 0.46, 0.17);

  const bodyGeo = mergeGeometries([body, tail, head]);
  body.dispose(); tail.dispose(); head.dispose();

  const beakGeo = new THREE.CylinderGeometry(0.035, 0.085, 0.13, 10);
  beakGeo.rotateX(Math.PI / 2 + 0.12);
  beakGeo.translate(0, 0.44, 0.36);

  const eyeL = new THREE.SphereGeometry(0.026, 6, 6);
  eyeL.translate(-0.105, 0.52, 0.3);
  const eyeR = new THREE.SphereGeometry(0.026, 6, 6);
  eyeR.translate(0.105, 0.52, 0.3);
  const eyesGeo = mergeGeometries([eyeL, eyeR]);
  eyeL.dispose(); eyeR.dispose();

  return { bodyGeo, beakGeo, eyesGeo };
}

export class DuckFlock {
  constructor(scene, level, sim) {
    this.scene = scene;
    this.level = level;
    this.sim = sim;
    this.ducks = [];
    this.grad = { x: 0, z: 0 };
    this.flow = { x: 0, z: 0 };
    this.wind = { x: 0, z: 0 }; // set by the game loop each frame
    this.logFns = level.logs.map((l) => capsule(l.x1, l.z1, l.x2, l.z2, l.r));
    this.captured = [];
    this.dropSplashes = 0;
    this.clearedBase = 0; // non-bonus ducks penned
    this.bread = null; // bits ducks paddle toward, set during a bread toss
    this.scare = null; // the goose's position; nearby ducks flee it
    this.nibbleCounts = new Map(); // bread bit -> ducks gathered on it
    this.wokeCount = 0; // sleepers jolted awake this frame
    this.sleepColor = new THREE.Color(0xffc93c).multiplyScalar(0.62);

    const maxCount = (level.duckCount || 100) + 80;
    const { bodyGeo, beakGeo, eyesGeo } = buildGeometries();
    this.geos = [bodyGeo, beakGeo, eyesGeo];

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.18,
    });
    this.beakMat = new THREE.MeshPhysicalMaterial({
      color: 0xff7c1f, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2,
    });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x241d14, roughness: 0.3 });

    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, this.bodyMat, maxCount);
    this.beakMesh = new THREE.InstancedMesh(beakGeo, this.beakMat, maxCount);
    this.eyesMesh = new THREE.InstancedMesh(eyesGeo, this.eyeMat, maxCount);
    this.bodyMesh.castShadow = true;
    this.beakMesh.castShadow = true;
    for (const m of [this.bodyMesh, this.beakMesh, this.eyesMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.dummy = new THREE.Object3D();
  }

  get afloatCount() {
    let n = 0;
    for (const d of this.ducks) {
      if (d.state === 'waiting' || d.state === 'dropping' || d.state === 'float') n++;
    }
    return n;
  }

  findOpenSpot(minDuckDist = 0.8) {
    const { w, h } = this.level.bounds;
    const pen = this.level.pen;
    for (let i = 0; i < 120; i++) {
      const x = (Math.random() - 0.5) * w * 0.9;
      const z = (Math.random() - 0.5) * h * 0.9;
      if (this.level.sdf(x, z) > -0.9) continue;
      if (Math.hypot(x - pen.x, z - pen.z) < pen.r + 1.6) continue;
      let blocked = false;
      for (const lf of this.logFns) if (lf(x, z) < 0.5) { blocked = true; break; }
      if (!blocked) {
        for (const d of this.ducks) {
          if (Math.hypot(x - d.x, z - d.z) < minDuckDist) { blocked = true; break; }
        }
      }
      if (!blocked) return { x, z };
    }
    return null;
  }

  makeDuck(spot, variant, dropDelay, bonus) {
    return {
      variant, bonus,
      x: spot.x, z: spot.z,
      vx: 0, vz: 0,
      y: 1.6 + Math.random() * 1.2, vy: 0,
      yaw: Math.random() * Math.PI * 2,
      pitch: 0, roll: 0, pitchV: 0, rollV: 0,
      bobPhase: Math.random() * Math.PI * 2,
      wanderPhase: Math.random() * Math.PI * 2,
      state: 'waiting',
      wait: dropDelay,
      penT: 0,
      scale: 1.0 + Math.random() * 0.2,
      bankT: 0, // recently bounced off a log (bank-shot window)
      riding: false, rideX: 0, rideZ: 0, // where the current wave ride began
      asleep: false, // dozing ducks ignore ripples until a big wave wakes them
      leader: null, slot: 0, // ducklings paddle in line astern of their mama
      flee: 0, fleeX: 0, fleeZ: 0, // startled goldens paddle ahead of the wave
    };
  }

  // the dawn flotilla: all ducks rain in over the first few seconds
  spawnInitial(count) {
    let spawned = 0;
    // broods first: a mama and her ducklings splash down together
    for (let b = 0; b < BROODS && spawned < count; b++) {
      const spot = this.findOpenSpot(2.2);
      if (!spot) break;
      const delay = Math.random() * 4;
      const mama = this.makeDuck(spot, MAMA, delay, false);
      mama.scale = 1.45;
      this.ducks.push(mama);
      spawned++;
      for (let c = 0; c < BROOD_SIZE && spawned < count; c++) {
        const a = (c / BROOD_SIZE) * Math.PI * 2;
        const kid = this.makeDuck(
          { x: spot.x + Math.cos(a) * 0.7, z: spot.z + Math.sin(a) * 0.7 },
          DUCKLING, delay + 0.3 + c * 0.2, false,
        );
        kid.scale = 0.55;
        kid.leader = mama;
        kid.slot = c;
        this.ducks.push(kid);
        spawned++;
      }
    }
    while (spawned < count) {
      const spot = this.findOpenSpot();
      if (!spot) break;
      const d = this.makeDuck(spot, pickVariant(Math.random), Math.random() * 4.5, false);
      if (d.variant.name === 'yellow' && Math.random() < SLEEPY_FRACTION) d.asleep = true;
      this.ducks.push(d);
      spawned++;
    }
    this.baseTotal = spawned;
    return spawned;
  }

  // reward wave: golden ducks for players who clear the pond before sunset
  spawnBonus(count) {
    const golden = VARIANTS[2];
    let n = 0;
    for (let i = 0; i < count; i++) {
      const spot = this.findOpenSpot(1.2);
      if (!spot) break;
      const d = this.makeDuck(spot, golden, i * 0.18, true);
      this.ducks.push(d);
      this.setColor(this.ducks.length - 1, golden.color);
      n++;
    }
    return n;
  }

  setColor(index, color) {
    this.bodyMesh.setColorAt(index, color);
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
  }

  update(dt, time) {
    this.captured.length = 0;
    this.dropSplashes = 0;
    this.wokeCount = 0;
    this.nibbleCounts.clear();
    const sim = this.sim;
    const pen = this.level.pen;
    const stream = this.level.stream;

    for (const d of this.ducks) {
      if (d.state === 'waiting') {
        d.wait -= dt;
        if (d.wait <= 0) d.state = 'dropping';
        continue;
      }
      if (d.state === 'penned') {
        d.penT += dt;
        if (d.penT >= 0.85) d.state = 'dead';
        continue;
      }
      if (d.state === 'dropping') {
        d.vy -= 9.8 * dt;
        d.y += d.vy * dt;
        const surf = sim.heightAt(d.x, d.z);
        if (d.y <= surf) {
          d.y = surf;
          sim.splash(d.x, d.z, 0.45, 0.055);
          d.state = 'float';
          this.dropSplashes++;
        }
        continue;
      }
      if (d.state !== 'float') continue;

      // --- forces ---
      // wave momentum flux: pushes along a travelling wave's direction
      sim.gradientAt(d.x, d.z, this.grad);
      const dudt = THREE.MathUtils.clamp(sim.dudtAt(d.x, d.z), -4, 4);
      let fx = -this.grad.x * dudt * WAVE_FORCE;
      let fz = -this.grad.z * dudt * WAVE_FORCE;
      const fMag = Math.hypot(fx, fz);

      // dozing ducks shrug off ripples; a proper wave jolts them awake
      if (d.asleep) {
        if (fMag > 1.1) {
          d.asleep = false;
          d.pitchV += 2.6;
          this.wokeCount++;
        } else {
          fx *= 0.06;
          fz *= 0.06;
        }
      }

      // goldens are wary: a strong wave startles them into paddling ahead of it
      if (d.variant.name === 'golden' && fMag > 0.7 && d.flee <= 0) {
        d.flee = 1.2;
        d.fleeX = fx / fMag;
        d.fleeZ = fz / fMag;
      }
      if (d.flee > 0) {
        d.flee -= dt;
        d.vx += d.fleeX * 3.2 * dt;
        d.vz += d.fleeZ * 3.2 * dt;
      }

      d.vx += fx * dt;
      d.vz += fz * dt;

      // weeds shelter ducks: drift forces fade inside a weed bed
      let shelter = 1;
      let dragK = 0.85;
      for (const w of this.level.weeds) {
        const dist = Math.hypot(d.x - w.x, d.z - w.z);
        if (dist < w.r) {
          const t = 1 - dist / w.r;
          dragK += 2.4 * t;
          shelter = Math.min(shelter, 1 - t * 0.9);
        }
      }

      // steady wind drift (oscillation handled by the game loop)
      d.vx += this.wind.x * 0.8 * shelter * dt;
      d.vz += this.wind.z * 0.8 * shelter * dt;

      // river current
      if (stream) {
        // accel = flow * dragK so the terminal drift speed equals the current
        streamFlowAt(stream, d.x, d.z, this.flow);
        d.vx += this.flow.x * 0.85 * shelter * dt;
        d.vz += this.flow.z * 0.85 * shelter * dt;
      }

      // ducklings paddle in line astern of their mama — and when she's home,
      // they follow her straight into the pen
      if (d.leader) {
        const L = d.leader;
        if (L.state === 'float') {
          const off = 0.55 + d.slot * 0.38;
          const tx = L.x - Math.sin(L.yaw) * off;
          const tz = L.z - Math.cos(L.yaw) * off;
          const ddx = tx - d.x, ddz = tz - d.z;
          const dist = Math.hypot(ddx, ddz);
          if (dist > 0.15) {
            const k = Math.min(2.6, 0.8 + dist * 0.9);
            d.vx += (ddx / dist) * k * dt;
            d.vz += (ddz / dist) * k * dt;
          } else {
            dragK += 1.2;
          }
        } else {
          const ddx = pen.x - d.x, ddz = pen.z - d.z;
          const dist = Math.hypot(ddx, ddz) || 1e-4;
          if (dist < 9) {
            d.vx += (ddx / dist) * 1.5 * dt;
            d.vz += (ddz / dist) * 1.5 * dt;
          } else {
            d.leader = null; // too far behind; grows up on the spot
          }
        }
      }

      // bread! paddle over and crowd around the nearest bit
      if (!d.asleep && this.bread && this.bread.length) {
        let best = null, bd = 56.25; // within 7.5m
        for (const b of this.bread) {
          if (!b.afloat) continue;
          const dd = (d.x - b.x) ** 2 + (d.z - b.z) ** 2;
          if (dd < bd) { bd = dd; best = b; }
        }
        if (best) {
          const dist = Math.sqrt(bd) || 1e-4;
          d.vx += ((best.x - d.x) / dist) * 0.55 * dt;
          d.vz += ((best.z - d.z) / dist) * 0.55 * dt;
          if (dist < 1.1) {
            dragK += 1.8; // settle in and nibble
            this.nibbleCounts.set(best, (this.nibbleCounts.get(best) || 0) + 1);
          }
        }
      }

      // flee the goose
      if (this.scare) {
        const sx = d.x - this.scare.x, sz = d.z - this.scare.z;
        const sd2 = Math.hypot(sx, sz);
        if (sd2 < 2.0 && sd2 > 1e-4) {
          const k = (1 - sd2 / 2.0) * 5.5;
          d.vx += (sx / sd2) * k * dt;
          d.vz += (sz / sd2) * k * dt;
        }
      }

      // idle wander so a calm flock still looks alive (sleepers just drift)
      if (!d.asleep) {
        d.vx += Math.sin(time * 0.4 + d.wanderPhase) * 0.06 * dt;
        d.vz += Math.cos(time * 0.31 + d.wanderPhase * 1.7) * 0.06 * dt;
      } else {
        dragK += 1.6;
      }

      const dragF = Math.exp(-dt * dragK);
      d.vx *= dragF;
      d.vz *= dragF;

      const sp = Math.hypot(d.vx, d.vz);
      if (sp > MAX_SPEED) {
        d.vx = (d.vx / sp) * MAX_SPEED;
        d.vz = (d.vz / sp) * MAX_SPEED;
      }

      // trick-shot bookkeeping: remember where a fast wave ride began
      if (!d.riding && sp > 1.3) {
        d.riding = true;
        d.rideX = d.x;
        d.rideZ = d.z;
      } else if (d.riding && sp < 0.4) {
        d.riding = false;
      }
      if (d.bankT > 0) d.bankT -= dt;

      d.x += d.vx * dt;
      d.z += d.vz * dt;

      // --- collisions ---
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
      for (const lf of this.logFns) {
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
            if (vn < -0.5) d.bankT = 2.5; // a real carom — bank-shot window opens
          }
        }
      }

      if (Math.hypot(d.x - pen.x, d.z - pen.z) < pen.r * 0.68) {
        d.state = 'penned';
        d.penT = 0;
        if (!d.bonus) this.clearedBase++;
        this.captured.push(d);
      }
    }

    // duck/duck separation
    for (let i = 0; i < this.ducks.length; i++) {
      const a = this.ducks[i];
      if (a.state !== 'float') continue;
      for (let j = i + 1; j < this.ducks.length; j++) {
        const b = this.ducks[j];
        if (b.state !== 'float') continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        if (dx > 0.8 || dx < -0.8 || dz > 0.8 || dz < -0.8) continue;
        const dist = Math.hypot(dx, dz);
        const minD = (a.scale + b.scale) * 0.26; // ducklings pack in tight
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

    // --- visuals: bob, wobble, face direction of travel ---
    for (const d of this.ducks) {
      if (d.state !== 'float') continue;
      const h = sim.heightAt(d.x, d.z);
      d.y = h * 0.85 + 0.02 + Math.sin(time * 2.1 + d.bobPhase) * 0.012;

      sim.gradientAt(d.x, d.z, this.grad);
      const targetPitch = THREE.MathUtils.clamp(this.grad.z * 1.6, -0.65, 0.65);
      const targetRoll = THREE.MathUtils.clamp(-this.grad.x * 1.6, -0.65, 0.65);
      d.pitchV += ((targetPitch - d.pitch) * 38 - d.pitchV * 4.5) * dt;
      d.rollV += ((targetRoll - d.roll) * 38 - d.rollV * 4.5) * dt;
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
    }

    // sweep the dead, then write every instance matrix
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      if (this.ducks[i].state === 'dead') this.ducks.splice(i, 1);
    }
    this.writeInstances();
    return this.captured;
  }

  writeInstances() {
    const dummy = this.dummy;
    let needColor = false;
    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      let s = d.scale;
      let y = d.y;
      let yaw = d.yaw;
      if (d.state === 'waiting') {
        s = 0.0001;
      } else if (d.state === 'penned') {
        const t = Math.min(d.penT / 0.85, 1);
        s = d.scale * Math.max(0.001, 1 - t * t);
        y = this.sim.heightAt(d.x, d.z) - t * 0.45;
        yaw = d.yaw + t * t * 14;
      }
      dummy.position.set(d.x, y, d.z);
      dummy.rotation.set(d.pitch, yaw, d.roll, 'YXZ');
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.bodyMesh.setMatrixAt(i, dummy.matrix);
      this.beakMesh.setMatrixAt(i, dummy.matrix);
      this.eyesMesh.setMatrixAt(i, dummy.matrix);
      // keep colors aligned after splices; sleepers show a drowsy tint
      this.bodyMesh.setColorAt(i, d.asleep ? this.sleepColor : d.variant.color);
      needColor = true;
    }
    for (const m of [this.bodyMesh, this.beakMesh, this.eyesMesh]) {
      m.count = this.ducks.length;
      m.instanceMatrix.needsUpdate = true;
    }
    if (needColor && this.bodyMesh.instanceColor) {
      this.bodyMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of [this.bodyMesh, this.beakMesh, this.eyesMesh]) {
      this.scene.remove(m);
      m.dispose();
    }
    for (const g of this.geos) g.dispose();
    this.bodyMat.dispose();
    this.beakMat.dispose();
    this.eyeMat.dispose();
    this.ducks.length = 0;
  }
}
