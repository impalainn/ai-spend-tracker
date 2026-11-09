import type { ToolStub } from "eve/evals";

import { analyzeSpend, type SpendAnalysis, type SpendRow } from "../../agent/lib/analyze.ts";

// Made-up spend for a fake team, so evals can assert exact numbers. Built with the
// real analyzeSpend, so the fixtures have the same shape and math as live output.

const WINDOW = { start: "2026-11-02", end: "2026-11-08", days: 7 };
const BASELINE = { start: "2026-10-26", end: "2026-11-01", days: 7 };

const days = (start: string, costs: number[]): SpendRow[] =>
  costs.map((totalCost, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { key: d.toISOString().slice(0, 10), totalCost };
  });

const baselineWeek = {
  byDay: days(BASELINE.start, [2.3, 2.4, 2.2, 2.3, 2.3, 2.2, 2.4]), // $16.10
  byModel: [
    { key: "anthropic/claude-haiku-4.5", totalCost: 12.6, requestCount: 1800, inputTokens: 2_700_000, cachedInputTokens: 900_000 },
    { key: "openai/gpt-5-mini", totalCost: 3.5, requestCount: 900, inputTokens: 1_100_000, cachedInputTokens: 0 },
  ],
  byTag: [
    { key: "feature:chat", totalCost: 9.1, requestCount: 1500 },
    { key: "feature:summarize", totalCost: 7.0, requestCount: 1200 },
  ],
};

/**
 * On 2026-11-05 the summarize feature moved most of its traffic from Haiku to Opus,
 * with longer prompts and almost no prompt caching. Total: $39.40 vs $16.10 (+145%).
 */
export const spikeWeek: SpendAnalysis = analyzeSpend(
  {
    byDay: days(WINDOW.start, [2.3, 2.2, 2.4, 9.1, 8.0, 7.6, 7.8]), // $39.40
    byModel: [
      { key: "anthropic/claude-opus-4.5", totalCost: 31.2, requestCount: 600, inputTokens: 2_400_000, cachedInputTokens: 120_000 },
      { key: "anthropic/claude-haiku-4.5", totalCost: 4.2, requestCount: 600, inputTokens: 900_000, cachedInputTokens: 300_000 },
      { key: "openai/gpt-5-mini", totalCost: 3.6, requestCount: 920, inputTokens: 1_120_000, cachedInputTokens: 0 },
      { key: "google/gemini-3.5-flash", totalCost: 0.4, requestCount: 80, inputTokens: 90_000, cachedInputTokens: 0 },
    ],
    byTag: [
      { key: "feature:summarize", totalCost: 29.2, requestCount: 1300 },
      { key: "feature:chat", totalCost: 9.8, requestCount: 820 },
    ],
  },
  baselineWeek,
  WINDOW,
  BASELINE,
);

/** Small movements only: $16.40 vs $16.10. Nothing should be flagged. */
export const quietWeek: SpendAnalysis = analyzeSpend(
  {
    byDay: days(WINDOW.start, [2.3, 2.4, 2.3, 2.4, 2.3, 2.3, 2.4]),
    byModel: [
      { key: "anthropic/claude-haiku-4.5", totalCost: 12.8, requestCount: 1830, inputTokens: 2_750_000, cachedInputTokens: 910_000 },
      { key: "openai/gpt-5-mini", totalCost: 3.6, requestCount: 910, inputTokens: 1_110_000, cachedInputTokens: 0 },
    ],
    byTag: [
      { key: "feature:chat", totalCost: 9.3, requestCount: 1520 },
      { key: "feature:summarize", totalCost: 7.1, requestCount: 1220 },
    ],
  },
  baselineWeek,
  WINDOW,
  BASELINE,
);

/** A new team: spend only this week, and no request tags. $5.25 total. */
export const firstWeek: SpendAnalysis = analyzeSpend(
  {
    byDay: days("2026-11-06", [1.5, 2.0, 1.75]),
    byModel: [
      { key: "openai/gpt-5", totalCost: 4.5, requestCount: 150, inputTokens: 300_000, cachedInputTokens: 0 },
      { key: "openai/gpt-5-mini", totalCost: 0.75, requestCount: 300, inputTokens: 200_000, cachedInputTokens: 0 },
    ],
    byTag: [],
  },
  { byDay: [], byModel: [], byTag: [] },
  WINDOW,
  BASELINE,
);

export const analyzeStub = (analysis: SpendAnalysis): ToolStub => ({
  id: "analyze",
  tool: "analyze_spend",
  outcome: { response: JSON.parse(JSON.stringify(analysis)) },
});

export const paidPlanStub = {
  id: "analyze-paid-plan",
  tool: "analyze_spend",
  outcome: {
    // The exact message lib/spend.ts produces for the live 403 response.
    throw: {
      message:
        'AI Gateway spend reports require a paid Vercel plan (the API said: "Spend report access requires a paid plan. Please upgrade your plan to use this feature."). Upgrade the team to Pro, or check spend in the dashboard\'s AI Gateway tab.',
    },
  },
} satisfies ToolStub;

export const creditsStub = {
  id: "credits",
  tool: "get_credit_balance",
  outcome: { response: { balanceUsd: 14.05279935, totalUsedUsd: 0.94720065 } },
} satisfies ToolStub;

export const saveStub = {
  id: "save",
  tool: "save_report",
  outcome: { response: { saved: "reports/2026-11-09.md" } },
} satisfies ToolStub;

export const ASK = "How did our AI spend change this week?";

/** Every dollar figure (2 decimals) and whole percent (changes, cache hit rates, threshold) a report about `analysis` may contain. */
export function allowedFigures(analysis: SpendAnalysis) {
  const dollars = new Set<string>();
  const percents = new Set<number>();
  const visit = (value: unknown, key = "") => {
    if (typeof value === "number") {
      if (key === "pctChange") percents.add(Math.round(Math.abs(value) * 100));
      else if (key === "minRatio" || key.endsWith("CacheHitRate")) percents.add(Math.round(value * 100));
      else dollars.add(Math.abs(value).toFixed(2));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, Array.isArray(value) ? key : k);
    }
  };
  visit(analysis);
  return { dollars, percents };
}
