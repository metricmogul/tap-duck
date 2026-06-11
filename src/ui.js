import * as THREE from 'three';

// Thin wrapper over the HTML HUD.

const els = {
  score: document.getElementById('score'),
  levelName: document.getElementById('level-name'),
  best: document.getElementById('best'),
  clock: document.getElementById('clock'),
  sunDot: document.getElementById('sun-dot'),
  windRow: document.getElementById('wind-row'),
  windArrow: document.getElementById('wind-arrow'),
  penned: document.getElementById('penned'),
  target: document.getElementById('target'),
  progressBar: document.getElementById('progress-bar'),
  overlayIntro: document.getElementById('overlay-intro'),
  overlayLevel: document.getElementById('overlay-level'),
  dayDoneTitle: document.getElementById('day-done-title'),
  dayDoneStars: document.getElementById('day-done-stars'),
  dayDoneText: document.getElementById('day-done-text'),
  btnStart: document.getElementById('btn-start'),
  btnNext: document.getElementById('btn-next'),
  toasts: document.getElementById('toasts'),
};

const v = new THREE.Vector3();

export const ui = {
  setScore(s) { els.score.textContent = s; },
  setLevelName(n) { els.levelName.textContent = n; },
  setBest(stars) {
    els.best.textContent = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  },
  // remaining seconds + fraction of the day elapsed (drives the sun dot)
  setClock(secondsLeft, dayFrac, goldenHour) {
    const s = Math.max(0, Math.ceil(secondsLeft));
    els.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    els.sunDot.style.left = `${Math.min(100, dayFrac * 100)}%`;
    els.clock.classList.toggle('golden', goldenHour);
  },
  setWind(angle, speed) {
    if (!speed) {
      els.windRow.style.display = 'none';
      return;
    }
    els.windRow.style.display = '';
    // screen-space: world +x is right, world +z is down
    els.windArrow.style.transform = `rotate(${angle}rad)`;
  },
  setProgress(penned, target) {
    els.penned.textContent = penned;
    els.target.textContent = target;
    els.progressBar.style.width = `${Math.min(100, (penned / target) * 100)}%`;
  },
  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  },
  showIntro(onStart) {
    els.overlayIntro.classList.remove('hidden');
    els.btnStart.onclick = () => {
      els.overlayIntro.classList.add('hidden');
      onStart();
    };
  },
  showDayEnd({ levelName, cleared, total, stars, score, isBest }, onNext) {
    els.dayDoneTitle.textContent = `The sun sets on ${levelName}`;
    els.dayDoneStars.innerHTML = [0, 1, 2]
      .map((i) => `<span class="${i < stars ? 'star on' : 'star'}">★</span>`)
      .join('');
    els.dayDoneText.textContent =
      `${cleared} of ${total} ducks home` +
      (cleared >= total ? ' — a perfect day!' : '.') +
      ` Score: ${score}.` +
      (isBest ? ' New best!' : '');
    els.overlayLevel.classList.remove('hidden');
    els.btnNext.onclick = () => {
      els.overlayLevel.classList.add('hidden');
      onNext();
    };
  },
  floater(text, worldPos, camera, color) {
    v.copy(worldPos).project(camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (color) el.style.color = color;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  },
};
