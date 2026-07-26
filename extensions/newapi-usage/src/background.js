// Background script for NewAPI Usage
// Polls all configured sites and updates the status bar
// NOTE: muxy.storage in background scripts is SYNCHRONOUS

const STORAGE_KEY = "newapi-sites";
const STATUS_KEY = "newapi-status";
const AUTO_REFRESH_KEY = "newapi-refresh";
const QUOTA_TO_USD = 500_000;

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

/* ─── API Fetch ─── */
function fetchSite(site) {
	const baseUrl = site.apiUrl.replace(/\/+$/, "");
	const headers = {
		Accept: "application/json",
		Authorization: `Bearer ${site.accessToken}`,
		"New-Api-User": site.userId,
	};

	const userResp = syncCurl(`${baseUrl}/api/user/self`, "GET", headers);
	if (!userResp) {
		return {
			id: site.id,
			name: site.name,
			apiUrl: site.apiUrl,
			error: "Failed to connect",
		};
	}
	if (!userResp.success || !userResp.data) {
		return {
			id: site.id,
			name: site.name,
			apiUrl: site.apiUrl,
			error: userResp.message || "API returned error",
		};
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

	return {
		id: site.id,
		name: site.name,
		apiUrl: site.apiUrl,
		fetchedAt: new Date().toISOString(),
		balanceUsd,
		totalUsedUsd,
		todayUsageUsd,
		requestCount: ud.request_count,
		group: ud.group || null,
		error: null,
	};
}

/* ─── Status Bar ─── */
function updateStatusBar(results) {
	const available = results.filter((r) => !r.error);
	if (available.length === 0) {
		muxy.statusbar.set({
			id: "newapi-usage",
			icon: { svg: "assets/icon.svg" },
		});
		return;
	}
	const totalBalance = available.reduce(
		(sum, r) => sum + (r.balanceUsd || 0),
		0,
	);
	muxy.statusbar.set({
		id: "newapi-usage",
		icon: { svg: "assets/icon.svg" },
		text: `$${totalBalance.toFixed(2)}`,
	});
}

/* ─── Storage helpers (synchronous in background) ─── */
function readSites() {
	try {
		const raw = muxy.storage.get(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
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
		if (Array.isArray(cached.sites)) {
			updateStatusBar(cached.sites);
		}
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
