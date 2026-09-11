const C = require('./constants');
const { zoneAt } = require('./zones');
const { generateBotName } = require('./names');
const { createPlayer, grantXP, applyUpgrade, applyEvolution } = require('./Player');
const { createResource, createProjectile, createEnemy, createBoss, randomPos } = require('./Entities');
const BotAI = require('./BotAI');
const { filterChatText } = require('./moderation');

const BOT_COLORS = ['#5ad1ff', '#ff5a5a', '#ffd75a', '#8fff5a', '#c77bff', '#ff9d5a', '#5affe0', '#ff5ad1'];
const ENEMY_WEIGHTS = [['drone', 40], ['hunter', 24], ['worm', 18], ['guardian', 12], ['crystalBeast', 5], ['titan', 1.5]];

const EVENT_DEFS = {
  doubleXP: {
    label: 'DOUBLE XP', apply: (r) => { r.xpMultiplier = 2; }, revert: (r) => { r.xpMultiplier = 1; },
  },
  resourceRush: {
    label: 'RESOURCE RUSH',
    apply: (r) => { for (let i = 0; i < 100; i++) { const res = createResource(); r.resources.set(res.id, res); } },
    revert: () => {},
  },
  goldenHour: {
    label: 'GOLDEN HOUR',
    apply: (r) => { for (let i = 0; i < 35; i++) { const res = createResource(randomPos(), 'golden'); r.resources.set(res.id, res); } },
    revert: () => {},
  },
  blackout: {
    label: 'BLACKOUT', apply: (r) => { r.blackout = true; }, revert: (r) => { r.blackout = false; },
  },
  redMoon: {
    label: 'RED MOON',
    apply: (r) => { r.redMoonMul = 1.6; for (const e of r.enemies.values()) e.speed *= 1.15; },
    revert: (r) => { r.redMoonMul = 1; for (const e of r.enemies.values()) e.speed /= 1.15; },
  },
  meteorShower: {
    label: 'METEOR SHOWER', apply: (r) => { r.meteorActive = true; }, revert: (r) => { r.meteorActive = false; },
  },
  chaos: {
    label: 'CHAOS MODE',
    apply: (r) => { r.xpMultiplier = 1.5; r.redMoonMul = 1.3; r.meteorActive = true; },
    revert: (r) => { r.xpMultiplier = 1; r.redMoonMul = 1; r.meteorActive = false; },
  },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function pickWeighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of pairs) { r -= w; if (r <= 0) return key; }
  return pairs[0][0];
}

class GameRoom {
  constructor(io, name, mode = 'ffa') {
    this.io = io;
    this.name = name;
    this.mode = mode;
    this.players = new Map();
    this.resources = new Map();
    this.projectiles = new Map();
    this.enemies = new Map();
    this.boss = null;
    this.socketPlayers = new Map(); // socketId -> playerId
    this.pendingBotRespawns = [];
    this.pendingEnemyRespawns = [];
    this.frameHits = [];
    this.xpMultiplier = 1;
    this.redMoonMul = 1;
    this.blackout = false;
    this.meteorActive = false;
    this._nextMeteorAt = 0;
    this.activeEvent = null;
    this.lastEventType = null;
    this.nextEventAt = Date.now() + 45000;
    this.nextBossAt = Date.now() + 60000;
    this._lastBotAdjustAt = 0;
    this.createdAt = Date.now();
    this._chatLog = new Map(); // socketId -> [timestamps]

    for (let i = 0; i < C.RESOURCE_TARGET_COUNT; i++) {
      const res = createResource();
      this.resources.set(res.id, res);
    }
    for (let i = 0; i < C.NEUTRAL_ENEMY_TARGET_COUNT; i++) this.spawnRandomEnemy();
    for (let i = 0; i < C.MIN_BOTS_WHEN_EMPTY; i++) this.spawnBot();
  }

  get realCount() {
    let n = 0; for (const p of this.players.values()) if (!p.isBot) n++; return n;
  }
  get botCount() {
    let n = 0; for (const p of this.players.values()) if (p.isBot) n++; return n;
  }
  get playerCount() { return this.players.size; }

