const PREFIXES = [
  'Void', 'Shadow', 'Nova', 'Toxic', 'Raptor', 'Mango', 'Ghost', 'Cyber',
  'Blob', 'Iron', 'Solar', 'Doom', 'Crimson', 'Frost', 'Neon', 'Rogue',
  'Titan', 'Nebula', 'Static', 'Quantum', 'Grim', 'Vortex', 'Ember', 'Astro',
];
const SUFFIXES = [
  'Walker', 'King', 'Demon', 'Slayer', 'Ghost', 'Hunter', 'Fang', 'Blade',
  'Storm', 'Wraith', 'Byte', 'Core', 'Fury', 'Reaper', 'Spark', 'Bolt',
  'Wolf', 'Viper', 'Phantom', 'Crusher', 'Drift', 'Comet', 'Pulse', 'Nova',
];
const PLAIN = [
  'Nobody', 'Destroyer', 'Mango', 'Toxic', 'Shadow', 'Raptor', 'Speedy',
  'Unknown', 'Rookie', 'Legend', 'Outlaw', 'Cipher', 'Havoc', 'Zero',
];

function randInt(n) { return Math.floor(Math.random() * n); }

function generateBotName() {
  const roll = Math.random();
  if (roll < 0.2) return PLAIN[randInt(PLAIN.length)];
  if (roll < 0.45) return `xX_${PREFIXES[randInt(PREFIXES.length)]}_Xx`;
  return `${PREFIXES[randInt(PREFIXES.length)]}${SUFFIXES[randInt(SUFFIXES.length)]}`;
}

module.exports = { generateBotName };
