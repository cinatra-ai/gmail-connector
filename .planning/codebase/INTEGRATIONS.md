# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Google Gmail API:**
- Gmail REST API v1 - Send emails, read thread/message metadata, list send-as aliases
  - Base URL: `https://gmail.googleapis.com/gmail/v1/users/me`
  - Endpoints used: `/messages/send`, `/messages/{id}`, `/threads/{id}`, `/messages?q=...`, `/configuration/sendAs`
  - SDK/Client: Native `fetch` via injected `deps.oauth.apiFetch<T>()` (no googleapis npm SDK)
  - Auth: Google OAuth 2.0 access token, refreshed via injected `deps.oauth.refreshAccessTokenIfNeeded()`
  - Implementation: `src/index.ts` — `gmailFetch()` wrapper calls the OAuth surface

**Nango (OAuth Connection Storage):**
- Nango - Stores and retrieves Google OAuth connection records per user
  - SDK/Client: Injected via `deps.nango` (interface `GmailNangoCapability` in `src/deps.ts`)
  - Connector keys used: `"gmail"` and `"googleOAuth"`
  - Operations: `getPrimarySavedConnection()`, `clearConnectionRecords()`
  - The concrete Nango implementation is host-bound at boot; this connector holds only a structural interface
  - Requested as a host port in `package.json`: `"requestedHostPorts": ["nango"]`

## Data Storage

**Databases:**
- Host database (abstract) - Persists Gmail connector settings (send-as alias lists, sync timestamps)
  - Connection: Host-injected; no direct DB connection in this package
  - Client: Injected `deps.readConnectorConfigFromDatabase<T>()` / `deps.writeConnectorConfigToDatabase()`
  - Connector config keys used: `"gmail"`, `"gmail_user:{userId}"`, `"email-system-development"`

**File Storage:**
- Not applicable

**Caching:**
- Not detected

## Authentication & Identity

**Auth Provider:**
- Google OAuth 2.0 (via host-injected `GmailOAuthCapability` interface in `src/deps.ts`)
  - Implementation: The connector itself holds no OAuth credentials; all token management delegated to the host-bound `deps.oauth` surface
  - `getStatus()` — check connector-level connection status
  - `apiFetch<T>()` — authenticated Google REST calls
  - `refreshAccessTokenIfNeeded()` — token refresh before Gmail API calls
- Auth Session (host-injected): `deps.requireSessionUserId()` — resolves the current session user for user-scoped actions
  - Requested as a host port in `package.json`: `"requestedHostPorts": ["authSession"]`

**Cinatra SDK Authorization:**
- `requireExtensionAction(pkg, "read")` from `@cinatra-ai/sdk-extensions` — gates the `refreshGmailSendAsAddressesAction` server action in `src/actions.ts`
- Policy: `"read"` permission admits any workspace member; operation is self-scoped to the session user

## Monitoring & Observability

**Error Tracking:**
- Not detected — errors are thrown as standard `Error` instances and propagated to callers

**Logs:**
- Not detected — no explicit logging framework; errors surface via thrown exceptions

## CI/CD & Deployment

**Hosting:**
- Deployed as a Cinatra connector extension embedded within a host Next.js application (server-side)
- Setup UI served at `/connectors/cinatra-ai/gmail-connector/setup` (referenced in `src/actions.ts`)

**CI Pipeline:**
- `.github/` directory present (contents not explored) — CI configuration likely present

## Environment Configuration

**Required env vars:**
- None directly consumed by this package — all secrets flow through host-injected deps
- Host must supply: Google OAuth credentials (for the `oauth` dep), Nango API credentials (for the `nango` dep), database connection (for config read/write)

**Secrets location:**
- `.env` file present at repo root — contents not read; secrets managed by host environment

## Webhooks & Callbacks

**Incoming:**
- Not detected — reply detection uses polling via Gmail search API (`findGmailReplyInThread` in `src/index.ts`), not webhooks

**Outgoing:**
- Not detected

## MCP Primitives (Internal Extension Bus)

**Registered handlers** (`src/mcp/handlers.ts`, `src/mcp/registry.ts`):
- `gmail_status` — returns connector connection status
- `gmail_aliases_list` — returns stored send-as aliases
- `gmail_aliases_refresh` — syncs send-as aliases from Gmail API
- `gmail_email_send` — sends an email via Gmail API (validated with zod schema)
- `gmail_email_find_reply` — searches for reply in a Gmail thread (validated with zod schema)

These handlers are registered via `createGmailModule()` in `src/mcp/module.ts` and consumed by the Cinatra host's MCP/primitive bus at boot.

---

*Integration audit: 2026-06-09*
