import { clamp, nonEmptyString } from "./values.mjs";

export function statusBarPresentation(selection, displayMode) {
  if (!selection) return { icon: { symbol: "sparkles" }, text: null };
  if (!selection.row && !selection.snapshot.rows.some((row) => row.percent !== null && row.percent !== undefined)) {
    return { icon: { symbol: "sparkles" }, text: null };
  }
  const percent = selection.row?.percent ?? maxPercent(selection.snapshot);
  const displayPercent = displayPercentValue(percent, displayMode);
  if (displayPercent === null) return { icon: { symbol: "sparkles" }, text: null };
  return {
    icon: { svg: `assets/${selection.snapshot.icon}.svg` },
    text: `${Math.round(displayPercent)}%`
  };
}

export function rowDisplay(row, displayMode) {
  const percent = displayPercentValue(row.percent, displayMode);
  return {
    percent,
    percentText: percent === null ? null : `${Math.round(percent)}%`,
    detail: detailForMode(row.detail, displayMode)
  };
}

export function usageIsCritical(row, displayMode) {
  const percent = displayPercentValue(row.percent, displayMode);
  if (percent === null) return false;
  return displayMode === "remaining" ? percent <= 20 : percent >= 80;
}

export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number >= 100 ? String(Math.round(number)) : number.toFixed(1);
}

function displayPercentValue(percent, displayMode) {
  if (percent === null || percent === undefined) return null;
  const clamped = clamp(Number(percent), 0, 100);
  return displayMode === "remaining" ? clamp(100 - clamped, 0, 100) : clamped;
}

function detailForMode(detail, displayMode) {
  const trimmed = nonEmptyString(detail);
  if (!trimmed) return null;
  if (displayMode === "used") {
    return convertRemainingFractionToUsed(trimmed) ?? convertRemainingPercentToUsed(trimmed) ?? trimmed;
  }
  return convertUsedFractionToRemaining(trimmed) ?? convertUsedPercentToRemaining(trimmed) ?? trimmed;
}

function convertUsedFractionToRemaining(detail) {
  const match = fractionMatch(detail);
  if (!match || match.remainingLabel) return null;
  return `${formatNumber(Math.max(0, match.total - match.left))}/${formatNumber(match.total)}`;
}

function convertRemainingFractionToUsed(detail) {
  const match = fractionMatch(detail);
  if (!match || !match.remainingLabel) return null;
  return `${formatNumber(Math.max(0, match.total - match.left))}/${formatNumber(match.total)}`;
}

function convertUsedPercentToRemaining(detail) {
  const match = detail.match(/^\s*([0-9]+(?:\.[0-9]+)?)%\s*used\s*$/i);
  if (!match) return null;
  return `${formatNumber(clamp(100 - Number(match[1]), 0, 100))}% left`;
}

function convertRemainingPercentToUsed(detail) {
  const match = detail.match(/^\s*([0-9]+(?:\.[0-9]+)?)%\s*(?:left|remaining)\s*$/i);
  if (!match) return null;
  return `${formatNumber(clamp(100 - Number(match[1]), 0, 100))}% used`;
}

function fractionMatch(detail) {
  const match = detail.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)(?:\s*(left|remaining))?\s*$/i);
  if (!match) return null;
  const left = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(total) || total <= 0) return null;
  return { left, total, remainingLabel: Boolean(match[3]) };
}

function maxPercent(snapshot) {
  const values = snapshot.rows.map((row) => row.percent).filter((value) => value !== null && value !== undefined);
  return values.length === 0 ? 0 : Math.max(...values);
}
