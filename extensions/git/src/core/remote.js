export function remoteHost(url) {
  const s = String(url ?? "").trim();
  const scheme = s.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)/);
  if (scheme) return scheme[1].toLowerCase();
  const scp = s.match(/^(?:[^@/]+@)?([^:/]+):/);
  return scp ? scp[1].toLowerCase() : "";
}

export function webUrl(remote) {
  const url = String(remote ?? "").trim();
  if (!url) return "";
  const ssh = url.match(/^ssh:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const scp = url.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+?)(?:\.git)?\/?$/);
  if (scp && !/^https?$/.test(scp[1])) return `https://${scp[1]}/${scp[2]}`;
  const http = url.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/);
  return http ? `https://${http[1]}` : "";
}

export function commitWebUrl(web, hash) {
  if (!web || !hash) return "";
  return /gitlab/i.test(web) ? `${web}/-/commit/${hash}` : `${web}/commit/${hash}`;
}
