import { quoteShell } from './model.js';

// One read-only shell request keeps Muxy's consent scoped to this exact scan.
// NUL section separators preserve spaces and newlines in process paths.
export const SCAN_SCRIPT = `export LC_ALL=C
[ "$(/usr/bin/uname -s)" = Darwin ] || exit 69
boot=$(/usr/sbin/sysctl -n kern.bootsessionuuid) || exit 70
uid=$(/usr/bin/id -u) || exit 70
scan_file=$(/usr/bin/mktemp -t run-deck) || exit 70
trap '/bin/rm -f "$scan_file"' EXIT
/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -F0pcun > "$scan_file"
status=$?
[ "$status" -le 1 ] || exit 70
printf 'RUN_DECK_4\\n%s\\n%s\\n%s\\n' "$boot" "$uid" "$(/bin/hostname)"
/bin/cat "$scan_file"
printf '\\000RUN_DECK_PS\\000'
pids=$(/usr/bin/tr '\\000' '\\n' < "$scan_file" | /usr/bin/awk '/^p[0-9]+$/ { if (++n <= 200) { if (n > 1) printf ","; printf "%s", substr($0,2) } }')
/bin/ps -Aww -o pid=,ppid=,uid=,pcpu=,rss=,etime=,lstart=,comm= || exit 70
printf '\\000RUN_DECK_CWD\\000'
if [ -n "$pids" ]; then /usr/sbin/lsof -nP -a -p "$pids" -d cwd -F0pn; fi
printf '\\000RUN_DECK_MARKERS\\000'
/bin/ps -Aww -o pid=,args= | /usr/bin/awk 'match($0, / run-deck:[a-f0-9-]+$/) { print $1, substr($0, RSTART + 10) }'
printf '\\000RUN_DECK_END\\000'
`;

const DB_PORTS = new Set([2375, 2376, 3306, 5432, 6379, 6380, 11211, 27017, 27018]);
const MAX_PROCESSES = 200;

function elapsedSeconds(value) {
  const match = value.match(/^(?:(\d+)-)?(?:(\d+):)?(\d{2}):(\d{2})$/);
  if (!match || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3]) * 60 + Number(match[4]);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

function lsofRecords(raw) {
  const records = [];
  let record;
  for (const token of raw.split('\0')) {
    const field = token.replace(/^\n/, '');
    if (/^p\d+$/.test(field)) {
      record = { pid: Number(field.slice(1)), hosts: [], cwd: null };
      records.push(record);
    } else if (record && field) {
      const value = field.slice(1);
      if (field[0] === 'c') record.name = value.slice(0, 120);
      if (field[0] === 'u') record.uid = Number(value);
      if (field === 'fcwd') record.cwdRecord = true;
      if (field[0] === 'n') {
        if (record.cwdRecord) record.cwd = value;
        else record.hosts.push(value);
      }
    }
  }
  return records;
}

