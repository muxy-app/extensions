export function exec(argv) {
  const res = muxy.exec(argv);
  if (!res || res.exitCode !== 0) throw new Error(((res && (res.stderr || res.stdout)) || `${argv.join(" ")} failed`).trim());
  return res.stdout;
}

export function tryExec(argv) {
  try {
    return exec(argv);
  } catch {
    return "";
  }
}

export function message(err) {
  return (err && err.message) || String(err || "Unknown error");
}

export function fail(title, err) {
  try {
    muxy.dialog.alert({ title, message: message(err).slice(0, 1900), style: "critical" });
  } catch {}
}

export function notify(body, title) {
  try {
    muxy.toast({ title, body });
  } catch {}
}

export function pick(options, onSelect) {
  muxy.modal.open({ ...options, onSelect: (choice) => choice && onSelect(choice) });
}
