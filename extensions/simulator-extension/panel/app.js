// The Simulator panel. It talks to simbridge, a small native helper on
// 127.0.0.1, which streams the simulator's screen as JPEG frames and turns
// pointer, wheel, and keyboard input into simulator touches and keys.
"use strict";

const PORT = 47290;
const HELPER_URL = "../helper/simbridge.swift";
const LOG_PATH = "~/Library/Caches/muxy-simulator-extension/simbridge.log";

// Compiles the helper once per version, then starts it in the background.
// The script text never changes, so Muxy can remember the permission for it.
const LAUNCH_SCRIPT = `set -e
[ -n "$SIMBRIDGE_VERSION" ] || { echo "SIMBRIDGE_VERSION is not set" >&2; exit 64; }
dir="$HOME/Library/Caches/muxy-simulator-extension"
bin="$dir/simbridge-$SIMBRIDGE_VERSION"
mkdir -p "$dir"
if [ -x "$bin" ]; then
  cat > /dev/null
else
  cat > "$bin.swift"
  if ! xcrun swiftc -O -suppress-warnings "$bin.swift" -o "$bin.partial" 2> "$dir/build.log"; then
    cat "$dir/build.log" >&2
    exit 1
  fi
  mv "$bin.partial" "$bin"
  find "$dir" -maxdepth 1 -name 'simbridge-*' ! -name "simbridge-$SIMBRIDGE_VERSION*" -delete
fi
log="$dir/simbridge.log"
if [ -f "$log" ] && [ "$(wc -c < "$log")" -gt 1000000 ]; then : > "$log"; fi
nohup "$bin" --port "$SIMBRIDGE_PORT" --version "$SIMBRIDGE_VERSION" < /dev/null >> "$log" 2>&1 &
pid=$!
# Wait until it listens (it has detached by then), so it outlives this script.
tries=0
until nc -z 127.0.0.1 "$SIMBRIDGE_PORT" 2> /dev/null; do
  if ! kill -0 "$pid" 2> /dev/null; then tail -n 5 "$log" >&2; exit 1; fi
  tries=$((tries + 1))
  if [ "$tries" -ge 100 ]; then echo "The helper didn't start listening." >&2; exit 1; fi
  sleep 0.05
done
echo "started $bin"`;

const $ = (id) => document.getElementById(id);
const ui = {
  device: $("device"),
  power: $("power"),
  stage: $("stage"),
  bezel: $("bezel"),
  screen: $("screen"),
  fingers: [$("finger1"), $("finger2")],
  message: $("message"),
  messageSpinner: $("message-spinner"),
  messageTitle: $("message-title"),
  messageDetail: $("message-detail"),
  messageAction: $("message-action"),
  toast: $("toast"),
  urlbar: $("urlbar"),
  url: $("url"),
  actions: [...document.querySelectorAll("[data-action]")],
};
const ctx = ui.screen.getContext("2d", { alpha: false });

const state = {
  phase: "starting", // starting | connecting | launching | ready | error
  error: "",
  devices: [],
  udid: null,
  deviceState: "",
  busy: "", // "Booting" or "Shutting Down" while a request runs
  screen: null, // native { width, height }
  hasFrame: false,
  visible: true,
};

let socket = null;
let helperSource = "";
let helperVersion = "";
let requestSeq = 0;
const pending = new Map();
let pollTimer = null;
let reconnectTimer = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (v) => Math.min(1, Math.max(0, v));

// A short, stable hash of the helper source names each compiled version.
function hashText(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

// MARK: - Connection

function openSocket(timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    sock.binaryType = "arraybuffer";
    const timer = setTimeout(() => { sock.close(); reject(new Error("timeout")); }, timeoutMs);
    sock.onopen = () => { clearTimeout(timer); resolve(sock); };
    sock.onerror = () => { clearTimeout(timer); reject(new Error("unreachable")); };
  });
}

function waitForHello(sock, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no hello")), timeoutMs);
    sock.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data);
      if (message.t === "hello") { clearTimeout(timer); resolve(message); }
    };
    sock.onclose = () => { clearTimeout(timer); reject(new Error("closed")); };
  });
}

/** Connects to a running helper of this version. Asks an older one to quit. */
async function tryConnect() {
  let sock;
  try { sock = await openSocket(); } catch { return null; }
  try {
    const hello = await waitForHello(sock);
    if (hello.version === helperVersion) return sock;
    console.log(`simbridge ${hello.version} is running; replacing it with ${helperVersion}`);
    sock.send(JSON.stringify({ t: "quit" }));
  } catch {}
  sock.close();
  await sleep(400);
  return null;
}

