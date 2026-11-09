// Pure spend analysis: compares a recent window of AI Gateway spend to the
// window just before it. All arithmetic lives here so the model never has to
// compute a percentage or a dollar figure itself.

export interface SpendRow {
  /** The value of the grouping dimension: a model id, a tag, or a YYYY-MM-DD day. */
  key: string;
  totalCost: number;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export interface WindowData {
  byModel: SpendRow[];
  byTag: SpendRow[];
  byDay: SpendRow[];
}

export interface Thresholds {
  /** Ignore changes smaller than this many dollars, however large in percent. */
  minDollars: number;
  /** Flag a group whose spend changed by at least this fraction (0.5 = 50%). */
  minRatio: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { minDollars: 1, minRatio: 0.5 };

export type ChangeKind = "new" | "gone" | "up" | "down" | "flat";

export interface GroupChange {
  key: string;
  current: number;
  baseline: number;
  delta: number;
  /** delta / baseline, or null when there was no baseline spend. */
  pctChange: number | null;
  kind: ChangeKind;
  flagged: boolean;
  currentRequests: number | null;
  baselineRequests: number | null;
  /** Average cost of one request, when request counts are available. */
  currentCostPerRequest: number | null;
  baselineCostPerRequest: number | null;
  currentInputTokensPerRequest: number | null;
  baselineInputTokensPerRequest: number | null;
  /** Share of input tokens served from the prompt cache, 0 to 1. */
  currentCacheHitRate: number | null;
}

export interface DaySpike {
  day: string;
  cost: number;
  /** Median daily spend over the baseline window. */
  baselineMedian: number;
  /** cost / baselineMedian, or null when the baseline median is 0. */
  multiple: number | null;
}

export interface SpendAnalysis {
  window: { start: string; end: string; days: number };
  baselineWindow: { start: string; end: string; days: number };
  thresholds: Thresholds;
  total: { current: number; baseline: number; delta: number; pctChange: number | null };
  byModel: GroupChange[];
  byTag: GroupChange[];
  /** Days in the current window that cost at least twice the baseline median day. */
  spikeDays: DaySpike[];
  hasTags: boolean;
  /** True when the baseline window has no spend, so changes cannot be judged. */
  noBaseline: boolean;
  flaggedCount: number;
}

const round = (n: number, digits = 4) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const sum = (rows: SpendRow[]) => rows.reduce((acc, r) => acc + r.totalCost, 0);

function perRequest(value: number | undefined, requests: number | undefined): number | null {
  if (value === undefined || !requests) return null;
  return value / requests;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function compareGroups(
  current: SpendRow[],
  baseline: SpendRow[],
  thresholds: Thresholds,
): GroupChange[] {
  const cur = new Map(current.map((r) => [r.key, r]));
  const base = new Map(baseline.map((r) => [r.key, r]));
  const keys = new Set([...cur.keys(), ...base.keys()]);

  const changes: GroupChange[] = [];
  for (const key of keys) {
    const c = cur.get(key);
    const b = base.get(key);
    const currentCost = c?.totalCost ?? 0;
    const baselineCost = b?.totalCost ?? 0;
    const delta = currentCost - baselineCost;
    const pctChange = baselineCost > 0 ? delta / baselineCost : null;

    let kind: ChangeKind;
    if (baselineCost === 0 && currentCost > 0) kind = "new";
    else if (currentCost === 0 && baselineCost > 0) kind = "gone";
    else if (pctChange !== null && pctChange >= thresholds.minRatio) kind = "up";
    else if (pctChange !== null && pctChange <= -thresholds.minRatio) kind = "down";
    else kind = "flat";

    const flagged = kind !== "flat" && Math.abs(delta) >= thresholds.minDollars;
    const cacheHitRate =
      c?.cachedInputTokens !== undefined && c.inputTokens ? c.cachedInputTokens / c.inputTokens : null;

    changes.push({
      key,
      current: round(currentCost),
      baseline: round(baselineCost),
      delta: round(delta),
      pctChange: pctChange === null ? null : round(pctChange, 3),
      kind,
      flagged,
      currentRequests: c?.requestCount ?? null,
      baselineRequests: b?.requestCount ?? null,
      currentCostPerRequest: nullableRound(perRequest(c?.totalCost, c?.requestCount), 6),
      baselineCostPerRequest: nullableRound(perRequest(b?.totalCost, b?.requestCount), 6),
      currentInputTokensPerRequest: nullableRound(perRequest(c?.inputTokens, c?.requestCount), 0),
      baselineInputTokensPerRequest: nullableRound(perRequest(b?.inputTokens, b?.requestCount), 0),
      currentCacheHitRate: nullableRound(cacheHitRate, 3),
    });
  }

  // Biggest absolute dollar movement first, so the report leads with what matters.
  return changes.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.key.localeCompare(y.key));
}

function nullableRound(n: number | null, digits: number) {
  return n === null ? null : round(n, digits);
}

export function findSpikeDays(currentDays: SpendRow[], baselineDays: SpendRow[], baselineDayCount: number): DaySpike[] {
  // Days with no spend are missing from the report, so pad the baseline with zeros.
  const baselineCosts = baselineDays.map((d) => d.totalCost);
  while (baselineCosts.length < baselineDayCount) baselineCosts.push(0);
  const med = median(baselineCosts);

  return currentDays
    .filter((d) => (med > 0 ? d.totalCost >= 2 * med : false))
    .map((d) => ({
      day: d.key,
      cost: round(d.totalCost),
      baselineMedian: round(med),
      multiple: med > 0 ? round(d.totalCost / med, 2) : null,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function analyzeSpend(
  current: WindowData,
  baseline: WindowData,
  window: SpendAnalysis["window"],
  baselineWindow: SpendAnalysis["baselineWindow"],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): SpendAnalysis {
  // Totals come from the day rows: every request has a day, while not every
  // request has a tag, and one request can carry several tags.
  const currentTotal = sum(current.byDay);
  const baselineTotal = sum(baseline.byDay);
  const delta = currentTotal - baselineTotal;

  const byModel = compareGroups(current.byModel, baseline.byModel, thresholds);
  const byTag = compareGroups(current.byTag, baseline.byTag, thresholds);

  return {
    window,
    baselineWindow,
    thresholds,
    total: {
      current: round(currentTotal),
      baseline: round(baselineTotal),
      delta: round(delta),
      pctChange: baselineTotal > 0 ? round(delta / baselineTotal, 3) : null,
    },
    byModel,
    byTag,
    spikeDays: findSpikeDays(current.byDay, baseline.byDay, baselineWindow.days),
    hasTags: current.byTag.length > 0 || baseline.byTag.length > 0,
    noBaseline: baselineTotal === 0,
    flaggedCount: [...byModel, ...byTag].filter((c) => c.flagged).length,
  };
}

/** Inclusive YYYY-MM-DD windows: the last `days` full UTC days, and the `days` before them. */
export function windowsEndingYesterday(days: number, now: Date = new Date()) {
  const dayMs = 86_400_000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const end = today - dayMs;
  const start = end - (days - 1) * dayMs;
  const baselineEnd = start - dayMs;
  const baselineStart = baselineEnd - (days - 1) * dayMs;
  return {
    window: { start: iso(start), end: iso(end), days },
    baselineWindow: { start: iso(baselineStart), end: iso(baselineEnd), days },
  };
}
