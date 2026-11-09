import { defineEval } from "eve/evals";

// No stubs: calls the real AI Gateway with AI_GATEWAY_API_KEY from .env.local.
// Run with `pnpm eval:live`. Checks only what holds on any plan: the agent calls
// analyze_spend, and either writes a report or explains the failure and gives the
// real credit balance.
export default defineEval({
  description: "End to end against the real AI Gateway, on whatever plan the team has.",
  tags: ["live"],
  async test(t) {
    const session = await t.session();
    const turn = await session.send("How did our AI spend change this week?");
    turn.expectOk();
    turn.notCalledTool("save_report");

    const message = turn.message ?? "";
    if (/^# AI spend: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/m.test(message)) {
      // Paid plan: spend reports work, so the agent wrote a report.
      turn.calledTool("analyze_spend", { status: "completed", count: 1 });
    } else {
      // Free plan: spend reports return 403, so the agent explains and gives the balance.
      turn.calledTool("analyze_spend", { status: "failed", count: 1 });
      turn.calledTool("get_credit_balance", { count: 1 });
      turn.messageIncludes(/paid|Pro/);
      turn.messageIncludes(/\$\d+\.\d{2}/);
    }
  },
});
