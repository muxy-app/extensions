// Canvas chart for the report — no chart library, same discipline as
// system-monitor's sparklines. Colors come from the live theme (and project
// icon colors), so the caller redraws on muxy.onThemeChange.

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// A small palette for projects without an iconColor: hues that hold up on
// both themes at mid lightness (data color, not chrome — the one sanctioned
// exception to the no-hardcoded-colors rule).
const FALLBACK_HUES = [210, 150, 30, 280, 0, 180, 60, 330];

export function colorForProject(projectID, ctx, index) {
  const iconColor = ctx?.projects?.[projectID]?.iconColor;
  if (typeof iconColor === "string" && /^#|^rgb|^hsl/.test(iconColor)) return iconColor;
  const hue = FALLBACK_HUES[index % FALLBACK_HUES.length];
  return `hsl(${hue} 55% 55%)`;
}

// bars: [{ day, parts: [{ projectID, color, value }], agent, degraded }]
// value/agent are seconds. Draws stacked "you" bars, a translucent agent
// overlay (when showAgent), dotted markers under degraded days.
export function drawBars(canvas, bars, { showAgent = true } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600;
  const cssHeight = canvas.clientHeight || 220;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssWidth, cssHeight);

  const fgMuted = cssVar("--muxy-foreground-muted") || "#888";
  const border = cssVar("--muxy-border") || "rgba(128,128,128,.3)";

  const padLeft = 44;
  const padBottom = 22;
  const padTop = 8;
  const plotW = cssWidth - padLeft - 8;
  const plotH = cssHeight - padTop - padBottom;
  if (plotW <= 0 || plotH <= 0 || !bars.length) return;

  const maxValue = Math.max(
    3600, // at least an hour of headroom so tiny days don't fill the chart
    ...bars.map((b) => Math.max(b.parts.reduce((s, p) => s + p.value, 0), showAgent ? b.agent : 0)),
  );

  // Horizontal gridlines at "nice" hour steps.
  const hours = maxValue / 3600;
  const stepH = hours > 8 ? 4 : hours > 4 ? 2 : 1;
  g.strokeStyle = border;
  g.fillStyle = fgMuted;
  g.font = `10px -apple-system, system-ui, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  g.lineWidth = 1;
  for (let hLine = 0; hLine * 3600 <= maxValue; hLine += stepH) {
    const y = padTop + plotH - (hLine * 3600 / maxValue) * plotH;
    g.beginPath();
    g.moveTo(padLeft, y);
    g.lineTo(padLeft + plotW, y);
    g.stroke();
    g.fillText(`${hLine}h`, padLeft - 6, y);
  }

  const n = bars.length;
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(36, slot * 0.62));

  g.textAlign = "center";
  g.textBaseline = "top";
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 34)));

  bars.forEach((bar, i) => {
    const cx = padLeft + slot * i + slot / 2;
    const x = cx - barW / 2;

    // Agent overlay behind the stack: wider, translucent.
    if (showAgent && bar.agent > 0) {
      const ah = (bar.agent / maxValue) * plotH;
      g.fillStyle = fgMuted;
      g.globalAlpha = 0.28;
      g.fillRect(cx - barW * 0.75, padTop + plotH - ah, barW * 1.5, ah);
      g.globalAlpha = 1;
    }

    let y = padTop + plotH;
    for (const part of bar.parts) {
      const ph = (part.value / maxValue) * plotH;
      if (ph <= 0) continue;
      g.fillStyle = part.color;
      g.fillRect(x, y - ph, barW, ph);
      y -= ph;
    }

    if (bar.degraded) {
      g.fillStyle = fgMuted;
      g.beginPath();
      g.arc(cx, padTop + plotH + 5, 1.5, 0, Math.PI * 2);
      g.fill();
    }

    if (i % labelEvery === 0) {
      g.fillStyle = fgMuted;
      g.fillText(bar.label, cx, padTop + plotH + 9);
    }
  });
}
