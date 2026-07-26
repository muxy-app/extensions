export const SORT_OPTIONS = [
  { value: "transcode-first", label: "Transcoding first" },
  { value: "user-asc", label: "User (A→Z)" },
  { value: "title-asc", label: "Title (A→Z)" },
  { value: "bandwidth-desc", label: "Bandwidth (high→low)" },
  { value: "recent", label: "Most recent" },
];

export const DEFAULT_SORT = "transcode-first";

function lc(s) {
  return (s || "").toString().toLowerCase();
}

export function filterSessions(sessions, query) {
  const q = lc(query).trim();
  if (!q) return sessions;
  return sessions.filter(
    (s) => lc(s.title).includes(q) || lc(s.user).includes(q) || lc(s.device).includes(q),
  );
}

export function sortSessions(sessions, sortKey) {
  const arr = sessions.slice();
  const cmp = comparators[sortKey] || comparators[DEFAULT_SORT];
  arr.sort(cmp);
  return arr;
}

const comparators = {
  "transcode-first": (a, b) => {
    const t = Number(!!b.isTranscoding) - Number(!!a.isTranscoding);
    if (t !== 0) return t;
    return lc(a.user).localeCompare(lc(b.user)) || lc(a.title).localeCompare(lc(b.title));
  },
  "user-asc": (a, b) =>
    lc(a.user).localeCompare(lc(b.user)) || lc(a.title).localeCompare(lc(b.title)),
  "title-asc": (a, b) => lc(a.title).localeCompare(lc(b.title)),
  "bandwidth-desc": (a, b) => {
    const aB = a.bandwidthKbps || a.bitrateKbps || 0;
    const bB = b.bandwidthKbps || b.bitrateKbps || 0;
    return bB - aB;
  },
  recent: (a, b) => {
    const aK = Number(a.sessionKey) || 0;
    const bK = Number(b.sessionKey) || 0;
    return bK - aK;
  },
};
