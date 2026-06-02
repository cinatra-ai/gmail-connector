// ---------------------------------------------------------------------------
// @cinatra-ai/gmail-connector — host dependency injection singleton.
//
// Host dependency injection keeps the gmail connector decoupled from
// host-internal modules such as `@/lib/database` and `@/lib/nango`. Direct
// imports anchor the package to the host's src/ tree and prevent the package
// from running from `extensions/cinatra-ai/gmail-connector/`; `@/` resolves
// to `src/` only inside the host.
//
// The fix: host injects the runtime dependencies at boot via
// `registerGmailConnector(deps)`. The runtime functions inside this package
// resolve the injected impls via `getGmailDeps()` on every call.
//
// The Nango connection-storage surface (`deps.nango`) and the Google-OAuth
// surface (`deps.oauth`) are ALSO host-injected (SDK-only decouple) so
// this connector carries NO non-SDK `@cinatra-ai/*` code dependency — the host
// sources them from the nango-connector + google-oauth-connection extensions
// and binds the concrete impls at boot.
//
// Test compatibility: tests that load gmail directly without `vi.mock`
// must call `registerGmailConnector(mockDeps)` in setup. Tests that
// `vi.mock` the whole module (today: schema-enricher.test.ts,
// server-actions-audit.test.ts) are unaffected.
// ---------------------------------------------------------------------------

/** Google-scoped connector keys gmail passes through to the OAuth/Nango surface. */
export type GmailGoogleConnectorKey = "gmail" | "googleOAuth";

/**
 * Structural shape of the Nango connection-storage surface gmail uses. Inlined
 * (NOT imported from `@cinatra-ai/nango-connector`) so the connector carries no
 * non-SDK `@cinatra-ai/*` code dependency — the host binds the concrete impl at
 * boot. Only the single read method gmail calls is exposed; `connectorKey` is
 * literal-scoped to the keys gmail actually passes.
 */
export interface GmailNangoCapability {
  /** The primary saved cinatra-side connection pointer for this connector, or
   *  null when none is saved. */
  getPrimarySavedConnection(
    connectorKey: GmailGoogleConnectorKey,
    opts?: { scope?: "app" | "user"; userId?: string },
  ): {
    providerConfigKey: string;
    connectionId: string;
    displayName?: string;
    email?: string;
  } | null;
  /** Clear the cinatra-side connection record(s) — used by the relocated
   *  refresh action when the stored token is stale, to force re-auth. */
  clearConnectionRecords(
    connectorKey: GmailGoogleConnectorKey,
    opts?: { scope?: "app" | "user"; userId?: string },
  ): Promise<unknown>;
}

/** Google-OAuth status result surfaced by `oauth.getStatus()`. */
export type GmailOAuthStatusResult = {
  status: "connected" | "incomplete" | "not_connected";
  accountEmail?: string;
  detail?: string;
};

/** Refreshed Google-OAuth token bundle returned by `oauth.refreshAccessTokenIfNeeded`. */
export type GmailOAuthRefreshResult = {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  accountEmail?: string;
};

/**
 * Structural shape of the Google-OAuth surface gmail uses. Inlined (NOT imported
 * from `@cinatra-ai/google-oauth-connection`) so the connector carries no non-SDK
 * `@cinatra-ai/*` code dependency — the host binds the concrete impl at boot.
 */
export interface GmailOAuthCapability {
  /** Connector-level connection status (no userId scope). */
  getStatus(): Promise<GmailOAuthStatusResult>;
  /** Perform an authenticated Google REST call, refreshing the token if needed. */
  apiFetch<T>(
    input: { url: string; method?: string; body?: unknown },
    options?: { userId?: string; connectorKey?: GmailGoogleConnectorKey },
  ): Promise<T>;
  /** Ensure a fresh access token, returning the current token bundle. */
  refreshAccessTokenIfNeeded(input?: {
    userId?: string;
    connectorKey?: GmailGoogleConnectorKey;
  }): Promise<GmailOAuthRefreshResult>;
}

/**
 * The narrow surface of the host that gmail needs at runtime: connector-config
 * read/write plus the host-injected Nango + Google-OAuth capabilities.
 */
export interface GmailConnectorDeps {
  /** Read this gmail connector's persisted settings (alias list, etc.). */
  readConnectorConfigFromDatabase: <T>(connectorId: string, fallback: T) => T;

  /** Write this gmail connector's persisted settings. */
  writeConnectorConfigToDatabase: (connectorId: string, value: unknown) => void;

  /** Nango connection-storage surface (host-bound from the nango-connector extension). */
  nango: GmailNangoCapability;

  /** Google-OAuth surface (host-bound from the google-oauth-connection extension). */
  oauth: GmailOAuthCapability;

  /** Resolve the current session user id for the relocated, manage-gated
   *  refresh action. Host binds to its auth-session lookup; throws if there is
   *  no authenticated session. */
  requireSessionUserId: () => Promise<string>;
}

let _deps: GmailConnectorDeps | null = null;

/**
 * Wire the host's runtime dependencies into the gmail connector. Call
 * exactly once at boot (e.g. from `src/lib/register-transport-connectors.ts`
 * which is itself imported by `src/instrumentation.node.ts`).
 *
 * Re-calling replaces the previous wiring — tests can use this to swap in
 * stubs between `describe` blocks.
 */
export function registerGmailConnector(deps: GmailConnectorDeps): void {
  _deps = deps;
}

/**
 * Resolve injected host deps. Throws loud if `registerGmailConnector` has
 * not been called — preferred over silent fallback because a missing
 * registration is always a boot-wiring bug.
 */
export function getGmailDeps(): GmailConnectorDeps {
  if (!_deps) {
    throw new Error(
      "@cinatra-ai/gmail-connector: host runtime deps not registered. " +
        "Call registerGmailConnector(deps) at boot (typically from " +
        "src/lib/register-transport-connectors.ts).",
    );
  }
  return _deps;
}

/**
 * @internal Only for tests — clear deps so a fresh registration is required.
 */
export function _resetGmailDepsForTests(): void {
  _deps = null;
}
