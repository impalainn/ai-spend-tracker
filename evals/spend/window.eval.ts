import { defineEval } from "eve/evals";

import { analyzeStub, spikeWeek } from "../fixtures/spend";

export default defineEval({
  description: "A question about yesterday uses a 1-day window.",
  async test(t) {
    const session = await t.session({ stubs: [analyzeStub(spikeWeek)] });
    const turn = await session.send("Did anything weird happen with our AI spend yesterday?");
    turn.expectOk();
    turn.calledTool("analyze_spend", { input: { days: 1 }, count: 1 });
  },
});
