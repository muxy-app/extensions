import { nonEmptyString } from "./values.mjs";

// Alibaba Bailian (Model Studio) Token Plan usage is only exposed through the
// console gateway that the official `bl` CLI uses (`bl usage token-plan`).
// Token Plan API keys (`sk-sp-…`) cannot read usage; the console access token
// written by `bl auth login --console` to ~/.bailian/config.json can.

const tokenPlanUsageAPI = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage";

const consoleGateways = {
  "cn-beijing": {
    domestic: { host: "bailian-cs.console.aliyun.com", action: "BroadScopeAspnGateway" },
    international: { host: "bailian-cs.console.alibabacloud.com", action: "BroadScopeAspnGateway" },
  },
  "ap-southeast-1": {
    domestic: { host: "modelstudio-cs.console.aliyun.com", action: "IntlBroadScopeAspnGateway" },
    international: { host: "bailian-singapore-cs.alibabacloud.com", action: "IntlBroadScopeAspnGateway" },
  },
};

export function bailianConfigPath(home, configDir = "") {
  return `${nonEmptyString(configDir) || `${home}/.bailian`}/config.json`;
}

// Mirrors the CLI: `active_config` names a profile block; "default" or no
// active profile means the top-level keys.
export function selectBailianProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const active = nonEmptyString(raw.active_config);
  const profile = active && active !== "default" ? raw[active] : raw;
  const token = nonEmptyString(profile?.access_token);
  if (!token) return null;
  const switchAgent = Number(profile.console_switch_agent);
  return {
    token,
    region: nonEmptyString(profile.console_region) || "cn-beijing",
    site: profile.console_site === "international" ? "international" : "domestic",
    switchAgent: Number.isFinite(switchAgent) && switchAgent > 0 ? switchAgent : null,
  };
}

export function bailianTokenPlanRequest(credentials) {
  const regionGateways = consoleGateways[credentials.region] || consoleGateways["cn-beijing"];
  const gateway = regionGateways[credentials.site] || regionGateways.domestic;
  const params = JSON.stringify({
    Api: tokenPlanUsageAPI,
    V: "1.0",
    Data: {
      cornerstoneParam: {
        protocol: "V2",
        console: "ONE_CONSOLE",
        productCode: "p_efm",
        switchUserType: 3,
        consoleSite: "BAILIAN_ALIYUN",
        ...(credentials.switchAgent ? { switchAgent: credentials.switchAgent } : {}),
      },
    },
  });
  return {
    url: `https://${gateway.host}/cli/api.json?action=${gateway.action}&product=sfm_bailian&api=${encodeURIComponent(tokenPlanUsageAPI)}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `params=${encodeURIComponent(params)}&region=${encodeURIComponent(credentials.region)}`,
  };
}
