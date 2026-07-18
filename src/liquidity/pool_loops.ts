/** $CLRTY liquidity pool interaction loops — duplicated per service repo. */

import { loadClrty1Config, probeClrty1, type Clrty1Config } from "../clrty1.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PoolAction = "addLiquidity" | "removeLiquidity" | "rebalance" | "quotePool";

export type PoolIntent = {
  action: PoolAction;
  asset: "CLRTY" | "USDT";
  amount: string;
  poolId?: string;
  ts: string;
  tipHeight?: string | number;
  status: "pending" | "finalized" | "rejected";
  reason?: string;
};

const STORE = join(process.cwd(), "var", "pool_intents.json");

async function loadIntents(): Promise<PoolIntent[]> {
  try {
    const raw = await readFile(STORE, "utf8");
    return JSON.parse(raw) as PoolIntent[];
  } catch {
    return [];
  }
}

async function saveIntents(items: PoolIntent[]): Promise<void> {
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(items, null, 2));
}

export async function runPoolLoop(
  action: PoolAction,
  opts: { asset: "CLRTY" | "USDT"; amount: string; poolId?: string; dryRun?: boolean },
  cfg: Clrty1Config = loadClrty1Config(),
): Promise<PoolIntent> {
  const probe = await probeClrty1(cfg);
  const intent: PoolIntent = {
    action,
    asset: opts.asset,
    amount: opts.amount,
    poolId: opts.poolId || "clrty-native-pool",
    ts: new Date().toISOString(),
    tipHeight: probe.tipHeight,
    status: "pending",
  };

  if (!opts.dryRun && !probe.ok) {
    intent.status = "rejected";
    intent.reason = probe.error || "clrty1_unreachable";
    const all = await loadIntents();
    all.push(intent);
    await saveIntents(all);
    return intent;
  }

  if (action === "quotePool") {
    intent.status = "finalized";
    intent.reason = `mock_quote asset=${opts.asset} amount=${opts.amount}`;
  } else {
    intent.status = "finalized";
    intent.reason = `mock_${action}_committed_to_clrty1`;
  }

  const all = await loadIntents();
  all.push(intent);
  await saveIntents(all);

  // Optional finalize hook to API
  if (!opts.dryRun && process.env.CLRTY_POOL_FINALIZE === "1") {
    try {
      await fetch(`${cfg.apiBase.replace(/\/$/, "")}/v1/pools/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });
    } catch {
      /* best-effort */
    }
  }

  return intent;
}

export function poolLoopsVersion(): string {
  return "pool_loops/0.1.0";
}
