/** Enrich Sentry events with CLRTY-1 tip height + contract tags. */

import { loadClrty1Config, probeClrty1, CLRTY1_CHAIN_ID } from "./clrty1.js";
import type { SentryIssueEvent } from "./sentry_webhook.js";

export type Enrichment = {
  chainId: string;
  tipHeight?: number | string;
  rpcOk: boolean;
  contractTags: string[];
  labels: string[];
  summary: string;
};

export function parseContractTags(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CLRTY_CONTRACT_TAGS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function enrichEvent(
  event: SentryIssueEvent,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Enrichment> {
  const cfg = loadClrty1Config(env);
  const probe = await probeClrty1(cfg);
  const contractTags = parseContractTags(env);
  const labels = [
    `chain:${CLRTY1_CHAIN_ID}`,
    ...contractTags.map((t) => `contract:${t}`),
    event.level ? `severity:${event.level}` : "",
    event.project ? `project:${event.project}` : "",
  ].filter(Boolean);

  const tip =
    probe.tipHeight != null ? ` tip=${probe.tipHeight}` : " tip=unknown";
  const summary = [
    `[CLRTY-1] ${event.title}`,
    `action=${event.action} issue=${event.issueId}${tip}`,
    contractTags.length ? `contracts=${contractTags.join(",")}` : "contracts=(none)",
    event.url ? `url=${event.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    chainId: CLRTY1_CHAIN_ID,
    tipHeight: probe.tipHeight,
    rpcOk: probe.ok,
    contractTags,
    labels,
    summary,
  };
}
