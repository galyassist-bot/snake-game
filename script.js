/* Snake — vanilla JS canvas implementation
 * Controls: arrows / WASD, Space pause/start, R restart
 */

(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Retina/HiDPI canvas: match backing store to CSS pixels to avoid blur on iPhone
  function resizeCanvasToCSSPixels() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // Backing store in device pixels
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    // Draw in CSS pixels (so all existing math stays in px)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const elScore = document.getElementById('score');
  const elBest = document.getElementById('best');
  const elSpeed = document.getElementById('speed');

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const btnStart = document.getElementById('btnStart');
  const btnHow = document.getElementById('btnHow');
  const btnRestart = document.getElementById('btnRestart');

  const selSize = document.getElementById('selSize');
  const selSpeed = document.getElementById('selSpeed');
  const chkWalls = document.getElementById('chkWalls');

  const STORAGE_KEY_BEST = 'snake.best';

  const COLORS = {
    bg: 'rgba(255,255,255,0.03)',
    grid: 'rgba(255,255,255,0.06)',
    snake: '#42f59b',
    snake2: '#2fd18d',
    head: '#b8ffe1',
    food: '#ffcc66',
    food2: '#ffb84d',
    text: 'rgba(232,238,252,0.82)',
  };

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function eq(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function wrapPos(p, size) {
    return {
      x: (p.x + size) % size,
      y: (p.y + size) % size,
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function getBest() {
    const n = Number(localStorage.getItem(STORAGE_KEY_BEST) || '0');
    return Number.isFinite(n) ? n : 0;
  }

  function setBest(n) {
    localStorage.setItem(STORAGE_KEY_BEST, String(n));
  }

  // --- Game state ---
  let size = Number(selSize.value);
  let tile = Math.floor(canvas.width / size);

  let baseTickMs = Number(selSpeed.value);
  let tickMs = baseTickMs;

  let walls = chkWalls.checked;

  let running = false;
  let paused = false;
  let dead = false;

  let score = 0;
  let best = getBest();

  let snake = []; // array of {x,y}, head at index 0
  let dir = DIRS.right;
  let nextDir = DIRS.right;

  let food = { x: 0, y: 0 };

  // timing
  let lastStepTs = 0;
  let rafId = 0;

  // swipe controls
  let pointerDown = null;

  function recomputeBoard() {
    size = Number(selSize.value);
    tile = Math.floor(canvas.width / size);
  }

  function resetState({ keepBest = true } = {}) {
    recomputeBoard();
    walls = chkWalls.checked;

    baseTickMs = Number(selSpeed.value);
    tickMs = baseTickMs;

    running = false;
    paused = false;
    dead = false;

    score = 0;
    best = keepBest ? getBest() : 0;

    const mid = Math.floor(size / 2);
    snake = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];

    dir = DIRS.right;
    nextDir = DIRS.right;

    placeFood();

    updateHud();
    showOverlay('Snake', 'Press Space to start. Use Arrow keys or WASD.');
  }

  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function updateHud() {
    elScore.textContent = String(score);
    elBest.textContent = String(best);
    const mult = baseTickMs / tickMs;
    elSpeed.textContent = `${mult.toFixed(1)}×`;
  }

  function setDir(newDir) {
    // Disallow reversing into itself
    if (newDir.x === -dir.x && newDir.y === -dir.y) return;
    nextDir = newDir;
  }

  function placeFood() {
    // naive retry; board is small
    for (let i = 0; i < 10_000; i++) {
      const p = { x: randInt(0, size - 1), y: randInt(0, size - 1) };
      if (!snake.some(s => eq(s, p))) {
        food = p;
        return;
      }
    }
    // fallback: if completely full, keep food at head
    food = { ...snake[0] };
  }

  function die(reasonText) {
    running = false;
    paused = false;
    dead = true;

    if (score > best) {
      best = score;
      setBest(best);
    }

    updateHud();
    showOverlay('Game Over', `${reasonText}\nPress R to restart or Space to play again.`);
  }

  function start() {
    if (dead) {
      resetState();
    }
    running = true;
    paused = false;
    dead = false;
    lastStepTs = performance.now();
    hideOverlay();
  }

  function togglePause() {
    if (!running) {
      start();
      return;
    }
    paused = !paused;
    if (paused) {
      showOverlay('Paused', 'Press Space to resume.');
    } else {
      hideOverlay();
      lastStepTs = performance.now();
    }
  }

  function restart() {
    resetState();
  }

  function step() {
    dir = nextDir;

    const head = snake[0];
    let newHead = { x: head.x + dir.x, y: head.y + dir.y };

    if (walls) {
      if (newHead.x < 0 || newHead.x >= size || newHead.y < 0 || newHead.y >= size) {
        die('You hit a wall.');
        return;
      }
    } else {
      newHead = wrapPos(newHead, size);
    }

    // moving into tail is allowed if tail is removed in same tick
    const willEat = eq(newHead, food);
    const tail = snake[snake.length - 1];

    const hitsSelf = snake.some((seg, idx) => {
      if (idx === snake.length - 1 && !willEat) {
        // tail will move away, so allow stepping into it
        return eq(seg, newHead) && !eq(seg, tail);
      }
      return eq(seg, newHead);
    });

    if (hitsSelf) {
      die('You ran into yourself.');
      return;
    }

    snake.unshift(newHead);

    if (willEat) {
      score += 1;
      // speed up gradually but cap at ~2.5x
      const target = clamp(baseTickMs - score * 2.5, 45, baseTickMs);
      tickMs = Math.round(lerp(tickMs, target, 0.35));
      placeFood();
    } else {
      snake.pop();
    }

    if (score > best) {
      best = score;
      setBest(best);
    }

    updateHud();
  }

  function draw() {
    // clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // grid
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;

    // draw fewer grid lines if board very dense
    const step = size > 26 ? 2 : 1;
    for (let i = 0; i <= size; i += step) {
      const p = i * tile + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size * tile);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size * tile, p);
      ctx.stroke();
    }
    ctx.restore();

    // food
    drawFood(food);

    // snake
    drawSnake();

    // paused hint overlay on canvas (small)
    if (!running && !dead) {
      drawCenterText('Press Space to start', 18);
    }
    if (paused) {
      drawCenterText('Paused', 22);
    }
  }

  function drawCenterText(text, sizePx) {
    ctx.save();
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 ${sizePx}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawFood(p) {
    const x = p.x * tile;
    const y = p.y * tile;
    const pad = Math.max(2, Math.floor(tile * 0.12));
    const r = Math.max(6, Math.floor(tile * 0.28));

    const grad = ctx.createRadialGradient(
      x + tile * 0.35,
      y + tile * 0.35,
      2,
      x + tile / 2,
      y + tile / 2,
      tile
    );
    grad.addColorStop(0, COLORS.food);
    grad.addColorStop(1, COLORS.food2);

    ctx.save();
    ctx.fillStyle = grad;
    roundRect(x + pad, y + pad, tile - pad * 2, tile - pad * 2, r);
    ctx.fill();
    ctx.restore();
  }

  function drawSnake() {
    ctx.save();
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const x = seg.x * tile;
      const y = seg.y * tile;
      const pad = Math.max(1, Math.floor(tile * 0.10));
      const r = Math.max(6, Math.floor(tile * 0.28));

      const isHead = i === 0;
      const base = isHead ? COLORS.head : (i % 2 === 0 ? COLORS.snake : COLORS.snake2);

      ctx.fillStyle = base;
      roundRect(x + pad, y + pad, tile - pad * 2, tile - pad * 2, r);
      ctx.fill();

      if (isHead) {
        // eyes
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const ex = x + tile * 0.35;
        const ey = y + tile * 0.35;
        const e2x = x + tile * 0.65;
        const rEye = Math.max(2, Math.floor(tile * 0.06));
        ctx.beginPath();
        ctx.arc(ex, ey, rEye, 0, Math.PI * 2);
        ctx.arc(e2x, ey, rEye, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);

    if (running && !paused && !dead) {
      const elapsed = ts - lastStepTs;
      if (elapsed >= tickMs) {
        // handle multiple steps if tab lagged
        const steps = Math.min(5, Math.floor(elapsed / tickMs));
        for (let i = 0; i < steps; i++) {
          step();
          if (!running) break;
        }
        lastStepTs = ts;
      }
    }

    draw();
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();

    if (k === 'arrowup' || k === 'w') setDir(DIRS.up);
    else if (k === 'arrowdown' || k === 's') setDir(DIRS.down);
    else if (k === 'arrowleft' || k === 'a') setDir(DIRS.left);
    else if (k === 'arrowright' || k === 'd') setDir(DIRS.right);
    else if (k === ' ') {
      e.preventDefault();
      togglePause();
    } else if (k === 'r') {
      restart();
    }
  }

  function onPointerDown(e) {
    pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerUp(e) {
    if (!pointerDown) return;
    const dx = e.clientX - pointerDown.x;
    const dy = e.clientY - pointerDown.y;
    const dt = performance.now() - pointerDown.t;
    pointerDown = null;

    // tap
    if (Math.hypot(dx, dy) < 12 || dt < 120) {
      togglePause();
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      setDir(dx > 0 ? DIRS.right : DIRS.left);
    } else {
      setDir(dy > 0 ? DIRS.down : DIRS.up);
    }
  }

  // UI wiring
  btnStart.addEventListener('click', () => start());
  btnRestart.addEventListener('click', () => restart());
  btnHow.addEventListener('click', () => {
    showOverlay('How to play',
      'Eat the food to grow. Don\'t hit walls (if enabled) and don\'t bite yourself.\n\nControls: Arrow keys / WASD, Space = pause/start, R = restart.');
  });

  selSize.addEventListener('change', () => restart());
  selSpeed.addEventListener('change', () => {
    baseTickMs = Number(selSpeed.value);
    tickMs = baseTickMs;
    updateHud();
  });
  chkWalls.addEventListener('change', () => {
    walls = chkWalls.checked;
  });

  function wireMobileButtons() {
    const mcUp = document.getElementById('mcUp');
    const mcDown = document.getElementById('mcDown');
    const mcLeft = document.getElementById('mcLeft');
    const mcRight = document.getElementById('mcRight');

    const press = (el, d) => {
      if (!el) return;
      // Use pointer events so it works on touch + mouse
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (d) setDir(d);
        // If game hasn't started yet, start on first directional press
        if (!running && !dead) start();
      });
    };

    press(mcUp, DIRS.up);
    press(mcDown, DIRS.down);
    press(mcLeft, DIRS.left);
    press(mcRight, DIRS.right);

  }

  // keyboard + touch
  window.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { pointerDown = null; });

  // prevent double-tap zoom / scroll quirks
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

  wireMobileButtons();

  // init
  elBest.textContent = String(best);
  resetState();

  // Resize once after layout and on orientation changes
  queueMicrotask(resizeCanvasToCSSPixels);
  window.addEventListener('resize', () => resizeCanvasToCSSPixels(), { passive: true });
  window.addEventListener('orientationchange', () => resizeCanvasToCSSPixels(), { passive: true });

  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
})();
