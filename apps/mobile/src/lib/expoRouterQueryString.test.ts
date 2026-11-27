import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const routerRequire = createRequire(require.resolve("expo-router/package.json"));
const queryString = routerRequire("query-string") as {
  parse: (input: string) => Record<string, string | string[]>;
  stringify: (input: Record<string, string | string[]>) => string;
};

describe("Expo Router query parameters", () => {
  it("uses the patched decoder without changing the CommonJS consumer's link values", () => {
    const params = {
      code: "synthetic+sign-in/example=",
      check: ["review-1", "review-2"],
      description: "Café + travel #1"
    };

    expect(queryString.parse(queryString.stringify(params))).toEqual(params);
    expect(queryString.parse("description=Lunch%26Walk").description).toBe("Lunch&Walk");
  });
});
