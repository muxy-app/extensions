import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  splitBlob,
  parseFast,
  parseSlow,
  parseProcs,
  parsePmset,
  parseDf,
  parseSwapUsage,
  netRate,
} from "../src/parsers.mjs";
import { renderTemplate, normalizeConfig, fmtBytes, DEFAULT_CONFIG } from "../src/format.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(resolve(here, "fixtures", name), "utf8");

test("splitBlob splits on @@ lines", () => {
  assert.deepEqual(splitBlob("a\n@@\nb\nc\n@@\nd"), ["a", "b\nc", "d"]);
  assert.deepEqual(splitBlob(""), [""]);
});

test("parseFast — Apple Silicon fixture (16K pages)", () => {
  const fast = parseFast(fixture("fast-as-local.txt"));
  assert.equal(fast.os, "Darwin");

  assert.ok(Math.abs(fast.cpu.usage - (100 - 60.88)) < 0.001);
  assert.equal(fast.cpu.user, 21.6);
  assert.equal(fast.cpu.sys, 17.51);

  assert.deepEqual(fast.loadavg, [31.2, 17.24, 13.88]);

  const page = 16384;
  assert.equal(fast.mem.totalB, 68719476736);
  assert.equal(fast.mem.appB, (1924569 - 33767) * page);
  assert.equal(fast.mem.wiredB, 272837 * page);
  assert.equal(fast.mem.compressedB, 465392 * page);
  assert.equal(fast.mem.usedB, (1924569 - 33767 + 272837 + 465392) * page);
  assert.equal(fast.mem.availableB, (278938 + 1557212) * page);

  assert.equal(fast.swap.totalB, 0);
  assert.equal(fast.swap.usedB, 0);

  // Expected totals computed independently with awk over the fixture:
  // <Link#…> rows, deduped by interface, lo0 excluded.
  assert.equal(fast.net.interfaces, 30);
  assert.equal(fast.net.ibytes, 12813814622);
  assert.equal(fast.net.obytes, 2157847607);

  assert.equal(fast.gpu.usage, 19);
});

test("parseFast — Intel fixture (4K pages, VPN interfaces, swap in use)", () => {
  const fast = parseFast(fixture("fast-intel-4k.txt"));
  assert.equal(fast.os, "Darwin");
  assert.ok(Math.abs(fast.cpu.usage - 19.12) < 0.001);

  const page = 4096;
  assert.equal(fast.mem.totalB, 17179869184);
  assert.equal(fast.mem.usedB, (1800000 - 40000 + 600000 + 350000) * page);
  assert.equal(fast.mem.availableB, (100000 + 800000) * page);

  assert.equal(fast.swap.totalB, 2048 * 1024 ** 2);
  assert.equal(fast.swap.usedB, 812.5 * 1024 ** 2);

  // lo0 excluded, en0 counted once (dedupe: the second en0 row is non-Link),
  // utun0 counted despite the missing Address column.
  assert.equal(fast.net.interfaces, 2);
  assert.equal(fast.net.ibytes, 5000000 + 336914);
  assert.equal(fast.net.obytes, 2500000 + 287734);

  assert.equal(fast.gpu.usage, 37);
});

test("parseFast — GPU block absent or unreadable → null, section hidden", () => {
  assert.equal(parseFast("Darwin").gpu, null);
});

test("parseFast — remote Linux workspace pauses parsing", () => {
  const fast = parseFast(fixture("fast-remote-linux.txt"));
  assert.equal(fast.os, "Linux");
  assert.equal(fast.cpu, undefined);
});

test("parseSlow — AC, charging, with estimate (captured)", () => {
  const slow = parseSlow(fixture("slow-as-local.txt"));
  assert.equal(slow.power.source, "AC");
  assert.equal(slow.power.battery.percent, 75);
  assert.equal(slow.power.battery.state, "charging");
  assert.equal(slow.power.battery.remaining, "1:56");

  assert.equal(slow.disk.sizeB, 971350180 * 1024);
  assert.equal(slow.disk.availB, 140680632 * 1024);
  assert.equal(slow.disk.usedB, (971350180 - 140680632) * 1024);
  assert.ok(Math.abs(slow.disk.pct - 85.517) < 0.01);
});

test("parseSlow — battery, discharging, with estimate", () => {
  const { power } = parseSlow(fixture("slow-battery-discharging.txt"));
  assert.equal(power.source, "Battery");
  assert.equal(power.battery.percent, 87);
  assert.equal(power.battery.state, "discharging");
  assert.equal(power.battery.remaining, "4:12");
});

