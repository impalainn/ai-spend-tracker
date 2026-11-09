import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

// Reports land in reports/<YYYY-MM-DD>.md under the project root.
const REPORT_DIR = path.join(process.cwd(), "reports");

export default defineTool({
  description:
    "Save a finished spend report as a markdown file. Call this after writing the report when the request comes from a schedule or the user asks to save it.",
  inputSchema: z.object({
    markdown: z.string().min(1).describe("The complete report in markdown."),
  }),
  label: {
    start: () => "Save spend report",
  },
  async execute({ markdown }) {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(REPORT_DIR, `${date}.md`);
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return { saved: path.relative(process.cwd(), file) };
  },
});
