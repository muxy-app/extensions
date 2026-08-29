// Source configuration: what this repository watches.
//
// Native providers (GitHub Actions, GitLab CI) are offered from detection with
// one click. Anything else becomes a CCTray monitor, and because one feed can
// cover a whole server, the form discovers the projects it reports and lets the
// user tick the ones that belong to this repository.

import { state, nav } from "../state.js";
import { escapeHtml, ellipsize } from "../util.js";
import { openUrl, isAvailable } from "../exec.js";
import { newId, storesSecret } from "../storage.js";
import { KIND_LABELS, KIND_CLI, labelFor } from "../providers/index.js";
import { fetchProjects, splitName } from "../providers/cctray.js";
import { cctrayUrlFor, nativeProviders } from "../providers/detect.js";
import * as icons from "../icons.js";
import { content, messageFor } from "./chrome.js";

// Local to the view: which monitor is open in the form, and what a test found.
let draft = null;
let discovered = null;
let testError = null;
let busy = false;

/** `save(config)` persists and re-renders; injected by the controller. */
let save = async () => {};

export function bindSources(persist) {
  save = persist;
}

export function renderSources() {
  const { sources } = state.config;
  content.innerHTML = `
    <div class="sources">
      ${draft ? monitorForm(draft) : ""}
      ${draft ? "" : detectedSection()}
      ${draft ? "" : undetectedSection()}
      ${draft ? "" : configuredSection(sources)}
      ${draft ? "" : hintsSection()}
    </div>`;
  wire();
}

// ------------------------------------------------------------- detection

const configuredKinds = () => new Set(state.config.sources.map((s) => s.kind));

function nativeCard(kind, label, cli, subHtml, accent) {
  return `
    <div class="source-card">
      <div class="source-card__head">
        <span class="source-card__title">${escapeHtml(label)}</span>
        <span class="badge" id="cli-${escapeHtml(kind)}">checking ${escapeHtml(cli)}…</span>
        <div class="source-card__actions">
          <button class="btn ${accent ? "btn--accent" : ""}" data-add-native="${escapeHtml(kind)}">Add</button>
        </div>
      </div>
      <div class="source-card__sub">${subHtml}</div>
    </div>`;
}

function detectedSection() {
  const configured = configuredKinds();
  const available = (state.detection.native || []).filter((n) => !configured.has(n.kind));
  if (!available.length) return "";

  return `
    <div>
      <div class="section-title">Detected in this repository</div>
      ${available.map((n) =>
        nativeCard(n.kind, n.label, n.cli, `Found <code>${escapeHtml(n.evidence)}</code>`, true)).join("")}
    </div>`;
}

/**
 * Native providers that were neither configured nor detected. A project can
 * point GitLab at a custom config path, another project, or an external URL,
 * and a repository can be mirrored — so a missing config file is not proof
 * there is no pipeline to read. Adding one by hand must always be possible.
 */
function undetectedSection() {
  const configured = configuredKinds();
  const detected = new Set((state.detection.native || []).map((n) => n.kind));
  const rest = nativeProviders().filter((n) => !configured.has(n.kind) && !detected.has(n.kind));
  if (!rest.length) return "";

  return `
    <div>
      <div class="section-title">Not detected — add anyway</div>
      <div class="hint">
        No CI config was found for these, but that only rules them out if the
        config lives where the file is expected. GitLab can point at a custom
        path, another project, or an external URL; either way the pipelines are
        read from the API, not from the file.
      </div>
      ${rest.map((n) =>
        nativeCard(n.kind, n.label, n.cli, "No configuration file found in this repository.", false)).join("")}
    </div>`;
}

