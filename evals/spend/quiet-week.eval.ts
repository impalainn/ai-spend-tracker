import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { analyzeStub, ASK, quietWeek } from "../fixtures/spend";

export default defineEval({
  description: "A week with no flagged changes gets a short 'nothing unusual' reply, not sections.",
  async test(t) {
    const session = await t.session({ stubs: [analyzeStub(quietWeek)] });
    const turn = await session.send(ASK);
    turn.expectOk();
    turn.calledTool("analyze_spend", { count: 1 });

    turn.messageIncludes("$16.40");
    turn.messageIncludes(/nothing unusual/i);
    const message = turn.message ?? "";
    t.check(message, satisfies((text: string) => !/^## /m.test(text), "no section headings"));
    t.check(message, satisfies((text: string) => text.split(/\s+/).length < 80, "short reply"));
  },
});
