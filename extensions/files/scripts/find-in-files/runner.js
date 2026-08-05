import { MAX_RESULTS, SEARCH_EXIT_MARKER } from "./constants.js";
import { grep_request, rg_request } from "./commands.js";
import {
  is_search_too_short,
  parse_result_id,
  parse_result_line,
  query_variants,
  search_options,
} from "./query.js";

const COMMAND_NOT_FOUND_EXIT_CODE = 127;
const SEARCH_CACHE_LIMIT = 20;

let searchCache = new Map();
let searchSerial = 0;
let searchTimer = null;
let searchTimerResolve = null;
let currentExecHandle = null;

export function open_find_in_files() {
  muxy.modal.open({
    placeholder: "Find in files...",
    emptyLabel: "Type 2 or more characters",
    noMatchLabel: "No matches",
    searchToolbar: true,
    items: [],
    onQuery: handle_query,
    onSelect: open_result,
  });
}

function handle_query(query, emitOrOptions, maybeOptions) {
  const emit = typeof emitOrOptions === "function" ? emitOrOptions : null;
  const rawOptions = typeof emitOrOptions === "function" ? maybeOptions : emitOrOptions;
  const options = search_options(rawOptions);
  const variants = query_variants(query, options);
  if (variants.length === 0 || is_search_too_short(variants[0], options)) {
    cancel_scheduled_search();
    return [];
  }

  const cacheKey = search_key(variants, options);
  const cachedItems = cached_items(cacheKey);
  if (cachedItems) {
    if (emit) return schedule_cached_emit(cachedItems, emit);
    cancel_scheduled_search();
    return [];
  }

  if (emit) return schedule_search({ cacheKey, variants, options, emit });
  cancel_scheduled_search();
  return [];
}

function cancel_running_search() {
  const handle = currentExecHandle;
  currentExecHandle = null;
  if (handle) {
    try {
      handle.cancel();
    } catch (_) {
      // ignore — best-effort cancel of a background exec
    }
  }
}

function cancel_scheduled_search() {
  cancel_running_search();
  searchSerial += 1;
  if (searchTimer != null) {
    searchTimer.cancel();
    searchTimer = null;
  }
  resolve_scheduled_search();
}

function schedule_search(search) {
  cancel_scheduled_search();
  const serial = searchSerial;
  return new Promise((resolve) => {
    searchTimerResolve = resolve;
    const task = schedule_deferred_task(() => {
      if (searchTimer === task) searchTimer = null;
      const done = () => resolve_scheduled_search(resolve);
      if (serial !== searchSerial) {
        done();
        return;
      }
      perform_search(search.variants, search.options)
        .then((result) => {
          if (serial !== searchSerial) return;
          if (result.cacheable) {
            cache_items(search.cacheKey, result.items);
          }
          search.emit(result.items);
        })
        .catch(() => {
          // search superseded or failed — emit handled by the latest query
        })
        .finally(done);
    });
    searchTimer = task;
  });
}

function schedule_cached_emit(items, emit) {
  cancel_scheduled_search();
  const serial = searchSerial;
  return new Promise((resolve) => {
    searchTimerResolve = resolve;
    const task = schedule_deferred_task(() => {
      if (searchTimer === task) searchTimer = null;
      if (serial === searchSerial) {
        emit(clone_items(items));
      }
      resolve_scheduled_search(resolve);
    });
    searchTimer = task;
  });
}

function schedule_deferred_task(callback) {
  let canceled = false;
  const run = () => {
    if (!canceled) callback();
  };

  if (typeof setTimeout === "function") {
    const timeout = setTimeout(run, 0);
    return {
      cancel() {
        canceled = true;
        if (typeof clearTimeout === "function") clearTimeout(timeout);
      },
    };
  }

  if (typeof setImmediate === "function") {
    const immediate = setImmediate(run);
    return {
      cancel() {
        canceled = true;
        if (typeof clearImmediate === "function") clearImmediate(immediate);
      },
    };
  }

  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
    return {
      cancel() {
        canceled = true;
      },
    };
  }

  Promise.resolve().then(run);
  return {
    cancel() {
      canceled = true;
    },
  };
}

function resolve_scheduled_search(expectedResolve) {
  const resolve = searchTimerResolve;
  if (!resolve) return;
  if (expectedResolve && resolve !== expectedResolve) return;
  searchTimerResolve = null;
  resolve();
}

async function perform_search(variants, options) {
  let response = await run_request(rg_request(variants, options));
  if (should_fallback_to_grep(response)) {
    response = await run_request(grep_request(variants, options));
  }

  const result = response.ok ? response.result : null;
  const items = result_items(result);
  if (items.length > 0) {
    return { items, cacheable: is_cacheable_result(result) };
  }
  if (response.ok && is_empty_success_result(result)) {
    return { items: [], cacheable: true };
  }
  if (is_cancelled_response(response)) {
    return { items: [], cacheable: false };
  }
  if (is_timed_out_response(response)) {
    return search_error("Search timed out", variants[0]);
  }
  if (options.regex && response.ok && search_exit_code(result) > 1) {
    return search_error("Invalid pattern", variants[0]);
  }
  return search_error("Search failed", variants[0]);
}

