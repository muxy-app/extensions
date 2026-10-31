export function rank(items, query, limit = 500) {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored = [];
  for (const item of items) {
    const title = item.title.toLowerCase();
    const index = title.indexOf(q);
    const subtitle = (item.subtitle ?? "").toLowerCase();
    if (index === -1 && !subtitle.includes(q)) continue;
    scored.push({ item, score: index === 0 ? 0 : index > 0 ? 1 + index / 1000 : 2 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
