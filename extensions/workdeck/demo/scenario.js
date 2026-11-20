/* Scripted interactions for the demo screenshots: opens the detail, switches tabs, picks a chat room... */
(() => {
  const name = new URLSearchParams(location.search).get("scenario") || "";
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $$ = (s) => [...document.querySelectorAll(s)];
  const byText = (sel, text) => $$(sel).find((e) => e.textContent.trim().startsWith(text));
  const click = (el) => el && el.click();
  const SCENARIOS = {
    async "issues-gh"() { await wait(900); click($$(".item")[0]); await wait(600); },
    async "issues-agent"() {
      await SCENARIOS["issues-gh"](); await wait(500);
      click(byText(".agentbox.issue .btn.primary", "Run with an agent")); await wait(700);
      const sel = document.querySelector(".runask select"); if (sel) { sel.value = "claude"; sel.dispatchEvent(new Event("change")); }
      const [model, effort] = $$(".runask input[type=text]"); if (model) model.value = "opus"; if (effort) effort.value = "high";
      const extra = document.querySelector(".runask textarea"); if (extra) extra.value = "Keep the old endpoint working until the mobile app ships 4.2.";
      const keep = $$(".runask input[type=checkbox]").pop(); if (keep) keep.checked = true; // "save as default"
    },
    async "issues-linear"() {
      await wait(500); click(byText("#source button", "Linear")); await wait(1400);
      click($$(".item.group")[0]); await wait(900);
    },
    async "deploys-pr"() {
      await wait(1000); click($$("#view .item, .list .item")[0]); await wait(900);
      click(byText("button, summary", "Show the full diff")); await wait(700);
    },
    async "deploys-actions"() {
      await wait(500); click(byText("#tabs button", "Actions")); await wait(1000);
      click($$(".rowx.clickable")[0]); await wait(900);
    },
    async "modal-linear"() {
      await wait(600); click(byText("#source button", "Linear")); await wait(1400);
      const title = document.querySelector(".editor > input"); const body = document.querySelector(".editor textarea");
      if (title) title.value = "Cart badge flickers when quantity changes quickly";
      if (body) body.value = "## Symptoms\nThe cart badge flickers for about a second when the quantity buttons are tapped quickly.\n\n## Steps to reproduce\n1. Open a cart with two items\n2. Tap + five times in a row\n\n## Expected behavior\nThe badge updates once, without flicker.";
      const todo = byText(".btn.state", "Todo"); click(todo); await wait(300);
    },
    async "modal-chat"() {
      await wait(600); click(byText(".modebar button", "From KakaoTalk chat")); await wait(1200);
      click(byText(".roomlist .ppitem", "Acme Support") || $$(".roomlist .ppitem")[0]); await wait(1500);
      const rows = $$(".cmsg"); [0, 1, 3, 4, 6].forEach((i) => rows[i] && rows[i].click()); await wait(400);
      const chat = document.querySelector(".chat"); if (chat) chat.scrollTop = 0;
      const t = document.querySelector(".kakao textarea"); if (t) { t.value = "Mobile web only. High priority."; t.dispatchEvent(new Event("input")); }
    },
    async "modal-draft"() {
      await SCENARIOS["modal-chat"](); await wait(300);
      click(byText(".kakao .btn.primary", "Summarize")); await wait(2200);
    },
    async "board-alert"() { await wait(1200); },
  };
  (SCENARIOS[name] || (async () => {}))();
})();