export function parseSnapshot(raw) {
  if (typeof raw !== 'string' || raw.length > 2 * 1024 * 1024) throw new Error('Service inspection exceeded its data limit.');
  const header = raw.match(/^RUN_DECK_4\n([A-Fa-f0-9-]{36})\n(\d+)\n([A-Za-z0-9_.-]{1,255})\n/);
  if (!header) throw new Error('Service inspection returned an invalid host identity.');
  const parts = raw.slice(header[0].length).split(/\0RUN_DECK_(?:PS|CWD|MARKERS|END)\0/);
  if (parts.length !== 5 || parts[4] !== '') throw new Error('Service inspection was incomplete. Refresh to try again.');
  const processes = new Map();
  for (const line of parts[1].split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.{24})\s+(.+)$/);
    if (match) processes.set(Number(match[1]), {
      pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]),
      started: match[7], executable: match[8].trim(), verified: true, ports: [],
      cpuPercent: /^\d+(?:\.\d+)?$/.test(match[4]) && Number.isFinite(Number(match[4])) ? Number(match[4]) : null,
      memoryBytes: /^\d+$/.test(match[5]) && Number.isSafeInteger(Number(match[5]) * 1024) ? Number(match[5]) * 1024 : null,
      uptimeSeconds: elapsedSeconds(match[6]),
      id: `${header[1]}:${match[1]}:${match[7]}`,
    });
  }
  if (processes.size > 6000) throw new Error('Too many processes to inspect safely.');
  for (const line of parts[3].split('\n')) {
    const match = line.match(/^(\d+) ([a-f0-9-]{36})$/);
    const process = match && processes.get(Number(match[1]));
    if (process && /(?:^|\/)sh$/.test(process.executable)) process.runToken = match[2];
  }

  const directories = new Map(lsofRecords(parts[2]).map(record => [record.pid, record.cwd]));
  const all = lsofRecords(parts[0]);
  const services = [];
  let limited = all.length > MAX_PROCESSES;
  for (const record of all.slice(0, MAX_PROCESSES)) {
    const ports = new Map();
    let complete = true;
    for (const address of record.hosts) {
      const match = address.match(/^(.*):(\d+)$/);
      if (!match || !Number(match[2]) || Number(match[2]) > 65535) continue;
      const port = Number(match[2]);
      if (!ports.has(port) && ports.size >= 32) { complete = false; limited = true; continue; }
      if (!ports.has(port)) ports.set(port, { port, hosts: [] });
      const hosts = ports.get(port).hosts;
      if (hosts.length < 16 && !hosts.includes(match[1])) hosts.push(match[1]);
    }
    if (!ports.size) continue;
    const identity = processes.get(record.pid);
    const service = {
      cpuPercent: null, memoryBytes: null, uptimeSeconds: null,
      ...record, ...identity,
      cwd: directories.get(record.pid) || null,
      ports: [...ports.values()].sort((a, b) => a.port - b.port),
      verified: complete && !!identity && identity.uid === record.uid,
      id: `${header[1]}:${record.pid}:${identity?.started || 'unknown'}`,
    };
    services.push(service);
    if (identity) processes.set(record.pid, service);
  }
  return { processes: [...processes.values()], hostId: header[1], hostname: header[3], uid: Number(header[2]), services, limited };
}

export function insideDirectory(path, root) {
  const parent = root.replace(/\/+$/, '') || '/';
  return !!path && (path === parent || path.startsWith(parent === '/' ? '/' : `${parent}/`));
}

export function stopRestriction(service, uid) {
  if (!service.verified || !service.executable || !service.started) return 'unverified';
  if (service.uid !== uid) return 'otherUser';
  if (service.pid <= 1 || /^(\/System\/|\/usr\/libexec\/|\/usr\/sbin\/)/.test(service.executable)
    || service.executable.includes('.app/Contents/')) return 'protected';
  return null;
}

export function defaultURL(service) {
  const endpoint = service.ports.find(item => !DB_PORTS.has(item.port));
  if (!endpoint) return null;
  const host = endpoint.hosts.find(value => value === '127.0.0.1')
    || (endpoint.hosts.includes('[::1]') && !endpoint.hosts.includes('*') ? '[::1]' : null)
    || (endpoint.hosts.some(value => ['*', '0.0.0.0', '[::]', '::'].includes(value)) ? 'localhost' : endpoint.hosts[0]);
  if (!host || !/^[\da-fA-F.:\[\]]+$/.test(host) && host !== 'localhost') return null;
  return `${[443, 8443].includes(endpoint.port) ? 'https' : 'http'}://${host}:${endpoint.port}`;
}

export function validateURL(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter an HTTP or HTTPS URL of at most 4096 characters.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a complete http:// or https:// URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS URL without credentials.');
  }
  return url.href;
}

