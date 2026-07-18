/** Parse Sentry issue webhooks into a normalized event. */

export type SentryAction = "created" | "resolved" | "reopened" | "assigned" | "unknown";

export type SentryIssueEvent = {
  action: SentryAction;
  issueId: string;
  shortId?: string;
  title: string;
  culprit?: string;
  level?: string;
  project?: string;
  url?: string;
  status?: string;
  raw: unknown;
};

function mapAction(action: string | undefined, status: string | undefined): SentryAction {
  const a = (action || "").toLowerCase();
  const s = (status || "").toLowerCase();
  if (a === "resolved" || s === "resolved") return "resolved";
  if (a === "unresolved" || a === "reopened" || a === "regression") return "reopened";
  if (a === "created" || a === "triggered") return "created";
  if (a === "assigned") return "assigned";
  if (s === "unresolved") return "reopened";
  return "unknown";
}

export function parseSentryWebhook(body: unknown): SentryIssueEvent {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = (b.data ?? b) as Record<string, unknown>;
  const issue = (data.issue ?? data.event ?? data) as Record<string, unknown>;

  const actionRaw =
    (typeof b.action === "string" && b.action) ||
    (typeof data.action === "string" && data.action) ||
    undefined;
  const status =
    (typeof issue.status === "string" && issue.status) ||
    (typeof data.status === "string" && data.status) ||
    undefined;

  const issueId = String(
    issue.id ?? issue.issue_id ?? data.issue_id ?? b.issue_id ?? "unknown",
  );
  const title = String(issue.title ?? issue.message ?? "Sentry issue");

  return {
    action: mapAction(actionRaw, status),
    issueId,
    shortId: issue.shortId ? String(issue.shortId) : undefined,
    title,
    culprit: issue.culprit ? String(issue.culprit) : undefined,
    level: issue.level ? String(issue.level) : undefined,
    project:
      typeof issue.project === "object" && issue.project
        ? String((issue.project as { slug?: string }).slug || "")
        : issue.project
          ? String(issue.project)
          : undefined,
    url: issue.permalink || issue.web_url ? String(issue.permalink || issue.web_url) : undefined,
    status,
    raw: body,
  };
}
