import { defineTool } from "eve/tools";
import { z } from "zod";

import { getCreditBalance } from "../lib/spend";

export default defineTool({
  description:
    "Get the team's remaining AI Gateway credit balance and lifetime credit spend, in USD. Use it when the user asks about their balance or credits, or when analyze_spend fails and a basic figure still helps.",
  inputSchema: z.object({}),
  label: {
    start: () => "Check AI Gateway credit balance",
  },
  async execute() {
    return getCreditBalance();
  },
});
