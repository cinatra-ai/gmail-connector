// Gmail API failure classification for the send-as path
// (`settings.sendAs.list` on `/configuration/sendAs`).
//
// The connector reaches Gmail through the host-injected `deps.oauth.apiFetch`
// (the shared Google-OAuth surface), so every way that call can fail arrives
// here as ONE thrown value. The setup page can only show a STATIC message
// selected by a stable flash CODE (the codes-only protocol documented in
// ./gmail-flash.ts), so this module is the bridge: it maps the thrown value to
// exactly one code from the closed set below, and that code names the real
// cause — whether the operator must reconnect, wait, or report an outage.
//
// TWO ERROR SHAPES, in priority order:
//
//   1. STRUCTURED — the thrown value carries the HTTP status and Gmail's
//      machine-readable `reason` on well-known fields (`status` / `code`,
//      `reason`, or nested under `cause` / `response`). Both dimensions are
//      known, so the classification is exact.
//   2. MESSAGE-ONLY — the thrown value is a plain Error whose message is
//      Gmail's own `error.message` string and nothing more. Google's strings
//      for the two authorization failures are stable and unambiguous
//      ("Insufficient Permission" / "Request had insufficient authentication
//      scopes." and "Invalid Credentials" / "Request had invalid
//      authentication credentials."), so scope-vs-token still resolves
//      exactly; the remaining statuses are matched on Google's equally stable
//      quota/backend/not-found phrasing and otherwise degrade to the terminal
//      `refresh-failed` code, because the numeric status is simply not present
//      in the value.
//
// PII CONTAINMENT: the returned code is always picked from the closed
// `GMAIL_FAILURE_CODES` set defined here. No substring of the Gmail response —
// which can carry a mailbox address, a message id, or a project id — is ever
// copied into the result, so nothing derived from a response body can reach
// the redirect URL or the toast. The response body is read only to TEST
// against the allow-lists below, never to build the output.

/**
 * The closed set of failure codes the send-as path can produce. Every member
 * is also a key of `GMAIL_ERROR_MESSAGES` in ./gmail-flash.ts — the flash test
 * asserts that correspondence in both directions, so a code can never be
 * emitted without a static message behind it.
 */
export const GMAIL_FAILURE_CODES = [
  "scope-missing",
  "reauth-required",
  "gmail-forbidden",
  "gmail-rate-limited",
  "gmail-not-found",
  "gmail-bad-request",
  "gmail-unavailable",
  "gmail-api-error",
  "gmail-unreachable",
  "refresh-failed",
] as const;

export type GmailFailureCode = (typeof GMAIL_FAILURE_CODES)[number];

// ---------------------------------------------------------------------------
// Allow-listed reason tokens.
//
// Gmail answers in two dialects that are both live today: the classic Gmail v1
// `error.errors[].reason` (camelCase — "insufficientPermissions") and the One
// Platform `error.details[].reason` / `error.status` (SCREAMING_SNAKE —
// "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "PERMISSION_DENIED"). Both dialects are
// listed so the same mailbox failure classifies identically whichever surface
// answered. Matching is case-insensitive, so each token is written once.
// ---------------------------------------------------------------------------

const SCOPE_REASONS = [
  "insufficientpermissions",
  "insufficientscope",
  "access_token_scope_insufficient",
];

const TOKEN_REASONS = [
  "autherror",
  "unauthorized",
  "access_token_expired",
  "authentication_failure",
  "unauthenticated",
  "invalid_token",
];

const RATE_LIMIT_REASONS = [
  "ratelimitexceeded",
  "userratelimitexceeded",
  "quotaexceeded",
  "dailylimitexceeded",
  "resource_exhausted",
];

const FORBIDDEN_REASONS = ["forbidden", "domainpolicy", "permission_denied"];

const NOT_FOUND_REASONS = ["notfound", "not_found"];

const BAD_REQUEST_REASONS = [
  "badrequest",
  "invalid",
  "invalidargument",
  "invalid_argument",
  "failedprecondition",
  "failed_precondition",
];

const BACKEND_REASONS = ["backenderror", "internalerror", "internal", "unavailable"];

