// Account-level (cross-match) progression. There is no login system in
// this build, so it's persisted per-browser in localStorage — currency,
// cosmetic unlocks, missions, achievements, daily rewards, settings.
// The live arena itself is fully server-authoritative (see server/); this
// file only stores cosmetic/meta state, never anything that affects combat.
(function () {
  const KEY = 'onlineio_save_v1';

  const COLORS = ['#5ad1ff', '#ff5a5a', '#ffd75a', '#8fff5a', '#c77bff', '#ff9d5a', '#5affe0', '#ff5ad1', '#ffffff', '#ff8f00'];
  const SHAPES = [
    { id: 'core', name: 'Core', cost: 0 },
    { id: 'hex', name: 'Hex', cost: 400 },
    { id: 'spike', name: 'Spike', cost: 900 },
    { id: 'orb', name: 'Orb', cost: 1500 },
  ];
  const TRAILS = [
    { id: 'none', name: 'None', cost: 0 },
    { id: 'spark', name: 'Spark Trail', cost: 300 },
    { id: 'smoke', name: 'Smoke Trail', cost: 600 },
    { id: 'rainbow', name: 'Rainbow Trail', cost: 2000 },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_blood', name: 'FIRST BLOOD', desc: 'Get your first kill', reward: 100 },
    { id: 'giant', name: 'GIANT', desc: 'Reach level 40', reward: 400 },
    { id: 'survivor', name: 'SURVIVOR', desc: 'Survive 20 minutes in one life', reward: 300 },
    { id: 'boss_slayer', name: 'BOSS SLAYER', desc: 'Land the killing blow on a world boss', reward: 500 },
    { id: 'dominator', name: 'DOMINATOR', desc: 'Reach #1 on the leaderboard', reward: 600 },
    { id: 'collector', name: 'COLLECTOR', desc: 'Collect 10,000 resources lifetime', reward: 350 },
    { id: 'speed_demon', name: 'SPEED DEMON', desc: 'Max out the speed upgrade', reward: 250 },
    { id: 'untouchable', name: 'UNTOUCHABLE', desc: 'Reach top 10 on the leaderboard', reward: 200 },
  ];

  function defaultState() {
    return {
      name: '',
      currency: 250,
      unlocked: { color: [...COLORS.slice(0, 4)], shape: ['core'], trail: ['none'] },
      selected: { color: COLORS[0], shape: 'core', trail: 'none' },
      bestScore: 0,
      stats: { totalKills: 0, totalResources: 0, gamesPlayed: 0, totalBossKills: 0 },
      missions: { day: null, list: [] },
      achievements: {},
      daily: { streak: 0, lastClaim: null },
      recentPlayers: [],
      settings: { musicVolume: 0.5, sfxVolume: 0.8, soundOn: true, mobileControlsForce: 'auto' },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed, {
        unlocked: Object.assign(defaultState().unlocked, parsed.unlocked),
        selected: Object.assign(defaultState().selected, parsed.selected),
        stats: Object.assign(defaultState().stats, parsed.stats),
        daily: Object.assign(defaultState().daily, parsed.daily),
        settings: Object.assign(defaultState().settings, parsed.settings),
      });
    } catch (e) { return defaultState(); }
  }

  const state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function missionTemplates() {
    return [
      { id: 'collect500', desc: 'Collect 500 resources', goal: 500, reward: 120, type: 'resources' },
      { id: 'killbots10', desc: 'Destroy 10 bots', goal: 10, reward: 150, type: 'botKills' },
      { id: 'killplayers3', desc: 'Destroy 3 players', goal: 3, reward: 220, type: 'playerKills' },
      { id: 'survive10', desc: 'Survive for 10 minutes', goal: 600, reward: 180, type: 'survival' },
      { id: 'reachlvl20', desc: 'Reach level 20', goal: 20, reward: 200, type: 'level' },
      { id: 'top10', desc: 'Finish in the top 10', goal: 1, reward: 250, type: 'top10' },
    ];
  }

  function refreshMissionsIfNeeded() {
    const today = todayStr();
    if (state.missions.day !== today) {
      const templates = missionTemplates().sort(() => Math.random() - 0.5).slice(0, 4);
      state.missions.day = today;
      state.missions.list = templates.map((t) => ({ ...t, progress: 0, claimed: false }));
      save();
    }
  }
  refreshMissionsIfNeeded();

  function bumpMission(type, amount) {
    let changed = false;
    for (const m of state.missions.list) {
      if (m.type !== type || m.claimed) continue;
      m.progress = type === 'level' ? Math.max(m.progress, amount) : Math.min(m.goal, m.progress + amount);
      changed = true;
    }
    if (changed) save();
  }
  function setMissionProgress(type, value) {
    let changed = false;
    for (const m of state.missions.list) {
      if (m.type !== type || m.claimed) continue;
      m.progress = Math.max(m.progress, Math.min(m.goal, value));
      changed = true;
    }
    if (changed) save();
  }

  function claimMission(id) {
    const m = state.missions.list.find((x) => x.id === id);
    if (!m || m.claimed || m.progress < m.goal) return false;
    m.claimed = true;
    state.currency += m.reward;
    save();
    return true;
  }

  function unlockAchievement(id) {
    if (state.achievements[id]) return null;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return null;
    state.achievements[id] = { unlockedAt: Date.now() };
    state.currency += def.reward;
    save();
    return def;
  }

  function checkAchievements(self, myRank) {
    const unlocked = [];
    const tryUnlock = (id) => { const r = unlockAchievement(id); if (r) unlocked.push(r); };
    if (self.kills >= 1) tryUnlock('first_blood');
    if (self.level >= 40) tryUnlock('giant');
    if (Date.now() - self.spawnedAt >= 20 * 60 * 1000) tryUnlock('survivor');
    if (myRank === 1) { tryUnlock('dominator'); }
    if (myRank && myRank <= 10) tryUnlock('untouchable');
    if (state.stats.totalResources >= 10000) tryUnlock('collector');
    if ((self.upgrades && self.upgrades.speed || 0) >= 9) tryUnlock('speed_demon');
    return unlocked;
  }

  function claimDaily() {
    const today = todayStr();
    if (state.daily.lastClaim === today) return null;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    state.daily.streak = state.daily.lastClaim === yesterday ? (state.daily.streak + 1) : 1;
    const day = ((state.daily.streak - 1) % 7) + 1;
    const rewards = {
      1: { type: 'coins', amount: 100, label: '+100 Coins' },
      2: { type: 'coins', amount: 150, label: '+150 Coins' },
      3: { type: 'coins', amount: 200, label: 'Cosmetic Discount' },
      4: { type: 'coins', amount: 220, label: '+220 Coins' },
      5: { type: 'coins', amount: 260, label: 'Rare Effect Unlock' },
      6: { type: 'coins', amount: 400, label: 'Large Reward' },
      7: { type: 'coins', amount: 700, label: 'Epic Cosmetic Bundle' },
    }[day];
    state.currency += rewards.amount;
    state.daily.lastClaim = today;
    save();
    return { day, ...rewards, streak: state.daily.streak };
  }
  function dailyClaimable() { return state.daily.lastClaim !== todayStr(); }

  function unlockCosmetic(type, id, cost) {
    if (state.unlocked[type].includes(id)) return true;
    if (state.currency < cost) return false;
    state.currency -= cost;
    state.unlocked[type].push(id);
    save();
    return true;
  }
  function select(type, id) { state.selected[type] = id; save(); }

  function recordMatchResult(stats) {
    state.stats.gamesPlayed += 1;
    state.stats.totalKills += stats.kills || 0;
    state.stats.totalResources += stats.resourcesCollected || 0;
    if ((stats.score || 0) > state.bestScore) state.bestScore = stats.score;
    const earned = Math.round((stats.score || 0) * 0.08) + (stats.kills || 0) * 15;
    state.currency += earned;
    save();
    return earned;
  }

  function addRecentPlayer(name, isBot) {
    if (!name || isBot) return;
    const list = state.recentPlayers.filter((p) => p.name !== name);
    list.unshift({ name, lastSeen: Date.now() });
    state.recentPlayers = list.slice(0, 20);
    save();
  }

  window.Meta = {
    state, save,
    COLORS, SHAPES, TRAILS, ACHIEVEMENTS,
    refreshMissionsIfNeeded, bumpMission, setMissionProgress, claimMission,
    unlockAchievement, checkAchievements,
    claimDaily, dailyClaimable,
    unlockCosmetic, select,
    recordMatchResult, addRecentPlayer,
    get currency() { return state.currency; },
    get settings() { return state.settings; },
  };
})();