test("parseSlow — battery with no estimate", () => {
  const { power } = parseSlow(fixture("slow-battery-no-estimate.txt"));
  assert.equal(power.battery.percent, 64);
  assert.equal(power.battery.state, "discharging");
  assert.equal(power.battery.remaining, null);
});

test("parseSlow — desktop without battery hides the section", () => {
  const { power, disk } = parseSlow(fixture("slow-desktop-no-battery.txt"));
  assert.equal(power.source, "AC");
  assert.equal(power.battery, null);
  assert.ok(disk.sizeB > 0);
});

test("parsePmset tolerates missing input", () => {
  assert.deepEqual(parsePmset(""), { source: null, battery: null });
});

test("parseDf ignores the header and non-device lines", () => {
  assert.equal(parseDf("Filesystem 1024-blocks Used Available Capacity Mounted on\n"), null);
});

test("parseSwapUsage units", () => {
  assert.equal(parseSwapUsage("total = 1.00G  used = 512.00M  free = 512.00M").totalB, 1024 ** 3);
});

test("parseProcs — captured ps output, paths with spaces", () => {
  const procs = parseProcs(fixture("procs-as-local.txt"));
  assert.equal(procs.length, 39); // head -40 minus the header
  assert.deepEqual(procs[0], {
    pid: 1011,
    cpu: 94.5,
    memPct: 0.1,
    rssB: 78576 * 1024,
    name: "Fantastical Widgets",
  });
  assert.equal(procs[1].name, "WindowServer");
  assert.ok(procs.every((p) => Number.isFinite(p.cpu) && p.name.length > 0));
});

test("netRate — Δ/Δt, first tick, counter reset, wake gap", () => {
  const prev = { ibytes: 1000, obytes: 500 };
  const cur = { ibytes: 4000, obytes: 2500 };
  const rate = netRate(prev, cur, 3000, 3000);
  assert.equal(rate.downBps, 1000);
  assert.ok(Math.abs(rate.upBps - 2000 / 3) < 0.001);

  assert.equal(netRate(null, cur, 3000, 3000), null);
  assert.equal(netRate({ ibytes: 9999, obytes: 500 }, cur, 3000, 3000), null); // reset
  assert.equal(netRate(prev, cur, 10000, 3000), null); // sleep/wake gap > 3× interval
});

test("renderTemplate tokens", () => {
  const snapshot = {
    cpu: { usage: 12.4 },
    gpu: { usage: 33.3 },
    loadavg: [2.44, 2.58, 2.81],
    mem: { usedB: 6.4 * 1024 ** 3, totalB: 16 * 1024 ** 3 },
    net: { downBps: 1.2 * 1024 ** 2, upBps: 88 * 1024 },
    power: { source: "Battery", battery: { percent: 87 } },
  };
  assert.equal(renderTemplate("CPU {cpu} · {mem}", snapshot), "CPU 12% · 6.4G");
  assert.equal(renderTemplate("GPU {gpu}", snapshot), "GPU 33%");
  assert.equal(renderTemplate("{gpu}", {}), "—");
  assert.equal(renderTemplate("{down} {up} {batt} {load1} {memPct}", snapshot), "1.2M/s 88K/s 87% 2.4 40%");
  assert.equal(renderTemplate("{cpu}", {}), "—");
});

test("normalizeConfig clamps and defaults", () => {
  assert.deepEqual(normalizeConfig(null), { ...DEFAULT_CONFIG, thresholds: { ...DEFAULT_CONFIG.thresholds } });
  const cfg = normalizeConfig({ fastSec: 0.5, slowSec: 9999, template: "", thresholds: { cpu: 200, notify: true } });
  assert.equal(cfg.fastSec, 1);
  assert.equal(cfg.slowSec, 600);
  assert.equal(cfg.template, DEFAULT_CONFIG.template);
  assert.equal(cfg.thresholds.cpu, 100);
  assert.equal(cfg.thresholds.notify, true);

  const sec = normalizeConfig({ sections: { gpu: false, top: false, bogus: false } });
  assert.equal(sec.sections.gpu, false);
  assert.equal(sec.sections.top, false);
  assert.equal(sec.sections.cpu, true);
  assert.ok(!("bogus" in sec.sections));
});

test("fmtBytes", () => {
  assert.equal(fmtBytes(0), "0B");
  assert.equal(fmtBytes(78576 * 1024), "77M");
  assert.equal(fmtBytes(6.4 * 1024 ** 3), "6.4G");
  assert.equal(fmtBytes(NaN), "—");
});