function hintsSection() {
  const hints = state.detection.hints || [];
  return `
    <div>
      <div class="section-title">Other build servers</div>
      <div class="hint">
        Anything that publishes a <strong>CCTray</strong> feed can be watched here — TeamCity,
        Jenkins, GoCD, Bamboo, CruiseControl. Add one URL per feed; a feed covering a
        whole server can be narrowed to the projects that belong to this repository.
        Add several monitors when different branches build under different URLs.
      </div>
      ${hints.length ? `
        <div class="hint" style="margin-top:var(--s4)">
          Detected here: ${hints.map((h) => `<strong>${escapeHtml(h.label)}</strong>${h.cctrayPath ? ` (try <code>${escapeHtml(h.cctrayPath)}</code>)` : ""}`).join(", ")}.
        </div>` : ""}
      <div class="form__actions" style="margin-top:var(--s5)">
        <button class="btn btn--accent" id="add-cctray">${icons.ICON_PLUS} Add a CCTray monitor</button>
      </div>
    </div>`;
}

// ----------------------------------------------------------- configured

function configuredSection(sources) {
  if (!sources.length) {
    return `
      <div>
        <div class="section-title">Watching</div>
        <div class="hint">Nothing configured yet for this repository.</div>
      </div>`;
  }
  return `
    <div>
      <div class="section-title">Watching</div>
      ${sources.map(sourceCard).join("")}
    </div>`;
}

function sourceCard(source) {
  const secret = storesSecret(source)
    ? `<span class="badge badge--warn" title="Stored in Muxy's extension store, not encrypted">stored secret</span>`
    : "";
  return `
    <div class="source-card">
      <div class="source-card__head">
        <span class="source-card__title">${escapeHtml(labelFor(source))}</span>
        <span class="badge ${source.enabled === false ? "badge--off" : "badge--on"}">${source.enabled === false ? "off" : "on"}</span>
        <span class="badge">${escapeHtml(KIND_LABELS[source.kind] || source.kind)}</span>
        ${secret}
        <div class="source-card__actions">
          <button class="icon-btn" data-toggle="${escapeHtml(source.id)}" title="${source.enabled === false ? "Enable" : "Disable"}">${icons.ICON_TARGET}</button>
          ${source.kind === "cctray"
            ? `<button class="icon-btn" data-edit="${escapeHtml(source.id)}" title="Edit">${icons.ICON_EDIT}</button>`
            : ""}
          <button class="icon-btn" data-remove="${escapeHtml(source.id)}" title="Remove">${icons.ICON_TRASH}</button>
        </div>
      </div>
      ${source.kind === "cctray" ? `
        <div class="source-card__sub">${escapeHtml(ellipsize(source.url, 80))}</div>
        <div class="source-card__sub">${source.projects?.length
          ? `${source.projects.length} project${source.projects.length === 1 ? "" : "s"} selected`
          : "all projects in the feed"}</div>` : ""}
    </div>`;
}

// ----------------------------------------------------------- the form

