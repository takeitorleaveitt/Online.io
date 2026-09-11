// Game canvas: rendering, camera, input capture, client-side prediction for
// the local player, and interpolation for every remote entity. The server
// remains authoritative — this file only smooths what the eye sees between
// the ~15Hz state snapshots and 60Hz screen refresh.
(function () {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);

  const worldParticles = new ParticlePool(900);

  let joinInfo = null;   // { worldSize, zones, weapons, abilities, evolutions, playerId }
  let prevSnap = null, curSnap = null, prevRecvAt = 0, curRecvAt = 0;
  let predicted = { x: 0, y: 0, inited: false };
  let serverSelfTarget = null;
  let camera = { x: 0, y: 0, zoom: 1 };
  let shake = { t: 0, mag: 0 };
  let running = false;
  let rafId = null;
  let isMobile = false;

  const input = { dx: 0, dy: 0, moving: false, aimAngle: 0, firing: false };
  const keys = {};
  let mouse = { x: 0, y: 0 };
  let mouseDown = false;
  let localFireNextAt = 0;
  let lastKillCount = 0, lastResourceCount = 0, lastHealth = null;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------- input capture ----------------
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
  function isTypingTarget() {
    const t = document.activeElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget()) return;
    keys[e.code] = true;
    if (e.code === 'Space') { e.preventDefault(); useAbility(); }
    const weaponKeyMap = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };
    if (weaponKeyMap[e.code] !== undefined && joinInfo) {
      const idx = weaponKeyMap[e.code];
      const self = curSnap && curSnap.self;
      if (self && self.unlockedWeapons[idx]) Net.weapon(self.unlockedWeapons[idx]);
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  const DASH_DISTANCE = 180;
  function useAbility() {
    const self = curSnap && curSnap.self;
    if (!self) return;
    if (self.abilityKey === 'dash' && predicted.inited) {
      // predict the server's instant-dash displacement locally so there's
      // nothing to "catch up" to on the next snapshot (removes a rubberband spike)
      const ang = input.moving ? Math.atan2(input.dy, input.dx) : input.aimAngle;
      const ws = joinInfo ? joinInfo.worldSize : 6000;
      const r = self.radius || 18;
      predicted.x = Math.max(r, Math.min(ws - r, predicted.x + Math.cos(ang) * DASH_DISTANCE));
      predicted.y = Math.max(r, Math.min(ws - r, predicted.y + Math.sin(ang) * DASH_DISTANCE));
    }
    Net.ability(self.abilityKey);
    SFX.ability();
  }
  document.getElementById('ability-btn').addEventListener('click', useAbility);

  // mobile joystick
  let joyActive = false, joyStart = { x: 0, y: 0 };
  const joyZone = document.getElementById('joystick-zone');
  const joyStick = document.getElementById('joystick-stick');
  function joyDown(x, y) { joyActive = true; joyStart = { x, y }; }
  function joyMove(x, y) {
    if (!joyActive) return;
    let dx = x - joyStart.x, dy = y - joyStart.y;
    const d = Math.hypot(dx, dy), max = 46;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, d / max);
    mobileMove.dx = mag > 0.08 ? dx / (d || 1) : 0;
    mobileMove.dy = mag > 0.08 ? dy / (d || 1) : 0;
    mobileMove.moving = mag > 0.08;
  }
  function joyUp() { joyActive = false; joyStick.style.transform = 'translate(0,0)'; mobileMove.moving = false; }
  const mobileMove = { dx: 0, dy: 0, moving: false };
  joyZone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; joyDown(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  joyZone.addEventListener('touchmove', (e) => { const t = e.changedTouches[0]; joyMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  joyZone.addEventListener('touchend', (e) => { joyUp(); e.preventDefault(); }, { passive: false });

  let mobileFiring = false;
  const fireBtn = document.getElementById('fire-btn');
  fireBtn.addEventListener('touchstart', (e) => { mobileFiring = true; e.preventDefault(); }, { passive: false });
  fireBtn.addEventListener('touchend', (e) => { mobileFiring = false; e.preventDefault(); }, { passive: false });

  function detectMobile() {
    isMobile = ('ontouchstart' in window) && window.innerWidth < 900;
    document.getElementById('mobile-controls').classList.toggle('hidden', !isMobile);
  }

  function zoneAtClient(x, y) {
    if (!joinInfo) return null;
    for (const z of joinInfo.zones) if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z;
    return null;
  }

  function computeInput(dt) {
    let dx = 0, dy = 0, moving = false;
    const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const ky = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (kx || ky) {
      const mag = Math.hypot(kx, ky) || 1;
      dx = kx / mag; dy = ky / mag; moving = true;
    } else if (isMobile) {
      dx = mobileMove.dx; dy = mobileMove.dy; moving = mobileMove.moving;
    } else {
      const cx = W / 2, cy = H / 2;
      const mdx = mouse.x - cx, mdy = mouse.y - cy;
      const dist = Math.hypot(mdx, mdy);
      if (dist > 12) { dx = mdx / dist; dy = mdy / dist; moving = true; }
    }
    let aimAngle;
    if (isMobile) aimAngle = moving ? Math.atan2(dy, dx) : input.aimAngle;
    else aimAngle = Math.atan2(mouse.y - H / 2, mouse.x - W / 2);

    input.dx = dx; input.dy = dy; input.moving = moving; input.aimAngle = aimAngle;
    input.firing = isMobile ? mobileFiring : mouseDown;

    Net.sendInput({ dx, dy, moving, aimAngle, firing: input.firing });

    // local prediction (mirrors server's applyMovement formula)
    if (predicted.inited) {
      const self = curSnap && curSnap.self;
      const speedBase = self ? self.speed : 220;
      const zone = zoneAtClient(predicted.x, predicted.y);
      let speedMul = 1;
      if (zone && zone.hazard === 'slow') speedMul *= 0.55;
      if (moving) {
        predicted.x += dx * speedBase * speedMul * dt;
        predicted.y += dy * speedBase * speedMul * dt;
      }
      const ws = joinInfo ? joinInfo.worldSize : 6000;
      const r = self ? self.radius : 18;
      predicted.x = Math.max(r, Math.min(ws - r, predicted.x));
      predicted.y = Math.max(r, Math.min(ws - r, predicted.y));

      // continuously (every rendered frame, not once per ~66ms network packet)
      // nudge the prediction toward the last known authoritative position.
      // Spreading the correction over many small frame-rate-independent steps
      // instead of one lump pull per snapshot is what removes the rubberbanding.
      if (serverSelfTarget) {
        const pull = 1 - Math.pow(0.0006, dt);
        predicted.x += (serverSelfTarget.x - predicted.x) * pull;
        predicted.y += (serverSelfTarget.y - predicted.y) * pull;
      }
    }

    // local optimistic fire sfx/vfx (server is still authoritative for damage)
    if (input.firing && curSnap && curSnap.self) {
      const w = joinInfo.weapons[curSnap.self.weapon];
      const now = performance.now();
      if (w && now >= localFireNextAt) {
        localFireNextAt = now + 1000 / w.fireRate;
        SFX.shoot(curSnap.self.weapon);
        muzzleFlash(predicted.x, predicted.y, input.aimAngle, w.color);
      }
    }
  }

  function muzzleFlash(x, y, angle, color) {
    worldParticles.emit({
      x: x + Math.cos(angle) * 24, y: y + Math.sin(angle) * 24,
      vx: Math.cos(angle) * 40, vy: Math.sin(angle) * 40,
      life: 0.12, size: 6, endSize: 0, color, glow: true, drag: 0.8,
    });
  }

  function triggerShake(mag, dur) { shake.mag = Math.max(shake.mag, mag); shake.t = Math.max(shake.t, dur); }

  // ---------------- net event wiring ----------------
  Net.on('joined', (data) => {
    joinInfo = data;
    predicted.inited = false;
    serverSelfTarget = null;
    detectMobile();
    document.getElementById('ability-label').textContent = 'DASH';
  });

  Net.on('state', (data) => {
    prevSnap = curSnap; curSnap = data;
    prevRecvAt = curRecvAt; curRecvAt = performance.now();
    if (!prevSnap) prevSnap = curSnap;

    const self = data.self;
    if (!predicted.inited) {
      predicted.x = self.x; predicted.y = self.y; predicted.inited = true;
      serverSelfTarget = { x: self.x, y: self.y };
    } else {
      const diff = Math.hypot(self.x - predicted.x, self.y - predicted.y);
      // only a genuine desync (respawn, big knockback) snaps instantly; everyday
      // drift (e.g. server-side collision separation the client doesn't simulate)
      // is bled off gradually every frame instead, which is what actually kills
      // the rubberbanding rather than one lump correction per network packet.
      if (diff > 320) { predicted.x = self.x; predicted.y = self.y; }
      serverSelfTarget = { x: self.x, y: self.y };
    }

    if (lastHealth !== null && self.health < lastHealth - 0.5) {
      SFX.damage();
      triggerShake(Math.min(14, (lastHealth - self.health) * 0.6), 0.18);
    }
    lastHealth = self.health;
    if (self.resourcesCollected > lastResourceCount) { SFX.collect(); }
    lastResourceCount = self.resourcesCollected;
    if (self.kills > lastKillCount) { SFX.destroy(); }
    lastKillCount = self.kills;

    for (const h of data.hits || []) {
      worldParticles.burst(h.x, h.y, h.c ? 14 : 7, {
        color: h.c ? ['#ffd75a', '#ffffff'] : ['#ff8f5a', '#ffd75a'], minSpeed: 40, maxSpeed: h.c ? 220 : 140,
        minLife: 0.25, maxLife: 0.5, minSize: 2, maxSize: h.c ? 5 : 3, glow: true,
      });
      spawnDamageNumber(h.x, h.y, h.a, h.c);
    }

    if (window.UI) window.UI.onState(data, joinInfo);
    if (window.Meta) {
      const unlocked = Meta.checkAchievements(self, data.myRank);
      unlocked.forEach((a) => window.UI && window.UI.toast('ACHIEVEMENT UNLOCKED', a.name));
      Meta.setMissionProgress('level', self.level);
      Meta.setMissionProgress('survival', Math.floor((Date.now() - self.spawnedAt) / 1000));
      if (data.myRank && data.myRank <= 10) Meta.setMissionProgress('top10', 1);
    }
  });

  Net.on('kill', (data) => {
    SFX.destroy();
    if (window.Meta) Meta.bumpMission(data.isBot ? 'botKills' : 'playerKills', 1);
  });

  Net.on('death', (stats) => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    SFX.death();
    triggerShake(20, 0.5);
    Music.stop();
    const earned = window.Meta ? Meta.recordMatchResult(stats) : 0;
    if (window.UI) window.UI.showDeathScreen(stats, earned);
  });

  Net.on('levelup', (data) => {
    SFX.levelup();
    worldParticles.burst(predicted.x, predicted.y, 40, { color: ['#5ad1ff', '#ffd75a', '#ffffff'], minSpeed: 80, maxSpeed: 320, minLife: 0.4, maxLife: 0.9, glow: true, maxSize: 6 });
    if (window.UI) window.UI.onLevelUp(data);
  });

  Net.on('evolutionAvailable', (data) => { if (window.UI) window.UI.showEvolution(data); });

  Net.on('worldEvent', (data) => {
    if (window.UI) window.UI.showEventBanner(data);
    if (data.type === 'redMoon' || data.type === 'chaos') Music.setMode('boss');
  });
  Net.on('worldEventEnd', () => { if (window.UI) window.UI.hideEventBanner(); Music.setMode(curSnap && curSnap.boss ? 'boss' : 'calm'); });

  Net.on('bossSpawned', (data) => {
    if (window.UI) window.UI.announceBoss(data);
    SFX.bossAnnounce();
    Music.setMode('boss');
  });
  Net.on('bossDefeated', (data) => {
    if (window.UI) window.UI.toast('BOSS DEFEATED', data.topName ? `Top damage: ${data.topName}` : '');
    Music.setMode('calm');
    if (window.Meta && data.topName) Meta.unlockAchievement('boss_slayer');
  });

  Net.on('chat', (msg) => { if (window.UI) window.UI.addChatMessage(msg); });

  // ---------------- floating damage numbers (screen-space, world-tracked) ----------------
  let dmgNumbers = [];
  function spawnDamageNumber(x, y, amount, crit) {
    dmgNumbers.push({ x, y, amount, crit, t: 0 });
  }

  // ---------------- rendering ----------------
  const BODY_DRAW = {
    core(ctx, r) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); },
    hex(ctx, r) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    },
    spike(ctx, r) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const rr = i % 2 === 0 ? r : r * 0.62; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    },
    orb(ctx, r) {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.stroke();
    },
  };

  function lerpAngle(a, b, t) {
    let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + diff * t;
  }

  function findById(list, id) { for (const e of list) if (e.id === id) return e; return null; }

  function interpEntities(prevList, curList, alpha) {
    return curList.map((c) => {
      const p = findById(prevList, c.id);
      if (!p) return c;
      return { ...c, x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, a: lerpAngle(p.a || 0, c.a || 0, alpha) };
    });
  }

  function drawZones() {
    if (!joinInfo) return;
    for (const z of joinInfo.zones) {
      ctx.fillStyle = z.color + '22';
      ctx.fillRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.strokeStyle = z.color + '55';
      ctx.lineWidth = 3;
      ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    }
    ctx.strokeStyle = '#ff5a5a55';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, joinInfo.worldSize, joinInfo.worldSize);
  }

  function drawGrid() {
    const gridSize = 200;
    const left = camera.x - W / camera.zoom / 2 - gridSize, right = camera.x + W / camera.zoom / 2 + gridSize;
    const top = camera.y - H / camera.zoom / 2 - gridSize, bottom = camera.y + H / camera.zoom / 2 + gridSize;
    ctx.strokeStyle = '#ffffff0a'; ctx.lineWidth = 1 / camera.zoom;
    for (let x = Math.floor(left / gridSize) * gridSize; x < right; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
    for (let y = Math.floor(top / gridSize) * gridSize; y < bottom; y += gridSize) { ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  }

  function drawResource(r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.shadowColor = r.c; ctx.shadowBlur = 10;
    ctx.fillStyle = r.c;
    const pulse = 1 + Math.sin(performance.now() / 250 + r.id) * 0.08;
    ctx.beginPath(); ctx.arc(0, 0, r.r * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawProjectile(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a || 0);
    ctx.shadowColor = p.c; ctx.shadowBlur = 12;
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.8, p.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.ellipse(-p.r * 2.4, 0, p.r * 2, p.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawHealthBar(x, y, w, hp, mhp, color) {
    const pct = Math.max(0, hp / mhp);
    ctx.fillStyle = '#00000088';
    ctx.fillRect(x - w / 2, y, w, 6);
    ctx.fillStyle = color || '#6bffb0';
    ctx.fillRect(x - w / 2, y, w * pct, 6);
  }

  function drawPlayer(p, isSelf) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.sh) {
      ctx.save();
      ctx.strokeStyle = '#5ad1ffaa'; ctx.lineWidth = 3; ctx.shadowColor = '#5ad1ff'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.rotate(p.a || 0);
    ctx.shadowColor = p.c; ctx.shadowBlur = isSelf ? 18 : 10;
    ctx.fillStyle = p.c;
    (BODY_DRAW[p.b] || BODY_DRAW.core)(ctx, p.r);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffffcc';
    ctx.beginPath(); ctx.arc(p.r * 0.4, 0, p.r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.font = `${isSelf ? 13 : 12}px Rajdhani, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = p.bot ? '#8ea0c2' : '#eaf2ff';
    ctx.fillText(`${p.n}${p.bot ? '' : ''}  Lv${p.lvl}`, 0, -p.r - 14);
    if (p.hp < p.mhp) drawHealthBar(0, -p.r - 10, Math.max(30, p.r), p.hp, p.mhp);
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.a || 0);
    ctx.shadowColor = e.c; ctx.shadowBlur = 12;
    ctx.fillStyle = e.c;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const rr = i % 2 === 0 ? e.r : e.r * 0.7; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    drawHealthBar(e.x, e.y - e.r - 12, e.r * 1.6, e.hp, e.mhp, '#8fa6ff');
  }

  function drawBoss(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    const pulse = 1 + Math.sin(performance.now() / 300) * 0.03;
    ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 40;
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(0, 0, b.r * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, b.r + 10, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawDamageNumbers(dt) {
    ctx.textAlign = 'center';
    dmgNumbers = dmgNumbers.filter((d) => d.t < 0.9);
    for (const d of dmgNumbers) {
      d.t += dt;
      const alpha = 1 - d.t / 0.9;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = d.crit ? 'bold 20px Orbitron, sans-serif' : 'bold 14px Rajdhani, sans-serif';
      ctx.fillStyle = d.crit ? '#ffd75a' : '#ff8f5a';
      ctx.fillText(Math.round(d.amount), d.x, d.y - d.t * 40 - 10);
      ctx.restore();
    }
  }

  function drawMinimap() {
    const mm = document.getElementById('minimap');
    const mctx = mm.getContext('2d');
    const size = mm.width;
    mctx.clearRect(0, 0, size, size);
    if (!joinInfo || !curSnap) return;
    const scale = size / joinInfo.worldSize;
    for (const z of joinInfo.zones) {
      mctx.fillStyle = z.color + '55';
      mctx.fillRect(z.x0 * scale, z.y0 * scale, (z.x1 - z.x0) * scale, (z.y1 - z.y0) * scale);
    }
    for (const p of curSnap.players) {
      mctx.fillStyle = p.id === curSnap.self.id ? '#5ad1ff' : (p.bot ? '#8ea0c288' : '#ff5a5a');
      mctx.beginPath(); mctx.arc(p.x * scale, p.y * scale, p.id === curSnap.self.id ? 3.5 : 2.2, 0, Math.PI * 2); mctx.fill();
    }
    if (curSnap.boss) {
      mctx.fillStyle = '#ff3b3b';
      mctx.beginPath(); mctx.arc(curSnap.boss.x * scale, curSnap.boss.y * scale, 4, 0, Math.PI * 2); mctx.fill();
    }
    mctx.strokeStyle = '#ffffff33'; mctx.lineWidth = 1;
    mctx.strokeRect(0, 0, size, size);
  }

  let lastFrameT = 0;
  function frame(ts) {
    if (!running) return;
    if (!lastFrameT) lastFrameT = ts;
    const dt = Math.min(0.05, (ts - lastFrameT) / 1000);
    lastFrameT = ts;

    computeInput(dt);
    worldParticles.update(dt);
    if (shake.t > 0) shake.t -= dt; else shake.mag *= 0.9;

    if (curSnap && curSnap.self) {
      const self = curSnap.self;
      const targetZoom = Math.max(0.38, Math.min(1.15, 1.15 * Math.sqrt(18 / Math.max(18, self.radius))));
      camera.zoom += (targetZoom - camera.zoom) * 0.08;
      camera.x += (predicted.x - camera.x) * 0.25;
      camera.y += (predicted.y - camera.y) * 0.25;
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#060911';
    ctx.fillRect(0, 0, W, H);

    const shakeX = shake.mag > 0.1 ? (Math.random() - 0.5) * shake.mag : 0;
    const shakeY = shake.mag > 0.1 ? (Math.random() - 0.5) * shake.mag : 0;

    ctx.save();
    ctx.translate(W / 2 * DPR + shakeX, H / 2 * DPR + shakeY);
    ctx.scale(camera.zoom * DPR, camera.zoom * DPR);
    ctx.translate(-camera.x, -camera.y);

    drawGrid();
    drawZones();

    if (curSnap) {
      const dtServer = Math.max(40, curRecvAt - prevRecvAt);
      let alpha = (performance.now() - curRecvAt) / dtServer;
      alpha = Math.max(0, Math.min(1, alpha));

      for (const r of curSnap.resources) drawResource(r);

      const enemies = interpEntities(prevSnap.enemies, curSnap.enemies, alpha);
      for (const e of enemies) drawEnemy(e);

      const projectiles = interpEntities(prevSnap.projectiles, curSnap.projectiles, alpha);
      for (const p of projectiles) drawProjectile(p);

      const players = interpEntities(prevSnap.players, curSnap.players, alpha);
      for (const p of players) {
        if (p.id === curSnap.self.id) continue;
        drawPlayer(p, false);
      }
      // draw local player at predicted position, using server-driven cosmetic/status flags
      const selfVisual = findById(curSnap.players, curSnap.self.id);
      if (selfVisual) drawPlayer({ ...selfVisual, x: predicted.x, y: predicted.y, a: input.aimAngle }, true);

      if (curSnap.boss) {
        const bossInterp = prevSnap.boss ? { ...curSnap.boss, x: prevSnap.boss.x + (curSnap.boss.x - prevSnap.boss.x) * alpha, y: prevSnap.boss.y + (curSnap.boss.y - prevSnap.boss.y) * alpha } : curSnap.boss;
        drawBoss(bossInterp);
      }

      if (curSnap.blackout) {
        ctx.fillStyle = '#00000055';
        ctx.fillRect(camera.x - W, camera.y - H, W * 2, H * 2);
      }
    }

    worldParticles.draw(ctx);
    drawDamageNumbers(dt);
    ctx.restore();

    drawMinimap();
    rafId = requestAnimationFrame(frame);
  }

  window.Game = {
    start() {
      running = true; lastFrameT = 0;
      predicted.inited = false;
      serverSelfTarget = null;
      dmgNumbers = [];
      lastHealth = null; lastKillCount = 0; lastResourceCount = 0;
      detectMobile();
      canvas.classList.remove('hidden');
      rafId = requestAnimationFrame(frame);
      Music.start('calm');
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.classList.add('hidden');
    },
    get self() { return curSnap && curSnap.self; },
    get joinInfo() { return joinInfo; },
  };
})();
