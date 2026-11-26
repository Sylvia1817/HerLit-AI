/**
 * Read-only npm advisory inventory. No package changes, no automatic force-fix.
 * The production-only report follows npm dependency classification; also review
 * all dependencies because this project uses dev tools in build/start scripts.
 */
import { spawnSync } from "node:child_process";

function audit(label, extra) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json", "--package-lock-only", ...extra],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32" });
  let report;
  try { report = JSON.parse(result.stdout || ""); }
  catch { throw new Error(label + ": npm audit returned no valid JSON"); }
  if (result.error || report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) {
    throw new Error(label + ": npm registry audit unavailable");
  }
  console.log("\n=== " + label + " ===");
  console.log("Counts: " + JSON.stringify(report.metadata.vulnerabilities));
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    console.log(JSON.stringify({
      package: name, severity: item.severity, direct: item.isDirect,
      range: item.range, nodes: item.nodes, effects: item.effects, fixAvailable: item.fixAvailable,
      via: item.via.map((entry) => typeof entry === "string" ? entry : ({
        title: entry.title, url: entry.url, severity: entry.severity, range: entry.range,
      })),
    }));
  }
  return report.metadata.vulnerabilities;
}
try {
  audit("ALL LOCKFILE DEPENDENCIES", []);
  audit("PRODUCTION CLASSIFICATION (omit dev)", ["--omit=dev"]);
  console.log("\nInventory only: vulnerabilities remain actionable; no packages were modified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Dependency audit failed");
  process.exitCode = 1;
}
