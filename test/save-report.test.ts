import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("save_report writes reports/<today>.md with a trailing newline", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spend-report-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    // Imported after chdir: the tool resolves reports/ from the working directory at load time.
    const { default: tool } = await import("../agent/tools/save_report.ts");
    const execute = (tool as unknown as { execute: (input: { markdown: string }) => Promise<{ saved: string }> }).execute;
    const result = await execute({ markdown: "# AI spend: test" });
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(result.saved, path.join("reports", `${today}.md`));
    assert.equal(await readFile(path.join(dir, result.saved), "utf8"), "# AI spend: test\n");
  } finally {
    process.chdir(cwd);
  }
});