async function launchHelper() {
  setPhase("launching");
  let result;
  try {
    // With the { shell } form, options go in the same object; a second argument is ignored.
    result = await muxy.exec({
      shell: LAUNCH_SCRIPT,
      env: { SIMBRIDGE_VERSION: helperVersion, SIMBRIDGE_PORT: String(PORT) },
      stdin: helperSource,
      timeoutMs: 180000,
    });
  } catch (error) {
    throw new Error(`Muxy didn't run the helper: ${error.message || error}`);
  }
  if (result.exitCode !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    throw new Error(`The helper didn't start (exit ${result.exitCode}).\n${output.slice(-1200)}`);
  }
}

async function connect() {
  clearTimeout(reconnectTimer);
  setPhase("connecting");
  try {
    if (!helperSource) {
      helperSource = await (await fetch(HELPER_URL)).text();
      helperVersion = hashText(helperSource);
    }
    let sock = await tryConnect();
    if (!sock) {
      await launchHelper();
      const deadline = Date.now() + 15000;
      while (!sock && Date.now() < deadline) {
        await sleep(250);
        sock = await tryConnect();
      }
      if (!sock) throw new Error(`The helper started but isn't accepting connections. Its log is ${LOG_PATH}.`);
    }
    adopt(sock);
  } catch (error) {
    console.error(error.message || error);
    state.error = error.message || String(error);
    setPhase("error");
  }
}

