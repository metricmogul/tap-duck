// All sound is synthesised with WebAudio — no assets needed.
// ensure() must be called from a user gesture before anything will play.

let ctx = null;
let master = null;
let noiseBuf = null;

export function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  startAmbience();
}

function env(gainNode, t0, peak, attack, decay) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

// Water plop: a pitch-dropping sine plus a short splash of filtered noise.
export function plop(strength = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = Math.min(strength, 3);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300 + s * 60, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.13);
  const og = ctx.createGain();
  env(og, t, 0.16 * s, 0.008, 0.16);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.25);

  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(900 + s * 500, t);
  f.frequency.exponentialRampToValueAtTime(250, t + 0.18);
  const ng = ctx.createGain();
  env(ng, t, 0.07 * s, 0.005, 0.18);
  n.connect(f).connect(ng).connect(master);
  n.start(t, Math.random() * 0.5);
  n.stop(t + 0.25);
}

// Rubber-duck squeak for a penned duck.
export function squeak(combo = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const base = 760 * Math.pow(1.08, Math.min(combo, 8));
  for (let i = 0; i < 2; i++) {
    const t0 = t + i * 0.085;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base * (i ? 1.32 : 1), t0);
    osc.frequency.exponentialRampToValueAtTime(base * (i ? 1.05 : 1.45), t0 + 0.07);
    const g = ctx.createGain();
    env(g, t0, 0.12, 0.012, 0.09);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }
}

// Soft pop for newly arriving ducks.
export function pop() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(640, t + 0.06);
  const g = ctx.createGain();
  env(g, t, 0.08, 0.01, 0.09);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.15);
}

// A little arpeggio when the pond is cleared.
export function fanfare() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t0 = t + i * 0.13;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = ctx.createGain();
    env(g, t0, 0.14, 0.015, 0.4);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  });
}

// A quiet bed of wind/water and the occasional far-off bird.
function startAmbience() {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.value = 0.018;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.008;
  lfo.connect(lfoG).connect(g.gain);
  n.connect(f).connect(g).connect(master);
  n.start();
  lfo.start();

  const chirp = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f0 = 2200 + Math.random() * 1400;
    for (let i = 0; i < 2 + (Math.random() * 2 | 0); i++) {
      const t0 = t + i * 0.12;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0 * (1 + Math.random() * 0.1), t0);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.72, t0 + 0.08);
      const g2 = ctx.createGain();
      env(g2, t0, 0.012, 0.01, 0.08);
      osc.connect(g2).connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.12);
    }
    setTimeout(chirp, 5000 + Math.random() * 11000);
  };
  setTimeout(chirp, 4000);
}
