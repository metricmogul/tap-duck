import * as THREE from 'three';
import { sdfGradient } from './sdf.js';
import * as audio from './audio.js';

// The pond's supporting cast: a troublemaking goose, day events (bread
// tosses, rain showers) and a frog who lives on the lily pads.

// ---------------------------------------------------------------------------
// The goose: paddles around scattering rafts of ducks, avoids the pen unless
// you panic it with a big wave and shove it home for a fat bonus.

const GOOSE_WAVE_FORCE = 34;
const GOOSE_PANIC_ACCEL = 1.3;

function buildGooseMesh() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x8d7f68, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.3,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 0.5 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 22, 16), bodyMat);
  body.scale.set(0.95, 0.72, 1.45);
  body.position.y = 0.26;
  g.add(body);

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), bodyMat);
  tail.scale.set(0.7, 0.8, 1.1);
  tail.rotation.x = 0.65;
  tail.position.set(0, 0.42, -0.52);
  g.add(tail);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.095, 0.62, 10), darkMat);
  neck.position.set(0, 0.62, 0.42);
  neck.rotation.x = -0.18;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), darkMat);
  head.scale.set(0.9, 0.85, 1.25);
  head.position.set(0, 0.95, 0.49);
  g.add(head);

  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), whiteMat);
  cheek.scale.set(1.15, 0.8, 0.9);
  cheek.position.set(0, 0.9, 0.55);
  g.add(cheek);

  const beak = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.14, 8), darkMat);
  beak.rotation.x = Math.PI / 2 + 0.1;
  beak.position.set(0, 0.95, 0.66);
  g.add(beak);

  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.visible = false;
  return g;
}

export class Goose {
  constructor(scene, level, sim) {
    this.scene = scene;
    this.level = level;
    this.sim = sim;
    this.mesh = buildGooseMesh();
    scene.add(this.mesh);
    this.state = 'away'; // away | dropping | cruise | panic | penned | gone
    this.x = 0; this.z = 0; this.y = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.wp = null;
    this.wpTimer = 0;
    this.panicT = 0;
    this.honkCd = 0;
    this.wakeAcc = 0;
    this.penT = 0;
    this.justPenned = false;
    this.grad = { x: 0, z: 0 };
  }

  // crash-land somewhere open
  enter(spot) {
    this.x = spot.x; this.z = spot.z;
    this.y = 7;
    this.vy = -2;
    this.state = 'dropping';
    this.mesh.visible = true;
  }

  pickWaypoint() {
    const { w, h } = this.level.bounds;
    const pen = this.level.pen;
    for (let i = 0; i < 50; i++) {
      const x = (Math.random() - 0.5) * w * 0.85;
      const z = (Math.random() - 0.5) * h * 0.85;
      if (this.level.sdf(x, z) > -1.2) continue;
      if (Math.hypot(x - pen.x, z - pen.z) < pen.r + 3) continue;
      return { x, z };
    }
    return { x: this.x, z: this.z };
  }

