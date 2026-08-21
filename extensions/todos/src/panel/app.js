import { clear, cls, h } from "@/lib/dom";
import { icon } from "@/lib/icons";

// Per-project namespace: todos:<projectID>
const keyFor = (projectID) => `todos:${projectID}`;

const uid = () =>
	crypto.randomUUID?.() ??
	`${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Free-form color palette for the right-click menu (no preset priority semantics)
const COLORS = [
	{ hex: "#FF0000", label: "Red" },
	{ hex: "#FF7A00", label: "Orange" },
	{ hex: "#FFD600", label: "Yellow" },
	{ hex: "#00C853", label: "Green" },
	{ hex: "#00BCD4", label: "Cyan" },
	{ hex: "#2196F3", label: "Blue" },
	{ hex: "#9C27B0", label: "Purple" },
	{ hex: "#FF4081", label: "Pink" },
	{ hex: "#795548", label: "Brown" },
	{ hex: "#9E9E9E", label: "Gray" },
];

// Legacy named priorities from v1.x still display their original color
const LEGACY_COLORS = {
	highest: "#FF0000",
	high: "#FF7A00",
	medium: "#FFD600",
	low: "#00C853",
	lowest: "#2196F3",
};

// Resolve a todo's display color: hex value, or a legacy named priority
const colorFor = (todo) => {
	const c = todo.priority;
	if (!c) return null;
	return c.startsWith("#") ? c : LEGACY_COLORS[c] || null;
};

export class TodosPanel {
	constructor(root) {
		this.root = root;
		this.projectID = null;
		this.projectName = "";
		this.todos = [];
		this.input = null;
		this.canAdd = false;
		// Note composer state
		this.noteOpen = false;
		this.noteInput = null;
		// Edit state
		this.editingId = null;
		// Drag-to-reorder state
		this.sorted = [];
		this.dragId = null;
		this.lastOver = null;
	}

	async start() {
		// Header button: clear completed
		muxy.events.subscribe("command.todos-clear-completed", () =>
			this.clearCompleted(),
		);
		// On project switch (the panel is usually rebuilt; this is a safety net)
		muxy.events.subscribe("project.switched", ({ projectID }) =>
			this.loadProject(projectID),
		);
		// Refresh the title when projects change (rename/add/remove)
		muxy.events.subscribe("projects.changed", () => this.refreshProjectName());
		// Behave like a native surface: focus the input when the panel opens or refocuses
		muxy.onFocus((focused) => {
			if (focused) this.input?.focus();
		});

		// Start with the currently active project
		const projects = await muxy.projects.list();
		const active = projects.find((p) => p.isActive);
		this.loadProject(active?.id);
	}

	async loadProject(projectID) {
		this.projectID = projectID ?? null;
		this.projectName = "";
		if (this.projectID) {
			const projects = await muxy.projects.list();
			this.projectName = projects.find((p) => p.id === this.projectID)?.name ?? "";
			const stored = await muxy.storage.get(keyFor(this.projectID));
			this.todos = Array.isArray(stored) ? stored : [];
		} else {
			this.todos = [];
		}
		this.render();
	}

	async refreshProjectName() {
		if (!this.projectID) return;
		const projects = await muxy.projects.list();
		const found = projects.find((p) => p.id === this.projectID);
		if (found && found.name !== this.projectName) {
			this.projectName = found.name;
			this.render();
		}
	}

	// ---- Data ops ----

	async save() {
		if (!this.projectID) return;
		await muxy.storage.set(keyFor(this.projectID), this.todos);
		this.renderList();
	}

	addTodo() {
		const text = this.input.value.trim();
		if (!text) return;
		const note = this.noteInput?.value.trim() ?? "";
		this.todos.unshift({
			id: uid(),
			text,
			note,
			done: false,
			createdAt: Date.now(),
			completedAt: null,
		});
		this.input.value = "";
		if (this.noteInput) this.noteInput.value = "";
		this.noteOpen = false;
		this.updateNoteArea();
		this.setCanAdd(false);
		this.save();
	}

	async toggleTodo(id) {
		const todo = this.todos.find((t) => t.id === id);
		if (!todo) return;
		todo.done = !todo.done;
		todo.completedAt = todo.done ? Date.now() : null;
		await this.save();
	}

	async removeTodo(id) {
		this.todos = this.todos.filter((t) => t.id !== id);
		await this.save();
	}

	// Right-click a row → in-place color picker menu (free colors, no preset priorities)
	showColorMenu(e, todo) {
		e.preventDefault();
		this.closeColorMenu();
		const menu = h(
			"div",
			{
				class:
					"fixed z-50 rounded-md border border-border bg-surface p-[6px] shadow-xl",
			},
			h(
				"div",
				{ class: "grid grid-cols-5 gap-[4px]" },
				COLORS.map((c) => this.colorSwatch(c, todo)),
			),
			h(
				"div",
				{ class: "mt-[6px] border-t border-border pt-[4px]" },
				h(
					"button",
					{
						type: "button",
						class:
							"flex w-full items-center gap-[6px] rounded-[4px] px-[6px] py-[4px] text-[11px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground",
						onclick: () => this.clearColor(todo.id),
					},
					icon("x", 11),
					"Clear color",
				),
			),
		);
		document.body.append(menu);
		this.menuEl = menu;
		this.placeMenu(e.clientX, e.clientY);
		setTimeout(() => document.addEventListener("click", this.onDocClick), 0);
		document.addEventListener("keydown", this.onKeyDown);
	}

	colorSwatch(c, todo) {
		const active = colorFor(todo) === c.hex;
		return h("button", {
			type: "button",
			class: cls(
				"h-[22px] w-[22px] rounded-full ring-1 ring-inset ring-black/15 transition-transform hover:scale-110",
				active && "ring-2 ring-foreground",
			),
			style: `background:${c.hex}`,
			title: c.label,
			"aria-label": c.label,
			onclick: () => this.setColor(todo.id, c.hex),
		});
	}

	// Keep the menu inside the viewport
	placeMenu(x, y) {
		if (!this.menuEl) return;
		const rect = this.menuEl.getBoundingClientRect();
		const nx = Math.min(x, window.innerWidth - rect.width - 4);
		const ny = Math.min(y, window.innerHeight - rect.height - 4);
		this.menuEl.style.left = `${Math.max(0, nx)}px`;
		this.menuEl.style.top = `${Math.max(0, ny)}px`;
	}

	async setColor(id, hex) {
		const todo = this.todos.find((t) => t.id === id);
		if (!todo) return;
		todo.priority = hex;
		this.closeColorMenu();
		await this.save();
	}

	async clearColor(id) {
		const todo = this.todos.find((t) => t.id === id);
		if (!todo) return;
		delete todo.priority;
		this.closeColorMenu();
		await this.save();
	}

	closeColorMenu() {
		this.menuEl?.remove();
		this.menuEl = null;
		document.removeEventListener("click", this.onDocClick);
		document.removeEventListener("keydown", this.onKeyDown);
	}

	onDocClick = (e) => {
		if (this.menuEl && !this.menuEl.contains(e.target)) this.closeColorMenu();
	};

	onKeyDown = (e) => {
		if (e.key === "Escape") this.closeColorMenu();
	};

	async clearCompleted() {
		const done = this.todos.filter((t) => t.done);
		if (!done.length) return;
		const choice = await muxy.dialog.confirm({
			title: "Clear Completed Tasks",
			message: `This will permanently remove ${done.length} completed task(s).`,
			buttons: ["Clear", "Cancel"],
			default: "Cancel",
			cancel: "Cancel",
			style: "warning",
		});
		if (choice !== "Clear") return;
		this.todos = this.todos.filter((t) => !t.done);
		await this.save();
	}

	// ---- Rendering ----

	render() {
		clear(this.root);
		const view = h(
			"div",
			{ class: "flex h-full flex-col overflow-hidden" },
			this.header(),
			this.inputRow(),
			h("div", {
				id: "todos-list",
				class: "min-h-0 flex-1 overflow-y-auto py-[6px]",
			}),
			h("div", { id: "todos-footer" }),
		);
		// Use native Node.append() here (it accepts a single node);
		// dom.js's append() helper takes a children array and throws "e.flat is not a function" on a single element.
		this.root.append(view);
		const list = this.root.querySelector("#todos-list");
		this.attachDragAndDrop(list);
		this.renderList();
	}

	// Drag-to-reorder: event delegation on the list container (re-attached on each render)
	attachDragAndDrop(list) {
		list.addEventListener("dragstart", (e) => {
			const row = e.target.closest("[data-id]");
			if (!row) return;
			this.dragId = row.dataset.id;
			row.classList.add("dragging");
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", this.dragId); // Firefox needs setData to start a drag
		});

		list.addEventListener("dragover", (e) => {
			const row = e.target.closest("[data-id]");
			if (!row || !this.dragId) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			if (row !== this.lastOver) {
				this.lastOver?.classList.remove("drag-before", "drag-after");
				this.lastOver = row;
			}
			const rect = row.getBoundingClientRect();
			const before = e.clientY < rect.top + rect.height / 2;
			row.classList.toggle("drag-before", before);
			row.classList.toggle("drag-after", !before);
		});

		list.addEventListener("dragleave", () => {
			this.lastOver?.classList.remove("drag-before", "drag-after");
			this.lastOver = null;
		});

		list.addEventListener("drop", (e) => {
			e.preventDefault();
			const row = e.target.closest("[data-id]");
			this.lastOver?.classList.remove("drag-before", "drag-after");
			this.lastOver = null;
			if (!row || !this.dragId) return;
			const rect = row.getBoundingClientRect();
			const before = e.clientY < rect.top + rect.height / 2;
			this.moveTodo(this.dragId, row.dataset.id, before);
			this.dragId = null;
		});

		list.addEventListener("dragend", () => {
			this.dragId = null;
			for (const el of list.querySelectorAll(".dragging"))
				el.classList.remove("dragging");
			this.lastOver?.classList.remove("drag-before", "drag-after");
			this.lastOver = null;
		});
	}

	// Persist the view order: what the user sees is what gets stored
	moveTodo(fromId, toId, before) {
		if (!fromId || fromId === toId) return;
		const sorted = this.sorted.slice();
		const from = sorted.findIndex((t) => t.id === fromId);
		if (from < 0) return;
		const [item] = sorted.splice(from, 1);
		let to = sorted.findIndex((t) => t.id === toId);
		if (to < 0) to = sorted.length;
		if (!before) to += 1;
		sorted.splice(to, 0, item);
		this.todos = sorted;
		this.save();
	}

	// Refresh the list + footer only; the input and its focus stay untouched
	renderList() {
		const list = this.root.querySelector("#todos-list");
		const footer = this.root.querySelector("#todos-footer");
		if (!list || !footer) return;
		// Incomplete first, completed sink to the bottom (stable within groups) — this is the drag order
		this.sorted = [...this.todos].sort((a, b) => Number(a.done) - Number(b.done));
		let rows;
		if (this.sorted.length) {
			rows = this.sorted.map((todo) => {
				const rowEl = this.row(todo);
				if (todo.id === this.editingId) this.attachEditKeys(rowEl, todo);
				return rowEl;
			});
		} else {
			const [title, hint] = this.projectID
				? ["No tasks in this project", "Add your first task above"]
				: ["No active project", "Open a project in Muxy first"];
			rows = [this.emptyState(title, hint)];
		}
		list.replaceChildren(...rows);
		footer.replaceChildren(this.footer());
	}

	header() {
		return h(
			"div",
			{ class: "flex items-center gap-[6px] px-[10px] pt-[10px]" },
			icon("list-checks", 13, "text-primary"),
			h(
				"span",
				{
					class: "min-w-0 truncate text-[11px] font-semibold text-muted-foreground",
				},
				this.projectName || "No project",
			),
		);
	}

	inputRow() {
		const form = h(
			"form",
			{
				class: "flex items-center gap-[6px] px-[10px] pt-[8px]",
				onsubmit: (e) => {
					e.preventDefault();
					this.addTodo();
				},
			},
			icon("plus", 14, "shrink-0 text-muted-foreground"),
			h("input", {
				type: "text",
				class:
					"h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-[8px] text-[12px] text-foreground placeholder:text-muted-foreground outline-none focus:border-ring",
				placeholder: "Add a task, press Enter…",
				autocomplete: "off",
				"aria-label": "Add task",
			}),
			h(
				"button",
				{
					type: "button",
					class: cls(
						"flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground",
						this.noteOpen && "bg-accent text-foreground",
					),
					onclick: () => this.toggleNote(),
					"aria-label": "Add note",
					title: "Add note",
				},
				icon("sticky-note", 13),
			),
			h(
				"button",
				{
					type: "submit",
					id: "todos-add-btn",
					disabled: !this.canAdd,
					class:
						"flex h-7 shrink-0 items-center justify-center gap-[4px] rounded-md bg-primary px-[10px] text-[12px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40",
					"aria-label": "Add task",
				},
				icon("plus", 12),
				"Add",
			),
		);
		const input = form.querySelector("input");
		input.addEventListener("input", () =>
			this.setCanAdd(input.value.trim().length > 0),
		);
		this.input = input;
		return h(
			"div",
			{ class: "shrink-0" },
			form,
			h("div", { id: "todos-note-area" }),
		);
	}

	// Note composer: toggled by the paperclip button; textarea keeps its newlines
	noteArea() {
		return h(
			"div",
			{ class: "pl-[30px] pr-[10px] pt-[6px]" },
			h("textarea", {
				id: "todos-note-input",
				rows: 4,
				class:
					"w-full resize-y rounded-md border border-border bg-surface px-[8px] py-[6px] text-[12px] leading-4 text-foreground placeholder:text-muted-foreground outline-none focus:border-ring",
				placeholder: "Note (optional), newlines are preserved…",
			}),
		);
	}

	toggleNote() {
		this.noteOpen = !this.noteOpen;
		this.updateNoteArea();
		if (this.noteOpen) this.noteInput?.focus();
	}

	// Refresh only the note slot so the task input keeps its focus
	updateNoteArea() {
		const area = this.root.querySelector("#todos-note-area");
		if (!area) return;
		if (this.noteOpen) area.replaceChildren(this.noteArea());
		else area.replaceChildren(); // no args: clear children (null would render a "null" text node)
		this.noteInput = this.noteOpen ? area.querySelector("textarea") : null;
	}

	setCanAdd(canAdd) {
		this.canAdd = canAdd;
		const btn = this.root.querySelector("#todos-add-btn");
		if (btn) btn.disabled = !canAdd;
	}

	emptyState(title, hint) {
		return h(
			"div",
			{
				class:
					"flex h-full flex-col items-center justify-center gap-[6px] px-[24px] text-center",
			},
			icon("list-checks", 26, "text-muted-foreground opacity-40"),
			h("p", { class: "text-[12px] font-medium text-muted-foreground" }, title),
			h("p", { class: "text-[11px] text-muted-foreground/60" }, hint),
		);
	}

	row(todo) {
		if (this.editingId === todo.id) return this.editRow(todo);
		const done = todo.done;
		const color = colorFor(todo);
		return h(
			"div",
			{
				class:
					"group flex items-start gap-[8px] rounded-md px-[10px] py-[4px] transition-colors hover:bg-accent",
				draggable: true,
				"data-id": todo.id,
				oncontextmenu: (e) => this.showColorMenu(e, todo),
			},
			icon(
				"grip-vertical",
				13,
				"mt-[6px] shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60 active:cursor-grabbing",
			),
			h(
				"button",
				{
					type: "button",
					class: cls(
						"mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors outline-none",
						done
							? "border-primary bg-primary text-primary-foreground"
							: "border-border bg-surface text-transparent hover:border-ring",
					),
					onclick: () => this.toggleTodo(todo.id),
					"aria-label": done ? "Mark as not done" : "Mark as done",
				},
				icon("check", 12),
			),
			// Color circle: between the checkbox and the text
			color
				? h("span", {
						class:
							"mt-[7px] h-[10px] w-[10px] shrink-0 rounded-full ring-1 ring-inset ring-black/15",
						style: `background: ${color}`,
					})
				: null,
			// Content column: title (single line) + note (newlines collapsed to spaces so rows stay compact)
			h(
				"div",
				{ class: "flex min-w-0 flex-1 flex-col py-[2px]" },
				h(
					"span",
					{
						class: cls(
							"truncate text-[12px] leading-5",
							done ? "text-muted-foreground line-through" : "text-foreground",
						),
						title: todo.text,
					},
					todo.text,
				),
				todo.note
					? h(
							"span",
							{
								class: "line-clamp-2 text-[11px] leading-4 text-muted-foreground/90",
								title: todo.note,
							},
							todo.note.replace(/\n+/g, " "),
						)
					: null,
			),
			h(
				"button",
				{
					type: "button",
					class:
						"flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-surface hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
					onclick: () => this.editTodo(todo.id),
					"aria-label": "Edit task",
				},
				icon("pen-line", 12),
			),
			h(
				"button",
				{
					type: "button",
					class:
						"flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-surface hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
					onclick: () => this.removeTodo(todo.id),
					"aria-label": "Delete task",
				},
				icon("x", 13),
			),
		);
	}

	// Edit mode: replaces the row with a title + note form (not draggable, no context menu)
	editRow(todo) {
		return h(
			"div",
			{
				class: "flex items-start gap-[8px] rounded-md px-[10px] py-[6px]",
				"data-id": todo.id,
			},
			icon(
				"grip-vertical",
				13,
				"shrink-0 cursor-default text-muted-foreground opacity-30",
			),
			h(
				"div",
				{ class: "flex min-w-0 flex-1 flex-col gap-[6px]" },
				h("input", {
					type: "text",
					id: "edit-text",
					class:
						"h-7 w-full rounded-md border border-border bg-surface px-[8px] text-[12px] text-foreground outline-none focus:border-ring",
					value: todo.text,
					"aria-label": "Task text",
				}),
				h(
					"textarea",
					{
						id: "edit-note",
						rows: 4,
						class:
							"w-full resize-y rounded-md border border-border bg-surface px-[8px] py-[6px] text-[12px] leading-4 text-foreground placeholder:text-muted-foreground outline-none focus:border-ring",
						placeholder: "Note (optional), newlines are preserved…",
					},
					todo.note ?? "",
				),
				h(
					"div",
					{ class: "flex items-center gap-[6px]" },
					h(
						"button",
						{
							type: "button",
							class:
								"flex h-7 items-center justify-center gap-[4px] rounded-md bg-primary px-[10px] text-[12px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90",
							onclick: () => this.saveEdit(todo.id),
						},
						icon("check", 12),
						"Save",
					),
					h(
						"button",
						{
							type: "button",
							class:
								"flex h-7 items-center justify-center rounded-md px-[10px] text-[12px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground",
							onclick: () => this.cancelEdit(),
						},
						"Cancel",
					),
				),
			),
		);
	}

	// Keyboard: Enter saves, Esc cancels; in the note field Cmd/Ctrl+Enter saves
	attachEditKeys(row, todo) {
		const text = row.querySelector("#edit-text");
		const note = row.querySelector("#edit-note");
		const save = () => this.saveEdit(todo.id);
		const cancel = () => this.cancelEdit();
		text.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				save();
			} else if (e.key === "Escape") cancel();
		});
		note.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
			else if (e.key === "Escape") cancel();
		});
	}

	editTodo(id) {
		this.editingId = id;
		this.renderList();
		this.root.querySelector("#edit-text")?.focus();
	}

	async saveEdit(id) {
		const todo = this.todos.find((t) => t.id === id);
		if (!todo) return;
		const text = this.root.querySelector("#edit-text")?.value.trim();
		if (!text) return;
		todo.text = text;
		todo.note = this.root.querySelector("#edit-note")?.value.trim() ?? "";
		this.editingId = null;
		await this.save();
	}

	cancelEdit() {
		this.editingId = null;
		this.renderList();
	}

	footer() {
		const done = this.todos.filter((t) => t.done).length;
		return h(
			"div",
			{
				class:
					"flex items-center justify-between border-t border-border px-[10px] py-[6px]",
			},
			h(
				"span",
				{ class: "font-mono text-[11px] text-muted-foreground" },
				`${done}/${this.todos.length} done`,
			),
			h(
				"button",
				{
					type: "button",
					class: cls(
						"flex h-6 items-center gap-[4px] rounded-[4px] px-[6px] text-[11px] font-medium outline-none transition-colors",
						done
							? "text-muted-foreground hover:bg-accent hover:text-foreground"
							: "cursor-default text-muted-foreground/40",
					),
					disabled: done === 0,
					onclick: () => this.clearCompleted(),
				},
				icon("trash-2", 12),
				"Clear completed",
			),
		);
	}
}