async function run_request(request) {
  const handle = muxy.execAsync(request.argv, {
    stdin: request.stdin,
    timeoutMs: request.timeoutMs,
  });
  if (
    !handle ||
    typeof handle.cancel !== "function" ||
    typeof handle.result?.then !== "function"
  ) {
    return { ok: false, error: new Error("muxy.execAsync unavailable") };
  }

  if (currentExecHandle) {
    try {
      currentExecHandle.cancel();
    } catch (_) {
      // ignore — best-effort cancel of a previously running exec
    }
  }
  currentExecHandle = handle;

  try {
    const result = await handle.result;
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (currentExecHandle === handle) currentExecHandle = null;
  }
}

function should_fallback_to_grep(response) {
  if (response.ok) {
    return search_exit_code(response.result) === COMMAND_NOT_FOUND_EXIT_CODE;
  }
  return is_command_not_found_error(response.error);
}

function result_items(result) {
  if (!result) return [];
  const seen = new Set();
  const items = [];
  const stdout = String(result.stdout || "");
  let start = 0;
  while (start < stdout.length && items.length < MAX_RESULTS) {
    const newline = stdout.indexOf("\n", start);
    const line = newline === -1 ? stdout.slice(start) : stdout.slice(start, newline);
    const item = parse_result_line(line);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return items;
}

function is_cacheable_result(result) {
  if (!result || result.timedOut) return false;
  const exitCode = search_exit_code(result);
  return (
    exitCode === 0 ||
    exitCode === 1 ||
    (exitCode === 141 && Boolean(result.stdout))
  );
}

function is_empty_success_result(result) {
  if (!result || result.timedOut) return false;
  const exitCode = search_exit_code(result);
  return exitCode === 0 || exitCode === 1;
}

function search_exit_code(result) {
  if (!result) return -1;
  const stderr = String(result.stderr || "");
  const marker = stderr.lastIndexOf(SEARCH_EXIT_MARKER);
  if (marker >= 0) {
    const value = parseInt(stderr.slice(marker + SEARCH_EXIT_MARKER.length), 10);
    if (Number.isFinite(value)) return value;
  }
  return Number.isFinite(result.exitCode) ? result.exitCode : -1;
}

function is_command_not_found_error(error) {
  if (!error || is_cancelled_error(error) || is_timeout_error(error)) return false;
  const message = String(error.message || error).toLowerCase();
  return message.includes("command not found:") || message.includes("enoent");
}

function is_cancelled_response(response) {
  return !response.ok && is_cancelled_error(response.error);
}

function is_cancelled_error(error) {
  return Boolean(error && (error.cancelled || error.code === "cancelled"));
}

function is_timed_out_response(response) {
  if (response.ok) return Boolean(response.result && response.result.timedOut);
  return is_timeout_error(response.error);
}

function is_timeout_error(error) {
  if (!error || is_cancelled_error(error)) return false;
  const message = String(error.message || error).toLowerCase();
  return message.includes("timed out") || message.includes("timeout");
}

function search_error(title, subtitle) {
  return {
    items: [{ id: "__error__", title, subtitle: String(subtitle || "") }],
    cacheable: false,
  };
}

export function reset_find_in_files_state_for_tests() {
  searchCache = new Map();
  cancel_scheduled_search();
}

function search_key(variants, options) {
  return JSON.stringify({
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regex: options.regex,
    variants,
  });
}

function clone_items(items) {
  return items.map((item) => ({ ...item }));
}

function cached_items(cacheKey) {
  if (!searchCache.has(cacheKey)) return null;
  const items = searchCache.get(cacheKey);
  searchCache.delete(cacheKey);
  searchCache.set(cacheKey, items);
  return clone_items(items);
}

function cache_items(cacheKey, items) {
  searchCache.set(cacheKey, clone_items(items));
  if (searchCache.size <= SEARCH_CACHE_LIMIT) return;

  const oldestKey = searchCache.keys().next().value;
  searchCache.delete(oldestKey);
}

function open_result(choice) {
  if (!choice) return;
  const result = parse_result_id(choice.id);
  if (!result) return;

  const extId = (typeof muxy !== "undefined" && muxy.extensionID) || "files";
  muxy.tabs.open({
    kind: "extensionWebView",
    extension: {
      id: extId,
      tabType: "code-editor",
      singleton: false,
      data: {
        filePath: result.filePath,
        line: result.lineNumber,
        replaceable: false,
      },
    },
  });
}
