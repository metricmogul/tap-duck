import * as THREE from 'three';
import { capsule } from './sdf.js';

// Height-field wave simulation on a CPU grid. The same field drives the
// water shader (via a float texture) and the duck physics (via heightAt /
// gradientAt), so what you see is exactly what pushes the ducks.

const SUBSTEPS = 2;
const WAVE_C = 0.42; // courant-ish factor, must stay < 0.5 for stability
const BASE_DAMP = 0.9965;
const WEED_DAMP = 0.962;

export class WaterSim {
  constructor(level, resolution = 168) {
    this.level = level;
    const { w, h } = level.bounds;
    this.worldW = w;
    this.worldH = h;

    if (w >= h) {
      this.gw = resolution;
      this.gh = Math.max(8, Math.round((resolution * h) / w));
    } else {
      this.gh = resolution;
      this.gw = Math.max(8, Math.round((resolution * w) / h));
    }
    this.cellX = w / this.gw;
    this.cellZ = h / this.gh;

    const n = this.gw * this.gh;
    this.u = new Float32Array(n); // height
    this.v = new Float32Array(n); // vertical velocity
    this.mask = new Float32Array(n); // 1 = water, 0 = solid (land or log)
    this.damp = new Float32Array(n);
    this.shore = new Float32Array(n); // signed distance to shoreline

    const logFns = level.logs.map((l) => capsule(l.x1, l.z1, l.x2, l.z2, l.r + 0.12));

    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const idx = j * this.gw + i;
        const x = (i + 0.5) * this.cellX - w / 2;
        const z = (j + 0.5) * this.cellZ - h / 2;
        const sd = level.sdf(x, z);
        this.shore[idx] = sd;

        let solid = sd > -this.cellX * 0.6;
        for (const lf of logFns) if (lf(x, z) < 0) solid = true;
        this.mask[idx] = solid ? 0 : 1;

        let d = BASE_DAMP;
        for (const wd of level.weeds) {
          const dist = Math.hypot(x - wd.x, z - wd.z);
          if (dist < wd.r) {
            const t = 1 - dist / wd.r;
            d = Math.min(d, BASE_DAMP + (WEED_DAMP - BASE_DAMP) * Math.min(1, t * 1.6));
          }
        }
        // extra damping near the shore stops standing waves ringing forever
        if (sd > -1.0) d -= 0.0055;
        this.damp[idx] = d;
      }
    }
  }

  worldToGridX(x) { return (x + this.worldW / 2) / this.cellX - 0.5; }
  worldToGridZ(z) { return (z + this.worldH / 2) / this.cellZ - 0.5; }

  step() {
    const { u, v, mask, damp, gw, gh } = this;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let j = 1; j < gh - 1; j++) {
        const row = j * gw;
        for (let i = 1; i < gw - 1; i++) {
          const c = row + i;
          if (mask[c] === 0) continue;
          const uc = u[c];
          // Reflective boundaries: a solid neighbour mirrors the centre height.
          const l = mask[c - 1] ? u[c - 1] : uc;
          const r = mask[c + 1] ? u[c + 1] : uc;
          const t = mask[c - gw] ? u[c - gw] : uc;
          const b = mask[c + gw] ? u[c + gw] : uc;
          const lap = (l + r + t + b) * 0.25 - uc;
          v[c] = (v[c] + lap * (WAVE_C * 4)) * damp[c];
        }
      }
      for (let j = 1; j < gh - 1; j++) {
        const row = j * gw;
        for (let i = 1; i < gw - 1; i++) {
          const c = row + i;
          if (!mask[c]) continue;
          let h = u[c] + v[c] * (1 / SUBSTEPS);
          // soft amplitude cap: stacked taps can't heave the surface over the banks
          if (h > 0.38) { h = 0.38 + (h - 0.38) * 0.25; if (h > 0.52) h = 0.52; }
          else if (h < -0.38) { h = -0.38 + (h + 0.38) * 0.25; if (h < -0.52) h = -0.52; }
          u[c] = h;
        }
      }
    }
  }

  // A tap: heave the surface up in a gaussian mound. It collapses into an
  // outgoing crest ring — and crests are what shove the ducks.
  splash(x, z, radius, strength) {
    const gx = this.worldToGridX(x);
    const gz = this.worldToGridZ(z);
    const rc = Math.max(1.5, radius / this.cellX);
    const span = Math.ceil(rc * 2.2);
    const i0 = Math.max(1, Math.floor(gx - span));
    const i1 = Math.min(this.gw - 2, Math.ceil(gx + span));
    const j0 = Math.max(1, Math.floor(gz - span));
    const j1 = Math.min(this.gh - 2, Math.ceil(gz + span));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.gw + i;
        if (this.mask[c] === 0) continue;
        const dx = (i - gx) / rc;
        const dz = (j - gz) / rc;
        const g = Math.exp(-(dx * dx + dz * dz) * 2.2);
        this.u[c] = Math.min(this.u[c] + strength * g, 0.6); // taps can't pile past the cap
        this.v[c] += strength * 0.35 * g;
      }
    }
  }

  sampleBilinear(arr, x, z) {
    const gx = Math.min(Math.max(this.worldToGridX(x), 0), this.gw - 1.001);
    const gz = Math.min(Math.max(this.worldToGridZ(z), 0), this.gh - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const c = j * this.gw + i;
    const a = arr[c] + (arr[c + 1] - arr[c]) * fx;
    const b = arr[c + this.gw] + (arr[c + this.gw + 1] - arr[c + this.gw]) * fx;
    return a + (b - a) * fz;
  }

  heightAt(x, z) { return this.sampleBilinear(this.u, x, z); }

  gradientAt(x, z, out) {
    const e = this.cellX;
    out.x = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    out.z = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out;
  }
}

