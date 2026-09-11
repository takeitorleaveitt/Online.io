// Thin wrapper around the socket.io client: connection lifecycle + a
// throttled input sender. Game code subscribes via Net.on(event, cb).
(function () {
  let socket = null;
  const listeners = {};

  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  }
  function emitLocal(event, data) {
    (listeners[event] || []).forEach((cb) => cb(data));
  }

  let pendingInput = null;
  let inputTimer = null;
  let lastInputSentAt = 0;
  const INPUT_MIN_INTERVAL = 1000 / 40; // don't send faster than needed, but don't buffer a whole tick either

  const Net = {
    connect() {
      socket = io({ transports: ['websocket', 'polling'] });
      socket.on('connect', () => emitLocal('connect'));
      socket.on('disconnect', () => emitLocal('disconnect'));
      socket.on('connect_error', (e) => emitLocal('connect_error', e));
      ['joined', 'state', 'death', 'levelup', 'evolutionAvailable', 'worldEvent', 'worldEventEnd',
        'bossSpawned', 'bossDefeated', 'chat', 'kill'].forEach((ev) => {
        socket.on(ev, (data) => emitLocal(ev, data));
      });
      // safety-net resend in case the last change-triggered emit was dropped
      if (!inputTimer) inputTimer = setInterval(() => {
        if (pendingInput && socket && socket.connected) socket.emit('input', pendingInput);
      }, 1000 / 12);
    },
    on,
    join(data) { socket && socket.emit('join', data); },
    respawn(data) { socket && socket.emit('respawn', data); },
    sendInput(data) {
      pendingInput = data;
      const now = performance.now();
      if (socket && socket.connected && now - lastInputSentAt >= INPUT_MIN_INTERVAL) {
        lastInputSentAt = now;
        socket.emit('input', data);
      }
    },
    ability(key) { socket && socket.emit('ability', key); },
    upgrade(key) { socket && socket.emit('upgrade', key); },
    evolve(key) { socket && socket.emit('evolve', key); },
    weapon(key) { socket && socket.emit('weapon', key); },
    chat(text) { socket && socket.emit('chat', text); },
    get connected() { return !!(socket && socket.connected); },
  };

  window.Net = Net;
})();
