const { PLAYER_BASE_RADIUS, PLAYER_MAX_RADIUS, PLAYER_BASE_SPEED, PLAYER_BASE_HEALTH,
  PLAYER_BASE_ENERGY, PLAYER_BASE_DAMAGE, XP_PER_LEVEL_BASE, XP_PER_LEVEL_GROWTH,
  MAX_LEVEL, EVOLUTIONS, WORLD_SIZE } = require('./constants');

let nextEntityId = 1;
function allocId() { return nextEntityId++; }

function xpForLevel(level) {
  return Math.round(XP_PER_LEVEL_BASE * Math.pow(XP_PER_LEVEL_GROWTH, level - 1));
}

function createPlayer({ socketId, name, isBot, color, bodyShape, personality }) {
  const angle = Math.random() * Math.PI * 2;
  return {
    id: allocId(),
    kind: 'player',
    socketId: socketId || null,
    isBot: !!isBot,
    personality: personality || null,
    name: (name || 'Unknown').slice(0, 16),
    color: color || '#5ad1ff',
    bodyShape: bodyShape || 'core',
    trail: 'none',

    x: WORLD_SIZE / 2 + (Math.random() - 0.5) * WORLD_SIZE * 0.8,
    y: WORLD_SIZE / 2 + (Math.random() - 0.5) * WORLD_SIZE * 0.8,
    vx: 0, vy: 0,
    aimAngle: angle,
    radius: PLAYER_BASE_RADIUS,

    maxHealth: PLAYER_BASE_HEALTH,
    health: PLAYER_BASE_HEALTH,
    maxEnergy: PLAYER_BASE_ENERGY,
    energy: PLAYER_BASE_ENERGY,

    baseSpeed: PLAYER_BASE_SPEED,
    damage: PLAYER_BASE_DAMAGE,
    armor: 0,
    critChance: 0.03,
    lifeSteal: 0,
    attackSpeedMul: 1,
    projectileSpeedMul: 1,
    projectileSizeMul: 1,
    energyRegen: 8,
    range: 1,

    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    upgradePoints: 0,
    upgrades: {},
    score: 0,
    kills: 0,
    resourcesCollected: 0,
    spawnedAt: Date.now(),

    weapon: 'pulse',
    unlockedWeapons: ['pulse', 'scatter'],
    evolution: null,
    abilityKey: 'dash',
    unlockedAbilities: ['dash'],
    cooldowns: {},
    effects: {}, // { shieldUntil, slowUntil, empUntil, magnetUntil, burnTick }

    input: { dx: 0, dy: 0, moving: false, aimAngle: angle, firing: false },
    lastFireAt: 0,

    alive: true,
    zoneId: null,
    partyId: null,
  };
}

function xpToNextFor(level) { return xpForLevel(level); }

function grantXP(player, amount, io) {
  if (!player.alive || player.level >= MAX_LEVEL) { player.score += Math.round(amount * 0.5); return; }
  player.xp += amount;
  player.score += Math.round(amount);
  let leveled = false;
  while (player.xp >= player.xpToNext && player.level < MAX_LEVEL) {
    player.xp -= player.xpToNext;
    player.level += 1;
    player.upgradePoints += 1;
    player.xpToNext = xpToNextFor(player.level);
    leveled = true;
    if (player.level === 4 && !player.unlockedWeapons.includes('rail')) player.unlockedWeapons.push('rail');
    if (player.level === 7 && !player.unlockedWeapons.includes('plasma')) player.unlockedWeapons.push('plasma');
    if (player.level === 9 && !player.unlockedWeapons.includes('laser')) player.unlockedWeapons.push('laser');
    if (player.level === 6 && !player.unlockedAbilities.includes('shield')) player.unlockedAbilities.push('shield');
    if (player.level === 12 && !player.unlockedAbilities.includes('magnet')) player.unlockedAbilities.push('magnet');
    if (player.level === 16 && !player.unlockedAbilities.includes('emp')) player.unlockedAbilities.push('emp');
  }
  if (leveled) growSize(player);
  return leveled;
}

function growSize(player) {
  const t = Math.min(1, (player.level - 1) / (MAX_LEVEL - 1));
  player.radius = PLAYER_BASE_RADIUS + t * (PLAYER_MAX_RADIUS - PLAYER_BASE_RADIUS);
}

function applyUpgrade(player, key) {
  if (player.upgradePoints <= 0) return false;
  const step = {
    maxHealth: 14, speed: 9, damage: 2.1, attackSpeed: 0.05, projectileSpeed: 45,
    energy: 12, energyRegen: 1.1, critChance: 0.018, armor: 3.2, lifeSteal: 0.012,
  }[key];
  if (step === undefined) return false;
  player.upgradePoints -= 1;
  player.upgrades[key] = (player.upgrades[key] || 0) + 1;
  switch (key) {
    case 'maxHealth': player.maxHealth += step; player.health += step; break;
    case 'speed': player.baseSpeed += step; break;
    case 'damage': player.damage += step; break;
    case 'attackSpeed': player.attackSpeedMul += step; break;
    case 'projectileSpeed': player.projectileSpeedMul += step / 100; break;
    case 'energy': player.maxEnergy += step; player.energy += step; break;
    case 'energyRegen': player.energyRegen += step; break;
    case 'critChance': player.critChance += step; break;
    case 'armor': player.armor += step; break;
    case 'lifeSteal': player.lifeSteal += step; break;
  }
  return true;
}

function applyEvolution(player, key) {
  const ev = EVOLUTIONS[key];
  if (!ev || player.level < ev.level || player.evolution) return false;
  player.evolution = key;
  player.damage *= ev.dmgMul;
  player.maxHealth *= ev.hpMul;
  player.health = player.maxHealth;
  player.baseSpeed *= ev.speedMul;
  player.color = ev.color;
  return true;
}

module.exports = { createPlayer, grantXP, xpToNextFor, applyUpgrade, applyEvolution, growSize, allocId };
