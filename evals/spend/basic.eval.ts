import { defineEval } from "eve/evals";

import { analyzeStub, ASK, saveStub, spikeWeek } from "../fixtures/spend";

export default defineEval({
  description: "A spike week: one analyze_spend call, the totals, the drivers, the spike start, and a caching suggestion.",
  async test(t) {
    const session = await t.session({ stubs: [analyzeStub(spikeWeek), saveStub] });
    const turn = await session.send(ASK);

    turn.expectOk();
    turn.calledTool("analyze_spend", { input: { days: 7 }, count: 1 });
    turn.notCalledTool("save_report");
    turn.messageIncludes("$39.40");
    turn.messageIncludes("$16.10");
    turn.messageIncludes(/\+145%/);
    turn.messageIncludes("claude-opus-4.5");
    turn.messageIncludes("feature:summarize");
    turn.messageIncludes(/\+317%/);
    turn.messageIncludes("2026-11-05");
    turn.messageIncludes(/cach/i);
    // Spike days 2026-11-05 through 2026-11-08 are consecutive, so they collapse into one run.
    turn.messageIncludes(/2026-11-05 (to|through|–|-) 2026-11-08/);
  },
});