  start() {
    this._tickHandle = setInterval(() => this.tick(1 / C.TICK_RATE), 1000 / C.TICK_RATE);
    this._broadcastHandle = setInterval(() => this.broadcast(), 1000 / C.BROADCAST_RATE);
  }

  stop() {
    clearInterval(this._tickHandle);
    clearInterval(this._broadcastHandle);
  }

  // ---------- player lifecycle ----------

  addRealPlayer(socket, data) {
    const name = sanitizeName(data && data.name);
    const color = sanitizeColor(data && data.color);
    const bodyShape = sanitizeBody(data && data.bodyShape);
    const player = createPlayer({ socketId: socket.id, name, color, bodyShape, isBot: false });
    this.players.set(player.id, player);
    this.socketPlayers.set(socket.id, player.id);
    socket.join(this.name);
    return player;
  }

  removePlayerBySocket(socketId) {
    const pid = this.socketPlayers.get(socketId);
    if (pid) { this.players.delete(pid); this.socketPlayers.delete(socketId); }
  }

  spawnBot() {
    const p = createPlayer({
      isBot: true,
      name: generateBotName(),
      color: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
      bodyShape: 'core',
      personality: BotAI.pickPersonality(),
    });
    this.players.set(p.id, p);
    return p;
  }

  spawnRandomEnemy(pos) {
    const type = pickWeighted(ENEMY_WEIGHTS);
    const e = createEnemy(type, pos);
    this.enemies.set(e.id, e);
    return e;
  }

  // ---------- socket-driven actions ----------

  handleInput(socketId, data) {
    const p = this.getPlayerBySocket(socketId);
    if (!p || !p.alive || !data) return;
    let dx = Number(data.dx) || 0, dy = Number(data.dy) || 0;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    p.input.dx = dx;
    p.input.dy = dy;
    p.input.moving = !!data.moving && mag > 0.02;
    if (typeof data.aimAngle === 'number' && isFinite(data.aimAngle)) p.input.aimAngle = data.aimAngle;
    p.input.firing = !!data.firing;
  }

  handleAbility(socketId, key) {
    const p = this.getPlayerBySocket(socketId);
    if (!p || !p.alive) return;
    this.tryUseAbility(p, key, Date.now());
  }

  handleUpgrade(socketId, key) {
    const p = this.getPlayerBySocket(socketId);
    if (!p || !p.alive) return;
    applyUpgrade(p, key);
  }

  handleEvolve(socketId, key) {
    const p = this.getPlayerBySocket(socketId);
    if (!p || !p.alive) return;
    applyEvolution(p, key);
  }

  handleWeaponSelect(socketId, key) {
    const p = this.getPlayerBySocket(socketId);
    if (!p || !p.alive) return;
    if (p.unlockedWeapons.includes(key)) p.weapon = key;
  }

  handleChat(socketId, text) {
    const p = this.getPlayerBySocket(socketId);
    if (!p || typeof text !== 'string') return null;
    const now = Date.now();
    const log = this._chatLog.get(socketId) || [];
    const recent = log.filter((t) => now - t < 10000);
    if (recent.length >= 6) return null; // spam protection
    recent.push(now);
    this._chatLog.set(socketId, recent);
    const clean = filterChatText(text);
    if (!clean.trim()) return null;
    const payload = { name: p.name, color: p.color, text: clean, isBot: p.isBot };
    this.io.to(this.name).emit('chat', payload);
    return payload;
  }

  getPlayerBySocket(socketId) {
    const pid = this.socketPlayers.get(socketId);
    return pid ? this.players.get(pid) : null;
  }

  // ---------- core simulation ----------

  tick(dt) {
    const now = Date.now();
    this.updateBots(now);

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      this.applyMovement(p, dt, now);
      this.tryFire(p, now);
    }

    this.applyMagnetPulls(dt, now);
    this.separatePlayers();
    this.updateProjectiles(dt, now);
    this.updateResourcePickups(dt, now);
    this.updateEnemies(dt, now);
    this.updateBoss(dt, now);

    if (this.meteorActive && now >= this._nextMeteorAt) {
      this._nextMeteorAt = now + 350 + Math.random() * 450;
      this.spawnMeteor();
    }

