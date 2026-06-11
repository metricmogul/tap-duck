import * as THREE from 'three';
import { mulberry32, makeNoise2D, sdfGradient } from './sdf.js';

// Builds everything that isn't water or ducks: the grassy banks and pond
// basin, shoreline stones, reeds, lily pads, floating logs and the pen fence.

const TERRAIN_SPREAD = 2.1; // ground extends well past the pond so the frame is always green

function smoothstep(a, b, t) {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// --- procedural textures ----------------------------------------------------

function paintGroundTexture(level, tw, th, noise) {
  const cw = 1024;
  const ch = Math.max(64, Math.round((1024 * th) / tw));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const data = img.data;

  const deepMud = [38, 62, 52];
  const shallowMud = [110, 100, 62];
  const sand = [205, 184, 132];
  const grassA = [108, 150, 74];
  const grassB = [88, 130, 62];
  const grassDry = [142, 158, 82];

  for (let py = 0; py < ch; py++) {
    const z = -th / 2 + ((py + 0.5) / ch) * th;
    for (let px = 0; px < cw; px++) {
      const x = -tw / 2 + ((px + 0.5) / cw) * tw;
      const sd = level.sdf(x, z);
      const n1 = noise(x * 0.45, z * 0.45);
      const n2 = noise(x * 1.7 + 40, z * 1.7 - 40);
      const wob = n2 * 0.22; // breaks up the contour rings

      let col;
      if (sd + wob < -0.85) {
        const t = smoothstep(0.85, 3.2, -(sd + wob));
        col = mixColor(shallowMud, deepMud, t);
      } else if (sd + wob < 0.0) {
        const t = smoothstep(-0.85, 0, sd + wob);
        col = mixColor(shallowMud, sand, t);
      } else if (sd + wob < 0.55) {
        const t = smoothstep(0.0, 0.55, sd + wob);
        col = mixColor(sand, mixColor(grassA, grassB, 0.5), t);
      } else {
        const patch = smoothstep(-0.3, 0.3, n1);
        col = mixColor(grassA, grassB, patch);
        const dry = smoothstep(0.15, 0.5, noise(x * 0.22 - 90, z * 0.22 + 90));
        col = mixColor(col, grassDry, dry * 0.4);
      }

      // fine speckle everywhere
      const sp = n2 * 10 + noise(x * 6.1, z * 6.3) * 14;
      col = [col[0] + sp, col[1] + sp, col[2] + sp];

      // weed patches stain the pond bed darker green
      for (const w of level.weeds) {
        const d = Math.hypot(x - w.x, z - w.z);
        if (d < w.r * 1.2) col = mixColor(col, [40, 75, 48], 0.5 * smoothstep(w.r * 1.2, w.r * 0.3, d));
      }

      // scattered daisies on the grass
      if (sd > 1.4 && noise(x * 23.7, z * 23.7) > 0.88) {
        col = noise(x * 31, z * 29) > 0 ? [246, 244, 228] : [240, 214, 120];
      }

      const o = (py * cw + px) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeBarkTexture(rand) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4f30';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    const y = rand() * 128;
    ctx.strokeStyle = `rgba(${30 + rand() * 40 | 0},${20 + rand() * 30 | 0},${10 + rand() * 20 | 0},${0.25 + rand() * 0.4})`;
    ctx.lineWidth = 1 + rand() * 3;
    ctx.beginPath();
    ctx.moveTo(-10, y);
    ctx.bezierCurveTo(40, y + rand() * 8 - 4, 90, y + rand() * 8 - 4, 140, y + rand() * 6 - 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeRingsTexture(rand) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#caa163';
  ctx.fillRect(0, 0, 128, 128);
  for (let r = 58; r > 4; r -= 5 + rand() * 5) {
    ctx.strokeStyle = `rgba(120,84,40,${0.3 + rand() * 0.3})`;
    ctx.lineWidth = 1.5 + rand() * 1.5;
    ctx.beginPath();
    ctx.arc(64 + rand() * 4 - 2, 64 + rand() * 4 - 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLilyTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(58, 58, 6, 64, 64, 62);
  g.addColorStop(0, '#5e9a4e');
  g.addColorStop(0.8, '#3e7a3a');
  g.addColorStop(1, '#2f6230');
  ctx.fillStyle = g;
  ctx.beginPath();
  // pad with a notch cut toward 3 o'clock
  ctx.moveTo(64, 64);
  ctx.arc(64, 64, 60, 0.22, Math.PI * 2 - 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,70,30,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    const a = 0.4 + (i / 9) * (Math.PI * 2 - 0.8);
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- terrain -----------------------------------------------------------------

export class Terrain {
  constructor(level) {
    this.level = level;
    this.group = new THREE.Group();
    this.lilyPads = [];
    this.disposables = [];

    const rand = mulberry32(level.seed);
    const noise = makeNoise2D(level.seed + 7);
    this.noise = noise;

    const tw = level.bounds.w * TERRAIN_SPREAD;
    const th = level.bounds.h * TERRAIN_SPREAD;

    this.heightFn = (x, z) => {
      const sd = level.sdf(x, z);
      let y;
      if (sd < 0) {
        y = -1.5 * Math.pow(smoothstep(0, 2.4, -sd), 0.75) - 0.04;
      } else {
        y = 0.3 * smoothstep(0.4, 3.5, sd) + 0.12 * smoothstep(2, 7, sd);
        y += noise(x * 0.3, z * 0.3) * 0.1 * smoothstep(0.4, 1.6, sd);
      }
      return y;
    };

    // ground mesh: a displaced plane forming banks and the pond basin
    const segX = 200;
    const segZ = Math.max(40, Math.round((segX * th) / tw));
    const geo = new THREE.PlaneGeometry(tw, th, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.heightFn(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();

    const groundTex = paintGroundTexture(level, tw, th, noise);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.95,
      metalness: 0,
    });
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(geo, groundMat, groundTex);

    this.addStones(rand);
    this.addReeds(rand);
    this.addLilyPads(rand);
    this.addLogs(rand);
    this.addPen(rand);
  }

  randPointWithSd(rand, sdMin, sdMax, tries = 60) {
    const { w, h } = this.level.bounds;
    for (let i = 0; i < tries; i++) {
      const x = (rand() - 0.5) * w * 1.3;
      const z = (rand() - 0.5) * h * 1.3;
      const sd = this.level.sdf(x, z);
      if (sd >= sdMin && sd <= sdMax) return { x, z, sd };
    }
    return null;
  }

  addStones(rand) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8d86, roughness: 0.9, flatShading: true });
    this.disposables.push(geo, mat);
    const pen = this.level.pen;
    const count = Math.min(70, Math.max(26, Math.round((this.level.bounds.w * this.level.bounds.h) / 24)));
    for (let i = 0; i < count; i++) {
      const p = this.randPointWithSd(rand, 0.25, 2.4);
      if (!p) continue;
      if (Math.hypot(p.x - pen.x, p.z - pen.z) < pen.r + 1.2) continue;
      const s = 0.14 + rand() * 0.34;
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(s * (0.8 + rand() * 0.5), s * (0.55 + rand() * 0.3), s * (0.8 + rand() * 0.5));
      m.position.set(p.x, this.heightFn(p.x, p.z) + s * 0.25, p.z);
      m.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  addReeds(rand) {
    const bladeGeo = new THREE.CylinderGeometry(0.015, 0.045, 1, 5);
    bladeGeo.translate(0, 0.5, 0);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5d7c3a, roughness: 0.9 });
    const headGeo = new THREE.CapsuleGeometry(0.05, 0.16, 3, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x6e4a26, roughness: 0.95 });
    this.disposables.push(bladeGeo, bladeMat, headGeo, headMat);

    const blades = [];
    const heads = [];
    const pen = this.level.pen;
    const dummy = new THREE.Object3D();

    const clusters = Math.min(24, Math.max(9, Math.round((this.level.bounds.w * this.level.bounds.h) / 60)));
    for (let c = 0; c < clusters; c++) {
      const p = this.randPointWithSd(rand, -0.35, 0.35);
      if (!p) continue;
      if (Math.hypot(p.x - pen.x, p.z - pen.z) < pen.r + 1.6) continue;
      const count = 6 + (rand() * 7) | 0;
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const rr = rand() * 0.5;
        const bx = p.x + Math.cos(a) * rr;
        const bz = p.z + Math.sin(a) * rr;
        const hgt = 0.6 + rand() * 0.8;
        dummy.position.set(bx, this.heightFn(bx, bz), bz);
        dummy.rotation.set((rand() - 0.5) * 0.3, rand() * Math.PI, (rand() - 0.5) * 0.3);
        dummy.scale.set(1, hgt, 1);
        dummy.updateMatrix();
        blades.push(dummy.matrix.clone());
        if (rand() < 0.3) {
          dummy.scale.set(1, 1, 1);
          dummy.position.y += hgt * 0.96;
          dummy.updateMatrix();
          heads.push(dummy.matrix.clone());
        }
      }
    }

    if (blades.length) {
      const im = new THREE.InstancedMesh(bladeGeo, bladeMat, blades.length);
      blades.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      this.group.add(im);
    }
    if (heads.length) {
      const im = new THREE.InstancedMesh(headGeo, headMat, heads.length);
      heads.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      this.group.add(im);
    }
  }

  addLilyPads(rand) {
    const tex = makeLilyTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.7,
      depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.4,
    });
    const flowerGeo = new THREE.IcosahedronGeometry(0.09, 1);
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xf2a7c3, roughness: 0.5 });
    this.disposables.push(tex, mat, flowerGeo, flowerMat);

    for (const w of this.level.weeds) {
      const count = 4 + (rand() * 4) | 0;
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2;
        const rr = rand() * w.r * 0.8;
        const x = w.x + Math.cos(a) * rr;
        const z = w.z + Math.sin(a) * rr;
        if (this.level.sdf(x, z) > -0.5) continue;
        const r = 0.24 + rand() * 0.24;
        const geo = new THREE.CircleGeometry(r, 20);
        this.disposables.push(geo);
        const pad = new THREE.Mesh(geo, mat);
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = rand() * Math.PI * 2;
        pad.position.set(x, 0.02, z);
        pad.renderOrder = 4;
        this.group.add(pad);
        this.lilyPads.push({ mesh: pad, x, z, phase: rand() * Math.PI * 2 });
        if (rand() < 0.22) {
          const f = new THREE.Mesh(flowerGeo, flowerMat);
          f.position.set(x, 0.09, z);
          f.scale.y = 0.7;
          f.castShadow = true;
          this.group.add(f);
          this.lilyPads.push({ mesh: f, x, z, phase: rand() * Math.PI * 2, lift: 0.07 });
        }
      }
    }
  }

  addLogs(rand) {
    const bark = makeBarkTexture(rand);
    const rings = makeRingsTexture(rand);
    this.disposables.push(bark, rings);
    for (const l of this.level.logs) {
      const dx = l.x2 - l.x1, dz = l.z2 - l.z1;
      const len = Math.hypot(dx, dz) + l.r * 1.6;
      const geo = new THREE.CylinderGeometry(l.r, l.r * 0.94, len, 14);
      const sideMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95 });
      const capMat = new THREE.MeshStandardMaterial({ map: rings, roughness: 0.9 });
      this.disposables.push(geo, sideMat, capMat);
      const log = new THREE.Mesh(geo, [sideMat, capMat, capMat]);
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      log.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      log.position.set((l.x1 + l.x2) / 2, l.r * 0.3, (l.z1 + l.z2) / 2);
      log.castShadow = true;
      log.receiveShadow = true;
      log.renderOrder = 3;
      this.group.add(log);
    }
  }

  addPen(rand) {
    const pen = this.level.pen;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.85 });
    const postGeo = new THREE.CylinderGeometry(0.07, 0.085, 1.3, 8);
    this.disposables.push(woodMat, postGeo);

    // fence ring with an opening of ~120 degrees facing open water
    const opening = Math.PI * 0.72; // a wide mouth — flocks sweep in together
    const start = pen.facing + opening / 2;
    const end = pen.facing + Math.PI * 2 - opening / 2;
    const segs = Math.max(9, Math.round(pen.r * 4.5));
    const posts = [];
    for (let i = 0; i <= segs; i++) {
      const a = start + ((end - start) * i) / segs;
      const x = pen.x + Math.cos(a) * pen.r;
      const z = pen.z + Math.sin(a) * pen.r;
      const post = new THREE.Mesh(postGeo, woodMat);
      post.position.set(x, 0.35, z);
      post.rotation.y = rand() * Math.PI;
      post.rotation.z = (rand() - 0.5) * 0.08;
      post.castShadow = true;
      this.group.add(post);
      posts.push({ x, z });
    }
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i], b = posts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (const ry of [0.52, 0.82]) {
        const railGeo = new THREE.BoxGeometry(len * 1.04, 0.05, 0.05);
        this.disposables.push(railGeo);
        const rail = new THREE.Mesh(railGeo, woodMat);
        rail.position.set((a.x + b.x) / 2, ry, (a.z + b.z) / 2);
        rail.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        rail.castShadow = true;
        this.group.add(rail);
      }
    }

    // soft golden glow marking the safe water
    const glowGeo = new THREE.CircleGeometry(pen.r * 0.88, 36);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 0.16,
      depthWrite: false, depthTest: false, // waves can't hide the safe zone
    });
    this.disposables.push(glowGeo, glowMat);
    this.penGlow = new THREE.Mesh(glowGeo, glowMat);
    this.penGlow.rotation.x = -Math.PI / 2;
    this.penGlow.position.set(pen.x, 0.025, pen.z);
    this.penGlow.renderOrder = 5;
    this.group.add(this.penGlow);
  }

  update(time, sim) {
    for (const p of this.lilyPads) {
      const h = sim.heightAt(p.x, p.z);
      p.mesh.position.y = 0.02 + (p.lift || 0) + h * 0.7 + Math.sin(time * 1.2 + p.phase) * 0.008;
    }
    if (this.penGlow) {
      this.penGlow.material.opacity = 0.13 + Math.sin(time * 2.2) * 0.05;
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
