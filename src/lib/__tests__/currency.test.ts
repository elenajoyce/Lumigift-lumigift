import {
  formatNGN,
  formatUSDC,
  usdToNgn,
  ngnToUsd,
  formatRateTimestamp,
} from "@/lib/currency";

describe("currency formatters", () => {
  describe("formatNGN", () => {
    it.each([
      [0, "₦0.00"],
      [1000, "₦1,000.00"],
      [-2500.5, "-₦2,500.50"],
      [1234567890.12, "₦1,234,567,890.12"],
      ["5000", "₦5,000.00"],
    ])("formats %p as %s", (amount, expected) => {
      expect(formatNGN(amount)).toBe(expected);
    });
  });

  describe("formatUSDC", () => {
    it.each([
      [0, "0.00 USDC"],
      [1, "1.00 USDC"],
      ["3.0000000", "3.00 USDC"],
      [-12.345, "-12.35 USDC"],
      [1234567890.12, "1,234,567,890.12 USDC"],
    ])("formats %p as %s", (amount, expected) => {
      expect(formatUSDC(amount)).toBe(expected);
    });
  });

  it("rejects non-finite amounts", () => {
    expect(() => formatNGN(Number.NaN)).toThrow(TypeError);
    expect(() => formatUSDC("not-a-number")).toThrow(TypeError);
  });
});

describe("currency conversion helpers", () => {
  describe("usdToNgn", () => {
    it("converts 1 USD at 1500 NGN/USDC to 1500 NGN", () => {
      expect(usdToNgn(1, 1500)).toBe(1500);
    });

    it("converts whole amounts exactly", () => {
      expect(usdToNgn(10, 1500)).toBe(15000);
      expect(usdToNgn(0.5, 1500)).toBe(750);
    });

    it("rounds fractional kobo up (ceiling) to avoid undercharging", () => {
      // 0.333 * 1500 = 499.5 -> ceiling to 500
      expect(usdToNgn(0.333, 1500)).toBe(500);
      // 0.0001 * 1500 = 0.15 -> ceiling to 1
      expect(usdToNgn(0.0001, 1500)).toBe(1);
      // 1.0001 * 1500 = 1500.15 -> ceiling to 1501
      expect(usdToNgn(1.0001, 1500)).toBe(1501);
    });

    it("returns 0 for zero input", () => {
      expect(usdToNgn(0, 1500)).toBe(0);
    });

    it("handles negative inputs symmetrically", () => {
      expect(usdToNgn(-1, 1500)).toBe(-1500);
      // -0.333 * 1500 = -499.5 -> ceiling to -499
      expect(usdToNgn(-0.333, 1500)).toBe(-499);
    });

    it("accepts string amounts", () => {
      expect(usdToNgn("2", 1500)).toBe(3000);
      expect(usdToNgn("0.333", 1500)).toBe(500);
    });

    it("throws on non-finite amount or rate", () => {
      expect(() => usdToNgn(Number.NaN, 1500)).toThrow(TypeError);
      expect(() => usdToNgn(Number.POSITIVE_INFINITY, 1500)).toThrow(TypeError);
      expect(() => usdToNgn(1, Number.NaN)).toThrow(TypeError);
      expect(() => usdToNgn(1, 0)).toThrow(TypeError);
      expect(() => usdToNgn(1, -1500)).toThrow(TypeError);
      expect(() => usdToNgn("not-a-number", 1500)).toThrow(TypeError);
    });
  });

  describe("ngnToUsd", () => {
    it("converts 1000 NGN at 1500 NGN/USDC to 0.66 USD", () => {
      expect(ngnToUsd(1000, 1500)).toBe(0.66);
    });

    it("floors fractional cents to avoid overstating USD", () => {
      // 1000 / 1500 = 0.6666... -> floor to 0.66
      expect(ngnToUsd(1000, 1500)).toBe(0.66);
      // 1 / 1500 = 0.000666... -> floor to 0.00
      expect(ngnToUsd(1, 1500)).toBe(0);
      // 1499 / 1500 = 0.99933... -> floor to 0.99
      expect(ngnToUsd(1499, 1500)).toBe(0.99);
    });

    it("converts exact multiples without rounding", () => {
      expect(ngnToUsd(1500, 1500)).toBe(1);
      expect(ngnToUsd(3000, 1500)).toBe(2);
    });

    it("returns 0 for zero input", () => {
      expect(ngnToUsd(0, 1500)).toBe(0);
    });

    it("handles negative inputs symmetrically", () => {
      expect(ngnToUsd(-1500, 1500)).toBe(-1);
      // -1000 / 1500 = -0.6666... -> floor to -0.67
      expect(ngnToUsd(-1000, 1500)).toBe(-0.67);
    });

    it("accepts string amounts", () => {
      expect(ngnToUsd("1500", 1500)).toBe(1);
      expect(ngnToUsd("1000", 1500)).toBe(0.66);
    });

    it("throws on non-finite amount or rate", () => {
      expect(() => ngnToUsd(Number.NaN, 1500)).toThrow(TypeError);
      expect(() => ngnToUsd(Number.NEGATIVE_INFINITY, 1500)).toThrow(TypeError);
      expect(() => ngnToUsd(1000, Number.NaN)).toThrow(TypeError);
      expect(() => ngnToUsd(1000, 0)).toThrow(TypeError);
      expect(() => ngnToUsd(1000, -1500)).toThrow(TypeError);
      expect(() => ngnToUsd("not-a-number", 1500)).toThrow(TypeError);
    });
  });

  describe("formatRateTimestamp", () => {
    it("formats a Date as 'Rate as of HH:MM'", () => {
      const date = new Date(2024, 0, 15, 9, 5, 0);
      expect(formatRateTimestamp(date)).toBe("Rate as of 09:05");
    });

    it("pads hours and minutes to two digits", () => {
      const date = new Date(2024, 0, 15, 0, 0, 0);
      expect(formatRateTimestamp(date)).toBe("Rate as of 00:00");
    });

    it("formats a timestamp number", () => {
      const date = new Date(2024, 0, 15, 23, 59, 0);
      expect(formatRateTimestamp(date.getTime())).toBe("Rate as of 23:59");
    });

    it("formats an ISO string", () => {
      const date = new Date(2024, 0, 15, 14, 30, 0);
      expect(formatRateTimestamp(date.toISOString())).toBe("Rate as of 14:30");
    });

    it("throws on invalid input", () => {
      expect(() => formatRateTimestamp("not-a-date")).toThrow(TypeError);
      expect(() => formatRateTimestamp(Number.NaN)).toThrow(TypeError);
    });
  });
});