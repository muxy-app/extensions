// Deployments per environment, for the sources that report them.

import { state, nav } from "../state.js";
import { escapeHtml, timeAgo } from "../util.js";
import { STATUS_META } from "../model.js";
import { openUrl } from "../exec.js";
import * as icons from "../icons.js";
import { content, statusIcon, sourceErrorsHtml, wireExternalLinks } from "./chrome.js";

export function renderEnvironments() {
  const errorsHtml = sourceErrorsHtml(state.envErrors);
  const envs = state.environments;

  if (!envs.length) {
    content.innerHTML = `${errorsHtml}
      <div class="state">
        <div class="state__icon">${icons.ICON_ROCKET}</div>
        <div class="state__title">No environments</div>
        <div class="state__detail">
          None of the configured sources reported a deployment environment.
          GitHub Actions and GitLab CI report them; a CCTray feed does not.
        </div>
        <button class="btn" id="open-sources">Configure sources</button>
      </div>`;
    document.querySelector("#open-sources")?.addEventListener("click", () => nav.sources());
    return;
  }

  content.innerHTML = `${errorsHtml}<div class="list">${envs.map(envRow).join("")}</div>`;
  wireExternalLinks(content, openUrl);
}

function envRow(env) {
  const meta = STATUS_META[env.status] || STATUS_META.unknown;
  const bits = [];
  if (env.ref) bits.push(escapeHtml(env.ref));
  if (env.sha) bits.push(`<code class="inline">${escapeHtml(env.sha)}</code>`);
  if (env.updatedAt) bits.push(escapeHtml(timeAgo(env.updatedAt)));
  bits.push(escapeHtml(meta.label));

  return `
    <div class="env">
      <span class="job__icon st-${meta.cls}">${statusIcon(env.status)}</span>
      <div class="run__body">
        <div class="env__name">${escapeHtml(env.name)}</div>
        <div class="env__meta">${bits.join('<span class="run__sep"> · </span>')}</div>
      </div>
      ${env.webUrl
        ? `<button class="icon-btn" data-url="${escapeHtml(env.webUrl)}" title="Open environment" aria-label="Open environment">${icons.ICON_OPEN_EXT}</button>`
        : ""}
    </div>`;
}
