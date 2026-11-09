import { defineEval } from "eve/evals";

import { analyzeStub, saveStub, spikeWeek } from "../fixtures/spend";

export default defineEval({
  description: "The daily schedule's prompt analyzes spend, then saves the finished report.",
  async test(t) {
    // Mirrors agent/schedules/daily-spend-check.md.
    const session = await t.session({ stubs: [analyzeStub(spikeWeek), saveStub] });
    const turn = await session.send(
      "Write the AI spend report comparing the last 7 days with the 7 days before, then save it with `save_report`.",
    );

    turn.expectOk();
    turn.toolOrder(["analyze_spend", "save_report"]);
    turn.calledTool("save_report", { input: { markdown: /\$39\.40[\s\S]*claude-opus-4\.5/ }, count: 1 });
  },
});
