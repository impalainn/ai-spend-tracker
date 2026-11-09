import { defineTool } from "eve/tools";
import { z } from "zod";

import { getSpendAnalysis } from "../lib/spend";

export default defineTool({
  description:
    "Compare AI Gateway spend over the last N full UTC days with the N days before. Returns totals, per-model and per-tag changes (already computed, with flags), and spike days. Call this once per report.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(30).default(7).describe("Length of each window in days."),
    minDollars: z
      .number()
      .min(0)
      .optional()
      .describe("Ignore changes smaller than this many dollars. Defaults to 1."),
    minRatio: z
      .number()
      .min(0)
      .optional()
      .describe("Flag changes of at least this fraction, such as 0.5 for 50%. Defaults to 0.5."),
  }),
  label: {
    start: ({ days }) => `Compare the last ${days} days of AI spend`,
  },
  async execute({ days, minDollars, minRatio }) {
    return getSpendAnalysis({
      days,
      thresholds: {
        ...(minDollars !== undefined && { minDollars }),
        ...(minRatio !== undefined && { minRatio }),
      },
    });
  },
});
