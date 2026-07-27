// Background script for API Usage
// Polls all configured NewAPI/Sub2API sites and updates the status bar.
// NOTE: muxy.storage in background scripts is SYNCHRONOUS

const STORAGE_KEY = "newapi-sites";
const STATUS_KEY = "newapi-status";
const AUTO_REFRESH_KEY = "newapi-refresh";
const QUOTA_TO_USD = 500_000;

const SITE_TYPES = {
	NEWAPI: "newapi",
	SUB2API: "sub2api",
};

/* ─── Curl Helper ─── */
function escapeCurl(value) {
	return String(value)
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n");
}

function syncCurl(url, method, headers) {
	const lines = [
		`url = "${escapeCurl(url)}"`,
		`request = "${escapeCurl(method)}"`,
	];
	if (headers) {
		for (const [key, value] of Object.entries(headers)) {
			lines.push(`header = "${escapeCurl(`${key}: ${value}`)}"`);
		}
	}
	const config = `${lines.join("\n")}\n`;
	const result = muxy.exec(
		[
			"/usr/bin/curl",
			"--silent",
			"--show-error",
			"--location",
			"--max-time",
			"15",
			"--write-out",
			"\n%{http_code}",
			"--config",
			"-",
		],
		{ stdin: config, timeoutMs: 20000 },
	);
	if (!result || result.exitCode !== 0) return null;
	const trimmed = String(result.stdout || "").trimEnd();
	const split = trimmed.lastIndexOf("\n");
	if (split < 0) return null;
	const status = Number(trimmed.slice(split + 1));
	if (!Number.isFinite(status) || status < 200 || status >= 300) return null;
	try {
		return JSON.parse(trimmed.slice(0, split) || "{}");
	} catch {
		return null;
	}
}

/* ─── Site helpers ─── */
function siteType(site) {
	return site?.type === SITE_TYPES.SUB2API
		? SITE_TYPES.SUB2API
		: SITE_TYPES.NEWAPI;
}

function baseResult(site, extra = {}) {
	return {
		id: site.id,
		type: siteType(site),
		name: site.name,
		apiUrl: site.apiUrl,
		...extra,
	};
}

function errorResult(site, error) {
	return baseResult(site, { error });
}

function defaultNewapiUserHeaderName() {
	return "New-Api-User";
}

function resolveNewapiUserHeaderName(site) {
	const custom = site?.userHeaderName?.trim();
	return custom || defaultNewapiUserHeaderName();
}

/* ─── NewAPI Fetch ─── */
function fetchNewapiSite(site) {
	const baseUrl = site.apiUrl.replace(/\/+$/, "");
	const headers = {
		Accept: "application/json",
		Authorization: `Bearer ${site.accessToken}`,
		[resolveNewapiUserHeaderName(site)]: site.userId,
	};

	const userResp = syncCurl(`${baseUrl}/api/user/self`, "GET", headers);
	if (!userResp) return errorResult(site, "Failed to connect");
	if (!userResp.success || !userResp.data) {
		return errorResult(site, userResp.message || "API returned error");
	}

	const ud = userResp.data;
	const balanceUsd = ud.quota / QUOTA_TO_USD;
	const totalUsedUsd = ud.used_quota / QUOTA_TO_USD;

	const now = new Date();
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const startTs = Math.floor(startOfDay.getTime() / 1000);
	const endTs = Math.floor(now.getTime() / 1000);

	let todayUsageUsd = null;
	const dataResp = syncCurl(
		`${baseUrl}/api/data/self?start_timestamp=${startTs}&end_timestamp=${endTs}&default_time=hour`,
		"GET",
		headers,
	);
	if (dataResp && dataResp.success && Array.isArray(dataResp.data)) {
		const totalQuota = dataResp.data.reduce(
			(sum, dp) => sum + (dp.quota || 0),
			0,
		);
		todayUsageUsd = totalQuota / QUOTA_TO_USD;
	}

	return baseResult(site, {
		fetchedAt: new Date().toISOString(),
		balanceUsd,
		totalUsedUsd,
		todayUsageUsd,
		requestCount: ud.request_count,
		group: ud.group || null,
		error: null,
	});
}

/* ─── Sub2API Fetch ─── */
function extractSub2apiUsage(response) {
	const remaining =
		response?.remaining ?? response?.quota?.remaining ?? response?.balance;
	const unit = response?.unit ?? response?.quota?.unit ?? "USD";
	return {
		isValid: response?.is_active ?? response?.isValid ?? true,
		remaining,
		unit,
	};
}