function monitorForm(source) {
  const auth = source.auth || { kind: "none" };
  const authField = (kind, html) => `<div data-auth-for="${kind}" ${auth.kind === kind ? "" : "hidden"}>${html}</div>`;

  return `
    <div>
      <button class="detail__back" id="cancel-form">${icons.ICON_BACK} Back to sources</button>
      <div class="section-title" style="margin-top:var(--s5)">${source.__isNew ? "Add" : "Edit"} CCTray monitor</div>
      <div class="form" style="margin-top:var(--s5)">
        <div class="form__group">
          <div class="form__label">Label</div>
          <input class="inp" id="f-label" placeholder="e.g. TeamCity — nightly" value="${escapeHtml(source.label || "")}" />
        </div>
        <div class="form__group">
          <div class="form__label">CCTray URL</div>
          <input class="inp" id="f-url" placeholder="https://teamcity.example.com/app/rest/cctray/projects.xml" value="${escapeHtml(source.url || "")}" />
          <div class="hint">
            Common paths: TeamCity <code>/app/rest/cctray/projects.xml</code> ·
            Jenkins <code>/cc.xml</code> · GoCD <code>/go/cctray.xml</code>
          </div>
        </div>

        <div class="form__group">
          <div class="form__label">Authentication</div>
          <div class="form__row form__row--wrap">
            ${["none", "token", "header", "basic", "curlConfig"].map((kind) => `
              <label class="radio">
                <input type="radio" name="auth" value="${kind}" ${auth.kind === kind ? "checked" : ""}>
                ${escapeHtml(AUTH_LABELS[kind])}
              </label>`).join("")}
          </div>
          ${authField("token", `<input class="inp" id="f-token" type="password" placeholder="Bearer token" value="${escapeHtml(auth.token || "")}" />`)}
          ${authField("header", `
            <div class="form__row">
              <input class="inp" id="f-hname" placeholder="Header name" value="${escapeHtml(auth.name || "")}" />
              <input class="inp" id="f-hvalue" type="password" placeholder="Header value" value="${escapeHtml(auth.value || "")}" />
            </div>`)}
          ${authField("basic", `
            <div class="form__row">
              <input class="inp" id="f-user" placeholder="User" value="${escapeHtml(auth.user || "")}" />
              <input class="inp" id="f-pass" type="password" placeholder="Password" value="${escapeHtml(auth.password || "")}" />
            </div>`)}
          ${authField("curlConfig", `
            <input class="inp" id="f-config" placeholder="~/.config/ci-dashboard/teamcity.curl" value="${escapeHtml(auth.path || "")}" />
            <div class="hint">
              A <code>curl --config</code> file you own, e.g.
              <code>header = "Authorization: Bearer …"</code>. The credential never
              enters Muxy's store — recommended on a shared machine.
            </div>`)}
          <div class="hint" data-auth-warning ${["token", "header", "basic"].includes(auth.kind) ? "" : "hidden"}>
            This credential is saved in Muxy's per-extension store as plain text.
            Use a curl config file instead if that matters here.
          </div>
        </div>

        <label class="check"><input type="checkbox" id="f-insecure" ${source.insecure ? "checked" : ""}> Allow self-signed certificates</label>

        <div class="form__actions">
          <button class="btn" id="f-test">Test &amp; list projects</button>
          <button class="btn btn--accent" id="f-save">Save monitor</button>
        </div>

        <div id="f-result">${discoveryHtml(source)}</div>
      </div>
    </div>`;
}

const AUTH_LABELS = {
  none: "None",
  token: "Bearer token",
  header: "Custom header",
  basic: "Basic auth",
  curlConfig: "curl config file",
};

function discoveryHtml(source) {
  if (busy) return `<div class="hint">Contacting the server…</div>`;
  if (testError) {
    return `<div class="source-error"><span class="source-error__icon">${icons.ICON_STATE}</span>
      <span class="source-error__text">${escapeHtml(messageFor(testError))}</span></div>`;
  }
  if (!discovered) return "";
  if (!discovered.length) return `<div class="hint">The feed reported no projects.</div>`;

  const selected = new Set(source.projects || []);
  return `
    <div class="form__group">
      <div class="form__label">${discovered.length} project${discovered.length === 1 ? "" : "s"} in this feed</div>
      <div class="hint">Tick the ones that belong to this repository. Leave all unticked to watch every project in the feed.</div>
      <div class="checklist">
        ${discovered.map((p) => {
          const parts = splitName(p.name);
          const label = parts.branch ? `${parts.title} · ${parts.branch}` : parts.title;
          return `<label>
            <input type="checkbox" data-project="${escapeHtml(p.name)}" ${selected.has(p.name) ? "checked" : ""}>
            <span title="${escapeHtml(p.name)}">${escapeHtml(label)}</span>
          </label>`;
        }).join("")}
      </div>
    </div>`;
}

// ------------------------------------------------------------- wiring

