import { after } from "next/server";

export async function retainLocationRequestWork<T>(run: () => Promise<T>): Promise<T> {
  let settle!: () => void;
  const completion = new Promise<void>(resolve => { settle = resolve; });
  // Register before the database work starts, including its cleanup on disconnect.
  after(completion);
  try {
    return await run();
  } finally {
    settle();
  }
}
