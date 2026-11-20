/* Demo harness: a fake `window.muxy` with invented data, so Workdeck's real pages can be rendered in a plain browser
 * for README screenshots without any personal project, repository, issue or chat. Not loaded by the extension itself. */
(() => {
  const Q = new URLSearchParams(location.search);
  const DEMO = { page: Q.get("page") || "", scenario: Q.get("scenario") || "" };
  window.__DEMO__ = DEMO;

  /* While iterating on the demo, script errors are printed on the page itself (add &quiet=1 to hide them). */
  if (!Q.get("quiet")) {
    const banner = (m) => { const d = document.createElement("div"); d.style.cssText = "position:fixed;z-index:99999;left:0;right:0;bottom:0;background:#7a1f1f;color:#fff;padding:6px 10px;font:12px monospace;white-space:pre-wrap"; d.textContent = "DEMO ERROR (" + DEMO.page + "): " + m; (document.body || document.documentElement).append(d); };
    window.addEventListener("error", (e) => banner(e.message + " @ " + String(e.filename || "").split("/").pop() + ":" + e.lineno));
    window.addEventListener("unhandledrejection", (e) => banner("promise: " + ((e.reason && e.reason.message) || e.reason)));
  }

  /* ---- Muxy's theme variables (the host injects these inside Muxy) ---- */
  const theme = document.createElement("style");
  theme.textContent = `:root{--muxy-background:#1c1c1e;--muxy-foreground:#f2f2f7;--muxy-foreground-muted:#9a9aa3;--muxy-surface:#2a2a2d;--muxy-surface-solid:#2a2a2d;--muxy-border:#3d3d42;--muxy-hover:rgba(255,255,255,.07);--muxy-accent:#4c9aff;--muxy-accent-soft:rgba(76,154,255,.2);--muxy-accent-foreground:#fff;color-scheme:dark}`;
  document.head.append(theme);

  /* ---- invented workspace ---- */
  const H = "/Users/demo";
  const P = (id, name, path, extra = {}) => ({ id, name, path, isActive: false, worktreesEnabled: true, sortOrder: 0, iconColor: "#808080", icon: null, logo: null, ...extra });
  const projects = [
    P("home", "Home", H, { worktreesEnabled: false }),
    P("web", "acme-web", H + "/work/acme/acme-web", { isActive: true, iconColor: "#4c9aff" }),
    P("api", "acme-api", H + "/work/acme/acme-api", { iconColor: "#30d158" }),
    P("mobile", "acme-mobile", H + "/work/acme/acme-mobile", { iconColor: "#bf5af2" }),
    P("infra", "acme-infra", H + "/work/acme/acme-infra", { iconColor: "#ff9f0a" }),
    P("ds", "design-system", H + "/work/acme-libs/design-system", { iconColor: "#ff375f" }),
    P("icons", "icons", H + "/work/acme-libs/icons", { iconColor: "#febc2e" }),
    P("notes", "notes-app", H + "/side/notes-app", { iconColor: "#0a84ff" }),
    P("blog", "blog", H + "/side/blog", { iconColor: "#8e8e93" }),
    P("dots", "dotfiles", H + "/side/dotfiles", { iconColor: "#64d2ff" }),
  ];
  const workspaces = [{ id: "ws1", name: "Acme Platform", isActive: true }, { id: "ws2", name: "Side Projects", isActive: false }];
  const members = [{ id: "ws1", name: "Acme Platform", projects: ["web", "api", "mobile", "infra", "ds", "icons"] }, { id: "ws2", name: "Side Projects", projects: ["notes", "blog", "dots"] }];
  const branches = { web: "feat/checkout-redesign", api: "main", mobile: "develop", infra: "main", ds: "main", icons: "main", notes: "main", blog: "main", dots: "main" };
  const worktrees = {
    web: [{ id: "web", path: projects[1].path, branch: "feat/checkout-redesign", isActive: true, name: "acme-web" }, { id: "web-wt1", path: H + "/work/acme/acme-web-worktrees/fix-cart", branch: "fix/cart-rounding", isActive: false, name: "fix/cart-rounding" }],
  };
  const tabs = {
    web: [
      { id: "t1", title: "npm run dev", customTitle: null, kind: "terminal", isPinned: true, color: null, paneIDs: ["pane-dev"] },
      { id: "t2", title: "Checkout flow — payment step", customTitle: null, kind: "terminal", isPinned: false, color: "#4c9aff", paneIDs: ["pane-claude"] },
      { id: "t3", title: "Issues", customTitle: null, kind: "extensionWebView", isPinned: false, color: null, paneIDs: [] },
    ],
    api: [{ id: "t4", title: "Fix webhook retries", customTitle: null, kind: "terminal", isPinned: false, color: null, paneIDs: ["pane-codex"] }],
    notes: [{ id: "t5", title: "Sync engine refactor", customTitle: null, kind: "terminal", isPinned: false, color: null, paneIDs: ["pane-oc"] }],
  };
  const agents = [
    { projectID: "web", worktreeID: "web", paneID: "pane-claude", providerID: "claude", status: "working" },
    { projectID: "api", worktreeID: "api", paneID: "pane-codex", providerID: "codex", status: "waiting" },
    { projectID: "notes", worktreeID: "notes", paneID: "pane-oc", providerID: "opencode", status: "idle" },
  ];
  const servers = [{ id: "s1", name: "build-box", ssh: "ci@build-box.example.net" }, { id: "s2", name: "staging", ssh: "deploy@staging.example.net" }];

  /* ---- storage (seeded with sidebar memory) ---- */
  const store = {
    state: { collapsed: {}, kinds: { ds: { kind: "repo", root: H + "/work/acme-libs" }, icons: { kind: "repo", root: H + "/work/acme-libs" } }, expanded: { web: true }, sizes: {}, showIdle: true, serverTabs: {}, managerTabs: {} },
    createSource: "linear",
  };

  /* ---- GitHub (invented repository acme-co/<name>) ---- */
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const lbl = (name, color) => ({ name, color });
  const ghIssues = [
    { number: 482, title: "Checkout total is off by one cent with 3+ discounts", state: "OPEN", labels: [lbl("bug", "d73a4a"), lbl("checkout", "0e8a16")], assignees: [{ login: "mira" }], author: { login: "devon" }, updatedAt: ago(35), comments: [{}, {}, {}] },
    { number: 479, title: "Add Apple Pay to the payment step", state: "OPEN", labels: [lbl("feature", "a2eeef")], assignees: [], author: { login: "mira" }, updatedAt: ago(190), comments: [{}] },
    { number: 475, title: "Cart badge flickers when quantity changes quickly", state: "OPEN", labels: [lbl("bug", "d73a4a"), lbl("ui", "5319e7")], assignees: [{ login: "sam" }], author: { login: "sam" }, updatedAt: ago(60 * 20), comments: [] },
    { number: 468, title: "Document the shipping-rate cache invalidation", state: "OPEN", labels: [lbl("docs", "0075ca")], assignees: [], author: { login: "lee" }, updatedAt: ago(60 * 52), comments: [{}, {}] },
    { number: 461, title: "Search results ignore the in-stock filter", state: "OPEN", labels: [lbl("bug", "d73a4a")], assignees: [{ login: "devon" }], author: { login: "alex" }, updatedAt: ago(60 * 90), comments: [{}] },
    { number: 455, title: "Migrate form validation to the shared schema package", state: "OPEN", labels: [lbl("tech-debt", "fbca04")], assignees: [], author: { login: "mira" }, updatedAt: ago(60 * 130), comments: [] },
  ];
  const ghIssueView = (n) => {
    const i = ghIssues.find((x) => x.number === n) || ghIssues[0];
    return { ...i, createdAt: ago(60 * 30), url: `https://github.com/acme-co/acme-web/issues/${i.number}`,
      body: "## What happens\nWhen an order has three or more stacked discounts the **total is one cent higher** than the sum of the line items.\n\n## Steps\n1. Add two items to the cart\n2. Apply `WELCOME10`, `FREESHIP` and a loyalty reward\n3. Open the payment step\n\n## Expected\nTotal equals the sum of the rounded line totals.\n\n- [ ] Reproduce with a unit test\n- [ ] Round once, at the end",
      comments: [{ author: { login: "mira" }, createdAt: ago(60 * 3), body: "Reproduced locally. The discount engine rounds after every step instead of once at the end." }, { author: { login: "devon" }, createdAt: ago(40), body: "I'll take this one. Plan: carry cents as integers until the final total." }] };
  };
  const chk = (name, status, conclusion) => ({ __typename: "CheckRun", name, status, conclusion });
  const prList = [
    { number: 491, title: "Redesign the checkout payment step", author: { login: "devon" }, headRefName: "feat/checkout-redesign", baseRefName: "develop", isDraft: false, reviewDecision: "REVIEW_REQUIRED", updatedAt: ago(12), url: "https://github.com/acme-co/acme-web/pull/491", labels: [lbl("checkout", "0e8a16")], statusCheckRollup: [chk("build", "COMPLETED", "SUCCESS"), chk("unit", "COMPLETED", "SUCCESS"), chk("e2e", "IN_PROGRESS", null)] },
    { number: 489, title: "Fix cart rounding for stacked discounts", author: { login: "mira" }, headRefName: "fix/cart-rounding", baseRefName: "develop", isDraft: false, reviewDecision: "APPROVED", updatedAt: ago(95), url: "https://github.com/acme-co/acme-web/pull/489", labels: [lbl("bug", "d73a4a")], statusCheckRollup: [chk("build", "COMPLETED", "SUCCESS"), chk("unit", "COMPLETED", "SUCCESS"), chk("e2e", "COMPLETED", "SUCCESS")] },
    { number: 487, title: "Upgrade the date picker and drop moment", author: { login: "sam" }, headRefName: "chore/date-picker", baseRefName: "develop", isDraft: true, reviewDecision: "", updatedAt: ago(60 * 7), url: "https://github.com/acme-co/acme-web/pull/487", labels: [], statusCheckRollup: [chk("build", "COMPLETED", "FAILURE")] },
    { number: 484, title: "Release 2.14: cut develop into main", author: { login: "lee" }, headRefName: "develop", baseRefName: "main", isDraft: false, reviewDecision: "CHANGES_REQUESTED", updatedAt: ago(60 * 30), url: "https://github.com/acme-co/acme-web/pull/484", labels: [lbl("release", "bfd4f2")], statusCheckRollup: [chk("build", "COMPLETED", "SUCCESS"), chk("unit", "COMPLETED", "SUCCESS"), chk("e2e", "COMPLETED", "FAILURE")] },
  ];
  const diffText = `diff --git a/src/checkout/PaymentStep.tsx b/src/checkout/PaymentStep.tsx
--- a/src/checkout/PaymentStep.tsx
+++ b/src/checkout/PaymentStep.tsx
@@ -12,18 +12,31 @@ export function PaymentStep({ order }: Props) {
-  const total = order.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
+  const totalCents = order.lines.reduce((sum, l) => sum + toCents(l.price) * l.qty, 0);
+  const discounted = applyDiscounts(totalCents, order.discounts);
   return (
     <section className="payment">
-      <h2>Payment</h2>
-      <CardForm onSubmit={pay} />
+      <h2>Pay securely</h2>
+      <WalletButtons total={discounted} />
+      <CardForm onSubmit={pay} total={discounted} />
+      <OrderSummary lines={order.lines} total={discounted} />
     </section>
   );
 }
diff --git a/src/checkout/money.ts b/src/checkout/money.ts
--- a/src/checkout/money.ts
+++ b/src/checkout/money.ts
@@ -1,6 +1,14 @@
+export const toCents = (v: number) => Math.round(v * 100);
+export const fromCents = (c: number) => c / 100;
+
 export function applyDiscounts(cents: number, discounts: Discount[]) {
-  return discounts.reduce((c, d) => Math.round(c * (1 - d.rate)), cents);
+  // round once at the end so stacked discounts do not drift
+  const rate = discounts.reduce((r, d) => r * (1 - d.rate), 1);
+  return Math.round(cents * rate);
 }`;
  const prView = (n) => {
    const p = prList.find((x) => x.number === n) || prList[0];
    return { ...p, body: "Reworks the payment step:\n\n- Wallet buttons above the card form\n- Order summary next to the form\n- Totals are calculated in integer cents\n\nCloses #482.", state: "OPEN", mergeable: "MERGEABLE", createdAt: ago(60 * 20), additions: 142, deletions: 38, changedFiles: 6,
      reviews: [{ author: { login: "mira" }, state: "COMMENTED", body: "Looks good overall. Can we add a test for three stacked discounts?", submittedAt: ago(60 * 2) }],
      comments: [{ author: { login: "devon" }, body: "Added the test in the last commit.", createdAt: ago(50) }],
      files: [{ path: "src/checkout/PaymentStep.tsx", additions: 41, deletions: 12 }, { path: "src/checkout/money.ts", additions: 18, deletions: 3 }, { path: "src/checkout/OrderSummary.tsx", additions: 52, deletions: 0 }, { path: "src/checkout/WalletButtons.tsx", additions: 24, deletions: 0 }, { path: "src/checkout/__tests__/money.test.ts", additions: 7, deletions: 0 }] };
  };
  const runs = [
    { databaseId: 9001, displayTitle: "Redesign the checkout payment step", status: "in_progress", conclusion: null, headBranch: "feat/checkout-redesign", workflowName: "CI", event: "pull_request", createdAt: ago(6), url: "#" },
    { databaseId: 9000, displayTitle: "Fix cart rounding for stacked discounts", status: "completed", conclusion: "success", headBranch: "fix/cart-rounding", workflowName: "CI", event: "pull_request", createdAt: ago(100), url: "#" },
    { databaseId: 8998, displayTitle: "Merge pull request #488 from acme-co/fix/typo", status: "completed", conclusion: "success", headBranch: "develop", workflowName: "Deploy staging", event: "push", createdAt: ago(60 * 5), url: "#" },
    { databaseId: 8990, displayTitle: "Upgrade the date picker and drop moment", status: "completed", conclusion: "failure", headBranch: "chore/date-picker", workflowName: "CI", event: "pull_request", createdAt: ago(60 * 8), url: "#" },
    { databaseId: 8985, displayTitle: "Release 2.13", status: "completed", conclusion: "success", headBranch: "main", workflowName: "Deploy production", event: "push", createdAt: ago(60 * 48), url: "#" },
  ];
  const jobs = { jobs: [
    { name: "build", status: "completed", conclusion: "success", steps: [{ name: "Checkout", status: "completed", conclusion: "success", number: 1 }, { name: "Install", status: "completed", conclusion: "success", number: 2 }, { name: "Build", status: "completed", conclusion: "success", number: 3 }] },
    { name: "e2e", status: "in_progress", conclusion: null, steps: [{ name: "Checkout", status: "completed", conclusion: "success", number: 1 }, { name: "Run browser tests", status: "in_progress", conclusion: null, number: 2 }, { name: "Upload report", status: "queued", conclusion: null, number: 3 }] },
  ] };
  const ghHandler = (a) => {
    const j = (v) => ({ exitCode: 0, stdout: JSON.stringify(v), stderr: "" });
    const [c, s] = a;
    if (c === "issue" && s === "list") return j(ghIssues);
    if (c === "issue" && s === "view") return j(ghIssueView(+a[2]));
    if (c === "label") return j([lbl("bug", "d73a4a"), lbl("feature", "a2eeef"), lbl("docs", "0075ca"), lbl("ui", "5319e7"), lbl("checkout", "0e8a16")]);
    if (c === "pr" && s === "list") return a.includes("merged") || a.includes("all") ? j([{ number: 480, headRefName: "feat/wishlist", baseRefName: "develop", headRefOid: "a1" }, { number: 476, headRefName: "fix/footer-links", baseRefName: "develop", headRefOid: "b2" }, { number: 491, headRefName: "feat/checkout-redesign", baseRefName: "develop", headRefOid: "c3" }, { number: 489, headRefName: "fix/cart-rounding", baseRefName: "develop", headRefOid: "d4" }]) : j(prList);
    if (c === "pr" && s === "view") return j(prView(+a[2]));
    if (c === "pr" && s === "diff") return { exitCode: 0, stdout: diffText, stderr: "" };
    if (c === "run" && s === "list") return j(runs);
    if (c === "run" && s === "view") return a.includes("--log-failed") ? { exitCode: 0, stdout: "e2e\tRun tests\tError: expected total 41.97 but received 41.98\ne2e\tRun tests\t  at checkout.spec.ts:58:12", stderr: "" } : j(jobs);
    if (c === "workflow") return j([{ id: 1, name: "CI", state: "active", path: ".github/workflows/ci.yml" }, { id: 2, name: "Deploy staging", state: "active", path: ".github/workflows/staging.yml" }, { id: 3, name: "Deploy production", state: "active", path: ".github/workflows/prod.yml" }, { id: 4, name: "Nightly audit", state: "disabled_manually", path: ".github/workflows/audit.yml" }]);
    if (c === "repo") return j({ defaultBranchRef: { name: "main" } });
    if (c === "release") return j([{ tagName: "v2.13.0", name: "2.13.0", publishedAt: ago(60 * 48), isLatest: true, isPrerelease: false, isDraft: false }, { tagName: "v2.13.0-rc.1", name: "2.13.0 RC1", publishedAt: ago(60 * 80), isLatest: false, isPrerelease: true, isDraft: false }, { tagName: "v2.12.2", name: "2.12.2", publishedAt: ago(60 * 24 * 12), isLatest: false, isPrerelease: false, isDraft: false }]);
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  /* ---- Linear (invented team ACM) ---- */
  const st = (id, name, type, color, position) => ({ id, name, type, color, position });
  const states = [st("s1", "Backlog", "backlog", "#bec2c8", 0), st("s2", "Todo", "unstarted", "#e2e2e2", 1), st("s3", "In Progress", "started", "#f2c94c", 2), st("s4", "In Review", "started", "#0f783c", 3), st("s5", "Done", "completed", "#5e6ad2", 4), st("s6", "Canceled", "canceled", "#95a2b3", 5)];
  const team = { id: "t1", key: "ACM", name: "Acme" };
  const lp = [{ id: "lp1", name: "acme-web", state: "started", teams: { nodes: [team] } }, { id: "lp2", name: "acme-api", state: "started", teams: { nodes: [team] } }, { id: "lp3", name: "Mobile app", state: "planned", teams: { nodes: [team] } }, { id: "lp4", name: "Design system", state: "started", teams: { nodes: [team] } }, { id: "lp5", name: "Platform reliability", state: "started", teams: { nodes: [team] } }];
  const li = (n, title, state, who, parent, prio = "Medium", mins = 120) => ({ id: "li" + n, identifier: "ACM-" + n, title, url: "https://linear.app/acme/issue/ACM-" + n, updatedAt: ago(mins), priorityLabel: prio, state, team, assignee: who ? { name: who } : null, project: { id: "lp1", name: "acme-web" }, parent: parent || null });
  const par = { id: "li120", identifier: "ACM-120", title: "Checkout redesign", };
  const lIssues = [
    li(120, "Checkout redesign", states[2], "Devon Park", null, "High", 20),
    li(121, "Wallet buttons on the payment step", states[2], "Devon Park", par, "High", 25),
    li(122, "Order summary beside the card form", states[3], "Mira Cho", par, "Medium", 80),
    li(123, "Integer-cent totals", states[1], null, par, "High", 150),
    li(124, "Checkout e2e coverage", states[0], null, par, "Low", 300),
    li(131, "Cart badge flicker on rapid quantity changes", states[1], "Sam Lee", null, "Medium", 400),
    li(137, "Search ignores the in-stock filter", states[2], "Alex Kim", null, "High", 900),
  ];
  const linearHandler = (q, v) => {
    if (/viewer/.test(q)) return { viewer: { id: "u1" } };
    if (/teams\s*\{\s*nodes/.test(q) && !/states/.test(q)) return { teams: { nodes: [team] } };
    if (/projects\(first/.test(q)) return { projects: { nodes: lp, pageInfo: { hasNextPage: false, endCursor: null } } };
    if (/team\(id/.test(q) && /states/.test(q) && !/issue\(id/.test(q)) return { team: { states: { nodes: states } } };
    if (/issues\(first/.test(q)) return { issues: { nodes: lIssues } };
    if (/issue\(id/.test(q)) {
      const i = lIssues.find((x) => x.id === v.id) || lIssues[0];
      const kids = i.id === "li120" ? lIssues.filter((x) => x.parent).map((x) => ({ id: x.id, identifier: x.identifier, title: x.title, description: "", url: x.url, state: x.state, assignee: x.assignee })) : [];
      return { issue: { ...i, description: "## Goal\nShip the redesigned payment step behind a flag.\n\n## Scope\n- Wallet buttons (Apple Pay, Google Pay)\n- Order summary next to the form\n- Totals in integer cents\n\n## Done when\n- [ ] QA signs off on iOS and Android\n- [ ] Conversion dashboard shows no regression", createdAt: ago(60 * 24 * 6), comments: { nodes: [{ id: "c1", body: "Design is final. Figma link in the project.", createdAt: ago(60 * 24 * 2), user: { name: "Mira Cho" } }] }, team: { ...team, states: { nodes: states } }, children: { nodes: kids } } };
    }
    return {};
  };

  /* ---- KakaoToLinear CLI (invented chat) ---- */
  const rooms = [
    { id: "r1", title: "Acme Support", lastActivityAt: ago(8), participantNames: ["Jordan"] },
    { id: "r2", title: "Product Team", lastActivityAt: ago(45), participantNames: [] },
    { id: "r3", title: "QA Channel", lastActivityAt: ago(60 * 3), participantNames: [] },
    { id: "r4", title: "Design Review", lastActivityAt: ago(60 * 9), participantNames: [] },
    { id: "r5", title: "Ops Alerts", lastActivityAt: ago(60 * 30), participantNames: [] },
    { id: "r6", title: "Dev Chat", lastActivityAt: ago(60 * 52), participantNames: [] },
  ];
  const mkMsg = (i, min, name, text, mine = false, extra = {}) => ({ id: "m" + i, roomId: "r1", senderId: mine ? "me" : "u" + name, senderName: name, timestamp: ago(min), type: "text", text, attachments: [], isMine: mine, ...extra });
  const chat = [
    mkMsg(1, 95, "Jordan", "Hi! The order total in checkout looks wrong on mobile."),
    mkMsg(2, 94, "Jordan", "It shows one cent more than the receipt."),
    mkMsg(3, 92, "Me", "Thanks Jordan, which discounts were applied?", true),
    mkMsg(4, 90, "Jordan", "Welcome code, free shipping and my loyalty reward."),
    mkMsg(5, 89, "Jordan", "", false, { type: "image", attachments: [{ id: "att1", messageId: "m5", kind: "image", fullAvailable: true }] }),
    mkMsg(6, 70, "Me", "Got it. Is it the same on desktop?", true),
    mkMsg(7, 66, "Jordan", "Desktop is fine, only the mobile web version.", false, { replyQuoteText: "Is it the same on desktop?", replyAuthorName: "Me" }),
  ];
  const klHandler = (a, stdin) => {
    const j = (v) => ({ exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, data: v }), stderr: "" });
    const [c, s] = a;
    if (c === "rooms" && s === "list") return j(rooms);
    if (c === "rooms" && s === "favorites") return j([rooms[0], rooms[3]]);
    if (c === "rooms") return j({ roomId: "r1", isFavorite: true });
    if (c === "messages") return j(chat);
    if (c === "ai" && s === "providers") return j([{ id: "codex-subscription", name: "GPT · ChatGPT/Codex Plan" }, { id: "alibaba-token-plan", name: "Alibaba Token Plan" }, { id: "opencode-free", name: "OpenCode Free" }, { id: "litellm", name: "LiteLLM" }]);
    if (c === "ai" && s === "models") return j([{ id: "auto", name: "auto" }, { id: "fast-model", name: "fast-model" }, { id: "deep-model", name: "deep-model" }]);
    if (c === "source") return j({ sourceId: "src_demo", messageCount: 7, attachmentCount: 1, attachmentFailureCount: 0 });
    if (c === "compose" || c === "revise") return j(draft);
    if (c === "linear" && s === "create") return j({ draftId: "d1", title: draft.title, description: draftMd(), options: {}, attachmentNames: ["IMG_0412.jpg"], id: "x", identifier: "ACM-140", url: "https://linear.app/acme/issue/ACM-140" });
    return j({});
  };
  const draft = { id: "draft_demo", sourceId: "src_demo", title: "Mobile checkout total is 1 cent higher than the receipt", summary: "A customer reports that on mobile web the checkout total is one cent higher than the receipt when several discounts are stacked. Desktop is not affected.",
    requirements: ["Make the mobile web checkout total match the receipt", "Round once at the end when several discounts are applied"], acceptanceCriteria: ["Welcome code + free shipping + loyalty reward gives the same total as the receipt on mobile web", "Desktop checkout totals stay unchanged"], notes: ["The attached screenshot shows the payment step on a phone"], questions: ["Which mobile browsers were used?"], sourceMessageIds: ["m1", "m2", "m4", "m7"] };
  const draftMd = () => `${draft.summary}\n\n## Requirements\n${draft.requirements.map((x) => "- " + x).join("\n")}\n\n## Acceptance criteria\n${draft.acceptanceCriteria.map((x) => "- " + x).join("\n")}\n\n## Notes\n${draft.notes.map((x) => "- " + x).join("\n")}\n\n## Open questions\n${draft.questions.map((x) => "- " + x).join("\n")}\n\n---\n\n## Original request\n> **Jordan** Hi! The order total in checkout looks wrong on mobile.\n`;
  const demoPhoto = () => {
    const c = document.createElement("canvas"); c.width = 360; c.height = 220; const g = c.getContext("2d");
    g.fillStyle = "#f5f6f8"; g.fillRect(0, 0, 360, 220); g.fillStyle = "#fff"; g.fillRect(14, 14, 332, 192);
    g.fillStyle = "#222"; g.font = "bold 15px sans-serif"; g.fillText("Order summary", 28, 44);
    g.font = "13px sans-serif"; g.fillStyle = "#555"; g.fillText("Subtotal", 28, 74); g.fillText("$44.00", 280, 74); g.fillText("Welcome10", 28, 98); g.fillText("-$4.40", 280, 98); g.fillText("Free shipping", 28, 122); g.fillText("$0.00", 280, 122);
    g.fillStyle = "#222"; g.font = "bold 14px sans-serif"; g.fillText("Total", 28, 160); g.fillText("$39.61", 270, 160);
    g.strokeStyle = "#e5484d"; g.lineWidth = 2.5; g.strokeRect(262, 142, 76, 26);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  /* ---- branch cleanup scan (the script prints ##-tagged lines) ---- */
  const cleanupScan = () => {
    const d = (m) => new Date(Date.now() - m * 60000).toISOString();
    const oid = (x) => x.repeat(40).slice(0, 40);
    const L = [
      ["develop", "a", "feat/wishlist", 60 * 24 * 3], ["develop", "b", "fix/footer-links", 60 * 24 * 5], ["main", "c", "chore/bump-deps", 60 * 24 * 11], ["develop", "d", "feat/coupon-banner", 60 * 24 * 14],
    ];
    let out = "##CUR feat/checkout-redesign\n##WT fix/cart-rounding\n##BASE main " + oid("1") + "\n##BASE develop " + oid("2") + "\n";
    for (const [b, o, n, m] of L) out += `##L ${b} ${oid(o)} ${d(m)} ${n}\n`;
    for (const [b, o, n, m] of L.slice(0, 3)) out += `##R ${b} ${oid(o)} ${d(m)} ${n}\n`;
    out += `##R develop ${oid("e")} ${d(60 * 24 * 21)} feat/legacy-export\n##L develop ${oid("f")} ${d(60 * 24 * 2)} fix/cart-rounding\n`;
    out += `##AL ${oid("a")} ${d(60 * 24 * 3)} feat/wishlist\n##AR ${oid("a")} ${d(60 * 24 * 3)} feat/wishlist\n`;
    return out;
  };

  /* ---- Muxy CLI: activity / sessions ---- */
  const sessions = [{ id: "6001", project_id: "web", directory: projects[1].path, status: "Live" }, { id: "6002", project_id: "api", directory: projects[2].path, status: "Live" }, { id: "6003", project_id: "notes", directory: projects[7].path, status: "Live" }];
  const screens = {
    6001: "● I'll make totals integer-cent based. First, let me look at how discounts are applied.\n\n  Read 3 files\n\n● The discount engine rounds after every step. I'll compute the combined rate once and round at the end:\n\n  - `applyDiscounts` now multiplies the rates\n  - `toCents` / `fromCents` helpers added\n\n⏺ Update(src/checkout/money.ts)\n  ⎿ Updated src/checkout/money.ts with 8 additions and 2 removals\n\n● Running the unit tests…\n\n  ⎿ $ npm test -- money\n     PASS  src/checkout/__tests__/money.test.ts (6 tests)\n\n✻ Cogitating… (42s · ↓ 3.1k tokens)\n\n❯\n⏵⏵ auto mode on · esc to interrupt",
    6002: "● The webhook handler retries without backoff. I'd like to add exponential backoff with jitter.\n\n  Do you want to proceed?\n\n  ❯ 1. Yes\n    2. Yes, and don't ask again for npm test commands\n    3. No, and tell Codex what to do differently (esc)\n\n  Edit file src/webhooks/retry.ts",
    6003: "● Refactor of the sync engine is done. All 48 tests pass.\n\n✻ Brewed for 6m 12s · done 10:42 AM\n\n❯\n⏵⏵ auto mode on",
  };
  const muxyCLI = (a, stdin) => {
    const j = (v) => ({ exitCode: 0, stdout: JSON.stringify(v), stderr: "" });
    if (a[0] === "config" && a[1] === "get" && a[2] === "servers") return j(servers);
    if (a[0] === "config" && a[1] === "get") return j("workdeck");
    if (a[0] === "extension" && a[1] === "list") return j({ extensions: [{ name: "workdeck", enabled: true, path: "/ext/workdeck" }], load_errors: [] });
    if (a[0] === "activity" && a[1] === "list") return j({ revision: 1, agents: [{ session: "6001", project: "web", provider: "Claude", state: "working" }, { session: "6002", project: "api", provider: "Codex", state: "waiting" }, { session: "6003", project: "notes", provider: "OpenCode", state: "idle" }], events: DEMO.scenario === "alert" ? [{ id: "e1", session: "6003", event: "Finished: sync engine refactor" }] : [] });
    if (a[0] === "session" && a[1] === "list") return j(sessions);
    if (a[0] === "session" && a[1] === "read-screen") return { exitCode: 0, stdout: screens[a[2]] || "", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  /* ---- notes: files under the notes folder, answered for the fixed shell commands in notes/store.js ---- */
  const nh = (meta) => `<!-- workdeck-note ${JSON.stringify({ v: 1, ...meta })} -->`;
  const notes = {
    "proj-acme-web/20261117-checkout-redesign-n1a2b3.md": { mtime: 1795017900, text: [
      nh({ id: "n1a2b3", scope: "proj:web", scopeName: "acme-web", created: "2026-11-17 10:05" }), "# Checkout redesign", "",
      "## 2026-11-17 10:12 · m1", "Payment step: keep saved cards above the new-card form. Ask design about the empty state when there are no saved cards.", "",
      "## 2026-11-17 14:40 · m2", "Why do totals sometimes differ by one cent from the API?",
      `<!-- thread ${JSON.stringify({ agent: "Claude Code", state: "done", summary: "- The cart rounds each line, the API rounds the sum after tax\n- Fix: round once, after tax, in `cart/totals.ts`\n- Add a test with 3 × 0.335 and a 10% coupon\n- Ask the API team whether invoices use the same rule", msgs: [{ x: "why do cart totals differ by a cent?" }, { x: "where would you fix it?" }] })} -->`, "",
      "## 2026-11-18 09:30 · m3", "Rounding fix filed as an issue; pairing with Mina on the test cases.",
      `<!-- issue ${JSON.stringify({ label: "ACM-143", url: "https://linear.app/acme/issue/ACM-143" })} -->`, "",
      "## 2026-11-18 16:05 · m4", "Release notes: mention the new address autocomplete and the faster card form.", "",
    ].join("\n") },
    "ws-acme-platform/20261118-platform-sync-n4d5e6.md": { mtime: 1794994800, text: [
      nh({ id: "n4d5e6", scope: "ws:ws1", scopeName: "Acme Platform", created: "2026-11-18 11:00" }), "# Platform sync — Nov 18", "",
      "## 2026-11-18 11:02 · m5", "Webhook retries: back off up to 1 h, then alert the on-call channel.", "",
      "## 2026-11-18 11:20 · m6", "Staging database upgrade moves to Thursday night.", "",
    ].join("\n") },
    "global/quick.md": { mtime: 1794928300, text: [
      nh({ id: "n7f8g9", scope: "global", scopeName: "", created: "2026-11-16 08:40" }), "# Quick notes", "",
      "## 2026-11-16 08:41 · m7", "Renew the code-signing certificate before Dec 3.", "",
      "## 2026-11-17 18:12 · m8", "Try the new terminal font at 13 px.", "",
    ].join("\n") },
    "proj-acme-api/20261115-webhook-retries-n0h1i2.md": { mtime: 1794841500, text: [
      nh({ id: "n0h1i2", scope: "proj:api", scopeName: "acme-api", created: "2026-11-15 15:00" }), "# Webhook retries", "",
      "## 2026-11-15 15:04 · m9", "Retries pile up when the partner endpoint is down; dedupe by event id.", "",
      "## 2026-11-15 15:25 · m10", "Check how long the partner keeps failed deliveries before giving up.", "",
    ].join("\n") },
  };
  const notesShell = (sh, env) => {
    const f = env.NOTES_FILE || "";
    if (sh.includes("-maxdepth 3")) return Object.entries(notes).map(([file, n]) => `${file}\t${n.mtime}\t${(n.text.match(/^## \d/gm) || []).length}\t${n.text.slice(0, 700).replace(/\n/g, "\x01")}`).join("\n") + "\n";
    if (sh.includes('echo "$R/$NOTES_FILE"')) return `${H}/.workdeck/notes/${f}\n`;
    if (sh.endsWith('cat "$R/$NOTES_FILE"')) return notes[f] ? notes[f].text : null;
    return "";
  };

  const base = (p) => String(p).replace(/\/+$/, "").split("/").pop();
  const exec = async (arg, opts = {}) => {
    if (Array.isArray(arg)) {
      const bin = base(arg[0]), a = arg.slice(1);
      if (bin === "gh") return ghHandler(a);
      if (bin === "muxy") return muxyCLI(a, opts.stdin);
      if (bin === "kakao-linear") return klHandler(a, opts.stdin);
      if (bin === "git") return a.includes("get-url") ? { exitCode: 0, stdout: `https://github.com/acme-co/${base(a[1])}.git\n`, stderr: "" } : { exitCode: 0, stdout: "", stderr: "" };
      if (bin === "plutil") return { exitCode: 0, stdout: JSON.stringify({ id: "main", title: "Workdeck" }), stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    const sh = arg.shell || "";
    opts = { ...arg, ...opts }; // object form: { shell, stdin, timeoutMs }
    if (opts.env && "NOTES_ROOT" in opts.env) { const out = notesShell(sh, opts.env); return out == null ? { exitCode: 1, stdout: "", stderr: "no such note" } : { exitCode: 0, stdout: out, stderr: "" }; }
    if (sh.includes("desktop-state.json")) return { exitCode: 0, stdout: JSON.stringify(members) + "\n" + H + "\n", stderr: "" };
    if (sh.includes("api.linear.app")) { const body = JSON.parse(opts.stdin || "{}"); return { exitCode: 0, stdout: JSON.stringify({ data: linearHandler(body.query, body.variables || {}) }), stderr: "" }; }
    if (sh.includes("##CUR")) return { exitCode: 0, stdout: cleanupScan(), stderr: "" };
    if (sh.includes("command -v kakao-linear")) return { exitCode: 0, stdout: H + "/.local/bin/kakao-linear\n", stderr: "" };
    if (sh.includes("mktemp -d /tmp/mxkl")) return { exitCode: 0, stdout: "att1\t" + demoPhoto() + "\n", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  /* ---- the fake muxy object; unknown calls resolve to nothing instead of throwing ---- */
  const noop = async () => undefined;
  const fallback = (path) => new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : fallback(path + "." + String(k))), apply: async () => undefined });
  const api = {
    extensionID: "workdeck", data: JSON.parse(Q.get("data") || "null") || { name: "acme-web", path: projects[1].path },
    projects: { list: async () => projects, switchTo: noop, sort: noop, reorder: noop, attach: noop, detach: noop, rename: noop, add: noop, delete: noop },
    workspaces: { list: async () => workspaces, create: noop, rename: noop, delete: noop, switchTo: noop },
    worktrees: { list: async (id) => worktrees[id] || [{ id, path: (projects.find((p) => p.id === id) || {}).path, branch: branches[id], isActive: false, name: id }], switchTo: noop },
    git: { currentBranch: async ({ project }) => branches[project] || null },
    tabs: { list: async ({ project } = {}) => tabs[project] || [], open: async () => "tab-new", close: noop, switchTo: noop, move: noop, setTitle: noop, rename: noop, pin: noop, new: noop },
    agents: { list: async () => agents, focus: noop },
    storage: { get: async (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : null), set: async (k, v) => { store[k] = v; }, delete: noop, keys: async () => Object.keys(store) },
    events: { subscribe: () => () => {}, unsubscribe: noop },
    commands: { run: noop, list: async () => [] },
    ui: { state: async () => ({}), openSettings: noop },
    dialog: { alert: noop, confirm: async () => false, prompt: async () => null },
    modal: { open: async () => null, openWebview: async () => null, closeWebview: noop, submitWebview: noop },
    popover: { close: noop, resize: noop },
    app: { openExternal: noop, info: async () => ({ language: "" }) },
    clipboard: { writeText: noop },
    exec,
    onFocus: () => {},
  };
  window.muxy = new Proxy(api, { get: (t, k) => (k in t ? t[k] : fallback(String(k))) });
})();
