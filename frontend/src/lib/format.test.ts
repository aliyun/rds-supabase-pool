import { describe, expect, it } from "vitest";
import { compactId, cx, formatBytes, formatDateTime, formatDuration, formatNumber, shortId } from "./format";

describe("format helpers", () => {
  it("joins class names and drops falsy values", () => {
    expect(cx("a", false && "b", "c")).toBe("a c");
  });

  it("formats numbers with grouping", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(65)).toBe("1m 5s");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("truncates identifiers", () => {
    expect(shortId("abcdefghij", 8)).toBe("abcdefgh…");
    expect(compactId("abcdefghijkl", 10)).toBe("abcdefghij");
    expect(shortId(null)).toBe("—");
  });

  it("handles invalid dates", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
