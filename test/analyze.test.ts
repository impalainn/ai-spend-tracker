import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeSpend, compareGroups, findSpikeDays, windowsEndingYesterday } from "../agent/lib/analyze.ts";
import { getCreditBalance, getSpendAnalysis, type SpendClient } from "../agent/lib/spend.ts";

const T = { minDollars: 1, minRatio: 0.5 };

test("windows are full UTC days ending yesterday", () => {
  const w = windowsEndingYesterday(7, new Date("2026-11-09T06:30:00Z"));
  assert.deepEqual(w.window, { start: "2026-11-02", end: "2026-11-08", days: 7 });
  assert.deepEqual(w.baselineWindow, { start: "2026-10-26", end: "2026-11-01", days: 7 });
  const one = windowsEndingYesterday(1, new Date("2026-03-01T00:00:00Z"));
  assert.deepEqual(one.window, { start: "2026-02-28", end: "2026-02-28", days: 1 });
  assert.deepEqual(one.baselineWindow, { start: "2026-02-27", end: "2026-02-27", days: 1 });
});

test("compareGroups classifies new, gone, up, down, flat and applies the dollar floor", () => {
  const changes = compareGroups(
    [
      { key: "up", totalCost: 30 },
      { key: "new", totalCost: 5 },
      { key: "flat", totalCost: 11 },
      { key: "tiny-up", totalCost: 0.3 },
      { key: "down", totalCost: 2 },
    ],
    [
      { key: "up", totalCost: 10 },
      { key: "flat", totalCost: 10 },
      { key: "tiny-up", totalCost: 0.1 },
      { key: "down", totalCost: 8 },
      { key: "gone", totalCost: 4 },
    ],
    T,
  );
  const by = Object.fromEntries(changes.map((c) => [c.key, c]));
  assert.equal(by.up!.kind, "up");
  assert.equal(by.up!.pctChange, 2);
  assert.equal(by.up!.flagged, true);
  assert.equal(by.new!.kind, "new");
  assert.equal(by.new!.pctChange, null);
  assert.equal(by.flat!.kind, "flat");
  assert.equal(by.flat!.flagged, false);
  assert.equal(by["tiny-up"]!.kind, "up");
  assert.equal(by["tiny-up"]!.flagged, false, "a 200% change under $1 is not flagged");
  assert.equal(by.down!.kind, "down");
  assert.equal(by.gone!.kind, "gone");
  assert.equal(by.gone!.delta, -4);
  assert.equal(changes[0]!.key, "up", "sorted by absolute dollar change");
});

test("per-request figures and cache hit rate", () => {
  const [c] = compareGroups(
    [{ key: "m", totalCost: 20, requestCount: 100, inputTokens: 400_000, cachedInputTokens: 40_000 }],
    [{ key: "m", totalCost: 10, requestCount: 100, inputTokens: 200_000 }],
    T,
  );
  assert.equal(c!.currentCostPerRequest, 0.2);
  assert.equal(c!.baselineCostPerRequest, 0.1);
  assert.equal(c!.currentInputTokensPerRequest, 4000);
  assert.equal(c!.baselineInputTokensPerRequest, 2000);
  assert.equal(c!.currentCacheHitRate, 0.1);
});

test("spike days pad missing baseline days with zeros", () => {
  // Baseline has spend on only 3 of 7 days: median of [0,0,0,0,1,1,1] is 0, so no spikes.
  assert.deepEqual(
    findSpikeDays([{ key: "2026-11-05", totalCost: 50 }], [1, 1, 1].map((c, i) => ({ key: `b${i}`, totalCost: c })), 7),
    [],
  );
  const spikes = findSpikeDays(
    [
      { key: "2026-11-05", totalCost: 9 },
      { key: "2026-11-04", totalCost: 3.9 },
    ],
    Array.from({ length: 7 }, (_, i) => ({ key: `b${i}`, totalCost: 2 })),
    7,
  );
  assert.deepEqual(spikes, [{ day: "2026-11-05", cost: 9, baselineMedian: 2, multiple: 4.5 }]);
});

test("analyzeSpend totals come from days, and noBaseline is set", () => {
  const w = { start: "a", end: "b", days: 7 };
  const a = analyzeSpend(
    { byDay: [{ key: "d1", totalCost: 3 }], byModel: [{ key: "m", totalCost: 3 }], byTag: [] },
    { byDay: [], byModel: [], byTag: [] },
    w,
    w,
  );
  assert.equal(a.noBaseline, true);
  assert.equal(a.total.pctChange, null);
  assert.equal(a.hasTags, false);
  assert.equal(a.total.current, 3);
});

function fakeClient(overrides: Partial<SpendClient> = {}): SpendClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async getSpendReport(params) {
      calls.push(params);
      const current = params.startDate === "2026-11-02";
      if (params.groupBy === "day") return { results: [{ day: params.startDate, totalCost: current ? 12 : 4 }] };
      if (params.groupBy === "model") return { results: [{ model: "openai/gpt-5", totalCost: current ? 12 : 4, requestCount: 10 }] };
      return { results: [] };
    },
    async getCredits() {
      return { balance: "14.05", totalUsed: "0.95" };
    },
    ...overrides,
  };
}

test("getSpendAnalysis queries both windows for day, model and tag", async () => {
  const client = fakeClient();
  const a = await getSpendAnalysis({ days: 7, now: new Date("2026-11-09T12:00:00Z") }, client);
  assert.equal(client.calls.length, 6);
  assert.equal(a.total.current, 12);
  assert.equal(a.total.baseline, 4);
  assert.equal(a.byModel[0]!.flagged, true);
});

test("a paid-plan 403 becomes a clear message", async () => {
  const client = fakeClient({
    async getSpendReport() {
      throw Object.assign(new Error("Spend report access requires a paid plan. Please upgrade your plan to use this feature."), { statusCode: 403 });
    },
  });
  await assert.rejects(getSpendAnalysis({ days: 7 }, client), /require a paid Vercel plan/);
});

test("credit balance is parsed to numbers", async () => {
  assert.deepEqual(await getCreditBalance(fakeClient()), { balanceUsd: 14.05, totalUsedUsd: 0.95 });
});