// ---------------------------------------------------------------------------
// Allow-listed message probes — the MESSAGE-ONLY fallback.
//
// Each entry is a stable fragment of a Google error message. They are only
// ever used with `String.includes` against the lower-cased message to CHOOSE a
// code; the message itself never reaches the output.
// ---------------------------------------------------------------------------

const SCOPE_MESSAGES = [
  "insufficient permission",
  "insufficient authentication scopes",
  "insufficient scope",
  "request does not have the required scopes",
];

const TOKEN_MESSAGES = [
  "invalid credentials",
  "invalid authentication credentials",
  "access token has expired",
  "token has been expired or revoked",
  "invalid_grant",
  "invalid authentication",
];

const RATE_LIMIT_MESSAGES = [
  "rate limit exceeded",
  "user-rate limit",
  "quota exceeded",
  "too many requests",
];

const BACKEND_MESSAGES = [
  "backend error",
  "internal error",
  "service unavailable",
  "temporarily unavailable",
  "try again later",
];

const NOT_FOUND_MESSAGES = ["not found"];

const BAD_REQUEST_MESSAGES = ["bad request", "invalid value", "invalid argument"];

// Transport failures never reach Gmail at all: undici's `fetch` rejects with a
// TypeError("fetch failed") whose `cause.code` carries the socket-level reason.
const TRANSPORT_MESSAGES = [
  "fetch failed",
  "econnrefused",
  "enotfound",
  "etimedout",
  "econnreset",
  "epipe",
  "socket hang up",
  "network error",
  "request timed out",
  "the operation was aborted",
];

const TRANSPORT_CAUSE_CODES = [
  "econnrefused",
  "enotfound",
  "etimedout",
  "econnreset",
  "epipe",
  "eai_again",
  "cert_has_expired",
  "unable_to_verify_leaf_signature",
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Pull an HTTP status off the thrown value. Accepts the shapes a Google/Gmail
 * failure realistically arrives in: a status carried directly on the error, on
 * a wrapped `cause`, on an attached `response`, or on a retained Gmail
 * `error` envelope (`{ error: { code: 403 } }`). Returns undefined when no
 * status is present — the MESSAGE-ONLY case.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const node = queue.shift();
    const record = asRecord(node);
    if (!record || seen.has(record)) continue;
    seen.add(record);

    for (const key of ["status", "statusCode", "code", "httpStatus"]) {
      const raw = record[key];
      // A Gmail `reason` can also live on `code` as a string ("ENOTFOUND"), so
      // only a numeric HTTP status in range counts.
      const numeric = typeof raw === "number" ? raw : undefined;
      if (numeric !== undefined && numeric >= 100 && numeric <= 599) {
        return numeric;
      }
    }

    for (const key of ["cause", "response", "error"]) {
      if (record[key] !== undefined) queue.push(record[key]);
    }
  }

  return undefined;
}

/**
 * Pull Gmail's machine-readable `reason` off the thrown value, lower-cased for
 * allow-list matching. Walks the same wrapper shapes as `extractHttpStatus`,
 * plus the two Gmail error-envelope arrays (`errors[]`, `details[]`).
 */
export function extractGmailReason(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const node = queue.shift();
    const record = asRecord(node);
    if (!record || seen.has(record)) continue;
    seen.add(record);

    for (const key of ["reason", "status"]) {
      const raw = record[key];
      // `status` is a number on an HTTP-ish wrapper and a string
      // ("PERMISSION_DENIED") on the One Platform envelope — only take strings.
      if (typeof raw === "string" && raw.trim()) {
        return raw.trim().toLowerCase();
      }
    }

    for (const key of ["cause", "response", "error"]) {
      if (record[key] !== undefined) queue.push(record[key]);
    }
    for (const key of ["errors", "details"]) {
      const list = record[key];
      if (Array.isArray(list)) queue.push(...list);
    }
  }

  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const record = asRecord(error);
  const message = record?.message;
  return typeof message === "string" ? message : "";
}

function isTransportFailure(error: unknown, message: string): boolean {
  if (includesAny(message, TRANSPORT_MESSAGES)) return true;

  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const record = asRecord(queue.shift());
    if (!record || seen.has(record)) continue;
    seen.add(record);
    const code = record.code;
    if (typeof code === "string" && TRANSPORT_CAUSE_CODES.includes(code.toLowerCase())) {
      return true;
    }
    if (record.cause !== undefined) queue.push(record.cause);
  }
  return false;
}

