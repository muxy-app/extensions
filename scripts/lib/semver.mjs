const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NUMERIC_RE = /^\d+$/;

export function parseSemver(version) {
  if (typeof version !== "string") return null;
  const match = SEMVER_RE.exec(version);
  if (!match) return null;
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(a, b) {
  const aNumeric = NUMERIC_RE.test(a);
  const bNumeric = NUMERIC_RE.test(b);
  if (aNumeric && bNumeric) {
    const diff = BigInt(a) - BigInt(b);
    return diff === 0n ? 0 : diff < 0n ? -1 : 1;
  }
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

// Semver 2.0.0 precedence: build metadata is ignored, and a prerelease sorts
// below the release it precedes. Throws on anything that is not semver.
export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left) throw new Error(`not a semver version: ${JSON.stringify(a)}`);
  if (!right) throw new Error(`not a semver version: ${JSON.stringify(b)}`);

  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length) || 0;
  }
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const order = compareIdentifiers(left.prerelease[i], right.prerelease[i]);
    if (order !== 0) return order;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length) || 0;
}
