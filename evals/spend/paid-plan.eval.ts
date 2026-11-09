import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { ASK, creditsStub, paidPlanStub, saveStub } from "../fixtures/spend";

export default defineEval({
  description: "When spend reports need a paid plan, explain it, give the credit balance, and write no report.",
  async test(t) {
    const session = await t.session({ stubs: [paidPlanStub, creditsStub, saveStub] });
    const turn = await session.send(ASK);
    turn.expectOk();

    turn.calledTool("analyze_spend", { status: "failed" });
    turn.calledTool("get_credit_balance", { count: 1 });
    turn.notCalledTool("save_report");
    turn.messageIncludes(/paid|Pro/);
    turn.messageIncludes("$14.05");
    const message = turn.message ?? "";
    t.check(message, satisfies((text: string) => !/^## /m.test(text), "no report sections"));
    // Only the two figures get_credit_balance returned, never a derived "total" such as $15.00.
    const dollars = [...message.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1]!.replace(/,/g, "")).toFixed(2));
    t.check(
      dollars.filter((d) => d !== "14.05" && d !== "0.95"),
      satisfies((invented: string[]) => invented.length === 0, "no dollar figures beyond the balance and amount used"),
    );
  },
});
