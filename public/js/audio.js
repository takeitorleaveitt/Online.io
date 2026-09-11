// Fully procedural sound system (WebAudio synthesis) — no external audio
// files needed. Covers short SFX blips plus a generative ambient music bed
// that switches mood for normal play / boss fights / big events.
(function () {
  let ctx = null;
  let master, sfxGain, musicGain;
  let unlocked = false;
  let musicTimer = null;
  let musicMode = 'menu';
  let nextNoteTime = 0;

  const settings = {
    get sfxVol() { return window.Meta ? window.Meta.settings.sfxVolume : 0.8; },
    get musicVol() { return window.Meta ? window.Meta.settings.musicVolume : 0.5; },
    get muted() { return window.Meta ? !window.Meta.settings.soundOn : false; },
  };

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = settings.sfxVol; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = settings.musicVol * 0.5; musicGain.connect(master);
  }

  function unlock() {
    if (unlocked) return;
    ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, passive: true }));

  function env(node, t0, attack, decay, peak) {
    node.gain.cancelScheduledValues(t0);
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function tone({ freq = 440, type = 'sine', dur = 0.15, attack = 0.005, gain = 0.3, slideTo = null, dest = null }) {
    if (!ctx || settings.muted) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    env(g, t0, attack, dur, gain);
    osc.connect(g); g.connect(dest || sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst({ dur = 0.2, gain = 0.25, filterFreq = 1200, dest = null }) {
    if (!ctx || settings.muted) return;
    const t0 = ctx.currentTime;
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = filterFreq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filt); filt.connect(g); g.connect(dest || sfxGain);
    src.start(t0);
  }

  const SFX = {
    collect() { tone({ freq: 700 + Math.random() * 200, type: 'sine', dur: 0.09, gain: 0.18, slideTo: 1100 }); },
    coin() { tone({ freq: 900, type: 'triangle', dur: 0.1, gain: 0.2, slideTo: 1400 }); },
    levelup() {
      [0, 90, 180].forEach((delay, i) => setTimeout(() => tone({ freq: 440 * Math.pow(2, i / 3), type: 'square', dur: 0.22, gain: 0.22 }), delay));
    },
    shoot(weapon) {
      const map = { pulse: 780, scatter: 520, rail: 260, plasma: 180, laser: 1200 };
      tone({ freq: map[weapon] || 700, type: weapon === 'laser' ? 'sawtooth' : 'square', dur: 0.07, gain: 0.14, slideTo: (map[weapon] || 700) * 0.6 });
    },
    hit() { noiseBurst({ dur: 0.06, gain: 0.18, filterFreq: 2200 }); },
    crit() { tone({ freq: 1400, type: 'square', dur: 0.08, gain: 0.22 }); noiseBurst({ dur: 0.05, gain: 0.18 }); },
    destroy() { noiseBurst({ dur: 0.35, gain: 0.32, filterFreq: 900 }); tone({ freq: 160, type: 'sawtooth', dur: 0.4, gain: 0.2, slideTo: 40 }); },
    damage() { tone({ freq: 180, type: 'sawtooth', dur: 0.12, gain: 0.22, slideTo: 90 }); },
    ability() { tone({ freq: 500, type: 'sine', dur: 0.2, gain: 0.25, slideTo: 1000 }); },
    dash() { noiseBurst({ dur: 0.12, gain: 0.15, filterFreq: 3000 }); },
    death() {
      noiseBurst({ dur: 0.6, gain: 0.35, filterFreq: 700 });
      tone({ freq: 300, type: 'sawtooth', dur: 0.8, gain: 0.25, slideTo: 30 });
    },
    menuOpen() { tone({ freq: 520, type: 'sine', dur: 0.1, gain: 0.15, slideTo: 780 }); },
    menuClose() { tone({ freq: 780, type: 'sine', dur: 0.1, gain: 0.15, slideTo: 480 }); },
    click() { tone({ freq: 600, type: 'triangle', dur: 0.05, gain: 0.14 }); },
    select() { tone({ freq: 900, type: 'triangle', dur: 0.07, gain: 0.18, slideTo: 1200 }); },
    spawn() { tone({ freq: 220, type: 'sine', dur: 0.3, gain: 0.2, slideTo: 660 }); },
    bossAnnounce() {
      [0, 160, 320].forEach((delay, i) => setTimeout(() => {
        tone({ freq: 110 * (i + 1), type: 'sawtooth', dur: 0.5, gain: 0.28 });
        noiseBurst({ dur: 0.2, gain: 0.2, filterFreq: 500 });
      }, delay));
    },
  };

  // ---------- generative ambient music ----------
  const SCALES = {
    calm: [220, 261.6, 293.7, 329.6, 392, 440],
    boss: [196, 233.1, 261.6, 277.2, 329.6, 349.2],
    event: [246.9, 293.7, 329.6, 369.9, 440, 493.9],
  };

  function scheduleNote(mode) {
    if (!ctx) return;
    const scale = SCALES[mode] || SCALES.calm;
    const t0 = nextNoteTime;
    const freq = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = mode === 'boss' ? 'sawtooth' : 'sine';
    osc.frequency.value = freq;
    const dur = mode === 'boss' ? 0.35 : 1.4;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(mode === 'boss' ? 0.18 : 0.1, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(musicGain);
    osc.start(t0); osc.stop(t0 + dur + 0.05);

    if (mode !== 'boss' && Math.random() < 0.5) {
      const bassOsc = ctx.createOscillator(); const bg = ctx.createGain();
      bassOsc.type = 'sine'; bassOsc.frequency.value = scale[0] / 2;
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.06, t0 + 0.3);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
      bassOsc.connect(bg); bg.connect(musicGain);
      bassOsc.start(t0); bassOsc.stop(t0 + 2.3);
    }
  }

  function musicLoop() {
    if (!ctx) return;
    const interval = musicMode === 'boss' ? 0.22 : 0.85;
    while (nextNoteTime < ctx.currentTime + 0.6) {
      scheduleNote(musicMode);
      nextNoteTime += interval * (0.85 + Math.random() * 0.3);
    }
  }

  const Music = {
    start(mode = 'calm') {
      ensureCtx();
      musicMode = mode;
      nextNoteTime = ctx.currentTime + 0.1;
      if (musicTimer) clearInterval(musicTimer);
      musicTimer = setInterval(musicLoop, 200);
    },
    setMode(mode) { musicMode = mode; },
    stop() { if (musicTimer) clearInterval(musicTimer); musicTimer = null; },
    setVolume(v) { if (musicGain) musicGain.gain.value = v * 0.5; },
  };

  function applyVolumes() {
    if (sfxGain) sfxGain.gain.value = settings.sfxVol;
    if (musicGain) musicGain.gain.value = settings.musicVol * 0.5;
  }

  window.SFX = SFX;
  window.Music = Music;
  window.AudioSystem = { unlock, applyVolumes };
})();
