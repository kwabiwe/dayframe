/**
 * An error whose message the harness wrote itself and knows holds nothing private: the CLI prints
 * these. Any other error (a file system error naming a path, a parser quoting input) is reported by
 * its kind only.
 */
export class HarnessError extends Error {
  override name = "HarnessError";
}
