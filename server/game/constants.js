// Core tuning constants for the Online.io arena simulation.
// Kept in one place so client-facing numbers (map size, zone bounds) stay
// in sync with what the authoritative server actually simulates.

module.exports = {
  TICK_RATE: 30,                // server simulation ticks per second
  BROADCAST_RATE: 20,           // snapshots sent to clients per second
  WORLD_SIZE: 6000,             // world is WORLD_SIZE x WORLD_SIZE units

  MAX_PLAYERS_PER_ROOM: 60,
  SPAWN_GRACE_MS: 3000,
  TARGET_REAL_RATIO: 0.75,      // ~75% real players / 25% bots at capacity
  MIN_BOTS_WHEN_EMPTY: 18,      // keep the world feeling alive with few real players
  MAX_BOTS: 40,

  RESOURCE_TARGET_COUNT: 420,
  RESOURCE_RESPAWN_MS: 350,

  NEUTRAL_ENEMY_TARGET_COUNT: 14,
  BOSS_SPAWN_INTERVAL_MS: 5 * 60 * 1000,
  BOSS_HEALTH: 60000,

  WORLD_EVENT_INTERVAL_MS: 90 * 1000,
  WORLD_EVENT_DURATION_MS: 30 * 1000,

  PLAYER_BASE_RADIUS: 18,
  PLAYER_MAX_RADIUS: 120,
  PLAYER_BASE_SPEED: 220,       // units / second
  PLAYER_BASE_HEALTH: 100,
  PLAYER_BASE_ENERGY: 100,
  PLAYER_BASE_DAMAGE: 10,

  XP_PER_LEVEL_BASE: 100,
  XP_PER_LEVEL_GROWTH: 1.18,
  MAX_LEVEL: 60,
  BOT_MAX_LEVEL: 22,             // keeps long-surviving bots dangerous but not endgame-boss-tier

  ZONES: [
    { id: 'grasslands', name: 'Grasslands', color: '#2e7d46', x: 0.00, y: 0.00, w: 0.34, h: 0.34, resourceMul: 1.0 },
    { id: 'desert',     name: 'Desert',     color: '#c9a34e', x: 0.66, y: 0.00, w: 0.34, h: 0.30, resourceMul: 0.9 },
    { id: 'frozen',     name: 'Frozen Zone', color: '#8fd3e8', x: 0.00, y: 0.66, w: 0.32, h: 0.34, hazard: 'slow', resourceMul: 0.9 },
    { id: 'lava',       name: 'Lava Zone',   color: '#7a2618', x: 0.66, y: 0.66, w: 0.34, h: 0.34, hazard: 'burn', resourceMul: 1.1 },
    { id: 'crystal',    name: 'Crystal Zone', color: '#7b4fd6', x: 0.36, y: 0.36, w: 0.28, h: 0.28, hazard: 'none', resourceMul: 1.6, rare: true },
    { id: 'dark',       name: 'Dark Zone',   color: '#151522', x: 0.36, y: 0.00, w: 0.28, h: 0.30, hazard: 'dark', resourceMul: 1.2 },
  ],

  WEAPONS: {
    pulse:   { name: 'Pulse Gun',      fireRate: 4.2, projSpeed: 620, dmgMul: 1.0, spread: 0, count: 1, life: 0.9,  radius: 5,  color: '#5ad1ff' },
    scatter: { name: 'Scatter Cannon', fireRate: 1.7, projSpeed: 520, dmgMul: 0.55, spread: 0.55, count: 5, life: 0.6, radius: 5, color: '#ffb14e' },
    rail:    { name: 'Rail Cannon',    fireRate: 0.9, projSpeed: 1100, dmgMul: 3.4, spread: 0, count: 1, life: 1.1, radius: 6, color: '#ff5ad1', pierce: true },
    plasma:  { name: 'Plasma Launcher',fireRate: 1.1, projSpeed: 420, dmgMul: 2.6, spread: 0, count: 1, life: 1.4, radius: 12, color: '#8fff5a', explode: 90 },
    laser:   { name: 'Laser',          fireRate: 12,  projSpeed: 1600, dmgMul: 0.32, spread: 0, count: 1, life: 0.35, radius: 3, color: '#ff3b3b', beam: true },
  },

  ABILITIES: {
    dash:   { name: 'Dash',   cooldown: 4.5, energyCost: 20 },
    shield: { name: 'Shield', cooldown: 12,  energyCost: 35, duration: 3.5 },
    emp:    { name: 'EMP',    cooldown: 16,  energyCost: 45, radius: 260 },
    magnet: { name: 'Magnet', cooldown: 9,   energyCost: 25, duration: 3, radius: 320 },
  },

  EVOLUTIONS: {
    assault:   { name: 'Assault',   level: 10, dmgMul: 1.35, hpMul: 1.0,  speedMul: 1.0,  color: '#ff5a5a' },
    tank:      { name: 'Tank',      level: 10, dmgMul: 0.9,  hpMul: 1.7,  speedMul: 0.85, color: '#5a8cff' },
    speed:     { name: 'Speed',     level: 10, dmgMul: 0.85, hpMul: 0.9,  speedMul: 1.55, color: '#5affe0' },
    destroyer: { name: 'Destroyer', level: 10, dmgMul: 1.7,  hpMul: 1.25, speedMul: 0.75, color: '#ffb85a' },
  },

  UPGRADE_KEYS: [
    'maxHealth', 'speed', 'damage', 'attackSpeed', 'projectileSpeed',
    'energy', 'energyRegen', 'critChance', 'armor', 'lifeSteal',
  ],
};