  update(dt, time, flockNearby) {
    this.justPenned = false;
    if (this.state === 'away' || this.state === 'gone') return;
    const sim = this.sim;
    const pen = this.level.pen;

    if (this.state === 'dropping') {
      this.vy -= 9.8 * dt;
      this.y += this.vy * dt;
      const surf = sim.heightAt(this.x, this.z);
      if (this.y <= surf) {
        this.y = surf;
        sim.splash(this.x, this.z, 1.0, 0.28);
        audio.honk();
        this.state = 'cruise';
        this.wp = this.pickWaypoint();
      }
      this.mesh.position.set(this.x, this.y + 0.02, this.z);
      return;
    }

    if (this.state === 'penned') {
      this.penT += dt;
      const t = Math.min(this.penT / 1.0, 1);
      this.mesh.scale.setScalar(Math.max(0.001, 1 - t * t));
      this.mesh.position.y = sim.heightAt(this.x, this.z) - t * 0.5;
      this.mesh.rotation.y += dt * (3 + t * 12);
      if (t >= 1) {
        this.state = 'gone';
        this.mesh.visible = false;
      }
      return;
    }

    // --- waves shove the goose like a (heavier) duck ---
    sim.gradientAt(this.x, this.z, this.grad);
    const dudt = THREE.MathUtils.clamp(sim.dudtAt(this.x, this.z), -4, 4);
    const fx = -this.grad.x * dudt * GOOSE_WAVE_FORCE;
    const fz = -this.grad.z * dudt * GOOSE_WAVE_FORCE;
    this.vx += fx * dt;
    this.vz += fz * dt;
    if (Math.hypot(fx, fz) > GOOSE_PANIC_ACCEL && this.state === 'cruise') {
      this.state = 'panic';
      this.panicT = 2.4;
      audio.honk();
    }

    if (this.state === 'panic') {
      this.panicT -= dt;
      // flailing — no steering, no pen avoidance: now's your chance
      this.roll += Math.sin(time * 22) * dt * 2.2;
      if (this.panicT <= 0) this.state = 'cruise';
    } else {
      // steer toward the waypoint
      this.wpTimer -= dt;
      if (!this.wp || this.wpTimer <= 0
        || Math.hypot(this.wp.x - this.x, this.wp.z - this.z) < 1.2) {
        this.wp = this.pickWaypoint();
        this.wpTimer = 7 + Math.random() * 5;
      }
      const dx = this.wp.x - this.x, dz = this.wp.z - this.z;
      const dd = Math.hypot(dx, dz) || 1e-4;
      this.vx += (dx / dd) * 1.1 * dt;
      this.vz += (dz / dd) * 1.1 * dt;
      // it knows what the pen is for, and wants none of it
      const pd = Math.hypot(this.x - pen.x, this.z - pen.z);
      if (pd < pen.r + 3.2) {
        this.vx += ((this.x - pen.x) / pd) * 2.4 * dt;
        this.vz += ((this.z - pen.z) / pd) * 2.4 * dt;
      }
    }

    const drag = Math.exp(-dt * 1.15);
    this.vx *= drag;
    this.vz *= drag;
    const sp = Math.hypot(this.vx, this.vz);
    const maxSp = this.state === 'panic' ? 3.0 : 1.1;
    if (sp > maxSp) {
      this.vx = (this.vx / sp) * maxSp;
      this.vz = (this.vz / sp) * maxSp;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // stay off the banks
    const sd = this.level.sdf(this.x, this.z);
    if (sd > -0.45) {
      sdfGradient(this.level.sdf, this.x, this.z, this.grad);
      const push = sd + 0.45;
      this.x -= this.grad.x * push;
      this.z -= this.grad.z * push;
    }

    // its wake is real: the sim ripples push ducks out of its way
    this.wakeAcc += sp * dt;
    if (this.wakeAcc > 0.35 && sp > 0.3) {
      this.wakeAcc = 0;
      this.sim.splash(this.x - (this.vx / sp) * 0.5, this.z - (this.vz / sp) * 0.5, 0.5, 0.05);
    }

    // honk at any raft it barges through
    this.honkCd -= dt;
    if (flockNearby >= 4 && this.honkCd <= 0) {
      this.honkCd = 6 + Math.random() * 4;
      audio.honk();
      this.sim.splash(this.x, this.z, 0.9, 0.16); // indignant wing-flap
    }

    // captured!
    if (Math.hypot(this.x - pen.x, this.z - pen.z) < pen.r * 0.66) {
      this.state = 'penned';
      this.penT = 0;
      this.justPenned = true;
      audio.honk();
      return;
    }

    // --- visuals ---
    const h = sim.heightAt(this.x, this.z);
    this.y = h * 0.85 + 0.02;
    if (sp > 0.15) {
      const targetYaw = Math.atan2(this.vx, this.vz);
      let dy = targetYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 2.6);
    }
    const tp = THREE.MathUtils.clamp(this.grad.z * 1.1, -0.4, 0.4);
    const tr = THREE.MathUtils.clamp(-this.grad.x * 1.1, -0.4, 0.4);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 5);
    this.roll += (tr - this.roll) * Math.min(1, dt * 5);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse((m) => {
      if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); }
    });
  }
}

// ---------------------------------------------------------------------------
// Bread toss: chunks arc in, ducks paddle over and cluster — a 15 second
// window where one good wave herds a dozen at once.

export class BreadToss {
  constructor(scene, sim, level) {
    this.scene = scene;
    this.sim = sim;
    this.level = level;
    this.bits = [];
    this.geo = new THREE.BoxGeometry(0.2, 0.08, 0.17);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xd9b376, roughness: 0.9 });
  }

  toss(x, z) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.4;
      const bx = x + Math.cos(a) * r;
      const bz = z + Math.sin(a) * r;
      if (this.level.sdf(bx, bz) > -0.5) continue;
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.bits.push({
        mesh, x: bx, z: bz,
        y: 5 + i * 0.8, vy: -1,
        life: 15 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
        afloat: false,
      });
    }
  }

  // ducks within nibble range make the bread go faster
  update(dt, time, nibbleCounts) {
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      if (!b.afloat) {
        b.vy -= 9.8 * dt;
        b.y += b.vy * dt;
        const surf = this.sim.heightAt(b.x, b.z);
        if (b.y <= surf) {
          b.y = surf;
          b.afloat = true;
          this.sim.splash(b.x, b.z, 0.35, 0.05);
          audio.plop(0.5);
        }
        b.mesh.position.set(b.x, b.y, b.z);
        continue;
      }
      b.life -= dt * (1 + (nibbleCounts ? (nibbleCounts.get(b) || 0) * 0.6 : 0));
      const h = this.sim.heightAt(b.x, b.z);
      const sink = Math.max(0, 1.5 - b.life) / 1.5; // last moments: sink away
      b.mesh.position.set(b.x, h + 0.03 - sink * 0.25, b.z);
      b.mesh.rotation.y += dt * 0.3;
      b.mesh.scale.setScalar(Math.max(0.01, 1 - sink));
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.bits.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const b of this.bits) this.scene.remove(b.mesh);
    this.bits.length = 0;
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Rain: instanced streaks over the visible water, droplet rings in the sim,
// and a capture bonus while it lasts. Intensity fades in and out.

