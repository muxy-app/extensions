"use strict";

(() => {
  const STORAGE_KEY = "muxy.web-browser.recent.v2";
  const MAX_RECENT = 20;
  // Muxy's reply when it has no built-in browser, as in Muxy 2.
  const NO_BUILT_IN_BROWSER = "built-in browser is disabled";

  const urlForm = document.getElementById("url-form");
  const urlInput = document.getElementById("url-input");
  const statusText = document.getElementById("status");
  const recentList = document.getElementById("recent-list");
  const recentEmpty = document.getElementById("recent-empty");

  let recent = readRecent();
  renderRecent();

  urlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = normalizeURL(urlInput.value);
    if (url) openPage(url);
  });

  urlInput.focus();

  // Extension pages can't show other sites, so pages open in Muxy's built-in
  // browser. Without one, web pages open in the default browser instead.
  async function openPage(url) {
    setStatus("");
    try {
      await muxy.browser.open(url);
      remember(url);
      return;
    } catch (error) {
      if (!errorText(error).includes(NO_BUILT_IN_BROWSER)) {
        setStatus(`Could not open ${url}: ${errorText(error)}`);
        return;
      }
    }
    if (!isWebURL(url)) {
      setStatus("Only web pages can open in your default browser.");
      return;
    }
    try {
      const result = await muxy.exec(["/usr/bin/open", url]);
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `open exited with ${result.exitCode}`);
      remember(url);
      setStatus("Opened in your default browser.");
    } catch (error) {
      setStatus(`Could not open ${url}: ${errorText(error)}`);
    }
  }

  function errorText(error) {
    return String((error && error.message) || error);
  }

  function isWebURL(url) {
    try {
      const { protocol } = new URL(url);
      return protocol === "https:" || protocol === "http:";
    } catch (_error) {
      return false;
    }
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function remember(url) {
    recent = [url, ...recent.filter((entry) => entry !== url)].slice(0, MAX_RECENT);
    writeRecent();
    renderRecent();
  }

  function renderRecent() {
    recentList.replaceChildren(
      ...recent.map((url) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recent-item";
        button.textContent = url;
        button.title = url;
        button.addEventListener("click", () => {
          urlInput.value = url;
          openPage(url);
        });
        item.append(button);
        return item;
      }),
    );
    recentEmpty.hidden = recent.length > 0;
  }

  function normalizeURL(rawInput) {
    const raw = String(rawInput || "").trim();
    if (!raw) return null;

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) {
      try {
        return new URL(raw).toString();
      } catch (_error) {
        return null;
      }
    }

    if (looksLikeHost(raw)) {
      try {
        return new URL(`https://${raw}`).toString();
      } catch (_error) {
        return null;
      }
    }

    return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
  }

  function looksLikeHost(value) {
    return value.includes(".") || value.startsWith("localhost") || /^[\d.:]+$/.test(value);
  }

  function readRecent() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) {
        return stored.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, MAX_RECENT);
      }
    } catch (_error) {}
    return [];
  }

  function writeRecent() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
    } catch (_error) {}
  }
})();