// ---------------------------------------------------------------------------

const waterVertex = /* glsl */ `
  uniform sampler2D uHeight;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    // flip V so texture row 0 lands at world -z, matching the sim grid
    vUv = vec2(uv.x, 1.0 - uv.y);
    vec3 p = position;
    p.z += texture2D(uHeight, vUv).r; // plane is XY before the -90deg X rotation
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const waterFragment = /* glsl */ `
  uniform sampler2D uHeight;
  uniform sampler2D uShore;
  uniform vec2 uTexel;
  uniform vec2 uCell;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uSkyHigh;
  uniform vec3 uSkyLow;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    float shoreD = texture2D(uShore, vUv).r;
    if (shoreD > 0.0) discard;

    float hL = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
    float hR = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r;
    float hD = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
    float hU = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r;
    float h  = texture2D(uHeight, vUv).r;

    vec3 n = normalize(vec3(hL - hR, 2.0 * uCell.x, hD - hU));

    // faint ambient ripple so still water never looks frozen
    vec2 p = vWorldPos.xz;
    n.x += 0.014 * sin(p.x * 2.4 + uTime * 0.9) + 0.009 * sin(p.x * 5.3 - uTime * 1.7 + p.y);
    n.z += 0.014 * cos(p.y * 2.1 - uTime * 0.8) + 0.009 * cos(p.y * 4.7 + uTime * 1.4 + p.x);
    n = normalize(n);

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    fresnel = 0.13 + 0.87 * fresnel;

    float depth = clamp(-shoreD / 2.6, 0.0, 1.0);
    vec3 waterCol = mix(uShallowColor, uDeepColor, depth);
    // waves shade their troughs and brighten their crests a touch
    waterCol *= 1.0 + h * 1.4;

    vec3 refl = reflect(-viewDir, n);
    vec3 sky = mix(uSkyLow, uSkyHigh, clamp(refl.y, 0.0, 1.0));

    vec3 col = mix(waterCol, sky, fresnel * 0.75);

    // sun glints
    float spec = pow(max(dot(refl, uSunDir), 0.0), 220.0);
    col += vec3(1.0, 0.95, 0.82) * spec * 1.6;
    float soft = pow(max(dot(refl, uSunDir), 0.0), 18.0);
    col += vec3(1.0, 0.9, 0.7) * soft * 0.08;

    // foam: a lapping line at the shore plus white on energetic crests
    float shoreFoam = smoothstep(-0.22, -0.02, shoreD) * (0.55 + 0.45 * sin(uTime * 1.4 + p.x * 3.0 + p.y * 2.2));
    float crestFoam = smoothstep(0.045, 0.14, abs(hR - hL) + abs(hU - hD));
    float foam = clamp(shoreFoam * 0.55 + crestFoam * 0.65, 0.0, 1.0);
    col = mix(col, vec3(0.96, 0.98, 0.95), foam);

    float alpha = mix(0.86, 0.97, fresnel);
    alpha = mix(alpha, 0.55, smoothstep(-0.1, 0.0, shoreD)); // soften the very edge
    gl_FragColor = vec4(col, alpha);
  }
`;

export class WaterMesh {
  constructor(sim, sunDir) {
    this.sim = sim;

    this.heightTex = new THREE.DataTexture(
      sim.u, sim.gw, sim.gh, THREE.RedFormat, THREE.FloatType,
    );
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.needsUpdate = true;

    this.shoreTex = new THREE.DataTexture(
      sim.shore, sim.gw, sim.gh, THREE.RedFormat, THREE.FloatType,
    );
    this.shoreTex.magFilter = THREE.LinearFilter;
    this.shoreTex.minFilter = THREE.LinearFilter;
    this.shoreTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(sim.worldW, sim.worldH, sim.gw - 1, sim.gh - 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      transparent: true,
      uniforms: {
        uHeight: { value: this.heightTex },
        uShore: { value: this.shoreTex },
        uTexel: { value: new THREE.Vector2(1 / sim.gw, 1 / sim.gh) },
        uCell: { value: new THREE.Vector2(sim.cellX, sim.cellZ) },
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone().normalize() },
        uDeepColor: { value: new THREE.Color(0x2a6661) },
        uShallowColor: { value: new THREE.Color(0x6cb5a4) },
        uSkyHigh: { value: new THREE.Color(0xbfe3f2) },
        uSkyLow: { value: new THREE.Color(0xe8f4e0) },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
  }

  update(time) {
    this.material.uniforms.uTime.value = time;
    this.heightTex.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.heightTex.dispose();
    this.shoreTex.dispose();
  }
}