const RAIN_COUNT = 260;
const RAIN_AREA = { w: 46, h: 34, top: 13 };

export class Rain {
  constructor(scene) {
    this.scene = scene;
    this.geo = new THREE.BoxGeometry(0.015, 0.55, 0.015);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xd8e6ec, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, RAIN_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.drops = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.drops.push({
        x: 0, y: Math.random() * RAIN_AREA.top, z: 0,
        speed: 8 + Math.random() * 3,
        seeded: false,
      });
    }
    this.dummy = new THREE.Object3D();
  }

  update(dt, intensity, center, sim, level) {
    this.mat.opacity = 0.34 * intensity;
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;

    let splashes = 0;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      if (!d.seeded) {
        d.x = center.x + (Math.random() - 0.5) * RAIN_AREA.w;
        d.z = center.z + (Math.random() - 0.5) * RAIN_AREA.h;
        d.seeded = true;
      }
      d.y -= d.speed * dt;
      if (d.y <= 0) {
        if (splashes < 5 && intensity > 0.4 && level.sdf(d.x, d.z) < -0.3 && Math.random() < 0.5) {
          sim.splash(d.x, d.z, 0.3, 0.012 + Math.random() * 0.012);
          splashes++;
        }
        d.y = RAIN_AREA.top * (0.7 + Math.random() * 0.3);
        d.x = center.x + (Math.random() - 0.5) * RAIN_AREA.w;
        d.z = center.z + (Math.random() - 0.5) * RAIN_AREA.h;
      }
      this.dummy.position.set(d.x, d.y, d.z);
      this.dummy.rotation.z = 0.06;
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// The frog: lives on the lily pads, hops between them now and then, and each
// landing sends out a free little ripple ring.

export class Frog {
  constructor(scene, pads, sim) {
    this.scene = scene;
    this.pads = pads; // [{x, z, mesh}] — real pads only, not flowers
    this.sim = sim;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6da944, roughness: 0.6 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x222418, roughness: 0.4 });
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 9), mat);
    body.scale.set(1, 0.72, 1.15);
    this.mesh.add(body);
    for (const s of [-1, 1]) {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat);
      bump.position.set(s * 0.055, 0.07, 0.07);
      this.mesh.add(bump);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
      eye.position.set(s * 0.055, 0.085, 0.095);
      this.mesh.add(eye);
    }
    this.mesh.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    scene.add(this.mesh);
    this.mats = [mat, eyeMat];

    this.pad = pads[Math.floor(Math.random() * pads.length)];
    this.from = null;
    this.to = null;
    this.hopT = 0;
    this.sitTimer = 4 + Math.random() * 6;
    this.croakTimer = 9 + Math.random() * 9;
  }

  update(dt, time) {
    if (!this.pad) return;
    if (this.to) {
      this.hopT += dt / 0.55;
      const t = Math.min(this.hopT, 1);
      const x = THREE.MathUtils.lerp(this.from.x, this.to.x, t);
      const z = THREE.MathUtils.lerp(this.from.z, this.to.z, t);
      const y = this.padY(t < 0.5 ? this.from : this.to) + Math.sin(t * Math.PI) * 0.85;
      this.mesh.position.set(x, y, z);
      this.mesh.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
      this.mesh.rotation.x = -Math.sin(t * Math.PI) * 0.5;
      if (t >= 1) {
        this.pad = this.to;
        this.to = null;
        this.sitTimer = 5 + Math.random() * 7;
        this.sim.splash(this.pad.x, this.pad.z, 0.5, 0.06);
        audio.plop(0.4);
      }
      return;
    }

    this.mesh.position.set(this.pad.x, this.padY(this.pad), this.pad.z);
    this.mesh.rotation.x = 0;
    this.mesh.scale.y = 1 + Math.sin(time * 3.1) * 0.04; // breathing

    this.croakTimer -= dt;
    if (this.croakTimer <= 0) {
      this.croakTimer = 8 + Math.random() * 12;
      audio.croak();
      this.mesh.scale.y = 1.15;
    }

    this.sitTimer -= dt;
    if (this.sitTimer <= 0 && this.pads.length > 1) {
      const options = this.pads.filter(
        (p) => p !== this.pad && Math.hypot(p.x - this.pad.x, p.z - this.pad.z) < 6,
      );
      if (options.length) {
        this.from = this.pad;
        this.to = options[Math.floor(Math.random() * options.length)];
        this.hopT = 0;
      } else {
        this.sitTimer = 6;
      }
    }
  }

  padY(pad) {
    return (pad.mesh ? pad.mesh.position.y : 0.02) + 0.07;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    for (const m of this.mats) m.dispose();
  }
}
