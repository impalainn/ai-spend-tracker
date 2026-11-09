import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import { allowedFigures, analyzeStub, ASK, spikeWeek } from "../fixtures/spend";

const { dollars, percents } = allowedFigures(spikeWeek);

export default defineEval({
  description: "Every dollar amount and percent in the report comes from the tool output.",
  async test(t) {
    const session = await t.session({ stubs: [analyzeStub(spikeWeek)] });
    const turn = await session.send(ASK);
    turn.expectOk();

    const message = turn.message ?? "";
    const cited = [...message.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1]!.replace(/,/g, "")).toFixed(2));
    const pcts = [...message.matchAll(/([\d.]+)\s?%/g)].map((m) => Math.round(Number(m[1])));

    t.check(
      cited.filter((d) => !dollars.has(d)),
      satisfies((invented: string[]) => invented.length === 0, "no invented dollar amounts"),
    );
    t.check(
      pcts.filter((p) => !percents.has(p)),
      satisfies((invented: number[]) => invented.length === 0, "no invented percents"),
    );
    t.check(
      message,
      satisfies((text: string) => !/\b(doubled|tripled|quadrupled)\b/i.test(text), "no doubled/tripled wording"),
    );
    t.check(cited, satisfies((found: string[]) => found.length >= 3, "cites at least three dollar amounts"));
  },
});
