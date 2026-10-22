import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Stability audit 22 Oct 2026 (iphone-timer-sync-3): `rejectOptimisticTimerStart` had no caller from
// 22 Aug, while contract tests that matched its source text kept passing. This guard reads the
// Dashboard's syntax tree, so comments and strings can't satisfy it (Codex r2 on #532); the behaviour
// (Stops removed, Edits settled, listeners told once) is covered in api.test.ts, timeEntryOutbox.test.ts,
// historyDeletion.test.ts and refusedTimerStartPresentation.test.ts.
const dashboardPath = fileURLToPath(new URL("../components/DayframeDashboard.tsx", import.meta.url));
const source = ts.createSourceFile(
  dashboardPath,
  readFileSync(dashboardPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function descendants(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node) => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

const allNodes = descendants(source);
const text = (node: ts.Node) => node.getText(source);
const calls = (node: ts.Node) => descendants(node).filter(ts.isCallExpression);
const callsTo = (node: ts.Node, callee: string) => calls(node).filter((call) => text(call.expression) === callee);

/** `useEffect(() => subscribeRefusedTimerStarts(listener), [])`: the effect returns the unsubscribe. */
function refusedStartSubscription() {
  const effects = callsTo(source, "useEffect").filter((effect) => {
    const [callback, deps] = effect.arguments;
    return callback && ts.isArrowFunction(callback) && ts.isCallExpression(callback.body) &&
      text(callback.body.expression) === "subscribeRefusedTimerStarts" &&
      deps && ts.isArrayLiteralExpression(deps) && deps.elements.length === 0;
  });
  expect(effects).toHaveLength(1);
  const subscribe = (effects[0].arguments[0] as ts.ArrowFunction).body as ts.CallExpression;
  const listener = subscribe.arguments[0];
  expect(listener && ts.isArrowFunction(listener)).toBe(true);
  return listener as ts.ArrowFunction;
}

function functionNamed(name: string) {
  const found = allNodes.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("refused queued Starts", () => {
  it("roll the block back through the Dashboard's rejection path, decided by refusedTimerStartPresentation", () => {
    const listener = refusedStartSubscription();
    expect(callsTo(listener, "refusedTimerStartPresentation")).toHaveLength(1);
    const reject = callsTo(listener, "rejectOptimisticTimerStartRef.current");
    expect(reject).toHaveLength(1);
    expect(reject[0].arguments.map(text)).toEqual(["localId", "null", "new Error(message)", "decision.alert"]);
    expect(callsTo(listener, "queueDashboardRefreshAfterConflict")).toHaveLength(1);

    const assignments = allNodes.filter((node) => ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      text(node.left) === "rejectOptimisticTimerStartRef.current" &&
      text(node.right) === "rejectOptimisticTimerStart");
    expect(assignments).toHaveLength(1);
  });

  it("dismiss a Calendar editor open on the refused block through its own exit", () => {
    expect(callsTo(refusedStartSubscription(), "setCalendarEditDismissRequestId")).toHaveLength(1);
    const dismissProps = allNodes.filter((node) => ts.isJsxAttribute(node) &&
      text(node.name) === "dismissRequestId" &&
      node.initializer !== undefined && text(node.initializer) === "{calendarEditDismissRequestId}");
    expect(dismissProps).toHaveLength(1);
  });

  it("drop only the refused block from a pending deletion, keeping Undo for the rest", () => {
    const reject = functionNamed("rejectOptimisticTimerStart");
    expect(calls(reject).some((call) => text(call.expression).endsWith(".removePendingEntry"))).toBe(true);
    expect(calls(reject).some((call) => text(call.expression).endsWith(".invalidatePendingEntry"))).toBe(false);
  });

  it("never restore the Start's own (possibly hours-old) snapshot", () => {
    const identifiers = descendants(refusedStartSubscription()).filter(ts.isIdentifier).map((node) => node.text);
    expect(identifiers).not.toContain("previousData");
    expect(identifiers.some((name) => /snapshot/i.test(name))).toBe(false);
  });
});
