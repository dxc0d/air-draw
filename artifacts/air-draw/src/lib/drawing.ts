export type ToolId = "pen" | "brush" | "marker" | "spray" | "neon" | "chalk";

export function strokeWith(
  ctx: CanvasRenderingContext2D,
  tool: ToolId,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  color: string,
  size: number,
) {
  ctx.save();
  switch (tool) {
    case "pen":
      if (!from) break;
      ctx.globalAlpha = 1; ctx.strokeStyle = color;
      ctx.lineWidth = size; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      break;

    case "brush":
      if (!from) break;
      ctx.shadowBlur = size * 2.5; ctx.shadowColor = color;
      ctx.strokeStyle = color; ctx.lineWidth = size;
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.shadowBlur = size * 0.4; ctx.lineWidth = size * 0.38; ctx.globalAlpha = 0.88;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      break;

    case "marker":
      if (!from) break;
      ctx.globalAlpha = 0.42; ctx.strokeStyle = color;
      ctx.lineWidth = size * 2.8; ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      break;

    case "spray": {
      const r = size * 2; const dots = Math.max(25, size * 4);
      for (let i = 0; i < dots; i++) {
        const a = Math.random() * Math.PI * 2; const d = Math.random() * r;
        ctx.beginPath(); ctx.arc(to.x + Math.cos(a) * d, to.y + Math.sin(a) * d, Math.random() * 1.4 + 0.3, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.globalAlpha = Math.random() * 0.35 + 0.05; ctx.fill();
      }
      break;
    }

    case "neon":
      if (!from) break;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowBlur = size * 7; ctx.shadowColor = color; ctx.strokeStyle = color;
      ctx.lineWidth = size * 1.6; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.shadowBlur = size * 3; ctx.lineWidth = size * 0.9; ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.strokeStyle = "#fff"; ctx.shadowBlur = size; ctx.lineWidth = size * 0.28; ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      break;

    case "chalk": {
      if (!from) break;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.floor(dist / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / Math.max(1, steps);
        const mx = from.x + (to.x - from.x) * t; const my = from.y + (to.y - from.y) * t;
        for (let i = 0; i < 14; i++) {
          ctx.beginPath();
          ctx.arc(mx + (Math.random() - 0.5) * size * 1.4, my + (Math.random() - 0.5) * size * 1.4,
            Math.random() * size * 0.22 + 0.4, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.globalAlpha = Math.random() * 0.4 + 0.06; ctx.fill();
        }
      }
      break;
    }
  }
  ctx.restore();
}
