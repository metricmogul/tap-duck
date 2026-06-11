// Signed-distance helpers used to define pond shapes.
// Convention: negative = inside the water, positive = on land.

export function circle(cx, cz, r) {
  return (x, z) => Math.hypot(x - cx, z - cz) - r;
}

export function capsule(x1, z1, x2, z2, r) {
  const dx = x2 - x1, dz = z2 - z1;
  const len2 = dx * dx + dz * dz || 1e-9;
  return (x, z) => {
    let t = ((x - x1) * dx + (z - z1) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) - r;
  };
}

// Smooth subtraction — carves islands out of a pond.
export function smoothSubtract(k, base, ...cuts) {
  return (x, z) => {
    let d = base(x, z);
    for (const cut of cuts) {
      const b = -cut(x, z);
      const h = Math.max(0, Math.min(1, 0.5 - (0.5 * (d - b)) / k));
      d = d + (b - d) * h + k * h * (1 - h);
    }
    return d;
  };
}

// Smooth union — blends shapes into one organic pond.
export function smoothUnion(k, ...fns) {
  return (x, z) => {
    let d = fns[0](x, z);
    for (let i = 1; i < fns.length; i++) {
      const b = fns[i](x, z);
      const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - d)) / k));
      d = b + (d - b) * h - k * h * (1 - h);
    }
    return d;
  };
}

// Numerical gradient of an SDF (points toward land).
export function sdfGradient(sdf, x, z, out) {
  const e = 0.05;
  const gx = sdf(x + e, z) - sdf(x - e, z);
  const gz = sdf(x, z + e) - sdf(x, z - e);
  const len = Math.hypot(gx, gz) || 1e-9;
  out.x = gx / len;
  out.z = gz / len;
  return out;
}

// Deterministic RNG so each level's decorations are stable across reloads.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap value noise for terrain/texture variation.
export function makeNoise2D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const grads = new Float32Array(512);
  for (let i = 0; i < 512; i++) grads[i] = rand() * 2 - 1;

  function hash(ix, iz) {
    return perm[(perm[ix & 255] + iz) & 255];
  }
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const v00 = grads[hash(ix, iz)];
    const v10 = grads[hash(ix + 1, iz)];
    const v01 = grads[hash(ix, iz + 1)];
    const v11 = grads[hash(ix + 1, iz + 1)];
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sz; // roughly -1..1
  };
}