function fetchSub2apiSite(site) {
	const baseUrl = site.apiUrl.replace(/\/+$/, "");
	const headers = {
		Accept: "application/json",
		Authorization: `Bearer ${site.accessToken}`,
	};

	const usageResp = syncCurl(`${baseUrl}/v1/usage`, "GET", headers);
	if (!usageResp) return errorResult(site, "Failed to connect");

	const usage = extractSub2apiUsage(usageResp);
	return baseResult(site, {
		fetchedAt: new Date().toISOString(),
		remaining: usage.remaining,
		unit: usage.unit,
		isValid: usage.isValid,
		error: null,
	});
}

function fetchSite(site) {
	return siteType(site) === SITE_TYPES.SUB2API
		? fetchSub2apiSite(site)
		: fetchNewapiSite(site);
}

/* ─── Status Bar ─── */
function formatRemaining(value, unit = "USD") {
	if (value === null || value === undefined || value === "") return null;
	const numeric = Number(value);
	if (Number.isFinite(numeric)) {
		if (unit === "USD") return `$${numeric.toFixed(2)}`;
		return `${numeric.toFixed(2)} ${unit || ""}`.trim();
	}
	return `${value}${unit ? ` ${unit}` : ""}`;
}

function statusBalance(result) {
	if (result.type === SITE_TYPES.SUB2API) {
		const unit = result.unit || "USD";
		const value = Number(result.remaining);
		return Number.isFinite(value) ? { value, unit } : null;
	}
	const value = Number(result.balanceUsd);
	return Number.isFinite(value) ? { value, unit: "USD" } : null;
}

function updateStatusBar(results) {
	const balances = results
		.filter((r) => !r.error)
		.map(statusBalance)
		.filter(Boolean);
	if (balances.length === 0) {
		muxy.statusbar.set({
			id: "newapi-usage",
			icon: { svg: "assets/icon.svg" },
		});
		return;
	}

	const unit = balances[0].unit;
	const sameUnit = balances.every((b) => b.unit === unit);
	const total = balances.reduce((sum, b) => sum + b.value, 0);
	muxy.statusbar.set({
		id: "newapi-usage",
		icon: { svg: "assets/icon.svg" },
		text: sameUnit ? formatRemaining(total, unit) : `${balances.length} sites`,
	});
}

/* ─── Storage helpers (synchronous in background) ─── */
function normalizeSite(site) {
	return { ...site, type: siteType(site) };
}

function readSites() {
	try {
		const raw = muxy.storage.get(STORAGE_KEY);
		const list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.map(normalizeSite) : [];
	} catch {
		return [];
	}
}

function readStatus() {
	try {
		const raw = muxy.storage.get(STATUS_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function writeStatus(payload) {
	try {
		muxy.storage.set(STATUS_KEY, JSON.stringify({ version: 1, ...payload }));
	} catch {
		/* best-effort */
	}
}

/* ─── Polling ─── */
let isPolling = false;
let autoRefreshSeconds = 300;

function poll() {
	if (isPolling) return;
	isPolling = true;

	try {
		const sites = readSites();
		const cached = readStatus() || {};
		autoRefreshSeconds = cached.autoRefreshSeconds || autoRefreshSeconds;

		const enabledSites = sites.filter((s) => s.enabled !== false);
		const results = enabledSites.map((site) => fetchSite(site));
		const payload = {
			autoRefreshSeconds,
			sites: results,
			lastPollAt: new Date().toISOString(),
		};

		writeStatus(payload);
		updateStatusBar(results);
	} catch (error) {
		console.warn("newapi-usage background poll failed", error);
	}

	isPolling = false;
}

function loadRefreshInterval() {
	try {
		const raw = muxy.storage.get(AUTO_REFRESH_KEY);
		if (raw) {
			const val = Number(raw);
			if ([60, 300, 600, 900, 1800, 3600].includes(val)) return val;
		}
	} catch {}
	return 300;
}

/* ─── Init ─── */
try {
	const cached = readStatus();
	if (cached) {
		autoRefreshSeconds = cached.autoRefreshSeconds || autoRefreshSeconds;
		if (Array.isArray(cached.sites)) updateStatusBar(cached.sites);
	}

	muxy.events.subscribe("extension.newapi-usage.keepalive", () => {
		autoRefreshSeconds = loadRefreshInterval();
	});

	muxy.events.subscribe("extension.newapi-usage.refresh", () => {
		poll();
	});

	// Timer: recursive setTimeout so interval is always current
	if (typeof setTimeout === "function") {
		poll();
		function backgroundTick() {
			autoRefreshSeconds = loadRefreshInterval();
			poll();
			setTimeout(backgroundTick, autoRefreshSeconds * 1000);
		}
		setTimeout(backgroundTick, autoRefreshSeconds * 1000);
	}

	console.log(
		`newapi-usage background started (interval=${autoRefreshSeconds}s)`,
	);
} catch (error) {
	console.warn("newapi-usage background init failed", error);
}
