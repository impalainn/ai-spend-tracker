# ai-spend-tracker

An [eve](https://eve.dev) agent that explains changes in a team's [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) spend. It compares the last 7 days with the 7 days before, finds which models, request tags, and days moved, says why (more requests, longer prompts, a pricier model, low cache use), and suggests what to check. You can ask it in chat, and a daily schedule saves a report.

AI Gateway already shows spend graphs, and [budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets) email you at 50%, 75%, and 100% of a limit. Neither tells you *why* spend changed, and a steady climb that stays under 50% of a budget never alerts. This agent answers the "why" question.

## Example

Unedited output of `spend/basic` on made-up data (the `spikeWeek` fixture), from `google/gemini-3.5-flash`:

```markdown
# AI spend: 2026-11-02 to 2026-11-08

AI spend this window was $39.40 vs $16.10 (+145%) compared to the previous 7 days. The single biggest driver was the introduction of the new `anthropic/claude-opus-4.5` model.

## What changed
- `anthropic/claude-opus-4.5`: $31.20 vs $0.00 (new)
  A new expensive model was introduced, making 600 requests at a cost per request of $0.05. As traffic on this model grew, traffic on `anthropic/claude-haiku-4.5` dropped, suggesting traffic moved from one to the other.
- `feature:summarize`: $29.20 vs $7.00 (+317%)
  Cost per request went from under $0.01 to $0.02, while requests went from 1,200 to 1,300. The tag likely shifted to using the pricier `anthropic/claude-opus-4.5` model.
- `anthropic/claude-haiku-4.5`: $4.20 vs $12.60 (-67%)
  Requests went from 1,800 to 600 as traffic migrated to Claude Opus.

## Spike days
- 2026-11-05 to 2026-11-08: $7.60 to $9.10 a day, up to 3.96x the usual day ($2.30).

## Suggestions
- Confirm the switch from Claude Haiku to the pricier Claude Opus for summarizing was intended, as Claude Opus cost per request is $0.05.
- With an average of 4,000 input tokens per request and a cache hit rate of only 5% on `anthropic/claude-opus-4.5`, consider enabling prompt caching to lower costs.
- Check deployments or traffic sources on 2026-11-05, when the multi-day spending spike began.
```

## How it works

| File | Role |
| --- | --- |
| `agent/instructions.md` | Workflow, report format, and rules (only tool numbers, only flagged changes, suggestions must cite a number) |
| `agent/tools/analyze_spend.ts` | Fetches spend for both windows and returns the computed comparison |
| `agent/lib/spend.ts` | Calls `gateway.getSpendReport()` from the AI SDK, and turns API errors into plain sentences |
| `agent/lib/analyze.ts` | All arithmetic: totals, per-group changes, per-request cost and tokens, cache hit rate, spike days |
| `agent/tools/get_credit_balance.ts` | Remaining credit balance and lifetime use, via `gateway.getCredits()` |
| `agent/tools/save_report.ts` | Writes the report to `reports/<YYYY-MM-DD>.md` |
| `agent/schedules/daily-spend-check.md` | Runs every day at 15:00 UTC and saves the report |
| `evals/` | Behavior tests on fixed spend data, plus one live test |
| `test/` | Unit tests for the analysis and data layer |

The model never does arithmetic. `analyze_spend` runs 6 [Custom Reporting](https://vercel.com/docs/ai-gateway/observability-and-spend/custom-reporting) queries (grouped by day, model, and tag, for the current and the previous window) and `lib/analyze.ts` computes every figure the report uses:

- **Windows**: the last N full UTC days, ending yesterday, so a partial day never looks like a drop. The previous window has the same length.
- **Flagged change**: a model or tag whose spend rose or fell by at least 50% *and* at least $1, or that appeared or stopped. Both thresholds can be changed per request ("flag anything over $5").
- **Cause**: request count, cost per request, input tokens per request, and cache hit rate for both windows, so the report can tell "more traffic" from "longer prompts" from "a pricier model".
- **Spike day**: a day that cost at least twice the median day of the previous window. Days with no spend count as $0 in the median.
- **Totals** come from the day breakdown, since untagged requests are missing from the tag breakdown and one request can carry several tags.

To split spend by feature, tag requests:

```ts
providerOptions: { gateway: { tags: ["feature:chat"] } }
```

## Setup

Requires Node.js 24+ and pnpm.

```bash
pnpm install
```

Add an AI Gateway API key to `.env.local` (Vercel dashboard → AI Gateway → API Keys):

```
AI_GATEWAY_API_KEY=...
```

The key is account-wide, so reports cover every project on the account. **Spend reports need a paid Vercel plan.** On the Hobby plan the reporting API returns 403; the agent then says so and reports the credit balance instead, which works on every plan. Reporting costs $5 per 1,000 queries, so one run (6 queries) costs $0.03.

The agent itself runs on `google/gemini-3.5-flash` through AI Gateway, set in `agent/agent.ts`.

## Usage

```bash
pnpm dev
```

```
How did our AI spend change this week?
Did anything weird happen with our AI spend yesterday?
```

`eve dev` does not fire schedules on their cron. To trigger the daily schedule once, keep the dev server running and run:

```bash
curl -X POST http://localhost:2000/eve/v1/dev/schedules/daily-spend-check
```

## Tests

```bash
pnpm test        # unit tests: analysis math, windows, error messages, save_report
pnpm eval        # behavior evals on fixed spend data
pnpm eval:live   # one eval against the real AI Gateway (uses your key, costs a few cents)
```

Each `pnpm eval` eval stubs `analyze_spend` with a made-up analysis from `evals/fixtures/spend.ts`. The fixtures are built with the real `analyzeSpend`, so they match live output exactly.

| Eval | Checks |
| --- | --- |
| `spend/basic` | One call; totals, +145%, the new model, the tag change, the spike run, and a caching suggestion appear |
| `spend/no-invented-numbers` | Every dollar amount and percent in the report exists in the tool output |
| `spend/quiet-week` | A week with no flagged change gets a short "nothing unusual" reply with no sections |
| `spend/first-week` | With no earlier spend: no percent increases, no "spike", and a suggestion to tag requests |
| `spend/paid-plan` | A 403 is explained, the credit balance is given, no other dollar figures appear, nothing is saved |
| `spend/window` | "yesterday" uses a 1-day window |
| `spend/scheduled-save` | The schedule prompt analyzes, then saves a report with the right figures |
| `live/real-gateway` | End to end with no stubs: a report on a paid plan, or the plan explanation and real balance on Hobby |

Latest run: `pnpm eval --repeat 3`: 21/21 passed. `pnpm test`: 9/9 passed. `pnpm eval:live`: passed on a Hobby-plan team (the 403 branch).

## Limitations

- **Tested live only on a Hobby team.** On that plan, the live path covers the 403 handling and the credit balance. The report path is covered by unit tests that use the response shape of the AI SDK's `getSpendReport` and by the evals, but has not run against a paid team's real data.
- Model and tag breakdowns are separate queries, so the agent cannot say which model a tag used. It says "likely" when the timing matches.
- `save_report` writes to the local filesystem, which does not persist on Vercel. A deployed schedule needs another delivery target, such as Slack.
- The API key covers the whole account; there is no per-project filter yet.

## Next steps

- Post the daily report to Slack (eve's Slack channel), and only when something is flagged.
- Match spike days to Vercel deployments with the Vercel REST API, and name the deploy and its author.
- Per-project reports, once the reporting API supports a project filter.
