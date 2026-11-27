/**
 * @jest-environment node
 *
 * Unit tests for src/server/services/gift-search.service.ts (Issue #513).
 *
 * Confirms that gift message search uses the `message_tsv` tsvector column
 * (to_tsquery / ts_rank) instead of an ILIKE scan, and that results are
 * returned ranked and scoped to the requesting sender.
 */

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import pool from "@/lib/db";
import { searchGiftMessages, toTsQuery } from "../gift-search.service";

const mockQuery = pool.query as jest.Mock;

describe("toTsQuery", () => {
  it("converts free text into AND-joined prefix terms", () => {
    expect(toTsQuery("happy birthday")).toBe("happy:* & birthday:*");
  });

  it("strips punctuation and drops empty terms", () => {
    expect(toTsQuery("  hello!! -- world??  ")).toBe("hello:* & world:*");
  });

  it("returns an empty string for input with no searchable terms", () => {
    expect(toTsQuery("   !!! ")).toBe("");
  });
});

describe("searchGiftMessages", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("queries using to_tsquery/ts_rank against message_tsv, not ILIKE", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchGiftMessages("sender-1", "birthday wishes", 10);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("to_tsquery");
    expect(sql).toContain("ts_rank");
    expect(sql).toContain("message_tsv");
    expect(sql).not.toMatch(/ILIKE/i);
    expect(params).toEqual(["sender-1", "birthday:* & wishes:*", 10]);
  });

  it("returns rows ranked by relevance as given by the query", async () => {
    const rows = [
      { id: "gift-1", message: "happy birthday!", rank: 0.9 },
      { id: "gift-2", message: "happy belated birthday", rank: 0.4 },
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await searchGiftMessages("sender-1", "birthday");

    expect(result).toEqual(rows);
  });

  it("caps the limit at 100", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchGiftMessages("sender-1", "birthday", 500);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe(100);
  });

  it("short-circuits without querying when the search text has no terms", async () => {
    const result = await searchGiftMessages("sender-1", "   ");

    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
