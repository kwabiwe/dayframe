import { describe, expect, it } from "vitest";
import {
  consumeActiveHashtag,
  findActiveHashtag,
  insertHashtagStarter,
  normalizeTagName,
  parseHashtagTokens,
  replaceActiveHashtag,
  tagNamesFromDescription
} from "./tags";

describe("tag normalization", () => {
  it("preserves a readable display name and creates a stable token slug", () => {
    expect(normalizeTagName("  Deep   Work  ")).toEqual({
      name: "Deep Work",
      normalizedName: "deep-work"
    });
    expect(normalizeTagName("#Q3_planning")).toEqual({
      name: "Q3_planning",
      normalizedName: "q3_planning"
    });
  });

  it("uses case-insensitive token identity", () => {
    expect(normalizeTagName("Planning").normalizedName).toBe(
      normalizeTagName("planning").normalizedName
    );
  });

  it("rejects punctuation and names that cannot be represented safely", () => {
    expect(() => normalizeTagName("client/work")).toThrow();
    expect(() => normalizeTagName("planning!")).toThrow();
    expect(() => normalizeTagName(" ")).toThrow();
  });
});

describe("hashtag parsing", () => {
  it("finds empty and filtered queries at the beginning, middle, and end", () => {
    expect(findActiveHashtag("#", 1)?.query).toBe("");
    expect(findActiveHashtag("Plan #dee", 9)?.query).toBe("dee");
    expect(findActiveHashtag("Plan (#q3) later", 9)?.query).toBe("q3");
    expect(findActiveHashtag("Done #review", 12)?.query).toBe("review");
  });

  it("does not trigger inside email addresses or URLs", () => {
    expect(findActiveHashtag("person#planning@example.com", 15)).toBeNull();
    expect(findActiveHashtag("https://example.com/#planning", 29)).toBeNull();
  });

  it("deduplicates case-insensitively and accepts trailing punctuation", () => {
    expect(parseHashtagTokens("#Planning, then #planning and #deep_work.")).toEqual([
      { start: 0, end: 9, token: "Planning", normalizedName: "planning" },
      { start: 30, end: 40, token: "deep_work", normalizedName: "deep_work" }
    ]);
  });

  it("stops associating a tag after its token is removed", () => {
    expect(parseHashtagTokens("Plan #deep-work")).toHaveLength(1);
    expect(parseHashtagTokens("Plan deep-work")).toHaveLength(0);
  });
});

describe("hashtag insertion", () => {
  it("consumes a selected temporary token without damaging description spacing", () => {
    const middle = "Plan #dee then review";
    expect(consumeActiveHashtag(middle, findActiveHashtag(middle, 9)!)).toEqual({
      caret: 5,
      text: "Plan then review"
    });
    const end = "Plan #dee";
    expect(consumeActiveHashtag(end, findActiveHashtag(end, end.length)!)).toEqual({
      caret: 4,
      text: "Plan"
    });
  });

  it("inserts a mobile hashtag starter at the caret with a safe boundary", () => {
    expect(insertHashtagStarter("Plan", { start: 4, end: 4 })).toEqual({
      caret: 6,
      text: "Plan #"
    });
    expect(insertHashtagStarter("Plan later", { start: 5, end: 10 })).toEqual({
      caret: 6,
      text: "Plan #"
    });
  });

  it("replaces the whole token at the caret and preserves punctuation", () => {
    const text = "Plan #pl, then review";
    const active = findActiveHashtag(text, 8);
    expect(active).not.toBeNull();
    expect(replaceActiveHashtag(text, active!, "Planning")).toEqual({
      caret: 14,
      text: "Plan #planning, then review"
    });
  });

  it("maps inline slugs back to canonical display names", () => {
    expect(tagNamesFromDescription("#planning #deep-work #planning", [
      { name: "Planning", normalizedName: "planning" },
      { name: "Deep work", normalizedName: "deep-work" }
    ])).toEqual(["Planning", "Deep work"]);
  });
});
