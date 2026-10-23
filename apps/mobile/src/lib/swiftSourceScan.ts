// Swift source scanning for native contract tests (no Swift toolchain needed): comments and string
// literals are blanked so braces and calls inside them never count.

/**
 * Swift source with comments and string literals blanked to spaces (positions kept), so a brace or a
 * hop inside either never changes which closure is checked (Codex r1 on #530).
 */
export function codeOnly(source: string) {
  type Context =
    | { kind: "code"; interpolation: boolean; depth: number }
    | { kind: "string"; quote: string; hashes: string };
  const stack: Context[] = [{ kind: "code", interpolation: false, depth: 0 }];
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let out = "";
  let index = 0;
  while (index < source.length) {
    const top = stack[stack.length - 1]!;
    if (top.kind === "string") {
      // Inside a literal: `\(` (or `\#(` in a raw string) opens interpolated code, an escape covers the
      // next character, the matching quote and #s close it; everything else is blanked.
      const escape = "\\" + top.hashes;
      if (source.startsWith(escape + "(", index)) {
        out += blank(escape + "(");
        index += escape.length + 1;
        stack.push({ kind: "code", interpolation: true, depth: 0 });
      } else if (source.startsWith(escape, index)) {
        out += blank(source.slice(index, index + escape.length + 1));
        index += escape.length + 1;
      } else if (source.startsWith(top.quote + top.hashes, index)) {
        out += blank(top.quote + top.hashes);
        index += top.quote.length + top.hashes.length;
        stack.pop();
      } else {
        out += blank(source[index]!);
        index += 1;
      }
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (source.startsWith("/*", index)) {
      // Swift block comments nest.
      let depth = 0;
      let cursor = index;
      while (cursor < source.length) {
        if (source.startsWith("/*", cursor)) { depth += 1; cursor += 2; continue; }
        if (source.startsWith("*/", cursor)) { depth -= 1; cursor += 2; if (depth === 0) break; continue; }
        cursor += 1;
      }
      out += blank(source.slice(index, cursor));
      index = cursor;
      continue;
    }
    // An extended regex literal (#/…/#, ##/…/##) is blanked to its matching close; bare /…/ regexes
    // need -enable-bare-slash-regex, which the Swift 5 pods don't set (Codex r4 on #530).
    const regex = /^(#+)\//.exec(source.slice(index, index + 64));
    if (regex) {
      const close = "/" + regex[1]!;
      const end = source.indexOf(close, index + regex[0].length);
      const stop = end === -1 ? source.length : end + close.length;
      out += blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    const literal = /^(#*)("""|")/.exec(source.slice(index, index + 64));
    if (literal) {
      out += blank(literal[0]);
      index += literal[0].length;
      stack.push({ kind: "string", quote: literal[2]!, hashes: literal[1]! });
      continue;
    }
    if (top.interpolation && source[index] === "(") top.depth += 1;
    if (top.interpolation && source[index] === ")") {
      if (top.depth === 0) {
        // The interpolation ends: back inside its string.
        out += " ";
        index += 1;
        stack.pop();
        continue;
      }
      top.depth -= 1;
    }
    out += source[index];
    index += 1;
  }
  return out;
}

/** Each closure that follows `marker`, found by matching braces in code only. */
export function closuresAfter(original: string, marker: RegExp) {
  const source = codeOnly(original);
  const bodies: string[] = [];
  for (const match of source.matchAll(new RegExp(marker, "g"))) {
    const open = source.indexOf("{", match.index! + match[0].length - 1);
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        bodies.push(source.slice(open, index + 1));
        break;
      }
    }
  }
  return bodies;
}
