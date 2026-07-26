import "@/styles/global.css";
import { h, clear, cls } from "@/lib/dom";

/* ─── Constants ─── */
const QUOTA_TO_USD = 500_000;
const STORAGE_KEY = "newapi-sites";
const STATUS_KEY = "newapi-status";
const AUTO_REFRESH_KEY = "newapi-refresh";
const BAL_ALERT_KEY = "newapi-balalert";

/* ─── App State ─── */
let _dragSiteId;
let sites = [];
let statusData = null;
let autoRefreshSeconds = 300;
let _balAlert = 0; // 0 = disabled
let formOpen = false;
let isLoading = true;
let lastRefreshTime = null; // Date

/* ─── Storage Helpers (async in webview) ─── */
async function loadSites() {
	try {
		const raw = await muxy.storage.get(STORAGE_KEY);
		sites = raw ? JSON.parse(raw) : [];
	} catch {
		sites = [];
	}
}

async function saveSites() {
	await muxy.storage.set(STORAGE_KEY, JSON.stringify(sites));
}

/* ─── Status cache (shared with background) ─── */
async function loadStatusCache() {
	try {
		const raw = await muxy.storage.get(STATUS_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

async function saveStatusCache(payload) {
	try {
		await muxy.storage.set(
			STATUS_KEY,
			JSON.stringify({ version: 1, ...payload }),
		);
	} catch {
		/* best-effort */
	}
}

/* ─── Refresh interval — store inside status cache + separate key fallback ─── */
async function loadRefreshInterval() {
	// Primary: read from status cache (always latest after any refresh)
	const cached = await loadStatusCache();
	if (cached && cached.autoRefreshSeconds) {
		autoRefreshSeconds = cached.autoRefreshSeconds;
		return;
	}
	// Fallback: read from separate key
	try {
		const raw = await muxy.storage.get(AUTO_REFRESH_KEY);
		if (raw) {
			const val = Number(raw);
			if ([60, 300, 600, 900, 1800, 3600].includes(val)) {
				autoRefreshSeconds = val;
			}
		}
	} catch {
		/* use default */
	}
}

async function saveRefreshInterval(seconds) {
	autoRefreshSeconds = seconds;
	// Save to separate key
	await muxy.storage.set(AUTO_REFRESH_KEY, String(seconds));
	// Also save into status cache so it survives re-open
	const payload = statusData || { sites: [] };
	payload.autoRefreshSeconds = seconds;
	await saveStatusCache(payload);
}

/* ─── Balance alert threshold ─── */
async function loadBalAlert() {
	_balAlert = 0;
	const cached = await loadStatusCache();
	if (cached && cached.balAlert) _balAlert = cached.balAlert;
	try {
		const raw = await muxy.storage.get(BAL_ALERT_KEY);
		if (raw) _balAlert = Number(raw);
	} catch {}
}

async function saveBalAlert(val) {
	_balAlert = val;
	await muxy.storage.set(BAL_ALERT_KEY, String(val));
	const payload = statusData || { sites: [] };
	payload.balAlert = val;
	await saveStatusCache(payload);
}

/* ─── API Helpers ─── */
async function fetchSiteData(site) {
	const baseUrl = site.apiUrl.replace(/\/+$/, "");
	const headers = {
		Accept: "application/json",
		Authorization: `Bearer ${site.accessToken}`,
		"New-Api-User": site.userId,
	};

	try {
		const userResp = await muxy.http.fetch(`${baseUrl}/api/user/self`, {
			method: "GET",
			headers,
			timeoutMs: 15000,
		});
		if (userResp.status !== 200) {
			return {
				id: site.id,
				name: site.name,
				apiUrl: site.apiUrl,
				error: `HTTP ${userResp.status}`,
			};
		}
		const userJson = JSON.parse(userResp.body);
		if (!userJson.success || !userJson.data) {
			return {
				id: site.id,
				name: site.name,
				apiUrl: site.apiUrl,
				error: userJson.message || "API error",
			};
		}
		const ud = userJson.data;
		const balanceUsd = ud.quota / QUOTA_TO_USD;
		const totalUsedUsd = ud.used_quota / QUOTA_TO_USD;

		const now = new Date();
		const startOfDay = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		);
		const startTs = Math.floor(startOfDay.getTime() / 1000);
		const endTs = Math.floor(now.getTime() / 1000);

		let todayUsageUsd = null;
		try {
			const dataResp = await muxy.http.fetch(
				`${baseUrl}/api/data/self?start_timestamp=${startTs}&end_timestamp=${endTs}&default_time=hour`,
				{ method: "GET", headers, timeoutMs: 15000 },
			);
			if (dataResp.status === 200) {
				const dataJson = JSON.parse(dataResp.body);
				if (dataJson.success && Array.isArray(dataJson.data)) {
					const totalQuota = dataJson.data.reduce(
						(sum, dp) => sum + (dp.quota || 0),
						0,
					);
					todayUsageUsd = totalQuota / QUOTA_TO_USD;
				}
			}
		} catch {
			/* optional */
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
	} catch (err) {
		return {
			id: site.id,
			name: site.name,
			apiUrl: site.apiUrl,
			error: err.message || "Connection failed",
		};
	}
}

/* ─── Formatting ─── */
function fmtUsdShort(val) {
	if (val === null || val === undefined) return "—";
	return `$${val.toFixed(2)}`;
}

function fmtRefreshTime(date) {
	if (!date) return "";
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

function fmtNextTime() {
	if (!lastRefreshTime) return "";
	const next = new Date(lastRefreshTime.getTime() + autoRefreshSeconds * 1000);
	const hh = String(next.getHours()).padStart(2, "0");
	const mm = String(next.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

/* ─── Render ─── */
function render(root) {
	clear(root);

	// Header
	const header = h(
		"div",
		{ class: "header" },
		h(
			"div",
			{ class: "header-title" },
			h("img", {
				src: "../assets/icon.svg",
				width: 18,
				height: 18,
				class: "header-icon",
				alt: "",
			}),
			"NewAPI Usage",
		),
		h(
			"div",
			{ class: "header-actions" },
			h(
				"button",
				{
					class: "icon-button",
					type: "button",
					"aria-label": "Add Site",
					title: "Add Site",
					onclick: () => openForm(root, null),
				},
				"＋",
			),
			h(
				"button",
				{
					class: "icon-button",
					type: "button",
					"aria-label": "Refresh",
					title: "Refresh All",
					onclick: () => refreshAll(root),
				},
				"↻",
			),
		),
	);
	root.appendChild(header);

	// Settings bar
	const balSelect = h(
		"select",
		{
			class: "bal-alert-select",
			onchange: async (e) => {
				await saveBalAlert(Number(e.target.value));
				const content = document.querySelector(".content");
				if (content) renderContent(content);
				try {
					muxy.toast({ title: "NewAPI Usage", body: "Balance alert updated" });
				} catch {}
			},
		},
		h("option", { value: "0" }, "Bal"),
		h("option", { value: "5" }, "$5"),
		h("option", { value: "10" }, "$10"),
		h("option", { value: "20" }, "$20"),
		h("option", { value: "50" }, "$50"),
		h("option", { value: "100" }, "$100"),
	);

	const refreshSelect = h(
		"select",
		{
			onchange: async (e) => {
				await saveRefreshInterval(Number(e.target.value));
				const nextEl = document.getElementById("next-refresh");
				if (nextEl)
					nextEl.textContent = lastRefreshTime ? `After ${fmtNextTime()}` : "";
				try {
					muxy.toast({
						title: "NewAPI Usage",
						body: "Refresh interval updated",
					});
				} catch {}
			},
		},
		h("option", { value: "60" }, "1 min"),
		h("option", { value: "300" }, "5 min"),
		h("option", { value: "600" }, "10 min"),
		h("option", { value: "900" }, "15 min"),
		h("option", { value: "1800" }, "30 min"),
		h("option", { value: "3600" }, "1 h"),
	);

	const settings = h(
		"section",
		{ class: "settings" },
		balSelect,
		refreshSelect,
		h(
			"span",
			{ class: "next-refresh", id: "next-refresh" },
			lastRefreshTime ? `After ${fmtNextTime()}` : "",
		),
		h(
			"span",
			{ class: "tip-icon", title: "Auto refreshes when popover is open" },
			"?",
		),
		h(
			"span",
			{ class: "last-refresh", id: "last-refresh" },
			lastRefreshTime ? `Updated: ${fmtRefreshTime(lastRefreshTime)}` : "",
		),
	);
	root.appendChild(settings);

	// Set select values AFTER they're in the DOM
	refreshSelect.value = String(autoRefreshSeconds);
	balSelect.value = String(_balAlert);

	const content = h("div", { class: "content" });
	root.appendChild(content);
	renderContent(content);
}

function renderContent(content) {
	clear(content);

	if (isLoading) {
		content.appendChild(h("div", { class: "status-message" }, "Loading..."));
		return;
	}

	if (sites.length === 0) {
		content.appendChild(
			h(
				"div",
				{ class: "empty-state" },
				h("div", { class: "empty-icon" }, "📡"),
				h("div", null, "No API sites configured yet"),
				h(
					"div",
					{ style: "font-size:11px;color:var(--muxy-foreground-muted)" },
					'Click "+ Add Site" to get started',
				),
			),
		);
		return;
	}

	const statusMap = {};
	if (statusData && Array.isArray(statusData.sites)) {
		for (const s of statusData.sites) {
			statusMap[s.id] = s;
		}
	}

	const list = h("div", { class: "site-list" });

	// Header
	list.appendChild(
		h(
			"div",
			{ class: "list-header" },
			h("div", { class: "col-name" }, "Name"),
			h("div", { class: "col-balance" }, "Balance"),
			h("div", { class: "col-today" }, "Today"),
			h("div", { class: "col-consumption" }, "Used"),
			h("div", { class: "col-actions" }, ""),
		),
	);

	const sorted = [...sites].sort((a, b) => {
		const ae = a.enabled !== false ? 1 : 0;
		const be = b.enabled !== false ? 1 : 0;
		return be - ae;
	});

	for (const site of sorted) {
		const st = statusMap[site.id];
		const hasError = st && st.error;
		const disabled = site.enabled === false;
		const rowClasses = [
			hasError ? "site-error" : "",
			disabled ? "site-disabled" : "",
		]
			.filter(Boolean)
			.join(" ");

		let todayText;
		if (hasError) todayText = "—";
		else if (st && st.todayUsageUsd !== null && st.todayUsageUsd !== undefined)
			todayText = fmtUsdShort(st.todayUsageUsd);
		else if (st) todayText = "—";
		else todayText = "...";

		list.appendChild(
			h(
				"div",
				{
					class: `list-row ${rowClasses}`.trim(),
					"data-site-id": site.id,
					draggable: "true",
					ondragstart: (e) => {
						_dragSiteId = site.id;
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", site.id);
						list
							.querySelectorAll(".list-row")
							.forEach((r) => r.classList.remove("drag-over"));
					},
					ondragover: (e) => {
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
					},
					ondrop: (e) => {
						e.preventDefault();
						const fromId = _dragSiteId || e.dataTransfer.getData("text/plain");
						if (!fromId || fromId === site.id) return;

						const fromIdx = sites.findIndex((s) => s.id === fromId);
						if (fromIdx < 0) return;

						// Insert dragged site right after the drop target
						const toIdx = sites.findIndex((s) => s.id === site.id);
						if (toIdx < 0) return;

						const [moved] = sites.splice(fromIdx, 1);
						const newTo = sites.findIndex((s) => s.id === site.id);
						sites.splice(newTo + 1, 0, moved);
						saveSites();

						list
							.querySelectorAll(".list-row")
							.forEach((r) => r.classList.remove("drag-over"));
						const r2 = document.getElementById("root");
						if (r2) renderContent(r2.querySelector(".content"));
					},
					ondragleave: (e) => {
						e.currentTarget.classList.remove("drag-over");
					},
					ondragend: () => {
						const rows = list.querySelectorAll(".list-row");
						rows.forEach((r) => r.classList.remove("drag-over"));
					},
				},
				h(
					"div",
					{ class: "col-name", title: site.apiUrl },
					h("div", { class: "cell-name" }, site.name),
					hasError
						? h("div", { class: "cell-error-inline" }, `⚠ ${st.error}`)
						: null,
				),
				h(
					"div",
					{
						class:
							"col-balance" +
							(_balAlert > 0 && st && !hasError && st.balanceUsd < _balAlert
								? " bal-low"
								: ""),
					},
					hasError ? "—" : st ? fmtUsdShort(st.balanceUsd) : "...",
				),
				h("div", { class: "col-today" }, todayText),
				h(
					"div",
					{ class: "col-consumption" },
					hasError ? "—" : st ? fmtUsdShort(st.totalUsedUsd) : "...",
				),
				h(
					"div",
					{ class: "col-actions" },
					h(
						"button",
						{
							class: "action-btn",
							type: "button",
							title: "Edit",
							onclick: () => openForm(document.getElementById("root"), site),
						},
						"✎",
					),
					h(
						"button",
						{
							class: "action-btn",
							type: "button",
							title: "Refresh",
							onclick: (e) => {
								e.stopPropagation();
								refreshSingleRow(site);
							},
						},
						h("span", { class: "btn-spin" }, "↻"),
					),
				),
			),
		);
	}
	content.appendChild(list);
}

function updateLastRefreshTime() {
	lastRefreshTime = new Date();
	const el = document.getElementById("last-refresh");
	if (el) el.textContent = `Updated: ${fmtRefreshTime(lastRefreshTime)}`;
	const nextEl = document.getElementById("next-refresh");
	if (nextEl) nextEl.textContent = `After ${fmtNextTime()}`;
}

/* ─── Form Overlay ─── */
function openForm(root, site) {
	if (formOpen) return;
	formOpen = true;
	const isEdit = site !== null;

	const triggerClose = () => {
		formOpen = false;
		const overlay = root.querySelector(".form-overlay");
		if (overlay) overlay.remove();
	};

	const overlay = h("div", {
		class: "form-overlay",
		onclick: (e) => {
			if (e.target === overlay) triggerClose();
		},
	});

	const panel = h("div", { class: "form-panel" });
	panel.appendChild(h("h3", null, isEdit ? "Edit" : "Add"));

	const fields = [
		{
			id: "name",
			label: "Name",
			placeholder: "e.g. My API",
			value: site?.name || "",
		},
		{
			id: "apiUrl",
			label: "API URL",
			placeholder: "https://newapi.example.com",
			value: site?.apiUrl || "",
			type: "url",
		},
		{
			id: "accessToken",
			label: "Access Token",
			placeholder: "Your Personal Security Settings",
			value: site?.accessToken || "",
			type: "password",
		},
		{
			id: "userId",
			label: "User ID",
			placeholder: "User ID from the site",
			value: site?.userId || "",
		},
	];

	const enabledDefault = site ? site.enabled !== false : true;

	const inputs = {};
	for (const f of fields) {
		const wrap = h("div", { class: "form-field" });
		wrap.appendChild(h("label", { for: f.id }, f.label));
		const input = h("input", {
			id: f.id,
			type: f.type || "text",
			placeholder: f.placeholder,
			value: f.value,
		});
		inputs[f.id] = input;
		wrap.appendChild(input);
		panel.appendChild(wrap);
	}

	// Enabled checkbox
	const enabledWrap = h("div", { class: "form-field form-check" });
	const enabledCb = h("input", {
		id: "enabled",
		type: "checkbox",
		checked: enabledDefault,
	});
	enabledCb._checked = enabledDefault;
	enabledCb.addEventListener("change", () => {
		enabledCb._checked = enabledCb.checked;
	});
	enabledWrap.appendChild(enabledCb);
	enabledWrap.appendChild(h("label", { for: "enabled" }, "Enabled"));
	panel.appendChild(enabledWrap);
	inputs.enabled = enabledCb;

	async function handleSave() {
		const val = (id) => inputs[id].value.trim();
		if (!val("name")) {
			showStatus(root, "error", "Name is required");
			return;
		}
		if (!val("apiUrl")) {
			showStatus(root, "error", "API URL is required");
			return;
		}
		let parsed;
		try {
			parsed = new URL(val("apiUrl"));
		} catch {
			showStatus(root, "error", "API URL is not valid");
			return;
		}
		if (parsed.protocol !== "https:") {
			showStatus(root, "error", "API URL must use https://");
			return;
		}
		if (!val("accessToken")) {
			showStatus(root, "error", "Access Token is required");
			return;
		}
		if (!val("userId")) {
			showStatus(root, "error", "User ID is required");
			return;
		}

		parsed.username = "";
		parsed.password = "";
		const cleanUrl = parsed.href.replace(/\/+$/, "");

		const now = Date.now();
		const enabled = !inputs.enabled || inputs.enabled._checked !== false;
		const newSite = {
			id: isEdit
				? site.id
				: `${now}-${Math.random().toString(36).slice(2, 10)}`,
			name: val("name"),
			apiUrl: cleanUrl,
			accessToken: val("accessToken"),
			userId: val("userId"),
			enabled,
			createdAt: isEdit ? site.createdAt : now,
			updatedAt: now,
		};

		if (isEdit) {
			const idx = sites.findIndex((s) => s.id === site.id);
			if (idx >= 0) sites[idx] = newSite;
		} else {
			sites.push(newSite);
		}

		await saveSites();
		triggerClose();
		// Re-render list immediately with new enabled state
		renderContent(root.querySelector(".content"));
		await refreshSingle(root, newSite);
	}

	async function handleDelete() {
		sites = sites.filter((s) => s.id !== site.id);
		await saveSites();
		triggerClose();
		if (statusData && Array.isArray(statusData.sites)) {
			statusData.sites = statusData.sites.filter((s) => s.id !== site.id);
		}
		await saveStatusCache(statusData);
		renderContent(root.querySelector(".content"));
	}

	const actions = h("div", { class: "form-actions" });
	if (isEdit)
		actions.appendChild(
			h(
				"button",
				{ class: "btn-delete", type: "button", onclick: handleDelete },
				"Delete",
			),
		);
	actions.appendChild(
		h(
			"button",
			{ class: "btn-cancel", type: "button", onclick: triggerClose },
			"Cancel",
		),
	);
	actions.appendChild(
		h(
			"button",
			{ class: "btn-save", type: "button", onclick: handleSave },
			isEdit ? "Save" : "Add",
		),
	);

	panel.appendChild(actions);
	overlay.appendChild(panel);
	root.appendChild(overlay);

	setTimeout(() => {
		const fi = panel.querySelector("input");
		if (fi) fi.focus();
	}, 50);
}

/* ─── Status Messages ─── */
function showStatus(root, type, msg) {
	const existing = root.querySelector(".status-message");
	if (existing) existing.remove();
	const el = h("div", { class: cls("status-message", type) }, msg);
	const header = root.querySelector(".header");
	if (header && header.nextSibling) root.insertBefore(el, header.nextSibling);
	if (type === "error") return;
	setTimeout(() => {
		if (el.parentNode) el.remove();
	}, 2500);
}

/* ─── Data Refresh ─── */
// Toggle spin on the header refresh button
function showRefreshIndicator() {
	let btn = document.getElementById("refresh-all-btn");
	if (!btn) {
		const els = document.querySelectorAll(".header-actions .icon-button");
		if (els.length >= 2) {
			els[els.length - 1].id = "refresh-all-btn";
			btn = els[els.length - 1];
		}
	}
	if (btn) btn.classList.add("refreshing");
}

function hideRefreshIndicator() {
	const btn = document.getElementById("refresh-all-btn");
	if (btn) btn.classList.remove("refreshing");
}

function animateCell(el, newText, duration) {
	const oldText = el.textContent;
	if (oldText === newText) return;
	const oldNum = parseFloat(oldText.replace(/[^\d.-]/g, ""));
	const newNum = parseFloat(newText.replace(/[^\d.-]/g, ""));
	if (isNaN(oldNum) || isNaN(newNum)) {
		el.textContent = newText;
		return;
	}

	const prefix = newText.startsWith("$") ? "$" : "";
	const start = performance.now();
	function tick(now) {
		const t = Math.min((now - start) / duration, 1);
		const ease = 1 - (1 - t) ** 3;
		const current = oldNum + (newNum - oldNum) * ease;
		el.textContent = `${prefix}${current.toFixed(2)}`;
		if (t < 1) requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
}

// Update a single row's values from API result (no full re-render)
function updateRowValues(siteId, data) {
	const row = document.querySelector(`[data-site-id="${siteId}"]`);
	if (!row) return;

	const nameEl = row.querySelector(".col-name");
	const balEl = row.querySelector(".col-balance");
	const conEl = row.querySelector(".col-consumption");
	const todEl = row.querySelector(".col-today");
	if (!balEl || !conEl || !todEl) return;

	const hasError = !!data.error;
	if (hasError) {
		balEl.textContent = "—";
		conEl.textContent = "—";
		todEl.textContent = "—";
		let errEl = nameEl.querySelector(".cell-error-inline");
		if (!errEl) {
			errEl = h("div", { class: "cell-error-inline" });
			nameEl.appendChild(errEl);
		}
		errEl.textContent = `⚠ ${data.error}`;
		row.classList.add("site-error");
	} else {
		animateCell(balEl, fmtUsdShort(data.balanceUsd), 1000);
		animateCell(conEl, fmtUsdShort(data.totalUsedUsd), 1000);
		animateCell(
			todEl,
			data.todayUsageUsd !== null ? fmtUsdShort(data.todayUsageUsd) : "—",
			1000,
		);
		// Remove inline error
		const errEl = nameEl.querySelector(".cell-error-inline");
		if (errEl) errEl.remove();
		row.classList.remove("site-error");
	}
}

// Refresh a single site row in-place (per-row ↻ button)
async function refreshSingleRow(site) {
	setRowLoading(site.id, true);
	const result = await fetchSiteData(site);
	setRowLoading(site.id, false);

	if (statusData && Array.isArray(statusData.sites)) {
		const idx = statusData.sites.findIndex((s) => s.id === site.id);
		if (idx >= 0) statusData.sites[idx] = result;
		else statusData.sites.push(result);
	}
	updateRowValues(site.id, result);
	updateLastRefreshTime();
	statusData.lastPollAt = lastRefreshTime?.toISOString();
	await saveStatusCache(statusData);
	try {
		muxy.toast({ title: "NewAPI Usage", body: "Updated ✓" });
	} catch {}
}

// Snapshot old display values in numeric cells before re-render
function snapshotValues(root) {
	const old = new Map();
	const cells = root.querySelectorAll(
		".col-balance, .col-consumption, .col-today",
	);
	for (const cell of cells) {
		const row = cell.closest(".list-row");
		if (!row) continue;
		const rowIdx = Array.from(row.parentNode.children).indexOf(row);
		const key = `${rowIdx}.${cell.className}`;
		old.set(key, cell.textContent);
	}
	return old;
}

// Animate numeric cells rolling from old values to new values
function rollValues(root, oldValues) {
	if (!oldValues || !oldValues.size) return;
	const cells = root.querySelectorAll(
		".col-balance, .col-consumption, .col-today",
	);
	for (const cell of cells) {
		const row = cell.closest(".list-row");
		if (!row || row.classList.contains("site-disabled")) continue;
		const rowIdx = Array.from(row.parentNode.children).indexOf(row);
		const key = `${rowIdx}.${cell.className}`;
		const oldText = oldValues.get(key);
		if (!oldText) continue;
		const newText = cell.textContent;
		if (oldText === newText) continue;

		const oldNum = parseFloat(oldText.replace(/[^\d.-]/g, ""));
		const newNum = parseFloat(newText.replace(/[^\d.-]/g, ""));
		if (isNaN(oldNum) || isNaN(newNum)) continue;

		const duration = 500;
		const start = performance.now();
		function tick(now) {
			const t = Math.min((now - start) / duration, 1);
			const ease = 1 - (1 - t) ** 3; // easeOutCubic
			const current = oldNum + (newNum - oldNum) * ease;
			const prefix = newText.startsWith("$") ? "$" : "";
			cell.textContent = `${prefix}${current.toFixed(2)}`;
			if (t < 1) requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	}
}

// Cascade flash + number roll on rows after data update
function animateRows(root, oldValues) {
	// Number roll only — flash removed per user request
	rollValues(root, oldValues);
}

async function refreshSingle(root, site) {
	const content = root.querySelector(".content");
	if (!content) return;
	const result = await fetchSiteData(site);

	if (!statusData) statusData = { autoRefreshSeconds, sites: [] };
	if (!Array.isArray(statusData.sites)) statusData.sites = [];

	const idx = statusData.sites.findIndex((s) => s.id === site.id);
	if (idx >= 0) statusData.sites[idx] = result;
	else statusData.sites.push(result);
	statusData.autoRefreshSeconds = autoRefreshSeconds;

	updateLastRefreshTime();
	statusData.lastPollAt = lastRefreshTime?.toISOString();
	await saveStatusCache(statusData);

	const oldVals = snapshotValues(root);
	renderContent(content);
	animateRows(root, oldVals);
	try {
		muxy.toast({ title: "NewAPI Usage", body: "Updated ✓" });
	} catch {}
	try {
		muxy.events.emit("extension.newapi-usage.keepalive", {
			sites: statusData.sites,
			autoRefreshSeconds,
		});
		muxy.events.emit("extension.newapi-usage.refresh", {});
	} catch {}
}

// Show/hide bouncing dots in a specific row during refresh
function setRowLoading(siteId, loading) {
	const rows = document.querySelectorAll(".list-row");
	for (const row of rows) {
		if (row.dataset.siteId === siteId) {
			if (loading) row.classList.add("row-loading");
			else row.classList.remove("row-loading");
			break;
		}
	}
}

async function refreshAll(root) {
	if (sites.length === 0) return;

	const enabledSites = sites.filter((s) => s.enabled !== false);

	// Start all fetches concurrently — each row updates on completion
	enabledSites.forEach((site) => setRowLoading(site.id, true));

	showRefreshIndicator();
	const fetchTasks = enabledSites.map(async (site) => {
		const result = await fetchSiteData(site);

		// Update this row's values in-place
		if (statusData && Array.isArray(statusData.sites)) {
			const idx2 = statusData.sites.findIndex((s) => s.id === site.id);
			if (idx2 >= 0) statusData.sites[idx2] = result;
			else statusData.sites.push(result);
		}
		updateRowValues(site.id, result);
		setRowLoading(site.id, false);
		return result;
	});
	const results = await Promise.all(fetchTasks);

	hideRefreshIndicator();

	statusData = {
		autoRefreshSeconds,
		sites: results,
		lastPollAt: new Date().toISOString(),
	};
	updateLastRefreshTime();
	statusData.lastPollAt = lastRefreshTime?.toISOString();
	await saveStatusCache(statusData);

	try {
		muxy.toast({ title: "NewAPI Usage", body: "Updated ✓" });
	} catch {}
	try {
		muxy.events.emit("extension.newapi-usage.keepalive", {
			sites: results,
			autoRefreshSeconds,
		});
		muxy.events.emit("extension.newapi-usage.refresh", {});
	} catch {}
}

/* ─── Init ─── */
async function init() {
	const root = document.getElementById("root");
	if (!root) return;

	await loadSites();
	await loadRefreshInterval();
	await loadBalAlert();

	const cached = await loadStatusCache();
	if (cached && Array.isArray(cached.sites)) {
		statusData = cached;
		if (cached.autoRefreshSeconds)
			autoRefreshSeconds = cached.autoRefreshSeconds;
		if (cached.balAlert) _balAlert = cached.balAlert;
		if (cached.lastPollAt) lastRefreshTime = new Date(cached.lastPollAt);
	}

	isLoading = false;
	render(root);

	try {
		muxy.events.emit("extension.newapi-usage.keepalive", {});
	} catch {}

	// 距上次更新超过刷新周期 → 自动刷新数据
	if (sites.length > 0) {
		const now = Date.now();
		const elapsed = lastRefreshTime
			? now - lastRefreshTime.getTime()
			: Infinity;
		if (elapsed >= autoRefreshSeconds * 1000) {
			refreshAll(root);
		}
	}

	// On focus: re-read from storage and check staleness
	muxy.onFocus((focused) => {
		if (!focused) return;
		loadStatusCache().then((c) => {
			if (c && Array.isArray(c.sites)) {
				statusData = c;
				if (c.autoRefreshSeconds) {
					autoRefreshSeconds = c.autoRefreshSeconds;
					const sel = root.querySelector(".bal-alert-select ~ select");
					if (sel) sel.value = String(autoRefreshSeconds);
				}
				if (c.balAlert) {
					_balAlert = c.balAlert;
					const balSel = root.querySelector(".bal-alert-select");
					if (balSel) balSel.value = String(_balAlert);
				}
				if (c.lastPollAt) {
					lastRefreshTime = new Date(c.lastPollAt);
					const el = document.getElementById("last-refresh");
					if (el)
						el.textContent = `Updated: ${fmtRefreshTime(lastRefreshTime)}`;
					const nextEl = document.getElementById("next-refresh");
					if (nextEl) nextEl.textContent = `After ${fmtNextTime()}`;
				}
			}
			renderContent(root.querySelector(".content"));
		});
		// 获得焦点时也检查是否超过刷新周期
		const elapsed = lastRefreshTime
			? Date.now() - lastRefreshTime.getTime()
			: Infinity;
		if (elapsed >= autoRefreshSeconds * 1000) {
			refreshAll(root);
		}
	});
}

document.addEventListener("DOMContentLoaded", init);
