// Fully procedural sound system (WebAudio synthesis) — no external audio
// files, no background music (SFX only, per design). Each blip layers a
// primary oscillator with a slightly detuned second voice through a
// lowpass filter, plus a touch of per-play pitch randomization, so
// repeated sounds don't feel like the exact same robotic beep every time.
(function () {
  let ctx = null;
  let master, sfxGain;
  let unlocked = false;

  const settings = {
    get sfxVol() { return window.Meta ? window.Meta.settings.sfxVolume : 0.8; },
    get muted() { return window.Meta ? !window.Meta.settings.soundOn : false; },
  };

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = settings.sfxVol; sfxGain.connect(master);
  }

  function unlock() {
    if (unlocked) return;
    ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, passive: true }));

  function envGain(node, t0, attack, decay, peak) {
    node.gain.cancelScheduledValues(t0);
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  // Layered voice: main osc + a quiet detuned second osc, both through a
  // lowpass filter that rounds off harsh square/sawtooth edges.
  function voice({ freq = 440, type = 'sine', dur = 0.15, attack = 0.004, gain = 0.3,
    slideTo = null, detuneCents = 9, filterFreq = 3400, filterQ = 0.7, dest = null, jitter = 0.02 }) {
    if (!ctx || settings.muted) return;
    const t0 = ctx.currentTime;
    const f0 = freq * (1 + (Math.random() - 0.5) * jitter);
    const target = dest || sfxGain;

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = filterFreq; filt.Q.value = filterQ;
    filt.connect(target);

    const g = ctx.createGain();
    envGain(g, t0, attack, dur, gain);
    g.connect(filt);

    const osc = ctx.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(f0, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    osc.connect(g);
    osc.start(t0); osc.stop(t0 + dur + 0.05);

    const g2 = ctx.createGain();
    envGain(g2, t0, attack, dur * 0.85, gain * 0.32);
    g2.connect(filt);
    const osc2 = ctx.createOscillator();
    osc2.type = type === 'square' ? 'triangle' : type;
    osc2.frequency.setValueAtTime(f0 * Math.pow(2, detuneCents / 1200), t0);
    if (slideTo) osc2.frequency.exponentialRampToValueAtTime(slideTo * Math.pow(2, detuneCents / 1200), t0 + dur);
    osc2.connect(g2);
    osc2.start(t0); osc2.stop(t0 + dur + 0.05);
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
    collect() { voice({ freq: 680 + Math.random() * 180, type: 'sine', dur: 0.1, gain: 0.16, slideTo: 1050, filterFreq: 2600 }); },
    coin() { voice({ freq: 880, type: 'triangle', dur: 0.11, gain: 0.18, slideTo: 1300, filterFreq: 3000 }); },
    levelup() {
      [0, 90, 180].forEach((delay, i) => setTimeout(() => voice({ freq: 392 * Math.pow(2, i / 3), type: 'triangle', dur: 0.24, gain: 0.2, filterFreq: 4000 }), delay));
    },
    shoot(weapon) {
      const map = { pulse: 720, scatter: 480, rail: 240, plasma: 170, laser: 1000 };
      const f = map[weapon] || 650;
      voice({ freq: f, type: weapon === 'laser' ? 'triangle' : 'square', dur: 0.075, gain: 0.12, slideTo: f * 0.55, filterFreq: 2200, jitter: 0.06 });
    },
    hit() { noiseBurst({ dur: 0.06, gain: 0.16, filterFreq: 1900 }); },
    crit() { voice({ freq: 1300, type: 'triangle', dur: 0.09, gain: 0.2, filterFreq: 4200 }); noiseBurst({ dur: 0.05, gain: 0.15 }); },
    destroy() { noiseBurst({ dur: 0.32, gain: 0.28, filterFreq: 800 }); voice({ freq: 150, type: 'triangle', dur: 0.38, gain: 0.18, slideTo: 40, filterFreq: 1200 }); },
    damage() { voice({ freq: 170, type: 'triangle', dur: 0.12, gain: 0.2, slideTo: 85, filterFreq: 1400 }); },
    ability() { voice({ freq: 480, type: 'sine', dur: 0.2, gain: 0.22, slideTo: 900, filterFreq: 3200 }); },
    dash() { noiseBurst({ dur: 0.1, gain: 0.13, filterFreq: 2600 }); },
    death() { noiseBurst({ dur: 0.55, gain: 0.3, filterFreq: 650 }); voice({ freq: 280, type: 'triangle', dur: 0.7, gain: 0.22, slideTo: 30, filterFreq: 900 }); },
    menuOpen() { voice({ freq: 500, type: 'sine', dur: 0.09, gain: 0.13, slideTo: 720, filterFreq: 3000 }); },
    menuClose() { voice({ freq: 720, type: 'sine', dur: 0.09, gain: 0.13, slideTo: 460, filterFreq: 3000 }); },
    click() { voice({ freq: 580, type: 'triangle', dur: 0.045, gain: 0.12, filterFreq: 2800 }); },
    select() { voice({ freq: 860, type: 'triangle', dur: 0.06, gain: 0.16, slideTo: 1150, filterFreq: 3400 }); },
    spawn() { voice({ freq: 210, type: 'sine', dur: 0.28, gain: 0.18, slideTo: 620, filterFreq: 2200 }); },
    bossAnnounce() {
      [0, 160, 320].forEach((delay, i) => setTimeout(() => {
        voice({ freq: 100 * (i + 1), type: 'sawtooth', dur: 0.45, gain: 0.24, filterFreq: 900 });
        noiseBurst({ dur: 0.18, gain: 0.18, filterFreq: 450 });
      }, delay));
    },
  };

  function applyVolumes() {
    if (sfxGain) sfxGain.gain.value = settings.sfxVol;
  }

  window.SFX = SFX;
  window.AudioSystem = { unlock, applyVolumes };
})();
