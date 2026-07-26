// `lsof`/`open`/`kill` exec work lives in background.js. The panel only receives
// raw records and groups them by project here.

const UNGROUPED = "Other";

function projectPath(project) {
  return project?.path || project?.directory || project?.root || project?.cwd || "";
}

function matchProject(cwd, projects) {
  if (!cwd) return null;

  let best = null;
  let bestLen = -1;

  for (const project of projects) {
    const path = projectPath(project).replace(/\/$/, "");
    if (!path) continue;

    if (cwd === path || cwd.startsWith(path + "/")) {
      if (path.length > bestLen) {
        best = project;
        bestLen = path.length;
      }
    }
  }

  return best;
}

export function isAppPort(record, projects) {
  return Boolean(matchProject(record.cwd, projects));
}

export function groupRecords(records, projects) {
  const groups = new Map();

  for (const rec of records) {
    const project = matchProject(rec.cwd, projects);
    const name = project ? project.name || UNGROUPED : UNGROUPED;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(rec);
  }

  return [...groups.entries()]
    .map(([name, ports]) => ({ name, ports: ports.sort((a, b) => a.port - b.port) }))
    .sort((a, b) => {
      if (a.name === UNGROUPED) return 1;
      if (b.name === UNGROUPED) return -1;
      return a.name.localeCompare(b.name);
    });
}

export function requestPorts() {
  return muxy.events.emit("extension.ports.request");
}

export function openPort(port) {
  return muxy.events.emit("extension.ports.open", { port });
}

export function killPorts(records) {
  return muxy.events.emit("extension.ports.kill", {
    ports: records.map((rec) => rec.port),
    pids: records.map((rec) => rec.pid),
  });
}
