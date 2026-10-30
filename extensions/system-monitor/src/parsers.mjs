// Pure parsers over the `@@`-delimited snapshot blobs. No muxy.* here —
// everything is unit-testable with canned fixtures (see test/fixtures/).

export function splitBlob(text) {
  const blocks = [];
  let current = [];
  for (const line of String(text ?? "").split("\n")) {
    if (line.trim() === "@@") {
      blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  blocks.push(current.join("\n"));
  return blocks;
}

// `top -l 1 -n 0 -s 0` → "CPU usage: 7.35% user, 11.76% sys, 80.88% idle"
export function parseTopCpu(block) {
  const m = /CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/.exec(block);
  if (!m) return null;
  const user = Number(m[1]);
  const sys = Number(m[2]);
  const idle = Number(m[3]);
  return { user, sys, idle, usage: Math.min(100, Math.max(0, 100 - idle)) };
}

// `sysctl -n hw.pagesize hw.memsize vm.loadavg vm.swapusage` — one value per line,
// in argument order.
export function parseSysctl(block) {
  const lines = String(block).split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return null;
  const pageSize = Number(lines[0]);
  const memTotalB = Number(lines[1]);
  const loadMatch = /\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}/.exec(lines[2]);
  const loadavg = loadMatch ? [Number(loadMatch[1]), Number(loadMatch[2]), Number(loadMatch[3])] : null;
  const swap = parseSwapUsage(lines[3]);
  if (!Number.isFinite(pageSize) || !Number.isFinite(memTotalB)) return null;
  return { pageSize, memTotalB, loadavg, swap };
}

// "total = 2048.00M  used = 812.50M  free = 1235.50M  (encrypted)"
export function parseSwapUsage(line) {
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  const m = /total\s*=\s*([\d.]+)([KMGT])\s+used\s*=\s*([\d.]+)([KMGT])/.exec(line);
  if (!m) return null;
  return {
    totalB: Number(m[1]) * unit[m[2]],
    usedB: Number(m[3]) * unit[m[4]],
  };
}

// `vm_stat` pages × pageSize. Approximates Activity Monitor's "Memory Used":
// app = anonymous − purgeable, used = app + wired + compressor-occupied.
// available = free + inactive.
export function parseVmStat(block, pageSize, memTotalB) {
  const pages = {};
  for (const line of String(block).split("\n")) {
    const m = /^"?([^:"]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim());
    if (m) pages[m[1]] = Number(m[2]);
  }
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    const hdr = /page size of (\d+) bytes/.exec(block);
    if (!hdr) return null;
    pageSize = Number(hdr[1]);
  }
  const need = ["Pages free", "Pages active", "Pages inactive", "Pages wired down"];
  if (!need.every((k) => Number.isFinite(pages[k]))) return null;
  const anon = pages["Anonymous pages"] ?? pages["Pages active"];
  const purgeable = pages["Pages purgeable"] ?? 0;
  const compressed = pages["Pages occupied by compressor"] ?? 0;
  const appB = Math.max(0, anon - purgeable) * pageSize;
  const wiredB = pages["Pages wired down"] * pageSize;
  const compressedB = compressed * pageSize;
  return {
    totalB: memTotalB,
    appB,
    wiredB,
    compressedB,
    usedB: appB + wiredB + compressedB,
    availableB: (pages["Pages free"] + pages["Pages inactive"]) * pageSize,
  };
}

// `netstat -ibn` — rows whose third column is `<Link#n>`, deduped by interface,
// lo0 skipped. The Address column is absent for some interfaces (lo0, utun…),
// so byte columns are indexed from the end of the row: … Ibytes Opkts Oerrs Obytes Coll.
export function parseNetstat(block) {
  let ibytes = 0;
  let obytes = 0;
  const seen = new Set();
  for (const line of String(block).split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 9 || !f[2]?.startsWith("<Link")) continue;
    const name = f[0].replace(/\*$/, "");
    if (name === "lo0" || seen.has(name)) continue;
    seen.add(name);
    const ib = Number(f[f.length - 5]);
    const ob = Number(f[f.length - 2]);
    if (Number.isFinite(ib)) ibytes += ib;
    if (Number.isFinite(ob)) obytes += ob;
  }
  return { ibytes, obytes, interfaces: seen.size };
}