function adopt(sock) {
  socket = sock;
  sock.onmessage = onMessage;
  sock.onclose = () => {
    if (socket !== sock) return;
    socket = null;
    for (const { reject } of pending.values()) reject(new Error("The helper disconnected."));
    pending.clear();
    state.hasFrame = false;
    setPhase("connecting");
    reconnectTimer = setTimeout(connect, 600);
  };
  setPhase("ready");
  sendConfig(true);
  send({ t: state.visible ? "resume" : "pause" });
  refreshDevices(true);
  startPolling();
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function request(type, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error("Not connected to the helper."));
    const id = ++requestSeq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} timed out.`)); }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    send({ t: type, id, ...params });
  });
}

function onMessage(event) {
  if (typeof event.data !== "string") return drawFrame(event.data);
  const message = JSON.parse(event.data);
  switch (message.t) {
    case "reply": {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error || "Request failed."));
      return;
    }
    case "state": {
      if (message.udid !== state.udid) return;
      state.deviceState = message.state;
      if (message.state !== "Booted") clearScreen();
      if (message.state === "Booted" || message.state === "Shutdown") state.busy = "";
      const device = currentDevice();
      if (device) device.state = message.state;
      renderDevices();
      render();
      return;
    }
    case "screen":
      state.screen = { width: message.width, height: message.height };
      layout();
      return;
    case "notice":
      showToast(message.message, message.level === "info" ? "" : "error");
      return;
  }
}

// MARK: - Frames

async function drawFrame(buffer) {
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/jpeg" }));
    if (ui.screen.width !== bitmap.width || ui.screen.height !== bitmap.height) {
      ui.screen.width = bitmap.width;
      ui.screen.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    if (!state.hasFrame) {
      state.hasFrame = true;
      render();
    }
  } catch (error) {
    console.warn("Couldn't draw a frame:", error.message || error);
  } finally {
    send({ t: "ack" });
  }
}

function clearScreen() {
  state.hasFrame = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ui.screen.width, ui.screen.height);
}

let configTimer = null;
let lastMaxWidth = 0;

function sendConfig(force = false) {
  const cssWidth = parseFloat(ui.screen.style.width) || 400;
  const native = state.screen ? state.screen.width : 4096;
  const maxWidth = Math.min(native, Math.ceil(cssWidth * (window.devicePixelRatio || 1)));
  if (!force && maxWidth === lastMaxWidth) return;
  lastMaxWidth = maxWidth;
  send({ t: "config", maxWidth });
}

/** Fits the screen into the stage, keeping its aspect ratio. */
function layout() {
  if (!state.screen) return;
  const bezel = 5;
  const pad = 14;
  const rect = ui.stage.getBoundingClientRect();
  const aspect = state.screen.height / state.screen.width;
  const availableWidth = rect.width - 2 * (pad + bezel);
  const availableHeight = rect.height - 2 * (pad + bezel);
  const width = Math.max(60, Math.floor(Math.min(availableWidth, availableHeight / aspect)));
  const height = Math.round(width * aspect);
  ui.screen.style.width = `${width}px`;
  ui.screen.style.height = `${height}px`;
  const name = currentDevice()?.name || "";
  const ratio = /iPad/.test(name) ? 0.03 : /Watch/.test(name) ? 0.2 : /TV|Vision/.test(name) ? 0 : 0.135;
  const radius = width * ratio;
  ui.screen.style.borderRadius = `${radius}px`;
  ui.bezel.style.borderRadius = `${radius + bezel}px`;
  clearTimeout(configTimer);
  configTimer = setTimeout(sendConfig, 150);
}

new ResizeObserver(layout).observe(ui.stage);

// MARK: - Devices

function currentDevice() {
  return state.devices.find((d) => d.udid === state.udid) || null;
}

function runtimeKey(runtime) {
  const [platform, version = "0"] = runtime.split(" ");
  const order = { iOS: 0, iPadOS: 0, watchOS: 1, tvOS: 2, visionOS: 3 }[platform] ?? 4;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return [order, -major, -minor];
}

function compareRuntimes(a, b) {
  const ka = runtimeKey(a), kb = runtimeKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

function defaultDevice(saved) {
  if (saved && state.devices.some((d) => d.udid === saved)) return saved;
  const sorted = [...state.devices].sort((a, b) => compareRuntimes(a.runtime, b.runtime));
  const booted = sorted.find((d) => d.state === "Booted");
  const iPhone = sorted.find((d) => d.runtime.startsWith("iOS") && d.name.startsWith("iPhone"));
  return (booted || iPhone || sorted[0])?.udid ?? null;
}

async function refreshDevices(initial = false) {
  try {
    state.devices = await request("list");
  } catch (error) {
    if (initial) showToast(error.message, "error");
    return;
  }
  if (initial || !currentDevice()) {
    let saved = null;
    try { saved = await muxy.storage.get("udid"); } catch {}
    const udid = defaultDevice(state.udid || saved);
    if (udid !== state.udid || initial) attach(udid);
  } else if (!state.deviceState) {
    state.deviceState = currentDevice()?.state || "";
  }
  renderDevices();
  render();
}

function renderDevices() {
  const groups = new Map();
  for (const device of state.devices) {
    if (!groups.has(device.runtime)) groups.set(device.runtime, []);
    groups.get(device.runtime).push(device);
  }
  const runtimes = [...groups.keys()].sort(compareRuntimes);
  const fragment = document.createDocumentFragment();
  for (const runtime of runtimes) {
    const group = document.createElement("optgroup");
    group.label = runtime;
    for (const device of groups.get(runtime)) {
      const option = document.createElement("option");
      option.value = device.udid;
      option.textContent = device.state === "Booted" ? `● ${device.name}` : device.name;
      group.append(option);
    }
    fragment.append(group);
  }
  const focused = document.activeElement === ui.device;
  if (!focused) {
    ui.device.replaceChildren(fragment);
    ui.device.value = state.udid || "";
  }
  ui.device.disabled = state.phase !== "ready" || !state.devices.length;
}

function attach(udid) {
  state.udid = udid;
  const device = currentDevice();
  state.deviceState = device ? device.state : "";
  state.busy = "";
  state.screen = null;
  clearScreen();
  send({ t: "attach", udid });
  if (udid) muxy.storage.set("udid", udid).catch(() => {});
  render();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (socket && state.visible && document.activeElement !== ui.device) refreshDevices();
  }, 4000);
}

async function setPower() {
  const device = currentDevice();
  if (!device) return;
  const booting = state.deviceState !== "Booted";
  state.busy = booting ? "Booting" : "Shutting Down";
  render();
  try {
    await request(booting ? "boot" : "shutdown", { udid: device.udid }, 180000);
    // The helper reports the new state within a moment; don't wait forever if it doesn't.
    setTimeout(() => { if (state.busy) { state.busy = ""; render(); } }, 3000);
  } catch (error) {
    state.busy = "";
    showToast(error.message, "error");
    render();
  }
  refreshDevices();
}

// MARK: - Rendering

function setPhase(phase) {
  state.phase = phase;
  renderDevices();
  render();
}

function showMessage({ title, detail = "", spinner = false, action = null }) {
  ui.message.hidden = false;
  ui.messageSpinner.hidden = !spinner;
  ui.messageTitle.textContent = title;
  ui.messageDetail.textContent = detail;
  ui.messageAction.hidden = !action;
  if (action) {
    ui.messageAction.textContent = action.label;
    ui.messageAction.onclick = action.run;
  }
}

function render() {
  const device = currentDevice();
  const booted = state.deviceState === "Booted";
  let message = null;

  if (state.phase === "error") {
    message = { title: "The simulator helper isn't running", detail: state.error, action: { label: "Try Again", run: connect } };
  } else if (state.phase === "launching") {
    message = { spinner: true, title: "Starting the simulator helper…", detail: "The first start compiles it with Xcode." };
  } else if (state.phase !== "ready") {
    message = { spinner: true, title: "Connecting…" };
  } else if (!state.devices.length) {
    message = { title: "No simulators", detail: "Create one in Xcode under Window › Devices and Simulators." };
  } else if (!device) {
    message = { title: "Choose a simulator" };
  } else if (state.busy && !(state.busy === "Booting" && booted && state.hasFrame)) {
    message = { spinner: true, title: `${state.busy} ${device.name}…` };
  } else if (state.deviceState === "Booting" || state.deviceState === "Shutting Down") {
    message = { spinner: true, title: `${state.deviceState} ${device.name}…` };
  } else if (state.deviceState === "Missing") {
    message = { title: "Simulator not found", detail: "It may have been deleted." };
  } else if (booted && !state.hasFrame) {
    message = { spinner: true, title: `Connecting to ${device.name}…` };
  } else if (!booted) {
    message = { title: `${device.name} is off`, detail: device.runtime, action: { label: "Boot", run: setPower } };
  }

  if (message) showMessage(message);
  else ui.message.hidden = true;
  ui.bezel.hidden = Boolean(message);
  if (!message) layout();

  const live = state.phase === "ready" && booted && state.hasFrame;
  for (const button of ui.actions) button.disabled = !live;
  if (!live) ui.urlbar.hidden = true;

  const canPower = state.phase === "ready" && device && !state.busy &&
    (state.deviceState === "Booted" || state.deviceState === "Shutdown");
  ui.power.disabled = !canPower;
  ui.power.classList.toggle("on", booted);
  ui.power.title = booted ? `Shut Down ${device?.name ?? ""}` : `Boot ${device?.name ?? ""}`;
}

let toastTimer = null;

function showToast(text, kind = "") {
  ui.toast.textContent = text;
  ui.toast.className = `toast ${kind}`;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, kind === "error" ? 5000 : 2500);
}

// MARK: - Touch

const touch = { pointer: null, pinch: false, pendingMove: null, frame: 0 };

function pointFrom(event) {
  const rect = ui.screen.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

function showFingers(point) {
  const [one, two] = ui.fingers;
  if (!point || !touch.pinch) {
    one.style.display = two.style.display = "none";
    return;
  }
  const width = ui.screen.clientWidth, height = ui.screen.clientHeight, bezel = 5;
  const place = (el, x, y) => {
    el.style.display = "block";
    el.style.left = `${bezel + x * width}px`;
    el.style.top = `${bezel + y * height}px`;
  };
  place(one, point.x, point.y);
  place(two, 1 - point.x, 1 - point.y);
}

function sendTouch(phase, point, extra = {}) {
  send({ t: "touch", phase, x: point.x, y: point.y, pinch: touch.pinch, ...extra });
}

function queueMove(point, extra) {
  touch.pendingMove = { point, extra };
  if (!touch.frame) touch.frame = requestAnimationFrame(flushMove);
}

function flushMove() {
  touch.frame = 0;
  if (!touch.pendingMove) return;
  sendTouch("move", touch.pendingMove.point, touch.pendingMove.extra);
  touch.pendingMove = null;
}

ui.screen.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || touch.pointer !== null) return;
  endWheel();
  ui.screen.focus();
  ui.screen.setPointerCapture(event.pointerId);
  touch.pointer = event.pointerId;
  touch.pinch = event.altKey;
  const point = pointFrom(event);
  showFingers(point);
  sendTouch("down", point);
});

ui.screen.addEventListener("pointermove", (event) => {
  if (event.pointerId !== touch.pointer) return;
  const point = pointFrom(event);
  showFingers(point);
  queueMove(point);
});

function endPointer(event) {
  if (event.pointerId !== touch.pointer) return;
  flushMove();
  sendTouch("up", pointFrom(event));
  touch.pointer = null;
  showFingers(null);
  touch.pinch = false;
}

ui.screen.addEventListener("pointerup", endPointer);
ui.screen.addEventListener("pointercancel", endPointer);
ui.screen.addEventListener("contextmenu", (event) => event.preventDefault());

// Scrolling becomes a one-finger drag that starts under the pointer.
const wheel = { point: null, start: null, timer: 0 };

function endWheel() {
  clearTimeout(wheel.timer);
  if (!wheel.point) return;
  flushMove();
  sendTouch("up", wheel.point, { edge: false });
  wheel.point = null;
}

ui.screen.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (touch.pointer !== null) return;
  const rect = ui.screen.getBoundingClientRect();
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
  if (!wheel.point) {
    wheel.start = pointFrom(event);
    wheel.point = { ...wheel.start };
    touch.pinch = false;
    sendTouch("down", wheel.point, { edge: false });
  }
  wheel.point = {
    x: wheel.point.x - (event.deltaX * scale) / rect.width,
    y: wheel.point.y - (event.deltaY * scale) / rect.height,
  };
  // Lift the finger before it leaves the screen; the next event starts a new drag.
  if (wheel.point.x < 0.02 || wheel.point.x > 0.98 || wheel.point.y < 0.04 || wheel.point.y > 0.96) {
    wheel.point = { x: clamp(wheel.point.x), y: clamp(wheel.point.y) };
    endWheel();
    return;
  }
  queueMove(wheel.point, { edge: false });
  clearTimeout(wheel.timer);
  wheel.timer = setTimeout(endWheel, 120);
}, { passive: false });

// MARK: - Keyboard

const heldKeys = new Set();

ui.screen.addEventListener("focus", () => ui.bezel.classList.add("focused"));
ui.screen.addEventListener("blur", () => {
  ui.bezel.classList.remove("focused");
  for (const usage of heldKeys) send({ t: "key", usage, down: false });
  heldKeys.clear();
});

ui.screen.addEventListener("keydown", (event) => {
  if (event.metaKey && event.code === "KeyV") {
    event.preventDefault();
    if (!event.repeat) runAction("paste");
    return;
  }
  if (event.metaKey && event.shiftKey && event.code === "KeyH") {
    event.preventDefault();
    if (!event.repeat) runAction("home");
    return;
  }
  const usage = HID_USAGE[event.code];
  if (usage === undefined) return;
  event.preventDefault();
  if (event.repeat || heldKeys.has(usage)) return;
  heldKeys.add(usage);
  send({ t: "key", usage, down: true });
});

ui.screen.addEventListener("keyup", (event) => {
  const usage = HID_USAGE[event.code];
  if (usage === undefined || !heldKeys.has(usage)) return;
  event.preventDefault();
  heldKeys.delete(usage);
  send({ t: "key", usage, down: false });
});

// MARK: - Actions

async function runAction(action) {
  const device = currentDevice();
  if (!device) return;
  try {
    switch (action) {
      case "home":
      case "switcher":
      case "lock":
        send({ t: "button", name: action });
        break;
      case "paste":
        send({ t: "paste" });
        break;
      case "appearance": {
        const mode = await request("appearance", { udid: device.udid, mode: "toggle" });
        showToast(mode === "dark" ? "Dark appearance" : "Light appearance");
        break;
      }
      case "url":
        ui.urlbar.hidden = !ui.urlbar.hidden;
        if (!ui.urlbar.hidden) { ui.url.focus(); ui.url.select(); }
        layout();
        break;
      case "screenshot": {
        const path = await request("screenshot", { udid: device.udid, name: device.name });
        showToast(`Saved ${path.split("/").pop()} to the Desktop and copied it.`);
        break;
      }
      case "simulator": {
        const app = await request("openSimulator", { udid: device.udid });
        if (app === "DeviceHub.app") showToast("Opened Device Hub.");
        break;
      }
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

for (const button of ui.actions) {
  button.addEventListener("click", () => runAction(button.dataset.action));
}

ui.urlbar.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = ui.url.value.trim();
  const device = currentDevice();
  if (!url || !device) return;
  try {
    await request("openurl", { udid: device.udid, url });
    ui.urlbar.hidden = true;
    layout();
    ui.screen.focus();
  } catch (error) {
    showToast(error.message, "error");
  }
});

ui.url.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { ui.urlbar.hidden = true; layout(); ui.screen.focus(); }
});

ui.device.addEventListener("change", () => attach(ui.device.value));
ui.power.addEventListener("click", setPower);

// MARK: - Visibility

function setVisible(visible) {
  if (visible === state.visible) return;
  state.visible = visible;
  send({ t: visible ? "resume" : "pause" });
  if (visible) refreshDevices();
}

document.addEventListener("visibilitychange", () => setVisible(!document.hidden));
if (window.muxy?.panel?.onChange) {
  muxy.panel.onChange((panel) => setVisible(panel.visible !== false && !document.hidden));
}
window.addEventListener("resize", () => { clearTimeout(configTimer); configTimer = setTimeout(sendConfig, 150); });

render();
connect();
