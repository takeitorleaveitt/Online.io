// Animated "alive" backdrop shown behind the main menu: drifting orbs,
// wandering creature blobs that occasionally collide and explode, a slowly
// panning camera, and ambient floating particles.
(function () {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);

  const ZONE_COLORS = ['#2e7d46', '#c9a34e', '#8fd3e8', '#7a2618', '#7b4fd6', '#5ad1ff'];
  const particles = new ParticlePool(300);

  let orbs = [];
  let creatures = [];
  let blobs = [];
  let camAngle = Math.random() * Math.PI * 2;
  let running = false;
  let rafId = null;
  let lastT = 0;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function initWorld() {
    blobs = [];
    for (let i = 0; i < 6; i++) {
      blobs.push({
        x: Math.random() * 2400 - 1200, y: Math.random() * 1600 - 800,
        r: 180 + Math.random() * 220, color: ZONE_COLORS[i % ZONE_COLORS.length],
      });
    }
    orbs = [];
    for (let i = 0; i < 60; i++) {
      orbs.push({
        x: Math.random() * 2400 - 1200, y: Math.random() * 1600 - 800,
        r: 2 + Math.random() * 3, phase: Math.random() * 10,
        color: Math.random() < 0.7 ? '#5ad1ff' : '#ffd75a',
      });
    }
    creatures = [];
    const colors = ['#5ad1ff', '#ff5a5a', '#ffd75a', '#8fff5a', '#c77bff', '#ff9d5a'];
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      creatures.push({
        x: Math.random() * 2400 - 1200, y: Math.random() * 1600 - 800,
        r: 8 + Math.random() * 14, angle: ang, turnT: Math.random() * 5,
        speed: 18 + Math.random() * 30, color: colors[Math.floor(Math.random() * colors.length)],
        hitCd: Math.random() * 3,
      });
    }
  }
  initWorld();

  function explode(x, y, color) {
    particles.burst(x, y, 26, {
      color: [color, '#ffffff', '#ffd75a'], minSpeed: 60, maxSpeed: 260,
      minLife: 0.3, maxLife: 0.8, minSize: 2, maxSize: 6, glow: true, drag: 0.9,
    });
  }

  function step(dt, t) {
    camAngle += dt * 0.015;
    const camX = Math.cos(camAngle * 0.6) * 260 + Math.sin(t * 0.05) * 60;
    const camY = Math.sin(camAngle * 0.5) * 180 + Math.cos(t * 0.04) * 40;

    for (const c of creatures) {
      c.turnT -= dt;
      if (c.turnT <= 0) { c.turnT = 2 + Math.random() * 4; c.angle += (Math.random() - 0.5) * 2.2; }
      c.x += Math.cos(c.angle) * c.speed * dt;
      c.y += Math.sin(c.angle) * c.speed * dt;
      if (c.x < -1300) c.angle = 0; if (c.x > 1300) c.angle = Math.PI;
      if (c.y < -900) c.angle = Math.PI / 2; if (c.y > 900) c.angle = -Math.PI / 2;
      c.hitCd -= dt;
    }
    for (let i = 0; i < creatures.length; i++) {
      for (let j = i + 1; j < creatures.length; j++) {
        const a = creatures[i], b = creatures[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const rr = (a.r + b.r);
        if (dx * dx + dy * dy < rr * rr && a.hitCd <= 0 && b.hitCd <= 0 && Math.random() < 0.02) {
          a.hitCd = 4 + Math.random() * 3; b.hitCd = 4 + Math.random() * 3;
          explode((a.x + b.x) / 2, (a.y + b.y) / 2, a.color);
          a.angle += Math.PI * 0.6; b.angle -= Math.PI * 0.6;
        }
      }
    }
    if (Math.random() < 0.004) {
      const c = creatures[Math.floor(Math.random() * creatures.length)];
      explode(c.x, c.y, c.color);
    }

    for (const o of orbs) {
      if (Math.random() < 0.002) particles.emit({
        x: o.x, y: o.y - o.r, vx: (Math.random() - 0.5) * 8, vy: -6 - Math.random() * 8,
        life: 1 + Math.random(), size: 1.5, endSize: 0, color: o.color, glow: true, drag: 0.99,
      });
    }

    particles.update(dt);
    return { camX, camY };
  }

  function draw(camX, camY, t) {
    ctx.clearRect(0, 0, W, H);
    const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, '#0b1120');
    grd.addColorStop(1, '#04060c');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2 - camX, H / 2 - camY);

    ctx.globalAlpha = 0.16;
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, b.color); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#ffffff08';
    ctx.lineWidth = 1;
    const gridSize = 90;
    const startX = Math.floor((camX - W) / gridSize) * gridSize;
    const startY = Math.floor((camY - H) / gridSize) * gridSize;
    for (let x = startX; x < camX + W; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, camY - H); ctx.lineTo(x, camY + H); ctx.stroke(); }
    for (let y = startY; y < camY + H; y += gridSize) { ctx.beginPath(); ctx.moveTo(camX - W, y); ctx.lineTo(camX + W, y); ctx.stroke(); }

    for (const o of orbs) {
      const bob = Math.sin(t * 1.4 + o.phase) * 3;
      ctx.beginPath();
      ctx.fillStyle = o.color;
      ctx.shadowColor = o.color; ctx.shadowBlur = 8;
      ctx.arc(o.x, o.y + bob, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const c of creatures) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.shadowColor = c.color; ctx.shadowBlur = 14;
      ctx.fillStyle = c.color + 'cc';
      ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, c.r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffffffdd';
      ctx.beginPath(); ctx.arc(c.r * 0.4, 0, c.r * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    particles.draw(ctx);
    ctx.restore();
  }

  function frame(ts) {
    if (!running) return;
    if (!lastT) lastT = ts;
    const dt = Math.min(0.05, (ts - lastT) / 1000);
    lastT = ts;
    const t = ts / 1000;
    const { camX, camY } = step(dt, t);
    draw(camX, camY, t);
    rafId = requestAnimationFrame(frame);
  }

  window.MenuBackground = {
    start() {
      if (running) return;
      running = true; lastT = 0;
      canvas.classList.remove('hidden');
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
})();
