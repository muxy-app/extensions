import { clamp } from "./values.mjs";

export function computePace({ usedPercent, resetAt, periodDuration, now }) {
  if (!(resetAt instanceof Date) || Number.isNaN(resetAt.getTime()) || periodDuration <= 0) return null;
  const used = clamp(Number(usedPercent), 0, 100);
  if (used >= 100) return saturatedPace();
  const periodStartMs = resetAt.getTime() - periodDuration * 1000;
  const elapsed = (now.getTime() - periodStartMs) / 1000;
  const remaining = (resetAt.getTime() - now.getTime()) / 1000;
  if (elapsed <= 0 || remaining <= 0) return null;
  const elapsedFraction = elapsed / periodDuration;
  if (elapsedFraction < 0.05) return used === 0 ? earlyPace() : null;
  const usageRate = used / elapsed;
  const projectedRaw = usageRate * periodDuration;
  const projectedUsed = clamp(Math.round(projectedRaw), 0, 100);
  const projectedLeft = clamp(100 - Math.round(projectedRaw), 0, 100);
  const status = projectedRaw <= 80 ? "ahead" : projectedRaw <= 100 ? "onTrack" : "behind";
  const deficitRaw = used - elapsedFraction * 100;
  const deficitPercent = deficitRaw > 0 ? clamp(Math.round(deficitRaw), 0, 100) : null;
  const eta = status === "behind" && usageRate > 0 ? (100 - used) / usageRate : null;
  const runsOutIn = eta !== null && eta > 0 && eta < remaining ? eta : null;
  return {
    status,
    projectedUsedPercentAtReset: projectedUsed,
    projectedLeftPercentAtReset: projectedLeft,
    runsOutIn,
    deficitPercent,
    detail: paceDetail({ status, runsOutIn, deficitPercent, projectedUsed, projectedLeft })
  };
}

export function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function saturatedPace() {
  return {
    status: "behind",
    projectedUsedPercentAtReset: 100,
    projectedLeftPercentAtReset: 0,
    runsOutIn: null,
    deficitPercent: null,
    detail: "100% used at reset"
  };
}

function earlyPace() {
  return {
    status: "ahead",
    projectedUsedPercentAtReset: 0,
    projectedLeftPercentAtReset: 100,
    runsOutIn: null,
    deficitPercent: null,
    detail: "0% used at reset"
  };
}

function paceDetail({ status, runsOutIn, deficitPercent, projectedUsed, projectedLeft }) {
  if (runsOutIn) return `Runs out in ${formatDuration(runsOutIn)}`;
  if (deficitPercent && deficitPercent > 0) return `${deficitPercent}% in deficit`;
  return status === "ahead" ? `${projectedUsed}% used at reset` : `${projectedLeft}% left at reset`;
}
