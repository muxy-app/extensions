/**
 * Returns a relative date-group label for a timestamp (ms).
 * Buckets: "Today", "Yesterday", "This Week", "Last Week", "This Month",
 * "Last Month", "Unknown" (when missing/0), or the full month+year string for older dates.
 */
export function dateGroup(ms) {
  if (!ms) return "Unknown";
  const now = new Date();
  const date = new Date(ms);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayStart = startOfDay(now);
  const dateStart = startOfDay(date);
  const diffDays = Math.round((todayStart - dateStart) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  // Start of this week (Monday)
  const thisWeekStart = new Date(todayStart);
  thisWeekStart.setDate(todayStart.getDate() - ((todayStart.getDay() + 6) % 7));
  if (dateStart >= thisWeekStart) return "This Week";

  // Start of last week
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);
  if (dateStart >= lastWeekStart) return "Last Week";

  // Start of this month
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (dateStart >= thisMonthStart) return "This Month";

  // Start of last month
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (dateStart >= lastMonthStart) return "Last Month";

  // Older: show month + year
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Relative time like "2m ago", "3h ago", "5d ago". */
export function relativeTime(ms) {
  if (!ms) return "";
  const delta = Date.now() - ms;
  if (delta < 0) return "just now";
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
