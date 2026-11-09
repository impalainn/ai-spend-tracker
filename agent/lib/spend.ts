// Reads AI Gateway spend through the AI SDK's gateway client.
// Spend reports: https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting
import { gateway } from "ai";

import {
  analyzeSpend,
  DEFAULT_THRESHOLDS,
  type SpendAnalysis,
  type SpendRow,
  type Thresholds,
  type WindowData,
  windowsEndingYesterday,
} from "./analyze.ts";

type GroupBy = "day" | "model" | "tag";

interface ReportRow {
  day?: string;
  model?: string;
  tag?: string;
  totalCost: number;
  requestCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

/** The subset of the AI SDK gateway provider this module uses; tests pass a fake. */
export interface SpendClient {
  getSpendReport(params: {
    startDate: string;
    endDate: string;
    groupBy: GroupBy;
  }): Promise<{ results: ReportRow[] }>;
  getCredits(): Promise<{ balance: string; totalUsed: string }>;
}

export class SpendSourceError extends Error {}

/** Turns gateway errors into one sentence the agent can repeat to the user. */
function explain(error: unknown): SpendSourceError {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (/paid plan/i.test(message)) {
    return new SpendSourceError(
      `AI Gateway spend reports require a paid Vercel plan (the API said: "${message}"). Upgrade the team to Pro, or check spend in the dashboard's AI Gateway tab.`,
    );
  }
  if (status === 401 || /api key|authentication|unauthorized|oidc/i.test(message)) {
    return new SpendSourceError(
      `AI Gateway rejected the credentials (${message}). Set AI_GATEWAY_API_KEY in .env.local, or deploy on Vercel to use OIDC.`,
    );
  }
  return new SpendSourceError(`AI Gateway spend report failed: ${message}`);
}

function toRows(results: ReportRow[], groupBy: GroupBy): SpendRow[] {
  return results.map((r) => ({
    key: (groupBy === "day" ? r.day : groupBy === "model" ? r.model : r.tag) ?? "(none)",
    totalCost: r.totalCost,
    requestCount: r.requestCount,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedInputTokens: r.cachedInputTokens,
  }));
}

async function fetchWindow(client: SpendClient, start: string, end: string): Promise<WindowData> {
  const query = (groupBy: GroupBy) =>
    client.getSpendReport({ startDate: start, endDate: end, groupBy }).then((r) => toRows(r.results, groupBy));
  const [byDay, byModel, byTag] = await Promise.all([query("day"), query("model"), query("tag")]);
  return { byDay, byModel, byTag };
}

export async function getSpendAnalysis(
  options: { days: number; thresholds?: Partial<Thresholds>; now?: Date },
  client: SpendClient = gateway,
): Promise<SpendAnalysis> {
  const { window, baselineWindow } = windowsEndingYesterday(options.days, options.now);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  try {
    const [current, baseline] = await Promise.all([
      fetchWindow(client, window.start, window.end),
      fetchWindow(client, baselineWindow.start, baselineWindow.end),
    ]);
    return analyzeSpend(current, baseline, window, baselineWindow, thresholds);
  } catch (error) {
    throw explain(error);
  }
}

export async function getCreditBalance(client: SpendClient = gateway) {
  try {
    const credits = await client.getCredits();
    return { balanceUsd: Number(credits.balance), totalUsedUsd: Number(credits.totalUsed) };
  } catch (error) {
    throw explain(error);
  }
}
