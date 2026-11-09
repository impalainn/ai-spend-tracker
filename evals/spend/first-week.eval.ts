import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { analyzeStub, ASK, firstWeek } from "../fixtures/spend";

export default defineEval({
  description: "With no earlier spend and no tags, report the total and top models, call nothing new or a spike, and suggest tagging.",
  async test(t) {
    const session = await t.session({ stubs: [analyzeStub(firstWeek)] });
    const turn = await session.send(ASK);
    turn.expectOk();

    turn.messageIncludes("$5.25");
    turn.messageIncludes("openai/gpt-5");
    turn.messageIncludes(/no (earlier|previous|prior)|nothing to compare|no .*baseline/i);
    turn.messageIncludes(/tags/i);
    const message = turn.message ?? "";
    t.check(message, satisfies((text: string) => !/spike/i.test(text), "does not call anything a spike"));
    t.check(message, satisfies((text: string) => !/\+\d+%/.test(text), "no percent increases without a baseline"));
  },
});
