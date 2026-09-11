const { ZONES, WORLD_SIZE } = require('./constants');

const resolved = ZONES.map((z) => ({
  ...z,
  x0: z.x * WORLD_SIZE,
  y0: z.y * WORLD_SIZE,
  x1: (z.x + z.w) * WORLD_SIZE,
  y1: (z.y + z.h) * WORLD_SIZE,
}));

function zoneAt(x, y) {
  for (const z of resolved) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z;
  }
  return null;
}

module.exports = { resolvedZones: resolved, zoneAt };
