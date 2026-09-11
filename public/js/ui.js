// All HUD + menu-panel DOM wiring. game.js calls into UI.onState() on every
// server snapshot; main.js calls the panel/menu functions from button clicks.
(function () {
  const UPGRADE_DEFS = {
    maxHealth: { icon: '❤', name: 'MAX HEALTH', desc: '+ maximum health' },
    speed: { icon: '⚡', name: 'SPEED', desc: '+ movement speed' },
    damage: { icon: '💥', name: 'DAMAGE', desc: '+ weapon damage' },
    attackSpeed: { icon: '🔁', name: 'ATTACK SPEED', desc: '+ fire rate' },
    projectileSpeed: { icon: '➤', name: 'PROJECTILE SPEED', desc: '+ shot velocity' },
    energy: { icon: '🔷', name: 'ENERGY', desc: '+ max energy' },
    energyRegen: { icon: '♻', name: 'ENERGY REGEN', desc: '+ energy regen rate' },
    critChance: { icon: '✦', name: 'CRIT CHANCE', desc: '+ critical hit chance' },
    armor: { icon: '🛡', name: 'ARMOR', desc: '+ damage reduction' },
    lifeSteal: { icon: '🩸', name: 'LIFE STEAL', desc: '+ heal on hit' },
  };
  const WEAPON_ICONS = { pulse: '🔫', scatter: '💠', rail: '🎯', plasma: '☄', laser: '➰' };
  const ABILITY_ICONS = { dash: 'DASH', shield: 'SHIELD', emp: 'EMP', magnet: 'MAGNET' };
  const EVOLUTION_DESC = {
    assault: 'Higher damage output', tank: 'Higher health and armor',
    speed: 'Extremely fast movement', destroyer: 'Huge weapons and explosions',
  };

  const $ = (id) => document.getElementById(id);
  let lastWeaponSig = '';
  let bestScoreCache = 0;

  function fmt(n) { return Math.round(n).toLocaleString(); }
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------------- HUD ----------------
  function onState(data, joinInfo) {
    const self = data.self;
    $('hud-level').textContent = self.level;
    $('hud-xp-bar').style.width = `${Math.min(100, (self.xp / self.xpToNext) * 100)}%`;
    $('hud-score').textContent = fmt(self.score);

    $('hud-hp-fill').style.width = `${Math.max(0, (self.health / self.maxHealth) * 100)}%`;
    $('hud-hp-label').textContent = `${Math.round(self.health)}/${Math.round(self.maxHealth)}`;
    $('hud-en-fill').style.width = `${Math.max(0, (self.energy / self.maxEnergy) * 100)}%`;
    $('hud-en-label').textContent = `${Math.round(self.energy)}/${Math.round(self.maxEnergy)}`;

    const sig = self.unlockedWeapons.join(',') + '|' + self.weapon;
    if (sig !== lastWeaponSig) {
      lastWeaponSig = sig;
      const row = $('weapon-row');
      row.innerHTML = '';
      self.unlockedWeapons.forEach((w) => {
        const chip = document.createElement('div');
        chip.className = 'weapon-chip' + (w === self.weapon ? ' active' : '');
        chip.textContent = `${WEAPON_ICONS[w] || ''} ${joinInfo.weapons[w].name}`;
        chip.addEventListener('click', () => Net.weapon(w));
        row.appendChild(chip);
      });
    }

    $('ability-label').textContent = ABILITY_ICONS[self.abilityKey] || self.abilityKey.toUpperCase();
    const abilityDef = joinInfo.abilities[self.abilityKey];
    const readyAt = self.cooldowns[self.abilityKey] || 0;
    const remaining = Math.max(0, (readyAt - Date.now()) / 1000);
    const pct = abilityDef ? Math.min(1, remaining / abilityDef.cooldown) : 0;
    $('ability-cd').style.height = `${pct * 100}%`;

    const lbList = $('lb-list');
    lbList.innerHTML = '';
    const topScore = Math.max(1, ...data.leaderboard.map((r) => r.score));
    data.leaderboard.forEach((row) => {
      const li = document.createElement('li');
      if (row.rank === data.myRank) li.classList.add('me');
      const pct = Math.max(6, Math.round((row.score / topScore) * 100));
      li.innerHTML = `<div class="lb-bar" style="width:${pct}%"></div><span class="lbn">${row.rank}. ${escapeHtml(row.name)}</span><span class="lbs">${fmt(row.score)}</span>`;
      lbList.appendChild(li);
    });
    const inTop = data.myRank && data.myRank <= 10;
    $('lb-self').textContent = inTop ? `#${data.myRank} — YOU` : `#${data.myRank || '?'} of ${data.totalPlayers} — YOU`;
    $('lb-self').style.display = inTop ? 'none' : 'block';

    if (data.boss) {
      $('boss-bar').classList.remove('hidden');
      $('boss-name').textContent = data.boss.name.toUpperCase();
      $('boss-hp').style.width = `${Math.max(0, (data.boss.hp / data.boss.mhp) * 100)}%`;
    } else {
      $('boss-bar').classList.add('hidden');
    }

    $('pop-real').textContent = data.realCount;
    $('pop-bots').textContent = data.botCount;

    const tokenEl = $('hud-tokens');
    if (tokenEl.textContent != self.upgradePoints) {
      tokenEl.textContent = self.upgradePoints;
      $('token-badge').classList.toggle('has-tokens', self.upgradePoints > 0);
    }
    renderUpgradePanel(self);
  }

  // ---------------- persistent in-game upgrade panel (diep.io style) ----------------
  const UPGRADE_ROW_COLORS = {
    maxHealth: 'orange', energyRegen: 'orange', armor: 'orange', energy: 'orange',
    damage: 'red', critChance: 'red', attackSpeed: 'red', lifeSteal: 'red',
    speed: 'purple', projectileSpeed: 'purple',
  };
  let upgradePanelBuilt = false;
  function buildUpgradePanel() {
    const panel = $('ingame-upgrade-panel');
    panel.innerHTML = '';
    Object.entries(UPGRADE_DEFS).forEach(([key, def]) => {
      const row = document.createElement('div');
      row.className = 'upgrade-row';
      row.dataset.key = key;
      row.innerHTML = `
        <span class="upgrade-row-name">${def.icon} ${def.name} <span class="upgrade-row-rank">[<span class="rank-num">0</span>]</span></span>
        <button class="gbtn gbtn-${UPGRADE_ROW_COLORS[key] || 'blue'} gbtn-sm upgrade-plus">+</button>`;
      row.querySelector('.upgrade-plus').addEventListener('click', () => {
        Net.upgrade(key);
        SFX.select();
        row.classList.add('spent');
        setTimeout(() => row.classList.remove('spent'), 180);
      });
      panel.appendChild(row);
    });
    upgradePanelBuilt = true;
  }
  function renderUpgradePanel(self) {
    const panel = $('ingame-upgrade-panel');
    if (self.upgradePoints <= 0) { panel.classList.add('hidden'); return; }
    if (!upgradePanelBuilt) buildUpgradePanel();
    panel.classList.remove('hidden');
    panel.querySelectorAll('.upgrade-row').forEach((row) => {
      const key = row.dataset.key;
      const rank = (self.upgrades && self.upgrades[key]) || 0;
      row.querySelector('.rank-num').textContent = rank;
      row.querySelector('.upgrade-plus').disabled = self.upgradePoints <= 0;
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------- toasts ----------------
  function toast(title, msg) {
    const stack = $('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="t-title">${escapeHtml(title)}</div><div>${escapeHtml(msg || '')}</div>`;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  // ---------------- level up (toast only - the upgrade panel shows itself) ----------------
  function onLevelUp(data) {
    toast(`LEVEL ${data.level}!`, '+10 upgrade tokens');
    const badge = $('token-badge');
    badge.classList.add('pulse');
    setTimeout(() => badge.classList.remove('pulse'), 700);
  }
  $('token-badge').addEventListener('click', () => {
    const panel = $('ingame-upgrade-panel');
    panel.classList.toggle('collapsed');
  });

  function showEvolution(data) {
    const overlay = $('evolution-overlay');
    $('evo-num').textContent = data.level;
    const grid = $('evolution-grid');
    grid.innerHTML = '';
    const joinInfo = window.Game.joinInfo;
    Object.entries(joinInfo.evolutions).forEach(([key, def]) => {
      const card = document.createElement('button');
      card.className = 'evolution-card';
      card.style.setProperty('--face', def.color);
      card.innerHTML = `<div class="name">${def.name.toUpperCase()}</div><div class="desc">${EVOLUTION_DESC[key] || ''}</div>`;
      card.addEventListener('click', () => {
        Net.evolve(key);
        SFX.select();
        overlay.classList.add('hidden');
      });
      grid.appendChild(card);
    });
    overlay.classList.remove('hidden');
  }

  // ---------------- event banner / boss announce ----------------
  let eventTimer = null;
  function showEventBanner(data) {
    const el = $('event-banner');
    el.textContent = `⚡ ${data.label} ⚡`;
    el.classList.remove('hidden');
    toast('WORLD EVENT', data.label);
  }
  function hideEventBanner() { $('event-banner').classList.add('hidden'); }

  function announceBoss(data) {
    const el = $('boss-announce');
    el.classList.remove('hidden');
    void el.offsetWidth;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 3200);
  }

  // ---------------- chat ----------------
  function addChatMessage(msg) {
    const log = $('chat-log');
    const div = document.createElement('div');
    if (msg.isBot) div.className = 'bot-msg';
    div.innerHTML = `<b style="color:${msg.color}">${escapeHtml(msg.name)}:</b> ${escapeHtml(msg.text)}`;
    log.appendChild(div);
    while (log.children.length > 6) log.removeChild(log.firstChild);
  }

  // ---------------- death screen ----------------
  function showDeathScreen(stats, earned) {
    $('hud').classList.add('hidden');
    $('death-killer').textContent = stats.killerName ? `Destroyed by ${stats.killerName}` : 'Destroyed';
    $('death-score').textContent = fmt(stats.score);
    $('death-level').textContent = stats.level;
    $('death-kills').textContent = stats.kills;
    $('death-time').textContent = fmtTime(stats.survivalTime);
    $('death-best').textContent = fmt(window.Meta ? Meta.state.bestScore : stats.score);
    if (earned) toast('MATCH REWARD', `+${earned} coins`);
    renderCurrency();
    $('screen-death').classList.remove('hidden');
  }

  // ---------------- currency / daily ----------------
  function renderCurrency() { $('currency-amount').textContent = Meta.currency.toLocaleString(); }

  function refreshDailyPill() {
    $('daily-pill').textContent = Meta.dailyClaimable() ? '🎁 Claim Daily Reward' : `🔥 Streak ${Meta.state.daily.streak}`;
  }

  // ---------------- panels ----------------
  function renderCustomizePanel(body) {
    body.innerHTML = `
      <div class="customize-layout">
        <canvas class="customize-preview-canvas" id="preview-canvas" width="200" height="200" style="border-radius:16px;background:radial-gradient(circle at 50% 40%, #17233b, #0a0f1c);"></canvas>
        <div class="customize-options">
          <div>
            <div class="option-group-label">BODY COLOR</div>
            <div class="swatch-row" id="opt-colors"></div>
          </div>
          <div>
            <div class="option-group-label">BODY SHAPE</div>
            <div class="shape-row" id="opt-shapes"></div>
          </div>
          <div>
            <div class="option-group-label">TRAIL EFFECT</div>
            <div class="cosmetic-row" id="opt-trails"></div>
          </div>
        </div>
      </div>`;
    const colorsEl = body.querySelector('#opt-colors');
    Meta.COLORS.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (Meta.state.selected.color === c ? ' selected' : '');
      sw.style.background = c;
      sw.addEventListener('click', () => {
        if (!Meta.state.unlocked.color.includes(c)) { if (!Meta.unlockCosmetic('color', c, 150)) { toast('NOT ENOUGH COINS', ''); return; } }
        Meta.select('color', c); SFX.select(); renderCustomizePanel(body); drawPreview();
      });
      colorsEl.appendChild(sw);
    });
    const shapesEl = body.querySelector('#opt-shapes');
    Meta.SHAPES.forEach((s) => {
      const owned = Meta.state.unlocked.shape.includes(s.id);
      const btn = document.createElement('button');
      btn.className = `gbtn gbtn-sm ${Meta.state.selected.shape === s.id ? 'gbtn-green selected' : 'gbtn-blue'}`;
      btn.innerHTML = s.name + (owned ? '' : `<span class="cost">⬡${s.cost}</span>`);
      btn.addEventListener('click', () => {
        if (!owned && !Meta.unlockCosmetic('shape', s.id, s.cost)) { toast('NOT ENOUGH COINS', ''); return; }
        Meta.select('shape', s.id); SFX.select(); renderCustomizePanel(body); drawPreview();
      });
      shapesEl.appendChild(btn);
    });
    const trailsEl = body.querySelector('#opt-trails');
    Meta.TRAILS.forEach((s) => {
      const owned = Meta.state.unlocked.trail.includes(s.id);
      const btn = document.createElement('button');
      btn.className = `gbtn gbtn-sm ${Meta.state.selected.trail === s.id ? 'gbtn-green selected' : 'gbtn-blue'}`;
      btn.innerHTML = s.name + (owned ? '' : `<span class="cost">⬡${s.cost}</span>`);
      btn.addEventListener('click', () => {
        if (!owned && !Meta.unlockCosmetic('trail', s.id, s.cost)) { toast('NOT ENOUGH COINS', ''); return; }
        Meta.select('trail', s.id); SFX.select(); renderCustomizePanel(body); drawPreview();
      });
      trailsEl.appendChild(btn);
    });
    drawPreview();
    renderCurrency();
  }

  function drawPreview() {
    const c = document.getElementById('preview-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.fillStyle = Meta.state.selected.color;
    ctx.shadowColor = Meta.state.selected.color; ctx.shadowBlur = 24;
    const r = 46;
    const shape = Meta.state.selected.shape;
    if (shape === 'hex') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    } else if (shape === 'spike') {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const rr = i % 2 === 0 ? r : r * 0.62; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      if (shape === 'orb') { ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();
  }

  function renderUpgradesPanel(body) {
    const joinInfo = window.Game.joinInfo;
    let html = '<div class="option-group-label">WEAPONS (unlock automatically as you level up)</div><div class="info-list">';
    const weapons = joinInfo ? joinInfo.weapons : {
      pulse: { name: 'Pulse Gun' }, scatter: { name: 'Scatter Cannon' }, rail: { name: 'Rail Cannon' }, plasma: { name: 'Plasma Launcher' }, laser: { name: 'Laser' },
    };
    Object.entries(weapons).forEach(([k, w]) => {
      html += `<div class="info-row"><span class="name">${WEAPON_ICONS[k] || ''} ${w.name}</span></div>`;
    });
    html += '</div><br/><div class="option-group-label">ABILITIES</div><div class="info-list">';
    const abilities = joinInfo ? joinInfo.abilities : { dash: {}, shield: {}, emp: {}, magnet: {} };
    Object.entries(abilities).forEach(([k]) => {
      html += `<div class="info-row"><span class="name">${ABILITY_ICONS[k] || k}</span></div>`;
    });
    html += '</div><br/><div class="option-group-label">STAT UPGRADES — pick one every level in-match (press U to reopen)</div><div class="info-list">';
    Object.values(UPGRADE_DEFS).forEach((d) => {
      html += `<div class="info-row"><span class="name">${d.icon} ${d.name}</span><span class="desc">${d.desc}</span></div>`;
    });
    html += '</div><br/><div class="option-group-label">EVOLUTIONS — choose your path at level 10</div><div class="info-list">';
    Object.entries(EVOLUTION_DESC).forEach(([k, d]) => {
      html += `<div class="info-row"><span class="name">${k.toUpperCase()}</span><span class="desc">${d}</span></div>`;
    });
    html += '</div>';
    body.innerHTML = html;
  }

  function renderMissionsPanel(body) {
    Meta.refreshMissionsIfNeeded();
    body.innerHTML = '<div class="gtabs"><button class="gtab active" data-t="missions">DAILY MISSIONS</button><button class="gtab" data-t="achievements">ACHIEVEMENTS</button></div><div id="missions-body"></div>';
    const mbody = body.querySelector('#missions-body');
    function renderMissions() {
      mbody.innerHTML = '';
      Meta.state.missions.list.forEach((m) => {
        const done = m.progress >= m.goal;
        const row = document.createElement('div');
        row.className = 'mission-row' + (done ? ' done' : '');
        row.innerHTML = `
          <div style="flex:2">
            <div>${escapeHtml(m.desc)}</div>
            <div class="mission-progress-wrap"><div class="mission-progress-fill" style="width:${Math.min(100, (m.progress / m.goal) * 100)}%"></div></div>
          </div>
          <div class="mission-reward">⬡${m.reward}</div>
          <button class="gbtn gbtn-sm ${done && !m.claimed ? 'gbtn-green' : 'gbtn-gray'}" ${done && !m.claimed ? '' : 'disabled'}>${m.claimed ? 'CLAIMED' : (done ? 'CLAIM' : `${m.progress}/${m.goal}`)}</button>`;
        row.querySelector('button').addEventListener('click', () => { if (Meta.claimMission(m.id)) { SFX.select(); renderMissions(); renderCurrency(); } });
        mbody.appendChild(row);
      });
    }
    function renderAchievements() {
      mbody.innerHTML = '';
      Meta.ACHIEVEMENTS.forEach((a) => {
        const unlocked = !!Meta.state.achievements[a.id];
        const row = document.createElement('div');
        row.className = 'mission-row' + (unlocked ? ' done' : '');
        row.innerHTML = `<div style="flex:2"><div>${unlocked ? '🏆' : '🔒'} ${a.name}</div><div style="font-size:11px;color:var(--text-dim)">${a.desc}</div></div><div class="mission-reward">⬡${a.reward}</div>`;
        mbody.appendChild(row);
      });
    }
    renderMissions();
    body.querySelectorAll('.gtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        body.querySelectorAll('.gtab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        SFX.click();
        if (btn.dataset.t === 'missions') renderMissions(); else renderAchievements();
      });
    });
  }

  function renderLeaderboardsPanel(body) {
    body.innerHTML = `<div class="option-group-label">SEASON 1 — LIVE STANDINGS (this match)</div><div id="lb-panel-list"></div>
      <br/><div class="option-group-label">YOUR STATS</div>
      <div class="info-list">
        <div class="info-row"><span class="name">Best Score</span><span>${Meta.state.bestScore.toLocaleString()}</span></div>
        <div class="info-row"><span class="name">Total Kills</span><span>${Meta.state.stats.totalKills}</span></div>
        <div class="info-row"><span class="name">Resources Collected</span><span>${Meta.state.stats.totalResources.toLocaleString()}</span></div>
        <div class="info-row"><span class="name">Games Played</span><span>${Meta.state.stats.gamesPlayed}</span></div>
      </div>`;
    const list = body.querySelector('#lb-panel-list');
    if (window.Game.self) {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:12px">Join a match to see live standings.</div>';
    } else {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:12px">Play a match to see live standings here.</div>';
    }
  }

  function renderShopPanel(body) {
    body.innerHTML = '<div class="option-group-label">COSMETIC SHOP — never affects combat power</div><div class="customize-options" id="shop-list" style="margin-top:12px"></div>';
    const list = body.querySelector('#shop-list');
    const sections = [
      { type: 'color', items: Meta.COLORS.map((c) => ({ id: c, name: c, cost: 150 })) },
      { type: 'shape', items: Meta.SHAPES },
      { type: 'trail', items: Meta.TRAILS },
    ];
    sections.forEach((sec) => {
      const label = document.createElement('div');
      label.className = 'option-group-label';
      label.textContent = sec.type.toUpperCase() + 'S';
      list.appendChild(label);
      const row = document.createElement('div');
      row.className = 'cosmetic-row';
      sec.items.forEach((it) => {
        const owned = Meta.state.unlocked[sec.type].includes(it.id);
        const btn = document.createElement('button');
        btn.className = `gbtn gbtn-sm ${owned ? 'gbtn-gray' : 'gbtn-orange'}`;
        btn.innerHTML = (sec.type === 'color' ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${it.id};margin-right:6px"></span>` : '') + (it.name || it.id) + (owned ? ' ✓' : `<span class="cost">⬡${it.cost}</span>`);
        btn.addEventListener('click', () => {
          if (owned) { toast('ALREADY OWNED', ''); return; }
          if (Meta.unlockCosmetic(sec.type, it.id, it.cost)) { SFX.select(); toast('UNLOCKED', it.name || it.id); renderShopPanel(body); renderCurrency(); }
          else toast('NOT ENOUGH COINS', '');
        });
        row.appendChild(btn);
      });
      list.appendChild(row);
    });
  }

  function renderSettingsPanel(body) {
    body.innerHTML = `
      <div class="settings-row"><span>SFX Volume</span><input type="range" id="s-sfx" min="0" max="1" step="0.05" value="${Meta.settings.sfxVolume}"/></div>
      <div class="settings-row"><span>Sound Enabled</span><button class="gtoggle ${Meta.settings.soundOn ? 'on' : ''}" id="s-sound"></button></div>
      <div class="settings-row"><span>Player Name</span><input id="s-name" class="field-input" value="${escapeHtml(Meta.state.name || '')}" placeholder="3-18 characters"/></div>
      <div class="settings-row"><span style="color:var(--text-dim);font-size:12px">Online.io — server-authoritative arena · real WebSocket multiplayer</span></div>`;
    body.querySelector('#s-sfx').addEventListener('input', (e) => { Meta.settings.sfxVolume = parseFloat(e.target.value); Meta.save(); AudioSystem.applyVolumes(); });
    body.querySelector('#s-sound').addEventListener('click', (e) => { Meta.settings.soundOn = !Meta.settings.soundOn; Meta.save(); e.target.classList.toggle('on'); });
    body.querySelector('#s-name').addEventListener('change', (e) => {
      const v = e.target.value.trim().slice(0, 18);
      Meta.state.name = v; Meta.save();
      const ni = document.getElementById('name-input'); if (ni) ni.value = v;
    });
  }

  const PANEL_RENDERERS = {
    customize: { title: 'CUSTOMIZE', render: renderCustomizePanel },
    upgrades: { title: 'UPGRADES & WEAPONS', render: renderUpgradesPanel },
    missions: { title: 'MISSIONS & ACHIEVEMENTS', render: renderMissionsPanel },
    leaderboards: { title: 'LEADERBOARDS', render: renderLeaderboardsPanel },
    shop: { title: 'SHOP', render: renderShopPanel },
    settings: { title: 'SETTINGS', render: renderSettingsPanel },
  };

  function openPanel(name) {
    const def = PANEL_RENDERERS[name];
    if (!def) return;
    $('panel-title').textContent = def.title;
    def.render($('panel-body'));
    $('panel-overlay').classList.remove('hidden');
    SFX.menuOpen();
  }
  function closePanel() { $('panel-overlay').classList.add('hidden'); SFX.menuClose(); }
  $('panel-close').addEventListener('click', closePanel);
  $('panel-overlay').addEventListener('click', (e) => { if (e.target.id === 'panel-overlay') closePanel(); });

  window.UI = {
    onState, toast, onLevelUp, showEvolution, showEventBanner, hideEventBanner,
    announceBoss, addChatMessage, showDeathScreen, renderCurrency, refreshDailyPill,
    openPanel, closePanel,
  };
})();