function wire() {
  // Whether each offered provider's CLI is actually installed.
  for (const native of nativeProviders()) {
    const badge = document.querySelector(`#cli-${native.kind}`);
    if (!badge) continue;
    isAvailable(native.cli).then((ok) => {
      badge.textContent = ok ? `${native.cli} ready` : `${native.cli} not installed`;
      badge.className = `badge ${ok ? "badge--on" : "badge--warn"}`;
    });
  }

  document.querySelector("#add-cctray")?.addEventListener("click", () => {
    const hint = (state.detection.hints || []).find((h) => h.cctrayPath);
    draft = {
      __isNew: true,
      id: newId(),
      kind: "cctray",
      label: hint?.label || "",
      url: hint ? cctrayUrlFor(hint, "https://") : "",
      auth: { kind: "none" },
      insecure: false,
      projects: [],
      enabled: true,
    };
    discovered = null;
    testError = null;
    renderSources();
  });

  content.querySelectorAll("[data-add-native]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const kind = btn.getAttribute("data-add-native");
      const next = { ...state.config, sources: [...state.config.sources, {
        id: `auto-${kind}`,
        kind,
        label: KIND_LABELS[kind],
        enabled: true,
      }] };
      await save(next);
    }));

  content.querySelectorAll("[data-toggle]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-toggle");
      const next = { ...state.config, sources: state.config.sources.map((s) =>
        s.id === id ? { ...s, enabled: s.enabled === false } : s) };
      await save(next);
    }));

  content.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-remove");
      const next = { ...state.config, sources: state.config.sources.filter((s) => s.id !== id) };
      await save(next);
    }));

  content.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const found = state.config.sources.find((s) => s.id === id);
      if (!found) return;
      draft = { ...found };
      discovered = null;
      testError = null;
      renderSources();
    }));

  if (!draft) return;

  document.querySelector("#cancel-form").addEventListener("click", () => {
    draft = null;
    discovered = null;
    testError = null;
    renderSources();
  });

  content.querySelectorAll('input[name="auth"]').forEach((radio) =>
    radio.addEventListener("change", () => {
      const kind = radio.value;
      content.querySelectorAll("[data-auth-for]").forEach((el) => {
        el.hidden = el.getAttribute("data-auth-for") !== kind;
      });
      const warning = content.querySelector("[data-auth-warning]");
      if (warning) warning.hidden = !["token", "header", "basic"].includes(kind);
    }));

  document.querySelector("#f-test").addEventListener("click", async () => {
    collectForm();
    if (!draft.url) { testError = new Error("Enter a CCTray URL first."); return renderSources(); }
    busy = true;
    testError = null;
    renderSources();
    try {
      discovered = await fetchProjects(draft, state.cwd);
      testError = null;
    } catch (e) {
      discovered = null;
      testError = e;
    } finally {
      busy = false;
      renderSources();
    }
  });

  document.querySelector("#f-save").addEventListener("click", async () => {
    collectForm();
    if (!draft.url) { testError = new Error("Enter a CCTray URL first."); return renderSources(); }
    const { __isNew, ...clean } = draft;
    const exists = state.config.sources.some((s) => s.id === clean.id);
    const next = {
      ...state.config,
      sources: exists
        ? state.config.sources.map((s) => (s.id === clean.id ? clean : s))
        : [...state.config.sources, clean],
    };
    draft = null;
    discovered = null;
    testError = null;
    await save(next);
  });
}

/** Reads the form back into the draft, including any ticked projects. */
function collectForm() {
  const value = (id) => document.querySelector(id)?.value?.trim() ?? "";
  const kind = content.querySelector('input[name="auth"]:checked')?.value || "none";

  draft.label = value("#f-label");
  draft.url = value("#f-url");
  draft.insecure = Boolean(document.querySelector("#f-insecure")?.checked);

  switch (kind) {
    case "token": draft.auth = { kind, token: value("#f-token") }; break;
    case "header": draft.auth = { kind, name: value("#f-hname"), value: value("#f-hvalue") }; break;
    case "basic": draft.auth = { kind, user: value("#f-user"), password: value("#f-pass") }; break;
    case "curlConfig": draft.auth = { kind, path: value("#f-config") }; break;
    default: draft.auth = { kind: "none" };
  }

  const ticked = [...content.querySelectorAll("[data-project]")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.getAttribute("data-project"));
  if (content.querySelector("[data-project]")) draft.projects = ticked;
}

/** Lets the controller reset transient form state when the project changes. */
export function resetSourcesView() {
  draft = null;
  discovered = null;
  testError = null;
  busy = false;
}

export { openUrl, nav };
