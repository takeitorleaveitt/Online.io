// Bot decision making. Bots are plain Player objects (see Player.js) driven
// by this module instead of a socket. Every ~1/6s each bot re-evaluates its
// situation and sets `input` + occasionally fires abilities/upgrades, exactly
// like a real client would - the GameRoom simulates bots through the same
// movement/combat code path used for real players.

const PERSONALITIES = ['aggressive', 'defensive', 'hunter', 'passive'];

function pickPersonality() {
  const r = Math.random();
  if (r < 0.28) return 'aggressive';
  if (r < 0.52) return 'defensive';
  if (r < 0.74) return 'hunter';
  return 'passive';
}

function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }

function power(p) { return (p.health + p.maxHealth * 0.5) * (1 + p.level * 0.12) * (0.6 + p.damage / 12); }

function findNearest(list, from, maxRange, filter) {
  let best = null, bestD = maxRange * maxRange;
  for (const e of list) {
    if (filter && !filter(e)) continue;
    const d = dist2(from, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function decide(bot, room) {
  const now = Date.now();
  const survivalMs = now - bot.spawnedAt;
  const boldness = Math.min(1.6, 0.9 + survivalMs / 240000); // grows bolder over ~4 minutes

  const players = [];
  for (const p of room.players.values()) {
    if (p.id !== bot.id && p.alive) players.push(p);
  }
  const enemies = [...room.enemies.values()];
  const resources = [...room.resources.values()];

  const detectRange = 520;
  const nearestPlayer = findNearest(players, bot, detectRange);
  const nearestEnemy = findNearest(enemies, bot, detectRange * 0.7);
  const nearestResource = findNearest(resources, bot, 900);

  let mode = 'wander';
  let target = null;

  const myPower = power(bot) * boldness;
  const threatRatio = nearestPlayer ? myPower / power(nearestPlayer) : 99;

  const mistake = Math.random() < 0.06; // bots occasionally misjudge

  if (bot.health < bot.maxHealth * 0.28 && !mistake) {
    mode = 'retreat';
    target = nearestPlayer || nearestEnemy;
  } else if (bot.personality === 'passive') {
    if (nearestPlayer && dist2(bot, nearestPlayer) < 360 * 360 && !mistake) { mode = 'flee'; target = nearestPlayer; }
    else if (nearestEnemy && bot.health > bot.maxHealth * 0.7) { mode = 'attackEnemy'; target = nearestEnemy; }
    else if (nearestResource) { mode = 'collect'; target = nearestResource; }
  } else if (bot.personality === 'defensive') {
    if (nearestPlayer && threatRatio < 1.15 && dist2(bot, nearestPlayer) < 420 * 420 && !mistake) { mode = 'flee'; target = nearestPlayer; }
    else if (nearestPlayer && threatRatio > 1.6 && dist2(bot, nearestPlayer) < 300 * 300) { mode = 'chase'; target = nearestPlayer; }
    else if (nearestEnemy && bot.health > bot.maxHealth * 0.6) { mode = 'attackEnemy'; target = nearestEnemy; }
    else if (nearestResource) { mode = 'collect'; target = nearestResource; }
  } else if (bot.personality === 'aggressive') {
    if (nearestPlayer && threatRatio > 0.85) { mode = 'chase'; target = nearestPlayer; }
    else if (nearestPlayer && threatRatio < 0.6 && !mistake) { mode = 'flee'; target = nearestPlayer; }
    else if (nearestEnemy) { mode = 'attackEnemy'; target = nearestEnemy; }
    else if (nearestResource) { mode = 'collect'; target = nearestResource; }
  } else { // hunter
    if (nearestPlayer && (threatRatio > 0.55 || boldness > 1.3)) { mode = 'chase'; target = nearestPlayer; }
    else if (nearestEnemy) { mode = 'attackEnemy'; target = nearestEnemy; }
    else if (nearestResource) { mode = 'collect'; target = nearestResource; }
  }

  if (room.boss && bot.personality !== 'passive' && Math.random() < 0.15) {
    const d2 = dist2(bot, room.boss);
    if (d2 < 700 * 700) { mode = 'attackEnemy'; target = room.boss; }
  }

  if (!target) { mode = 'wander'; }

  return { mode, target };
}

function steer(bot, target, mode) {
  let dx = 0, dy = 0;
  if (target) {
    dx = target.x - bot.x; dy = target.y - bot.y;
    if (mode === 'flee' || mode === 'retreat') { dx = -dx; dy = -dy; }
  } else {
    if (!bot._wanderAngle || Math.random() < 0.02) bot._wanderAngle = Math.random() * Math.PI * 2;
    dx = Math.cos(bot._wanderAngle); dy = Math.sin(bot._wanderAngle);
  }
  const len = Math.hypot(dx, dy) || 1;
  bot.input.dx = dx / len;
  bot.input.dy = dy / len;
  bot.input.moving = true;
  if (target && (mode === 'chase' || mode === 'attackEnemy')) {
    bot.input.aimAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
    bot.input.firing = Math.hypot(target.x - bot.x, target.y - bot.y) < 480;
  } else {
    bot.input.aimAngle = Math.atan2(dy, dx);
    bot.input.firing = false;
  }
}

function maybeUseAbility(bot, mode, room) {
  const ab = bot.unlockedAbilities;
  if (!ab.length) return null;
  const readyAt = bot.cooldowns[bot.abilityKey] || 0;
  if (Date.now() < readyAt) return null;
  if (mode === 'flee' || mode === 'retreat') {
    if (ab.includes('dash')) { bot.abilityKey = 'dash'; return 'dash'; }
    if (ab.includes('shield')) { bot.abilityKey = 'shield'; return 'shield'; }
  } else if (mode === 'chase' || mode === 'attackEnemy') {
    if (ab.includes('dash') && Math.random() < 0.3) { bot.abilityKey = 'dash'; return 'dash'; }
    if (ab.includes('emp') && Math.random() < 0.15) { bot.abilityKey = 'emp'; return 'emp'; }
  } else if (mode === 'collect') {
    if (ab.includes('magnet') && Math.random() < 0.2) { bot.abilityKey = 'magnet'; return 'magnet'; }
  }
  return null;
}

function maybeSpendUpgrade(bot) {
  if (bot.upgradePoints <= 0) return null;
  const weights = {
    aggressive: ['damage', 'attackSpeed', 'speed', 'critChance'],
    defensive: ['maxHealth', 'armor', 'energyRegen', 'speed'],
    hunter: ['damage', 'speed', 'critChance', 'lifeSteal'],
    passive: ['energy', 'energyRegen', 'maxHealth', 'speed'],
  }[bot.personality] || ['maxHealth', 'damage'];
  return weights[Math.floor(Math.random() * weights.length)];
}

function pickWeapon(bot, mode, target) {
  const opts = bot.unlockedWeapons;
  if (opts.length <= 1) return opts[0];
  if (mode === 'attackEnemy' && opts.includes('rail')) return 'rail';
  if (target && dist2(bot, target) > 400 * 400 && opts.includes('rail')) return 'rail';
  if (mode === 'chase' && opts.includes('scatter')) return Math.random() < 0.5 ? 'scatter' : bot.weapon;
  return opts[Math.floor(Math.random() * opts.length)];
}

module.exports = { pickPersonality, PERSONALITIES, decide, steer, maybeUseAbility, maybeSpendUpgrade, pickWeapon };
