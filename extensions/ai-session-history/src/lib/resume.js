import { isSafeSessionId } from "./sanitize.js";
import { shellQuote } from "./shell-quote.js";

const RESUME = {
  grok: (id) => `grok --resume ${shellQuote(id)}`,
  claude: (id) => `claude --resume ${shellQuote(id)}`,
  codex: (id) => `codex resume ${shellQuote(id)}`,
  copilot: (id) => `copilot --resume=${shellQuote(id)}`,
  cursor: (id) => `cursor-agent --resume ${shellQuote(id)}`,
  opencode: (id) => `opencode --session ${shellQuote(id)}`,
};

const START = {
  grok: "grok",
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
  cursor: "cursor-agent",
  opencode: "opencode",
};

export function buildResumeCommand(cli, sessionId) {
  if (!isSafeSessionId(sessionId)) {
    throw new Error("Invalid session id");
  }
  const builder = RESUME[cli];
  if (!builder) throw new Error(`Unknown CLI: ${cli}`);
  return builder(sessionId);
}

export function buildStartCommand(cli) {
  const cmd = START[cli];
  if (!cmd) throw new Error(`Unknown CLI: ${cli}`);
  return cmd;
}

export async function openResumeTerminal(cli, sessionId) {
  const command = buildResumeCommand(cli, sessionId);
  return muxy.tabs.open({
    kind: "terminal",
    directory: ".",
    command,
  });
}

export async function openStartTerminal(cli) {
  return muxy.tabs.open({
    kind: "terminal",
    directory: ".",
    command: buildStartCommand(cli),
  });
}