    if (!this.activeEvent && now >= this.nextEventAt) this.startWorldEvent(now);
    else if (this.activeEvent && now >= this.activeEvent.endsAt) this.endWorldEvent(now);

    if (!this.boss && now >= this.nextBossAt) this.spawnBoss(now);

    this.pendingBotRespawns = this.pendingBotRespawns.filter((t) => { if (now >= t) { this.spawnBot(); return false; } return true; });
    this.pendingEnemyRespawns = this.pendingEnemyRespawns.filter((t) => { if (now >= t) { this.spawnRandomEnemy(); return false; } return true; });

    this.adjustBotPopulation(now);
  }

  applyMovement(player, dt, now) {
    const zone = zoneAt(player.x, player.y);
    player.zoneId = zone ? zone.id : null;
    let speedMul = 1;
    if (zone && zone.hazard === 'slow') speedMul *= 0.55;
    if (player.effects.dashUntil && now < player.effects.dashUntil) speedMul *= 1.0;
    if (player.effects.stunUntil && now < player.effects.stunUntil) speedMul = 0;
    const speed = player.baseSpeed * speedMul;
    if (player.input.moving) {
      player.x += player.input.dx * speed * dt;
      player.y += player.input.dy * speed * dt;
    }
    player.x = clamp(player.x, player.radius, C.WORLD_SIZE - player.radius);
    player.y = clamp(player.y, player.radius, C.WORLD_SIZE - player.radius);
    player.aimAngle = player.input.aimAngle;
    player.energy = Math.min(player.maxEnergy, player.energy + player.energyRegen * dt);
    if (zone && zone.hazard === 'burn') this.damageEntity(player, 7 * dt, null, now);
  }

  separatePlayers() {
    const list = [...this.players.values()].filter((p) => p.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const rr = a.radius + b.radius;
        const d2 = dist2(a, b);
        if (d2 > 0 && d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          const push = (rr - d) / 2;
          const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
          a.x += nx * push; a.y += ny * push;
          b.x -= nx * push; b.y -= ny * push;
        }
      }
    }
  }

  tryFire(player, now) {
    if (!player.input.firing || !player.alive) return;
    const w = C.WEAPONS[player.weapon] || C.WEAPONS.pulse;
    const interval = 1000 / (w.fireRate * player.attackSpeedMul);
    if (now - player.lastFireAt < interval) return;
    if (player.energy < 3) return;
    player.lastFireAt = now;
    player.energy = Math.max(0, player.energy - 2.2);
    const count = w.count || 1;
    for (let i = 0; i < count; i++) {
      const spreadOffset = count > 1 ? (i - (count - 1) / 2) * (w.spread / Math.max(1, count - 1)) : (w.spread ? (Math.random() - 0.5) * w.spread : 0);
      const angle = player.aimAngle + spreadOffset;
      const isCrit = Math.random() < player.critChance;
      const dmg = player.damage * w.dmgMul * (isCrit ? 1.8 : 1);
      const speed = w.projSpeed * player.projectileSpeedMul;
      const radius = w.radius * player.projectileSizeMul;
      const spawnDist = player.radius + radius + 4;
      const proj = createProjectile({
        owner: player,
        x: player.x + Math.cos(angle) * spawnDist,
        y: player.y + Math.sin(angle) * spawnDist,
        angle, speed, damage: dmg, life: w.life, radius, color: w.color,
        weaponKey: player.weapon, pierce: w.pierce, explode: w.explode,
      });
      proj.isCrit = isCrit;
      this.projectiles.set(proj.id, proj);
    }
  }

  spawnMeteor() {
    const p = randomPos(150);
    const proj = createProjectile({
      owner: { id: 0, isBot: false, lifeSteal: 0 },
      x: p.x, y: p.y, angle: 0, speed: 0, damage: 26, life: 0.9, radius: 46, color: '#ff8f3b', weaponKey: 'meteor',
    });
    proj.ownerId = null;
    this.projectiles.set(proj.id, proj);
  }

  applyMagnetPulls(dt, now) {
    for (const p of this.players.values()) {
      if (!p.alive || !p.effects.magnetUntil || now >= p.effects.magnetUntil) continue;
      const r2 = C.ABILITIES.magnet.radius * C.ABILITIES.magnet.radius;
      for (const res of this.resources.values()) {
        if (dist2(p, res) > r2) continue;
        const ang = Math.atan2(p.y - res.y, p.x - res.x);
        res.x += Math.cos(ang) * 640 * dt;
        res.y += Math.sin(ang) * 640 * dt;
      }
    }
  }

  updateProjectiles(dt, now) {
    for (const proj of this.projectiles.values()) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.life -= dt;
      let dead = proj.life <= 0 || proj.x < 0 || proj.x > C.WORLD_SIZE || proj.y < 0 || proj.y > C.WORLD_SIZE;
      if (!dead) dead = this.handleProjectileHits(proj, now);
      if (dead) this.projectiles.delete(proj.id);
    }
  }

  handleProjectileHits(proj, now) {
    const targets = [];
    for (const p of this.players.values()) if (p.alive && p.id !== proj.ownerId) targets.push(p);
    for (const e of this.enemies.values()) targets.push(e);
    if (this.boss) targets.push(this.boss);
    for (const t of targets) {
      if (proj.hitIds.has(t.id)) continue;
      const rr = t.radius + proj.radius;
      if (dist2(proj, t) > rr * rr) continue;
      proj.hitIds.add(t.id);
      const owner = proj.ownerId ? this.players.get(proj.ownerId) : null;
      this.damageEntity(t, proj.damage, owner, now, { isCrit: proj.isCrit });
      if (proj.explode) this.explodeAt(proj, now, owner);
      if (!proj.pierce) return true;
    }
    return false;
  }

  explodeAt(proj, now, owner) {
    const r2 = proj.explode * proj.explode;
    const targets = [];
    for (const p of this.players.values()) if (p.alive && p.id !== proj.ownerId) targets.push(p);
    for (const e of this.enemies.values()) targets.push(e);
    if (this.boss) targets.push(this.boss);
    for (const t of targets) {
      if (proj.hitIds.has(t.id)) continue;
      if (dist2(proj, t) > r2) continue;
      proj.hitIds.add(t.id);
      this.damageEntity(t, proj.damage * 0.55, owner, now, { isCrit: false });
    }
  }

  damageEntity(target, rawAmount, source, now, opts = {}) {
    if (!target || rawAmount <= 0) return 0;
    if (target.kind === 'player' && !target.alive) return 0;
    if (target.kind === 'player' && now - target.spawnedAt < C.SPAWN_GRACE_MS) rawAmount *= 0.1;
    if (target.effects && target.effects.shieldUntil && now < target.effects.shieldUntil) rawAmount *= 0.3;
    // bots hit real players softer across the board, and hit even softer the
    // more levels they're ahead - keeps the game approachable for newcomers
    // rather than getting steamrolled by long-surviving "dangerous" bots
    if (source && source.kind === 'player' && source.isBot && target.kind === 'player' && !target.isBot) {
      rawAmount *= 0.6;
      const gap = source.level - target.level;
      if (gap > 2) rawAmount *= Math.max(0.3, 1 - (gap - 2) * 0.08);
    }
    // real players hit bots harder - bots should feel killable, not spongy
    if (source && source.kind === 'player' && !source.isBot && target.kind === 'player' && target.isBot) {
      rawAmount *= 1.35;
    }
    const armor = target.armor || 0;
    const mitigated = rawAmount * (100 / (100 + armor));
    target.health -= mitigated;
    this.frameHits.push({ x: Math.round(target.x), y: Math.round(target.y), a: Math.round(mitigated), c: !!opts.isCrit, id: target.id });
    if (source && source.kind === 'player' && source.lifeSteal) {
      source.health = Math.min(source.maxHealth, source.health + mitigated * source.lifeSteal);
    }
    if (target.kind === 'boss' && source && source.kind === 'player') {
      target.damageContributors.set(source.id, (target.damageContributors.get(source.id) || 0) + mitigated);
    }
    if (target.health <= 0) this.handleEntityDeath(target, source, now);
    return mitigated;
  }

  handleEntityDeath(target, source, now) {
    if (target.kind === 'player') {
      const killer = source && source.kind === 'player' ? source : null;
      this.killPlayer(target, killer, now);
    } else if (target.kind === 'enemy') {
      this.killEnemy(target, source);
    } else if (target.kind === 'boss') {
      this.killBoss(target);
    }
  }

  killPlayer(player, killer, now) {
    if (!player.alive) return;
    player.alive = false;
    const survivalTime = now - player.spawnedAt;
    const stats = {
      score: Math.round(player.score), level: player.level, kills: player.kills,
      survivalTime, resourcesCollected: player.resourcesCollected,
      killerName: killer ? killer.name : null,
    };
    this.scatterResourcesAt(player);
    if (killer && killer.id !== player.id) {
      killer.kills += 1;
      killer.score += 60 + player.level * 10;
      killer.upgradePoints += 1; // 1 upgrade token per kill, on top of level-up tokens
      this.grantXPTo(killer, 40 + player.level * 18);
      if (killer.socketId) this.io.to(killer.socketId).emit('kill', { isBot: player.isBot, victimName: player.name });
    }
    if (player.socketId) {
      this.io.to(player.socketId).emit('death', stats);
      this.socketPlayers.delete(player.socketId);
    }
    this.players.delete(player.id);
    if (player.isBot) this.pendingBotRespawns.push(now + 2000 + Math.random() * 4000);
  }

  killEnemy(enemy, source) {
    this.enemies.delete(enemy.id);
    if (source && source.kind === 'player' && source.alive) {
      source.score += enemy.scoreValue;
      this.grantXPTo(source, enemy.xp);
    }
    this.pendingEnemyRespawns.push(Date.now() + 1500 + Math.random() * 3000);
  }

  killBoss(boss) {
    this.boss = null;
    let topId = null, topDmg = -1;
    for (const [pid, dmg] of boss.damageContributors) if (dmg > topDmg) { topDmg = dmg; topId = pid; }
    for (const [pid, dmg] of boss.damageContributors) {
      const p = this.players.get(pid);
      if (!p) continue;
      const share = Math.min(1, (dmg / boss.maxHealth) * 3);
      p.score += Math.round(boss.scoreValue * share) + (pid === topId ? 1000 : 0);
      this.grantXPTo(p, Math.round(boss.xp * share) + (pid === topId ? 400 : 0));
    }
    const topPlayer = topId ? this.players.get(topId) : null;
    this.io.to(this.name).emit('bossDefeated', { topName: topPlayer ? topPlayer.name : null });
    this.nextBossAt = Date.now() + C.BOSS_SPAWN_INTERVAL_MS;
  }

  grantXPTo(player, amount) {
    const leveled = grantXP(player, amount * (this.xpMultiplier || 1));
    if (player.socketId && leveled) {
      this.io.to(player.socketId).emit('levelup', { level: player.level, upgradePoints: player.upgradePoints });
      if (player.level >= 10 && !player.evolution && !player.evoPrompted) {
        player.evoPrompted = true;
        this.io.to(player.socketId).emit('evolutionAvailable', { level: player.level });
      }
    }
  }

  scatterResourcesAt(player) {
    const count = clamp(Math.round(player.score / 60), 3, 16);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * 90;
      const pos = {
        x: clamp(player.x + Math.cos(ang) * dist, 20, C.WORLD_SIZE - 20),
        y: clamp(player.y + Math.sin(ang) * dist, 20, C.WORLD_SIZE - 20),
      };
      const res = createResource(pos);
      this.resources.set(res.id, res);
    }
  }

  updateResourcePickups(dt, now) {
    const flowRadius = 130;
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const pickupR = player.radius + 6;
      const flowR2 = flowRadius * flowRadius;
      for (const res of this.resources.values()) {
        const d2 = dist2(player, res);
        if (d2 <= pickupR * pickupR) {
          this.resources.delete(res.id);
          player.resourcesCollected += 1;
          player.score += res.value;
          this.grantXPTo(player, res.xp);
          const nr = createResource();
          this.resources.set(nr.id, nr);
          continue;
        }
        // passive "flow toward you" magnetism at short range - gets stronger the closer it is
        if (d2 <= flowR2) {
          const d = Math.sqrt(d2) || 1;
          const pull = 620 * (1 - d / flowRadius) + 60;
          res.x += (player.x - res.x) / d * pull * dt;
          res.y += (player.y - res.y) / d * pull * dt;
        }
      }
    }
  }

  updateEnemies(dt, now) {
    for (const en of this.enemies.values()) {
      let target = en.targetId ? this.players.get(en.targetId) : null;
      if (!target || !target.alive || dist2(en, target) > en.aggroRange * en.aggroRange * 2.4) {
        target = this.findNearestPlayer(en, en.aggroRange);
        en.targetId = target ? target.id : null;
      }
      if (target && dist2(en, target) <= en.aggroRange * en.aggroRange) {
        const ang = Math.atan2(target.y - en.y, target.x - en.x);
        en.angle = ang;
        const rr = en.radius + target.radius + 4;
        if (dist2(en, target) > rr * rr) {
          en.x += Math.cos(ang) * en.speed * dt;
          en.y += Math.sin(ang) * en.speed * dt;
        } else if (now - en.lastAttackAt > 700) {
          en.lastAttackAt = now;
          this.damageEntity(target, en.damage * (this.redMoonMul || 1), en, now);
        }
      } else {
        const ang = Math.atan2(en.homeY - en.y, en.homeX - en.x);
        const d = Math.hypot(en.homeX - en.x, en.homeY - en.y);
        if (d > 40) { en.x += Math.cos(ang) * en.speed * 0.5 * dt; en.y += Math.sin(ang) * en.speed * 0.5 * dt; }
      }
      en.x = clamp(en.x, en.radius, C.WORLD_SIZE - en.radius);
      en.y = clamp(en.y, en.radius, C.WORLD_SIZE - en.radius);
    }
  }

  updateBoss(dt, now) {
    const boss = this.boss;
    if (!boss) return;
    let target = boss.targetId ? this.players.get(boss.targetId) : null;
    if (!target || !target.alive || dist2(boss, target) > boss.aggroRange * boss.aggroRange * 2.4) {
      target = this.findNearestPlayer(boss, boss.aggroRange);
      boss.targetId = target ? target.id : null;
    }
    if (target) {
      const ang = Math.atan2(target.y - boss.y, target.x - boss.x);
      boss.angle = ang;
      const rr = boss.radius + target.radius + 6;
      if (dist2(boss, target) > rr * rr) {
        boss.x += Math.cos(ang) * boss.speed * dt;
        boss.y += Math.sin(ang) * boss.speed * dt;
      } else if (now - boss.lastAttackAt > 900) {
        boss.lastAttackAt = now;
        this.damageEntity(target, boss.damage * (this.redMoonMul || 1), boss, now);
      }
    }
    boss.x = clamp(boss.x, boss.radius, C.WORLD_SIZE - boss.radius);
    boss.y = clamp(boss.y, boss.radius, C.WORLD_SIZE - boss.radius);
  }

  findNearestPlayer(from, maxRange) {
    let best = null, bestD = maxRange * maxRange;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist2(from, p);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  spawnBoss(now) {
    this.boss = createBoss();
    this.io.to(this.name).emit('bossSpawned', { name: this.boss.name, maxHealth: this.boss.maxHealth });
  }

  startWorldEvent(now) {
    const keys = Object.keys(EVENT_DEFS).filter((k) => k !== this.lastEventType);
    const type = keys[Math.floor(Math.random() * keys.length)];
    this.lastEventType = type;
    const def = EVENT_DEFS[type];
    def.apply(this);
    this.activeEvent = { type, label: def.label, startsAt: now, endsAt: now + C.WORLD_EVENT_DURATION_MS };
    this.io.to(this.name).emit('worldEvent', { type, label: def.label, duration: C.WORLD_EVENT_DURATION_MS });
  }

  endWorldEvent(now) {
    const def = EVENT_DEFS[this.activeEvent.type];
    def.revert(this);
    this.io.to(this.name).emit('worldEventEnd', { type: this.activeEvent.type });
    this.activeEvent = null;
    this.nextEventAt = now + C.WORLD_EVENT_INTERVAL_MS;
  }

  tryUseAbility(player, key, now) {
    const def = C.ABILITIES[key];
    if (!def || !player.unlockedAbilities.includes(key)) return false;
    const readyAt = player.cooldowns[key] || 0;
    if (now < readyAt) return false;
    if (player.energy < def.energyCost) return false;
    player.energy -= def.energyCost;
    player.cooldowns[key] = now + def.cooldown * 1000;
    player.abilityKey = key;
    switch (key) {
      case 'dash': {
        const ang = player.input.moving ? Math.atan2(player.input.dy, player.input.dx) : player.aimAngle;
        player.x = clamp(player.x + Math.cos(ang) * 180, player.radius, C.WORLD_SIZE - player.radius);
        player.y = clamp(player.y + Math.sin(ang) * 180, player.radius, C.WORLD_SIZE - player.radius);
        player.effects.dashUntil = now + 250;
        break;
      }
      case 'shield':
        player.effects.shieldUntil = now + def.duration * 1000;
        break;
      case 'emp': {
        const r2 = def.radius * def.radius;
        for (const other of this.players.values()) {
          if (other.id === player.id || !other.alive || dist2(player, other) > r2) continue;
          other.effects.stunUntil = now + 1500;
          this.damageEntity(other, 18, player, now);
        }
        for (const en of this.enemies.values()) {
          if (dist2(player, en) > r2) continue;
          en.effects = en.effects || {};
          this.damageEntity(en, 40, player, now);
        }
        player.effects.empPulseUntil = now + 400;
        break;
      }
      case 'magnet':
        player.effects.magnetUntil = now + def.duration * 1000;
        break;
    }
    return true;
  }

  updateBots(now) {
    for (const bot of this.players.values()) {
      if (!bot.isBot || !bot.alive) continue;
      if (!bot._nextDecisionAt || now >= bot._nextDecisionAt) {
        bot._nextDecisionAt = now + 280 + Math.random() * 220;
        const { mode, target } = BotAI.decide(bot, this);
        bot._aiMode = mode; bot._aiTarget = target;
        const w = BotAI.pickWeapon(bot, mode, target);
        if (w) bot.weapon = w;
        const ability = BotAI.maybeUseAbility(bot, mode, this);
        if (ability) this.tryUseAbility(bot, ability, now);
        const upKey = BotAI.maybeSpendUpgrade(bot);
        if (upKey) applyUpgrade(bot, upKey);
      }
      BotAI.steer(bot, bot._aiTarget, bot._aiMode);
    }
  }

  adjustBotPopulation(now) {
    if (now - this._lastBotAdjustAt < 1000) return;
    this._lastBotAdjustAt = now;
    const real = this.realCount, bots = this.botCount;
    let desired = Math.max(C.MIN_BOTS_WHEN_EMPTY - real, Math.round(real * (1 - C.TARGET_REAL_RATIO) / C.TARGET_REAL_RATIO));
    desired = clamp(desired, 0, C.MAX_BOTS);
    if (real + desired > C.MAX_PLAYERS_PER_ROOM) desired = Math.max(0, C.MAX_PLAYERS_PER_ROOM - real);
    if (bots < desired) this.spawnBot();
    else if (bots > desired) {
      const list = [...this.players.values()].filter((p) => p.isBot);
      if (list.length) this.players.delete(list[Math.floor(Math.random() * list.length)].id);
    }
  }

  // ---------- networking ----------

  buildLeaderboard() {
    const all = [...this.players.values()].sort((a, b) => b.score - a.score);
    const top10 = all.slice(0, 10).map((p, i) => ({ rank: i + 1, name: p.name, score: Math.round(p.score), isBot: p.isBot, color: p.color }));
    const rankOf = new Map();
    all.forEach((p, i) => rankOf.set(p.id, i + 1));
    return { top10, rankOf, totalPlayers: all.length };
  }

  viewRadiusFor(player) {
    let r = 640 + player.radius * 4.2;
    if (player.zoneId === 'dark') r *= 0.62;
    return Math.min(r, 1650);
  }

  broadcast() {
    if (this.socketPlayers.size === 0) { this.frameHits = []; return; }
    const lb = this.buildLeaderboard();
    for (const [socketId, pid] of this.socketPlayers) {
      const player = this.players.get(pid);
      if (!player) continue;
      const snapshot = this.buildSnapshotFor(player, lb);
      this.io.to(socketId).emit('state', snapshot);
    }
    this.frameHits = [];
  }

  buildSnapshotFor(player, lb) {
    const vr2 = this.viewRadiusFor(player) ** 2;
    const near = (e) => (e.x - player.x) ** 2 + (e.y - player.y) ** 2 <= vr2;
    const players = [];
    for (const p of this.players.values()) if (p.id === player.id || (p.alive && near(p))) players.push(packPlayer(p));
    const resources = [];
    for (const r of this.resources.values()) if (near(r)) resources.push({ id: r.id, x: Math.round(r.x), y: Math.round(r.y), t: r.type, c: r.color, r: r.radius });
    const projectiles = [];
    for (const pr of this.projectiles.values()) if (near(pr)) projectiles.push({ id: pr.id, x: Math.round(pr.x), y: Math.round(pr.y), r: pr.radius, c: pr.color, a: Math.atan2(pr.vy, pr.vx) });
    const enemies = [];
    for (const e of this.enemies.values()) if (near(e)) enemies.push({ id: e.id, x: Math.round(e.x), y: Math.round(e.y), r: e.radius, c: e.color, hp: Math.round(e.health), mhp: e.maxHealth, t: e.type, a: e.angle });
    const boss = this.boss ? { id: this.boss.id, x: Math.round(this.boss.x), y: Math.round(this.boss.y), r: this.boss.radius, hp: Math.round(this.boss.health), mhp: this.boss.maxHealth, name: this.boss.name } : null;
    return {
      t: Date.now(),
      self: packSelf(player),
      players, resources, projectiles, enemies, boss,
      hits: this.frameHits,
      leaderboard: lb.top10, myRank: lb.rankOf.get(player.id), totalPlayers: lb.totalPlayers,
      event: this.activeEvent ? { type: this.activeEvent.type, label: this.activeEvent.label, endsAt: this.activeEvent.endsAt } : null,
      blackout: !!this.blackout,
      realCount: this.realCount, botCount: this.botCount,
    };
  }
}

