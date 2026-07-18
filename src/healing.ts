/**
 * Self-healing stub rules:
 * - Sentry resolve → close Linear ticket
 * - Regression / reopen → reopen Linear ticket
 * - New / unknown → upsert Linear ticket
 */

import type { SentryIssueEvent } from "./sentry_webhook.js";
import { enrichEvent } from "./enrich.js";
import {
  closeTicket,
  reopenTicket,
  upsertTicket,
  type LinearTicket,
} from "./linear.js";

export type HealingResult = {
  action: "created" | "updated" | "closed" | "reopened" | "noop";
  ticket: LinearTicket | null;
  enrichment: Awaited<ReturnType<typeof enrichEvent>>;
  rule: string;
};

export async function applyHealing(
  event: SentryIssueEvent,
  env: NodeJS.ProcessEnv = process.env,
  sinkPath?: string,
): Promise<HealingResult> {
  const enrichment = await enrichEvent(event, env);
  const title = `[CLRTY-1] ${event.shortId || event.issueId}: ${event.title}`;
  const description = enrichment.summary;

  if (event.action === "resolved") {
    const closed = await closeTicket({
      sentryIssueId: event.issueId,
      env,
      sinkPath,
    });
    if (closed) {
      return {
        action: "closed",
        ticket: closed,
        enrichment,
        rule: "sentry_resolve_closes_linear",
      };
    }
    // No prior ticket — create then close for audit trail
    const created = await upsertTicket({
      sentryIssueId: event.issueId,
      title,
      description,
      env,
      sinkPath,
    });
    const after = await closeTicket({
      sentryIssueId: event.issueId,
      env,
      sinkPath,
    });
    return {
      action: "closed",
      ticket: after || created,
      enrichment,
      rule: "sentry_resolve_closes_linear",
    };
  }

  if (event.action === "reopened") {
    let ticket = await reopenTicket({
      sentryIssueId: event.issueId,
      env,
      sinkPath,
    });
    if (!ticket) {
      ticket = await upsertTicket({
        sentryIssueId: event.issueId,
        title,
        description,
        env,
        sinkPath,
      });
      return {
        action: "created",
        ticket,
        enrichment,
        rule: "sentry_regression_reopens_linear",
      };
    }
    return {
      action: "reopened",
      ticket,
      enrichment,
      rule: "sentry_regression_reopens_linear",
    };
  }

  const ticket = await upsertTicket({
    sentryIssueId: event.issueId,
    title,
    description,
    env,
    sinkPath,
  });
  return {
    action: ticket.status === "reopened" ? "updated" : "created",
    ticket,
    enrichment,
    rule: "sentry_issue_upserts_linear",
  };
}
