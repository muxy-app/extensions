/**
 * Wrap an exec function and record argv for budget / amplification tests.
 * @param {Function} [inner]
 */
export function countingExec(inner) {
  const calls = [];
  const exec = (argv, opts = {}) => {
    calls.push(Array.isArray(argv) ? argv.slice() : argv);
    return inner(argv, opts);
  };
  exec.calls = calls;
  exec.reset = () => {
    calls.length = 0;
  };
  /** @param {string | ((argv: string[]) => boolean)} binOrPred */
  exec.countWhere = (binOrPred) => {
    if (typeof binOrPred === "function") {
      return calls.filter((a) => binOrPred(a)).length;
    }
    return calls.filter((a) => a[0] === binOrPred).length;
  };
  return exec;
}