function packPlayer(p) {
  const now = Date.now();
  return {
    id: p.id, x: Math.round(p.x), y: Math.round(p.y), r: Math.round(p.radius), a: p.aimAngle,
    n: p.name, c: p.color, b: p.bodyShape, lvl: p.level, hp: Math.round(p.health), mhp: Math.round(p.maxHealth),
    bot: p.isBot, ev: p.evolution,
    sh: !!(p.effects.shieldUntil && now < p.effects.shieldUntil),
    dash: !!(p.effects.dashUntil && now < p.effects.dashUntil),
  };
}

function packSelf(p) {
  return {
    id: p.id, x: p.x, y: p.y, health: p.health, maxHealth: p.maxHealth, energy: p.energy, maxEnergy: p.maxEnergy,
    level: p.level, xp: p.xp, xpToNext: p.xpToNext, upgradePoints: p.upgradePoints, score: Math.round(p.score),
    kills: p.kills, resourcesCollected: p.resourcesCollected, weapon: p.weapon, unlockedWeapons: p.unlockedWeapons,
    abilityKey: p.abilityKey, unlockedAbilities: p.unlockedAbilities, cooldowns: p.cooldowns, evolution: p.evolution,
    radius: p.radius, speed: p.baseSpeed, zone: p.zoneId, spawnedAt: p.spawnedAt, upgrades: p.upgrades,
    damage: p.damage, armor: p.armor, critChance: p.critChance,
  };
}

function sanitizeName(name) {
  // defense-in-depth only - server/index.js already resolves the final,
  // profanity-checked, unique name before addRealPlayer is ever called.
  const n = (typeof name === 'string' ? name : '').replace(/[^\w \-À-ɏ]/g, '').trim().slice(0, 18);
  return n || `Player${Math.floor(Math.random() * 9000 + 1000)}`;
}
function sanitizeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#5ad1ff';
}
function sanitizeBody(shape) {
  return ['core', 'hex', 'spike', 'orb'].includes(shape) ? shape : 'core';
}

module.exports = GameRoom;
