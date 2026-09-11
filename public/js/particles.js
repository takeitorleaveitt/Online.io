// Lightweight, dependency-free particle pool shared by the menu background
// and the in-game canvas. Callers set up whatever ctx transform they need
// (world-space camera, or plain screen-space) before calling draw().
class ParticlePool {
  constructor(maxParticles = 600) {
    this.max = maxParticles;
    this.list = [];
  }

  emit(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: p.x, y: p.y,
      vx: p.vx || 0, vy: p.vy || 0,
      life: p.life || 1, maxLife: p.life || 1,
      size: p.size || 3, endSize: p.endSize !== undefined ? p.endSize : (p.size || 3),
      color: p.color || '#5ad1ff',
      gravity: p.gravity || 0,
      drag: p.drag !== undefined ? p.drag : 0.98,
      shape: p.shape || 'circle',
      rot: p.rot || 0, vrot: p.vrot || 0,
      glow: p.glow || false,
    });
  }

  burst(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const ang = opts.angle !== undefined ? opts.angle + (Math.random() - 0.5) * (opts.spread || Math.PI * 2) : Math.random() * Math.PI * 2;
      const speed = (opts.minSpeed || 40) + Math.random() * ((opts.maxSpeed || 160) - (opts.minSpeed || 40));
      this.emit({
        x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        life: (opts.minLife || 0.4) + Math.random() * ((opts.maxLife || 0.9) - (opts.minLife || 0.4)),
        size: (opts.minSize || 2) + Math.random() * ((opts.maxSize || 5) - (opts.minSize || 2)),
        endSize: opts.endSize !== undefined ? opts.endSize : 0,
        color: Array.isArray(opts.color) ? opts.color[Math.floor(Math.random() * opts.color.length)] : (opts.color || '#5ad1ff'),
        gravity: opts.gravity || 0, drag: opts.drag !== undefined ? opts.drag : 0.96,
        shape: opts.shape || 'circle', glow: opts.glow,
      });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      const t = p.life / p.maxLife;
      const size = p.endSize + (p.size - p.endSize) * t;
      if (size <= 0.1) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = size * 2.2;
      }
      ctx.fillStyle = p.color;
      if (p.shape === 'square') {
        ctx.fillRect(-size / 2, -size / 2, size, size);
      } else if (p.shape === 'line') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, size * 0.4);
        ctx.beginPath();
        ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
window.ParticlePool = ParticlePool;
