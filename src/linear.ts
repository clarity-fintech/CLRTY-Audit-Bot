/**
 * Linear issue create/update/close.
 * Without LINEAR_API_KEY, persists to var/tickets.jsonl (mock sink).
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type LinearTicket = {
  id: string;
  sentryIssueId: string;
  title: string;
  description: string;
  status: "open" | "closed" | "reopened";
  linearId?: string;
  updatedAt: string;
  mode: "mock" | "live";
};

const DEFAULT_SINK = resolve(process.cwd(), "var/tickets.jsonl");

export function linearConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.LINEAR_API_KEY);
}

async function ensureSink(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

async function loadTickets(path: string): Promise<LinearTicket[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LinearTicket);
  } catch {
    return [];
  }
}

async function rewriteTickets(path: string, tickets: LinearTicket[]) {
  await ensureSink(path);
  await writeFile(path, tickets.map((t) => JSON.stringify(t)).join("\n") + (tickets.length ? "\n" : ""));
}

async function appendTicket(path: string, ticket: LinearTicket) {
  await ensureSink(path);
  await appendFile(path, JSON.stringify(ticket) + "\n", "utf8");
}

async function linearGraphql(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`linear_http_${res.status}`);
  const body = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown };
  if (body.errors) throw new Error(`linear_graphql_error`);
  return body.data || {};
}

export async function upsertTicket(input: {
  sentryIssueId: string;
  title: string;
  description: string;
  env?: NodeJS.ProcessEnv;
  sinkPath?: string;
}): Promise<LinearTicket> {
  const env = input.env ?? process.env;
  const sink = input.sinkPath || env.LINEAR_MOCK_SINK || DEFAULT_SINK;
  const now = new Date().toISOString();

  if (!linearConfigured(env)) {
    const tickets = await loadTickets(sink);
    const existing = tickets.find((t) => t.sentryIssueId === input.sentryIssueId);
    if (existing) {
      existing.title = input.title;
      existing.description = input.description;
      existing.status = existing.status === "closed" ? "reopened" : "open";
      existing.updatedAt = now;
      existing.mode = "mock";
      await rewriteTickets(sink, tickets);
      return existing;
    }
    const ticket: LinearTicket = {
      id: `mock_${input.sentryIssueId}`,
      sentryIssueId: input.sentryIssueId,
      title: input.title,
      description: input.description,
      status: "open",
      updatedAt: now,
      mode: "mock",
    };
    await appendTicket(sink, ticket);
    return ticket;
  }

  const teamId = env.LINEAR_TEAM_ID;
  if (!teamId) {
    throw new Error("LINEAR_TEAM_ID required when LINEAR_API_KEY is set");
  }

  const data = await linearGraphql(
    env.LINEAR_API_KEY!,
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title }
      }
    }`,
    {
      input: {
        teamId,
        title: input.title,
        description: input.description,
      },
    },
  );
  const created = (data.issueCreate as { issue?: { id: string } })?.issue;
  const ticket: LinearTicket = {
    id: created?.id || `live_${input.sentryIssueId}`,
    linearId: created?.id,
    sentryIssueId: input.sentryIssueId,
    title: input.title,
    description: input.description,
    status: "open",
    updatedAt: now,
    mode: "live",
  };
  await appendTicket(sink, ticket);
  return ticket;
}

export async function closeTicket(input: {
  sentryIssueId: string;
  env?: NodeJS.ProcessEnv;
  sinkPath?: string;
}): Promise<LinearTicket | null> {
  const env = input.env ?? process.env;
  const sink = input.sinkPath || env.LINEAR_MOCK_SINK || DEFAULT_SINK;
  const tickets = await loadTickets(sink);
  const existing = tickets.find((t) => t.sentryIssueId === input.sentryIssueId);
  if (!existing) return null;

  existing.status = "closed";
  existing.updatedAt = new Date().toISOString();

  if (linearConfigured(env) && existing.linearId && env.LINEAR_DONE_STATE_ID) {
    await linearGraphql(
      env.LINEAR_API_KEY!,
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: existing.linearId, input: { stateId: env.LINEAR_DONE_STATE_ID } },
    );
    existing.mode = "live";
  } else {
    existing.mode = linearConfigured(env) ? "live" : "mock";
  }

  await rewriteTickets(sink, tickets);
  return existing;
}

export async function reopenTicket(input: {
  sentryIssueId: string;
  env?: NodeJS.ProcessEnv;
  sinkPath?: string;
}): Promise<LinearTicket | null> {
  const env = input.env ?? process.env;
  const sink = input.sinkPath || env.LINEAR_MOCK_SINK || DEFAULT_SINK;
  const tickets = await loadTickets(sink);
  const existing = tickets.find((t) => t.sentryIssueId === input.sentryIssueId);
  if (!existing) return null;

  existing.status = "reopened";
  existing.updatedAt = new Date().toISOString();

  if (linearConfigured(env) && existing.linearId && env.LINEAR_OPEN_STATE_ID) {
    await linearGraphql(
      env.LINEAR_API_KEY!,
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: existing.linearId, input: { stateId: env.LINEAR_OPEN_STATE_ID } },
    );
    existing.mode = "live";
  } else {
    existing.mode = linearConfigured(env) ? "live" : "mock";
  }

  await rewriteTickets(sink, tickets);
  return existing;
}
