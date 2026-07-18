import { readFileSync } from "node:fs";
import { join } from "node:path";

export function validateEbpfPolicy(root = process.cwd()): { ok: boolean; version?: string; error?: string } {
  try {
    const raw = readFileSync(join(root, "security/ebpf/filters.yaml"), "utf8");
    if (!raw.includes("deny_by_default")) {
      return { ok: false, error: "missing_deny_by_default" };
    }
    const m = raw.match(/version:\s*"([^"]+)"/);
    return { ok: true, version: m?.[1] || "unknown" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const EBPF_POLICY_VERSION_FILE = "security/ebpf/filters.yaml";
