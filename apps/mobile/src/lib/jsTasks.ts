// Fixed labels for the long JS work the freeze watchdog names (staging freeze, 22 Oct 2026). JS is
// single-threaded, but this work awaits, so a stall names every labelled task then running and the one
// that started last. Labels only, never data. No imports: api.ts and others use it in Node tests.

export type JsTaskLabel =
  | "bootstrap"
  | "sync-queue"
  | "health-wake"
  | "location-foreground"
  | "location-replay"
  | "location-drain"
  | "review-bootstrap";

export type JsTaskSink = (running: JsTaskLabel[], last: JsTaskLabel | null) => void;

const running = new Map<JsTaskLabel, number>();
let last: JsTaskLabel | null = null;
let sink: JsTaskSink | null = null;

/** The stall watchdog hears every change; tests and headless code run with none. */
export function setJsTaskSink(next: JsTaskSink | null) {
  sink = next;
  publish();
}

export async function withJsTask<Result>(label: JsTaskLabel, run: () => Promise<Result>): Promise<Result> {
  running.set(label, (running.get(label) ?? 0) + 1);
  last = label;
  publish();
  try {
    return await run();
  } finally {
    const count = (running.get(label) ?? 1) - 1;
    if (count > 0) running.set(label, count);
    else running.delete(label);
    if (last === label && count === 0) last = [...running.keys()].pop() ?? null;
    publish();
  }
}

export function runningJsTasks() {
  return { running: [...running.keys()].sort(), last };
}

function publish() {
  if (!sink) return;
  const snapshot = runningJsTasks();
  try {
    sink(snapshot.running, snapshot.last);
  } catch {
    // Diagnostics never break the work they describe.
  }
}

export function __resetJsTasksForTests() {
  running.clear();
  last = null;
  sink = null;
}