// `ioreg -r -d 1 -w 0 -c IOAccelerator` — GPU utilization from the
// accelerator's PerformanceStatistics, no root needed. Multiple GPUs
// (e.g. Intel iGPU + AMD dGPU) → report the busiest one. Some drivers only
// publish Renderer Utilization, so fall back to it.
export function parseIoregGpu(block) {
  let best = null;
  for (const re of [/"Device Utilization %"=(\d+)/g, /"Renderer Utilization %"=(\d+)/g]) {
    for (const m of String(block).matchAll(re)) {
      const v = Number(m[1]);
      if (best === null || v > best) best = v;
    }
    if (best !== null) break;
  }
  return best === null ? null : { usage: Math.min(100, best) };
}

// The fast snapshot: uname ; top ; vm_stat ; sysctl ; netstat ; ioreg.
export function parseFast(text) {
  const blocks = splitBlob(text);
  const os = (blocks[0] ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (os !== "Darwin") return { os };
  const sysctl = parseSysctl(blocks[3] ?? "");
  return {
    os,
    cpu: parseTopCpu(blocks[1] ?? ""),
    loadavg: sysctl?.loadavg ?? null,
    mem: parseVmStat(blocks[2] ?? "", sysctl?.pageSize, sysctl?.memTotalB),
    swap: sysctl?.swap ?? null,
    net: parseNetstat(blocks[4] ?? ""),
    gpu: parseIoregGpu(blocks[5] ?? ""),
  };
}

// `pmset -g batt` — source line plus, on machines with a battery, per-battery rows:
//  -InternalBattery-0 (id=…)\t87%; discharging; 4:12 remaining present: true
export function parsePmset(block) {
  const text = String(block);
  const source = /'Battery Power'/.test(text) ? "Battery" : /'AC Power'/.test(text) ? "AC" : null;
  const m = /(\d+)%;\s*([^;]+?);?\s*(?:(\d+:\d+) remaining|\(no estimate\))?\s*(?:present: \w+)?\s*$/m.exec(text);
  if (!m) return { source, battery: null };
  return {
    source,
    battery: {
      percent: Number(m[1]),
      state: m[2].trim(),
      remaining: m[3] ?? null,
    },
  };
}

// `df -kP /` — 1024-blocks. On APFS the root volume's own "Used" underreports,
// so used is computed as size − available (tracks the whole container).
export function parseDf(block) {
  for (const line of String(block).split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6 || !f[0].startsWith("/")) continue;
    const sizeB = Number(f[1]) * 1024;
    const availB = Number(f[3]) * 1024;
    if (!Number.isFinite(sizeB) || !Number.isFinite(availB) || sizeB <= 0) continue;
    const usedB = Math.max(0, sizeB - availB);
    return { sizeB, availB, usedB, pct: (usedB / sizeB) * 100 };
  }
  return null;
}

// The slow snapshot: pmset ; df.
export function parseSlow(text) {
  const blocks = splitBlob(text);
  return {
    power: parsePmset(blocks[0] ?? ""),
    disk: parseDf(blocks[1] ?? ""),
  };
}

// `ps -Areo pid,pcpu,pmem,rss,comm -r | head -40` — comm may contain spaces.
export function parseProcs(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const comm = m[5].trim();
    rows.push({
      pid: Number(m[1]),
      cpu: Number(m[2]),
      memPct: Number(m[3]),
      rssB: Number(m[4]) * 1024,
      name: comm.split("/").pop() || comm,
    });
  }
  return rows;
}

// Δbytes/Δt against the previous tick. Returns null on the first tick, on
// counter resets (Δ < 0), and after sleep/wake gaps (Δt > 3× the interval).
export function netRate(prev, cur, elapsedMs, intervalMs) {
  if (!prev || !cur || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  if (intervalMs && elapsedMs > 3 * intervalMs) return null;
  const down = cur.ibytes - prev.ibytes;
  const up = cur.obytes - prev.obytes;
  if (down < 0 || up < 0) return null;
  return { downBps: (down / elapsedMs) * 1000, upBps: (up / elapsedMs) * 1000 };
}
