#!/usr/bin/env node
/**
 * Print CLRTY-1 connection report and exit 0/1.
 * Prefer compiled dist/; otherwise load src/clrty1.ts via tsx.
 */
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const distJs = join(root, "dist", "clrty1.js");
const srcTs = join(root, "src", "clrty1.ts");

async function main() {
  let mod;
  if (existsSync(distJs)) {
    mod = await import(pathToFileURL(distJs).href);
  } else if (existsSync(srcTs)) {
    // Re-exec under tsx so TypeScript source loads cleanly.
    const r = spawnSync(
      "npx",
      [
        "--yes",
        "tsx",
        "-e",
        `
import { getClrty1ConnectionReport, loadClrty1Config } from ${JSON.stringify(srcTs)};
const report = await getClrty1ConnectionReport(loadClrty1Config(process.env));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
`,
      ],
      { stdio: "inherit", cwd: root, env: process.env },
    );
    process.exit(r.status ?? 1);
  } else {
    console.error("smoke-clrty1: missing dist/clrty1.js and src/clrty1.ts");
    process.exit(2);
  }

  const report = await mod.getClrty1ConnectionReport(mod.loadClrty1Config(process.env));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
