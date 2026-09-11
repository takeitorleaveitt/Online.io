// Boots the app: wires menu buttons, screen transitions, and the
// connect -> join -> play -> death -> replay loop.
(function () {
  const $ = (id) => document.getElementById(id);

  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }

  Meta.refreshMissionsIfNeeded();
  $('name-input').value = Meta.state.name || '';
  UI.renderCurrency();
  UI.refreshDailyPill();

  MenuBackground.start();
  Net.connect();

  Net.on('connect', () => {
    $('server-pill').classList.add('online');
    $('server-pill-text').textContent = 'server online';
  });
  Net.on('disconnect', () => {
    $('server-pill').classList.remove('online');
    $('server-pill-text').textContent = 'reconnecting…';
  });
  Net.on('connect_error', () => {
    $('server-pill-text').textContent = 'connection error';
  });

  function currentLoadout() {
    let name = $('name-input').value.trim().slice(0, 16);
    if (!name) name = `Player${Math.floor(Math.random() * 9000 + 1000)}`;
    Meta.state.name = name; Meta.save();
    return { name, color: Meta.state.selected.color, bodyShape: Meta.state.selected.shape };
  }

  function startConnecting() {
    hide('screen-menu'); hide('screen-death');
    $('connecting-title').textContent = 'CONNECTING…';
    $('connecting-sub').textContent = '';
    show('screen-connecting');
  }

  function doPlay() {
    AudioSystem.unlock();
    SFX.click();
    startConnecting();
    Net.join(currentLoadout());
  }

  Net.on('joined', (data) => {
    $('connecting-title').textContent = 'CONNECTED';
    $('connecting-sub').innerHTML = `${data.realCount} PLAYERS ONLINE &middot; ${data.botCount} BOTS<br/>ENTERING ${data.roomName}`;
    setTimeout(() => {
      hide('screen-connecting');
      show('hud');
      MenuBackground.stop();
      Game.start();
    }, 550);
  });

  $('btn-play').addEventListener('click', doPlay);
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPlay(); });

  document.querySelectorAll('.menu-btn[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => { SFX.click(); UI.openPanel(btn.dataset.panel); });
  });

  $('daily-pill').addEventListener('click', () => {
    if (!Meta.dailyClaimable()) { UI.toast('ALREADY CLAIMED', `Streak ${Meta.state.daily.streak} 🔥 — come back tomorrow`); return; }
    const r = Meta.claimDaily();
    SFX.levelup();
    UI.toast(`DAY ${r.day} REWARD`, r.label);
    UI.renderCurrency();
    UI.refreshDailyPill();
  });

  // ---------------- death screen buttons ----------------
  $('death-play-again').addEventListener('click', () => {
    hide('screen-death');
    startConnecting();
    Net.respawn(currentLoadout());
  });
  $('death-customize').addEventListener('click', () => { UI.openPanel('customize'); });
  $('death-menu').addEventListener('click', () => {
    hide('screen-death');
    Game.stop();
    UI.renderCurrency();
    UI.refreshDailyPill();
    show('screen-menu');
    MenuBackground.start();
  });

  // ---------------- chat ----------------
  const chatInput = $('chat-input');
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) Net.chat(text);
      chatInput.value = '';
      chatInput.blur();
    } else if (e.key === 'Escape') { chatInput.value = ''; chatInput.blur(); }
  });

  // upgrade-spend hotkey reminder
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyU' && document.activeElement.tagName !== 'INPUT') {
      const self = window.Game.self;
      if (self && self.upgradePoints > 0) UI.showLevelUp({ level: self.level, upgradePoints: self.upgradePoints });
    }
  });
})();
