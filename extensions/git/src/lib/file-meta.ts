export function middle_truncate(path: string, max = 44): string {
  if (path.length <= max) return path;
  const keepEnd = Math.ceil((max - 1) / 2);
  const keepStart = max - 1 - keepEnd;
  return `${path.slice(0, keepStart)}…${path.slice(path.length - keepEnd)}`;
}
