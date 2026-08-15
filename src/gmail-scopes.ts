// Granted-Google-scope probe for the send-as path.
//
// WHAT GMAIL NEEDS: listing send-as aliases (`settings.sendAs.list`) requires
// `gmail.settings.basic`. That scope is REQUESTED by the shared workspace
// Google OAuth client, not by this connector — the connector declares no
// scopes of its own and inherits whatever the workspace client asked for.
//
// WHY A PRE-CHECK EXISTS AT ALL: a requested scope is not a granted scope.
// Google returns only the scopes the user actually consented to, so a mailbox
// can be fully "connected" and still be unable to read its own send-as
// settings. Without this probe the first evidence is a 403 from Gmail, which
// ./gmail-api-error.ts does classify — but only AFTER a pointless round trip,
// and only if Gmail's 403 is the scope flavor rather than a policy refusal.
// Probing first lets the connector name the missing scope up front and send
// the operator straight to Reconnect.
//
// WHERE THE ANSWER COMES FROM: the OAuth2 token response Google returns to the
// connection service carries a space-delimited `scope` field listing the
// GRANTED scopes. The connection service preserves that response verbatim on
// `credentials.raw`, so `credentials.raw.scope` is the granted set for this
// user's connection. Nothing else in the connector's dependency surface
// exposes it: the normalized token bundle from `oauth.refreshAccessTokenIfNeeded`
// keeps only the access/refresh tokens and the account email.
//
// FAIL-OPEN, ALWAYS: `raw` is populated from the most recent token exchange,
// and a connection can legitimately lack it (an imported connection, a
// connection service that did not retain the field, an auth mode that is not
// OAuth2). Treating "no `scope` field" as "scope missing" would block a
// working mailbox on absent evidence, so an unreadable probe returns
// `{ known: false }` and the caller proceeds to the live API call. The probe
// may only ever BLOCK on positive evidence: a scope list that was read
// successfully and demonstrably does not contain the scope.

import { getGmailDeps, type GmailGoogleConnectorKey } from "./deps";

/** The scope `settings.sendAs.list` requires. */
export const GMAIL_SETTINGS_BASIC_SCOPE =
  "https://www.googleapis.com/auth/gmail.settings.basic";

/**
 * The outcome of a granted-scope read.
 *
 * `known: false` means the granted set could not be established — NOT that it
 * is empty. The two must stay distinguishable so a caller can never confuse
 * "no evidence" with "evidence of absence".
 */
export type GrantedScopeProbe =
  | { known: false }
  | { known: true; granted: readonly string[] };

const UNKNOWN: GrantedScopeProbe = { known: false };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Normalize Google's `scope` field. It is space-delimited per RFC 6749, but
 * comma-delimited lists occur in the wild (the request side of this very
 * integration sends commas), so both separators are accepted.
 */
export function parseGrantedScopes(value: unknown): readonly string[] | null {
  if (Array.isArray(value)) {
    const list = value.filter((entry): entry is string => typeof entry === "string");
    return list.length > 0 ? list.map((entry) => entry.trim()).filter(Boolean) : null;
  }
  if (typeof value !== "string") return null;
  const list = value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * Read the scopes Google actually granted for this user's Gmail connection.
 *
 * Every failure mode collapses to `{ known: false }` — no saved connection, a
 * connection-storage surface that predates `getConnection`, a null connection,
 * a non-OAuth2 credential, an absent or unparseable `raw.scope`, or a throw
 * from the connection service.
 */
export async function probeGrantedGoogleScopes(userId: string): Promise<GrantedScopeProbe> {
  const { nango } = getGmailDeps();

  // `getConnection` is optional on the capability surface, so a host binding
  // that predates it degrades to "unknown" instead of throwing.
  if (typeof nango.getConnection !== "function") return UNKNOWN;

  // The mailbox connection is the authority; the shared workspace client is
  // the fallback, mirroring how getGmailConnectorStatus resolves the pointer.
  const keys: GmailGoogleConnectorKey[] = ["gmail", "googleOAuth"];

  for (const key of keys) {
    let saved: { providerConfigKey: string; connectionId: string } | null = null;
    try {
      saved = nango.getPrimarySavedConnection(key, { scope: "user", userId });
    } catch {
      continue;
    }
    if (!saved?.providerConfigKey || !saved.connectionId) continue;

    let connection: unknown = null;
    try {
      connection = await nango.getConnection(saved.providerConfigKey, saved.connectionId, {
        // No forced token refresh: this probe runs on the Refresh button's hot
        // path and must not spend a round trip on Google's token endpoint. The
        // stored `raw` already reflects the grant.
        forceRefresh: false,
        refreshToken: false,
      });
    } catch {
      continue;
    }

    const credentials = asRecord(asRecord(connection)?.credentials);
    if (!credentials) continue;
    const raw = asRecord(credentials.raw);
    const granted = parseGrantedScopes(raw?.scope ?? credentials.scope);
    if (granted) return { known: true, granted };
  }

  return UNKNOWN;
}

/**
 * Does the connection hold `gmail.settings.basic`?
 *
 * Returns `null` for "cannot tell" so the caller must handle the unknown case
 * explicitly rather than defaulting an absent probe to `false`.
 *
 * A granted entry matches on the full scope URL or on the bare scope name, so
 * a connection service that stores short-form scopes still resolves.
 */
export function hasSettingsBasicScope(probe: GrantedScopeProbe): boolean | null {
  if (!probe.known) return null;
  const shortName = GMAIL_SETTINGS_BASIC_SCOPE.split("/").pop() ?? "";
  return probe.granted.some((scope) => {
    const normalized = scope.trim().toLowerCase();
    return (
      normalized === GMAIL_SETTINGS_BASIC_SCOPE.toLowerCase() ||
      normalized === shortName.toLowerCase()
    );
  });
}

/**
 * The send-as pre-check: `true` only when the granted set was READ and proves
 * `gmail.settings.basic` is absent. Unknown probes return `false` — the caller
 * proceeds to Gmail and relies on the 403 classification instead.
 */
export async function isSettingsBasicScopeMissing(userId: string): Promise<boolean> {
  return hasSettingsBasicScope(await probeGrantedGoogleScopes(userId)) === false;
}
