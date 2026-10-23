import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Stability audit 22 Oct 2026 (iphone-timer-sync-3): `rejectOptimisticTimerStart` had no caller from
// 22 Aug, while contract tests that matched its source text kept passing. The subscription and its
// decisions now live in `useRefusedTimerStartRollback`, tested by behaviour
// (useRefusedTimerStartRollback.test.tsx, Codex r3 on #532); this guard only checks, in the Dashboard's
// syntax tree, that the provider itself calls that hook and hands it the real rollback. The rest of
// the behaviour is covered in api.test.ts, timeEntryOutbox.test.ts, historyDeletion.test.ts and
// refusedTimerStartPresentation.test.ts.
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

/**
 * The provider's own `useRefusedTimerStartRollback({...})`: a statement of its body (not inside a
 * nested function or component, so disconnected wiring fails), with the rollback's callbacks by name
 * (arrow, block-bodied or method form alike).
 */
function rollbackWiring() {
  const provider = functionNamed("DayframeDashboardProvider");
  const hookCalls = (provider.body?.statements ?? []).flatMap((statement) =>
    ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
      text(statement.expression.expression) === "useRefusedTimerStartRollback"
      ? [statement.expression]
      : []);
  expect(hookCalls).toHaveLength(1);
  expect(callsTo(source, "useRefusedTimerStartRollback")).toHaveLength(1);
  const [config] = hookCalls[0].arguments;
  expect(config && ts.isObjectLiteralExpression(config)).toBe(true);
  const callbacks = new Map<string, ts.Node>();
  for (const property of (config as ts.ObjectLiteralExpression).properties) {
    if (property.name) callbacks.set(text(property.name), property);
  }
  expect([...callbacks.keys()].sort()).toEqual(["describe", "dismissCalendarEditor", "refresh", "reject"]);
  return (name: string) => callbacks.get(name) as ts.Node;
}

function functionNamed(name: string) {
  const found = allNodes.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("refused queued Starts", () => {
  it("roll the block back through the Dashboard's rejection path, from the provider itself", () => {
    const callback = rollbackWiring();
    const reject = callsTo(callback("reject"), "rejectOptimisticTimerStart");
    expect(reject).toHaveLength(1);
    // Never the Start's own (possibly hours-old) snapshot: server truth replaces it.
    expect(text(reject[0].arguments[1])).toBe("null");
    expect(callsTo(callback("refresh"), "queueDashboardRefreshAfterConflict")).toHaveLength(1);
    const describeIdentifiers = descendants(callback("describe")).filter(ts.isIdentifier).map((node) => node.text);
    expect(describeIdentifiers).not.toContain("previousData");
    expect(describeIdentifiers.some((name) => /snapshot/i.test(name))).toBe(false);
  });

  it("dismiss a Calendar editor open on the refused block through its own exit", () => {
    expect(callsTo(rollbackWiring()("dismissCalendarEditor"), "setCalendarEditDismissRequestId")).toHaveLength(1);
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
});