/** Map an allow-listed reason token to its code, independent of the status. */
function codeForReason(reason: string): GmailFailureCode | undefined {
  if (SCOPE_REASONS.includes(reason)) return "scope-missing";
  if (TOKEN_REASONS.includes(reason)) return "reauth-required";
  if (RATE_LIMIT_REASONS.includes(reason)) return "gmail-rate-limited";
  if (FORBIDDEN_REASONS.includes(reason)) return "gmail-forbidden";
  if (NOT_FOUND_REASONS.includes(reason)) return "gmail-not-found";
  if (BAD_REQUEST_REASONS.includes(reason)) return "gmail-bad-request";
  if (BACKEND_REASONS.includes(reason)) return "gmail-unavailable";
  return undefined;
}

/**
 * Classify a thrown send-as failure into exactly one allow-listed flash code.
 *
 * Precedence, and why:
 *   1. TRANSPORT — the request never reached Gmail, so no Gmail status or
 *      reason can be trusted; this must win over any message probe.
 *   2. STATUS — the authoritative signal when present. Within 403 the scope
 *      reason (or the unambiguous "insufficient permission" message) is
 *      checked first, because a missing scope and a policy refusal share the
 *      status but need opposite recourse: reconnect vs. contact the admin.
 *   3. REASON alone — a structured reason with no status still classifies.
 *   4. MESSAGE — Google's stable strings.
 *   5. `refresh-failed` — the terminal code, used only when the value carries
 *      no recognizable signal at all. It is deliberately NOT the catch-all for
 *      recognized-but-unmapped statuses; those get `gmail-api-error`, which
 *      tells the operator Gmail did answer.
 */
export function classifyGmailApiFailure(error: unknown): GmailFailureCode {
  const message = errorMessage(error).toLowerCase();

  if (isTransportFailure(error, message)) {
    return "gmail-unreachable";
  }

  const status = extractHttpStatus(error);
  const reason = extractGmailReason(error);
  const looksLikeScope =
    (reason !== undefined && SCOPE_REASONS.includes(reason)) ||
    includesAny(message, SCOPE_MESSAGES);

  if (status !== undefined) {
    if (status === 401) return "reauth-required";
    if (status === 403) return looksLikeScope ? "scope-missing" : "gmail-forbidden";
    if (status === 429) return "gmail-rate-limited";
    if (status === 404) return "gmail-not-found";
    if (status === 400 || status === 412 || status === 422) return "gmail-bad-request";
    if (status >= 500) return "gmail-unavailable";
    return "gmail-api-error";
  }

  if (reason !== undefined) {
    const byReason = codeForReason(reason);
    if (byReason) return byReason;
  }

  if (looksLikeScope) return "scope-missing";
  if (includesAny(message, TOKEN_MESSAGES)) return "reauth-required";
  if (includesAny(message, RATE_LIMIT_MESSAGES)) return "gmail-rate-limited";
  if (includesAny(message, BACKEND_MESSAGES)) return "gmail-unavailable";
  if (includesAny(message, BAD_REQUEST_MESSAGES)) return "gmail-bad-request";
  if (includesAny(message, NOT_FOUND_MESSAGES)) return "gmail-not-found";

  return "refresh-failed";
}

/**
 * Codes whose recourse is "reconnect the Gmail account". The refresh action
 * routes these back to the SETUP tab (omitting `tab`), because that is where
 * the Connect/Reconnect control lives — the same fallback the stale-token path
 * already performs. Every other code stays on the Sender-addresses tab, where
 * the user pressed Refresh.
 */
export const GMAIL_RECONNECT_CODES: readonly GmailFailureCode[] = [
  "scope-missing",
  "reauth-required",
];

/**
 * Takes a plain string so the refresh action can route ANY flash error code
 * without casting; a code outside the reconnect set simply answers false.
 */
export function needsReconnect(code: string): boolean {
  return (GMAIL_RECONNECT_CODES as readonly string[]).includes(code);
}
