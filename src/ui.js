import * as THREE from 'three';

// Thin wrapper over the HTML HUD.

const els = {
  score: document.getElementById('score'),
  levelName: document.getElementById('level-name'),
  duckCount: document.getElementById('duck-count'),
  spawnTimer: document.getElementById('spawn-timer'),
  spawnCount: document.getElementById('spawn-count'),
  penned: document.getElementById('penned'),
  target: document.getElementById('target'),
  progressBar: document.getElementById('progress-bar'),
  overlayIntro: document.getElementById('overlay-intro'),
  overlayLevel: document.getElementById('overlay-level'),
  levelDoneTitle: document.getElementById('level-done-title'),
  levelDoneText: document.getElementById('level-done-text'),
  btnStart: document.getElementById('btn-start'),
  btnNext: document.getElementById('btn-next'),
};

const v = new THREE.Vector3();

export const ui = {
  setScore(s) { els.score.textContent = s; },
  setLevelName(n) { els.levelName.textContent = n; },
  setDuckCount(n) { els.duckCount.textContent = n; },
  setSpawn(seconds, count) {
    els.spawnTimer.textContent = Math.max(0, Math.ceil(seconds));
    els.spawnTimer.classList.toggle('urgent', seconds < 4);
    els.spawnCount.textContent = `+${count}`;
  },
  setProgress(penned, target) {
    els.penned.textContent = penned;
    els.target.textContent = target;
    els.progressBar.style.width = `${Math.min(100, (penned / target) * 100)}%`;
  },
  showIntro(onStart) {
    els.overlayIntro.classList.remove('hidden');
    els.btnStart.onclick = () => {
      els.overlayIntro.classList.add('hidden');
      onStart();
    };
  },
  showLevelDone(levelName, score, onNext) {
    els.levelDoneTitle.textContent = `${levelName} cleared!`;
    els.levelDoneText.textContent = `Every duck is safely home. Score so far: ${score}.`;
    els.overlayLevel.classList.remove('hidden');
    els.btnNext.onclick = () => {
      els.overlayLevel.classList.add('hidden');
      onNext();
    };
  },
  // floating "+10" text anchored to a world position
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
