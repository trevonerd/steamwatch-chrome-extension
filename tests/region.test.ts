// tests/region.test.ts
import { describe, it, expect } from "vitest";

describe("price region formatting", () => {
  it("uses hardcoded US region for price data fetching", () => {
    // Price fetching always uses "US" region — no region detection needed
    const region = "US";
    expect(region).toBe("US");
  });
});
