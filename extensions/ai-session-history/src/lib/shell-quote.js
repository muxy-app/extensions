/** Single-quote a string for embedding in a shell command. */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
