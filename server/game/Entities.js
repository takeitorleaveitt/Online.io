const { WORLD_SIZE } = require('./constants');
const { allocId } = require('./Player');

const RESOURCE_TYPES = {
  orb:     { value: 6,  xp: 6,  radius: 5,  color: '#5ad1ff', weight: 60 },
  coin:    { value: 12, xp: 4,  radius: 6,  color: '#ffd75a', weight: 24 },
  crystal: { value: 26, xp: 14, radius: 8,  color: '#c77bff', weight: 8, zoneOnly: 'crystal' },
  power:   { value: 40, xp: 22, radius: 9,  color: '#5aff8f', weight: 5 },
  golden:  { value: 90, xp: 55, radius: 11, color: '#ffb100', weight: 1.2, event: true },
  rareCore:{ value: 160,xp: 110,radius: 13, color: '#ff5ad1', weight: 0.8 },
};

function randomPos(margin = 100) {
  return {
    x: margin + Math.random() * (WORLD_SIZE - margin * 2),
    y: margin + Math.random() * (WORLD_SIZE - margin * 2),
  };
}

function pickResourceType(zone) {
  const entries = Object.entries(RESOURCE_TYPES).filter(([, t]) => !t.event);
  const pool = entries.filter(([, t]) => !t.zoneOnly || (zone && zone.id === t.zoneOnly));
  const total = pool.reduce((s, [, t]) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const [key, t] of pool) {
    r -= t.weight;
    if (r <= 0) return key;
  }
  return 'orb';
}

function createResource(pos, forcedType) {
  const type = forcedType || pickResourceType(null);
  const def = RESOURCE_TYPES[type];
  const p = pos || randomPos();
  return { id: allocId(), kind: 'resource', type, x: p.x, y: p.y, radius: def.radius, color: def.color, value: def.value, xp: def.xp };
}

function createProjectile({ owner, x, y, angle, speed, damage, life, radius, color, weaponKey, pierce, explode }) {
  return {
    id: allocId(), kind: 'projectile',
    ownerId: owner.id, ownerIsBot: owner.isBot, weaponKey,
    x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    damage, life, maxLife: life, radius, color, pierce: !!pierce, explode: explode || 0,
    hitIds: new Set(),
  };
}

const ENEMY_TYPES = {
  drone:    { name: 'Drone',    hp: 40,  dmg: 6,  speed: 120, radius: 14, color: '#8fa6ff', xp: 30,  score: 40,  aggroRange: 220 },
  hunter:   { name: 'Hunter',   hp: 110, dmg: 12, speed: 170, radius: 20, color: '#ff8f5a', xp: 80,  score: 110, aggroRange: 320 },
  guardian: { name: 'Guardian', hp: 260, dmg: 18, speed: 90,  radius: 30, color: '#6bffb0', xp: 180, score: 250, aggroRange: 260 },
  worm:     { name: 'Worm',     hp: 160, dmg: 10, speed: 60,  radius: 24, color: '#c9ff5a', xp: 130, score: 170, aggroRange: 180 },
  crystalBeast: { name: 'Crystal Beast', hp: 380, dmg: 22, speed: 100, radius: 34, color: '#c77bff', xp: 260, score: 340, aggroRange: 300 },
  titan:    { name: 'Titan', hp: 900, dmg: 34, speed: 70, radius: 46, color: '#ffd75a', xp: 520, score: 700, aggroRange: 360 },
};

function createEnemy(type, pos) {
  const def = ENEMY_TYPES[type];
  const p = pos || randomPos(300);
  return {
    id: allocId(), kind: 'enemy', type, name: def.name,
    x: p.x, y: p.y, vx: 0, vy: 0, angle: 0,
    radius: def.radius, color: def.color,
    health: def.hp, maxHealth: def.hp, damage: def.dmg, speed: def.speed,
    xp: def.xp, scoreValue: def.score, aggroRange: def.aggroRange,
    targetId: null, homeX: p.x, homeY: p.y, lastAttackAt: 0,
  };
}

function createBoss(pos) {
  const { BOSS_HEALTH } = require('./constants');
  const p = pos || { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  return {
    id: allocId(), kind: 'boss', type: 'worldBoss', name: 'Colossus',
    x: p.x, y: p.y, vx: 0, vy: 0, angle: 0,
    radius: 90, color: '#ff3b3b',
    health: BOSS_HEALTH, maxHealth: BOSS_HEALTH, damage: 60, speed: 65,
    xp: 4000, scoreValue: 6000, aggroRange: 520,
    targetId: null, lastAttackAt: 0,
    damageContributors: new Map(), // playerId -> total damage
    spawnedAt: Date.now(),
  };
}

module.exports = { RESOURCE_TYPES, ENEMY_TYPES, createResource, createProjectile, createEnemy, createBoss, randomPos, pickResourceType };
