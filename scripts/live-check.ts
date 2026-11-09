// Calls the real AI Gateway with the key in .env.local: pnpm live-check
import { getCreditBalance, getSpendAnalysis } from "../agent/lib/spend.ts";

console.log("credits:", await getCreditBalance());
try {
  const analysis = await getSpendAnalysis({ days: 7 });
  console.log("analysis:", JSON.stringify(analysis, null, 2));
} catch (error) {
  console.log("analyze_spend error:", (error as Error).message);
}
