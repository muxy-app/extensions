// Inline canvas sparklines — 2 px bars, theme foreground at 60% alpha.
// No chart library. Redraw on muxy.onThemeChange (canvas doesn't track CSS vars).

const BAR_W = 2;
const GAP_W = 1;

export function drawSpark(canvas, values, { max = null } = {}) {
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  if (!cssW || !cssH) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const slots = Math.max(1, Math.floor((cssW + GAP_W) / (BAR_W + GAP_W)));
  const data = values.slice(-slots);
  if (!data.length) return;

  const peak = max ?? Math.max(...data, 1e-9);
  const color = getComputedStyle(document.documentElement).getPropertyValue("--muxy-foreground").trim() || "#888";

  ctx.globalAlpha = 0.6;
  ctx.fillStyle = color;
  // Right-align so the newest sample hugs the right edge.
  let x = cssW - data.length * (BAR_W + GAP_W) + GAP_W;
  for (const v of data) {
    const h = Math.max(1, (Math.min(v, peak) / peak) * cssH);
    ctx.fillRect(x, cssH - h, BAR_W, h);
    x += BAR_W + GAP_W;
  }
  ctx.globalAlpha = 1;
}
