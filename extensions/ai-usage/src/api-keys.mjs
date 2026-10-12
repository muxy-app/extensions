import { statusCacheDir } from "./status-cache.mjs";
import { nonEmptyString } from "./values.mjs";

/*
 * 변경 전 정책: OpenRouter / Z.ai / MiniMax는 환경 변수나 각 CLI 설정 파일에 API key가 있어야만
 *   조회됐고, 없으면 "Set OPENROUTER_API_KEY" 같은 안내만 표시했다.
 * 변경 후 정책: popover에서 버튼으로 API key를 입력받아 이 Mac의
 *   ~/Library/Application Support/muxy-ai-usage/api-keys.json(디렉터리 700, 파일 600)에 저장하고,
 *   collector는 저장된 key를 환경 변수·CLI 설정보다 먼저 쓴다.
 * 변경 이유: Muxy는 셸 환경 변수를 물려받지 못하는 경우가 많아 key를 직접 넣을 방법이 필요했다.
 *   background 호스트에는 muxy.storage가 없어서 popover와 background가 함께 읽을 수 있는 로컬 파일을 쓴다.
 * 영향 범위: apiKeyProviders에 있는 provider의 credential 탐색 순서. key는 stdin으로만 쓰므로
 *   exec argv(감사 로그)에 남지 않고, 각 provider의 usage endpoint로만 전송된다.
 */
export const apiKeyProviders = {
  openrouter: { label: "OpenRouter API key", placeholder: "sk-or-v1-…", host: "openrouter.ai" },
  zai: { label: "Z.ai API key", placeholder: "Z.ai API key", host: "api.z.ai" },
  minimax: { label: "MiniMax API key", placeholder: "MiniMax API key", host: "api.minimax.io" },
};

export function apiKeysPath(home) {
  const dir = statusCacheDir(home);
  return dir ? `${dir}/api-keys.json` : "";
}

export function parseStoredApiKeys(raw) {
  try {
    const payload = JSON.parse(String(raw || "{}"));
    const keys = payload && typeof payload === "object" ? payload.keys : null;
    if (!keys || typeof keys !== "object") return {};
    return Object.fromEntries(Object.keys(apiKeyProviders).flatMap((id) => {
      const key = nonEmptyString(keys[id]);
      return key ? [[id, key]] : [];
    }));
  } catch {
    return {};
  }
}

export async function readStoredApiKeys(context) {
  const path = apiKeysPath(context.home === "~" ? "" : context.home);
  return path ? parseStoredApiKeys(await context.readText(path)) : {};
}

export function maskApiKey(key) {
  const value = String(key || "");
  return value.length > 4 ? `••••${value.slice(-4)}` : "••••";
}

// Writes go through stdin (never argv) into an owner-only file: the temp file is
// created and chmod'ed 600 before the secret is written, then renamed into place.
export async function saveStoredApiKey(exec, home, providerID, key) {
  if (!apiKeyProviders[providerID] || !home) throw new Error("unsupported provider");
  const dir = statusCacheDir(home);
  const path = apiKeysPath(home);
  const current = await exec(["/bin/cat", path], { timeoutMs: 3000 });
  const keys = parseStoredApiKeys(current && current.exitCode === 0 ? current.stdout : "");
  const value = nonEmptyString(key);
  if (value) keys[providerID] = value;
  else delete keys[providerID];

  const tmpPath = `${path}.tmp`;
  const steps = [
    [["/bin/mkdir", "-p", dir]],
    [["/bin/chmod", "700", dir]],
    [["/usr/bin/touch", tmpPath]],
    [["/bin/chmod", "600", tmpPath]],
    // dd (not tee) so the secret is never echoed back on stdout.
    [["/bin/dd", `of=${tmpPath}`, "status=none"], JSON.stringify({ version: 1, keys })],
    [["/bin/mv", "-f", tmpPath, path]],
  ];
  for (const [argv, stdin] of steps) {
    const result = await exec(argv, stdin === undefined ? { timeoutMs: 3000 } : { stdin, timeoutMs: 3000 });
    if (!result || result.exitCode !== 0) throw new Error("api key write failed");
  }
  return keys;
}