// Fold listeners under a verified launch root, or the nearest listening ancestor.
// Directory names never establish ownership.
export function groupServices(snapshot, entries = []) {
  const nodes = new Map(snapshot.processes.map(p => [p.pid, p]));
  const listeners = new Map(snapshot.services.map(p => [p.pid, p]));
  const runs = new Map(entries.filter(e => e.run?.state === 'linked' && e.run.token).map(e => [e.run.token, e]));
  const children = new Map();
  for (const p of nodes.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  const roots = new Map();
  for (const listener of listeners.values()) {
    let root = listener;
    let parent = nodes.get(listener.ppid);
    let origin = null;
    const visited = new Set([listener.pid]);
    while (parent && !visited.has(parent.pid) && visited.size < 128 && parent.uid === listener.uid) {
      visited.add(parent.pid);
      if (parent.runToken && runs.has(parent.runToken)) { root = parent; break; }
      if (listeners.has(parent.pid)) root = parent;
      const app = parent.executable.match(/\/([^/]+)\.app\/Contents\//)?.[1];
      if (!origin && app) origin = app;
      parent = nodes.get(parent.ppid);
    }
    if (!roots.has(root.pid)) roots.set(root.pid, { root, listener, origin, observed: new Map() });
    roots.get(root.pid).observed.set(listener.pid, listener);
  }
  const groups = [];
  for (const { root, listener, origin, observed } of roots.values()) {
    const members = [];
    const queue = [{ ...root, depth: 0 }];
    const seen = new Set();
    while (queue.length && members.length < 256) {
      const current = queue.shift();
      if (seen.has(current.pid)) continue;
      seen.add(current.pid); members.push(current);
      for (const child of children.get(current.pid) || []) queue.push({ ...child, depth: current.depth + 1 });
    }
    const entry = runs.get(root.runToken);
    // The display cap must not erase listeners already found in the snapshot.
    for (const member of members) if (member.ports.length) observed.set(member.pid, member);
    const endpoints = new Map();
    for (const p of observed.values()) for (const endpoint of p.ports) {
      if (!endpoints.has(endpoint.port)) endpoints.set(endpoint.port, { port: endpoint.port, hosts: [] });
      const hosts = endpoints.get(endpoint.port).hosts;
      for (const host of endpoint.hosts) if (!hosts.includes(host)) hosts.push(host);
    }
    const truncated = queue.length > 0;
    const total = key => truncated || members.some(p => p[key] == null) ? null : members.reduce((sum, p) => sum + p[key], 0);
    const complete = members.length <= 64 && !truncated && !snapshot.limited && members.every(p => p.verified && p.uid === root.uid);
    const restrictedChild = members.some(p => stopRestriction(p, snapshot.uid));
    groups.push({
      ...root, name: listener.name, cwd: root.cwd || listener.cwd,
      label: entry?.name, members, ports: [...endpoints.values()].sort((a,b) => a.port - b.port),
      cpuPercent: total('cpuPercent'), memoryBytes: total('memoryBytes'),
      verified: complete && !restrictedChild,
      restriction: stopRestriction(root, snapshot.uid) || (!complete || restrictedChild ? 'unverified' : null),
      source: entry ? { name: 'Run Deck', entryId: entry.id, token: entry.run.token, tabId: entry.run.tabId, command: entry.command, directory: entry.directory } : { name: origin },
      listeningIds: [...observed.values()].map(p => p.id).sort().join('|'),
    });
  }
  return groups;
}

function hostGuard(snapshot) {
  return `export LC_ALL=C
[ "$(/usr/bin/uname -s)" = Darwin ] || exit 69
[ "$(/usr/sbin/sysctl -n kern.bootsessionuuid)" = ${quoteShell(snapshot.hostId)} ] || exit 71
[ "$(/usr/bin/id -u)" = ${quoteShell(snapshot.uid)} ] || exit 71`;
}
function identityCheck(p) {
  if (!Number.isSafeInteger(p.pid) || p.pid <= 1) throw new Error('Invalid process identity.');
  return `actual=$(/bin/ps -ww -p ${p.pid} -o uid=,lstart=,comm= | /usr/bin/sed 's/^ *//;s/  */ /g')
expected=$(printf '%s' ${quoteShell(`${p.uid} ${p.started} ${p.executable}`)} | /usr/bin/sed 's/  */ /g')`;
}
export function stopTreeScript(service, snapshot) {
  const members = service.members || [service];
  if (!service.verified || members.length > 64 || members.some(p => stopRestriction(p, snapshot.uid))) throw new Error('This process tree cannot be stopped safely.');
  if (!service.ports.length || service.ports.some(p => !Number.isInteger(p.port) || p.port < 1 || p.port > 65535)) throw new Error('Invalid listening port.');
  const ids = members.map(p => p.pid).sort((a,b) => a-b);
  const membership = `/bin/ps -A -o pid=,ppid= | /usr/bin/awk -v root=${service.pid} '{ parent[$1]=$2 } END { seen[root]=1; for (pass=0;pass<256;pass++) { changed=0; for (pid in parent) if (!seen[pid] && seen[parent[pid]]) { seen[pid]=1; changed=1 }; if (!changed) break }; for (pid in seen) if (seen[pid]) print pid }' | /usr/bin/sort -n | /usr/bin/tr '\\n' ','`;
  return `${hostGuard(snapshot)}
[ "$(${membership})" = ${quoteShell(ids.join(',') + ',')} ] || exit 72
${members.map(p => `${identityCheck(p)}\n[ "$actual" = "$expected" ] || exit 72`).join('\n')}
ports=$(/usr/sbin/lsof -nP -a -p ${ids.join(',')} -iTCP -sTCP:LISTEN -Fn | /usr/bin/sed -n 's/^n.*://p' | /usr/bin/sort -nu | /usr/bin/tr '\\n' ',')
[ "$ports" = ${quoteShell(service.ports.map(p => p.port).sort((a,b) => a-b).join(',') + ',')} ] || exit 72
${members.map(p => `${identityCheck(p)}
if [ "$actual" = "$expected" ]; then
  /bin/kill -TERM ${p.pid} || exit 73
elif [ -n "$actual" ]; then
  # An earlier TERM may have left a child exited but not yet reaped.
  state=$(/bin/ps -p ${p.pid} -o stat= | /usr/bin/tr -d '[:space:]')
  case "$state" in ''|Z*) ;; *) exit 72 ;; esac
fi`).join('\n')}
/bin/sleep 0.5
${SCAN_SCRIPT}`;
}

export function launchCommand(command, token, guard = null) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid launch token.');
  const preflight = guard ? `${hostGuard(guard)}
${guard.members.map(p => `${identityCheck(p)}\n[ "$actual" != "$expected" ] || { echo 'Run Deck: old process is still running. Restart cancelled.' >&2; exit 74; }`).join('\n')}
if /usr/sbin/lsof -nP -iTCP:${guard.ports.map(p => p.port).join(',')} -sTCP:LISTEN -t >/dev/null 2>&1; then echo 'Run Deck: port is occupied. Restart cancelled.' >&2; exit 74; fi
` : '';
  // A foreground shell gives this launch a stable marker without a daemon,
  // persistent files, or reading process environments. The user command runs
  // unchanged in a child shell; Run Deck's guarded stop handles the full tree.
  // Save stdin before backgrounding: dash replaces fd 0 before applying the
  // child's redirections. Close the temporary descriptor in both processes.
  const body = `${preflight}trap 'exit 143' TERM
exec 3<&0
/bin/sh -c ${quoteShell(command)} <&3 3<&- &
child=$!
exec 3<&-
wait "$child"
result=$?
exit "$result"`;
  return `/bin/sh -c ${quoteShell(body)} run-deck:${token}`;
}
