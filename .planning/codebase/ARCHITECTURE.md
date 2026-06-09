<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Host Application (Next.js)                       │
│   registers deps at boot via registerGmailConnector(deps)            │
└──────┬──────────────────────────────────────────────────────────────┘
       │ injects GmailConnectorDeps
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Dependency Injection Layer                           │
│  `src/deps.ts`  — GmailConnectorDeps interface + singleton store     │
│  registerGmailConnector() / getGmailDeps()                           │
└──────┬──────────────────────────────────────────────────────────────┘
       │ resolved on each call
       ▼
┌───────────────────────────┬─────────────────────┬───────────────────┐
│    Core Transport Layer   │  MCP Surface Layer  │  UI / Setup Layer │
│  `src/index.ts`           │  `src/mcp/`         │  `src/setup-page` │
│  sendGmailMessage()       │  handlers.ts        │  `src/gmail-setup-│
│  findGmailReplyInThread() │  registry.ts        │   impl.tsx`       │
│  getGmailConnectorStatus()│  module.ts          │  `src/actions.ts` │
│  refresh/read sendAs      │                     │                   │
└───────────────────────────┴─────────────────────┴───────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│           Provider-Neutral Contract Layer                            │
│  @cinatra-ai/sdk-extensions/email-contract                           │
│  EmailConnector, EmailSystemMessage, EmailSendReceipt, EmailReplyMatch│
└─────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  External: Gmail REST API (gmail.googleapis.com/gmail/v1/users/me)   │
│  OAuth token flow via host-injected GmailOAuthCapability             │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Dependency injection singleton | Stores host-injected deps; throws loud on missing boot wiring | `src/deps.ts` |
| Core transport | Sends email, finds replies, manages sendAs aliases, dev-mode override | `src/index.ts` |
| EmailConnector facade | Wraps transport in provider-neutral `EmailConnector` interface | `src/email-connector.ts` |
| Connector definition | Leaf `EmailConnectorDefinition` constant (avoids circular TDZ) | `src/definition.ts` |
| MCP handlers | Validates input with zod, dispatches to core transport | `src/mcp/handlers.ts` |
| MCP registry | Registers MCP tools on the `ExtensionMcpToolServer` | `src/mcp/registry.ts` |
| MCP module factory | Returns `{ registerCapabilities }` entry for the host | `src/mcp/module.ts` |
| Setup page | Async RSC setup page dispatch route | `src/setup-page.tsx` |
| Setup page impl | Full React Server Component with Nango connect UI + sendAs list | `src/gmail-setup-impl.tsx` |
| Server actions | `refreshGmailSendAsAddressesAction` gated by `requireExtensionAction` | `src/actions.ts` |
| UI primitives | Alert, Button for the setup page | `src/components/ui/alert.tsx`, `src/components/ui/button.tsx` |

## Pattern Overview

**Overall:** Dependency-Injected Extension / SDK-Only Decoupled Connector

**Key Characteristics:**
- The connector carries zero direct `@cinatra-ai/*` non-SDK imports. All host capabilities (database, Nango, OAuth, auth session) are injected via `registerGmailConnector(deps)` called once at host boot.
- A module-level singleton `_deps` in `src/deps.ts` is the single coupling point. All runtime functions call `getGmailDeps()` to retrieve it; missing registration throws immediately.
- The `EmailConnector` facade (`src/email-connector.ts`) makes the connector interchangeable with any other email provider by conforming to the provider-neutral contract in `@cinatra-ai/sdk-extensions/email-contract`.
- Circular-dependency TDZ is broken by isolating the `gmailAPIConnector` constant into `src/definition.ts` (a leaf with no other local imports).
- Dev-mode recipient override (`applyDevelopmentRecipientOverride`) is applied inside `sendGmailMessage` — not at a higher layer — so ALL call paths (direct, MCP, email system) are protected.

## Layers

**Dependency Injection Layer:**
- Purpose: Decouple the connector from host internals; provide a single registration point
- Location: `src/deps.ts`
- Contains: `GmailConnectorDeps` interface, `GmailNangoCapability`, `GmailOAuthCapability`, singleton store, `registerGmailConnector`, `getGmailDeps`
- Depends on: Nothing (no imports from the host or other connector files)
- Used by: Every other module in the connector via `getGmailDeps()`

**Core Transport Layer:**
- Purpose: All Gmail API operations — send, find reply, alias management, dev-mode override
- Location: `src/index.ts`
- Contains: `sendGmailMessage`, `findGmailReplyInThread`, `getGmailConnectorStatus`, `getStoredGmailSendAsAddresses`, `refreshGmailSendAsAddresses`, `refreshUserGmailSendAsAddresses`, MIME building utilities
- Depends on: `src/deps.ts`, `src/definition.ts`, `@cinatra-ai/sdk-extensions/email-contract`
- Used by: `src/email-connector.ts`, `src/mcp/handlers.ts`, `src/actions.ts`, `src/gmail-setup-impl.tsx`

**Provider-Neutral Facade Layer:**
- Purpose: Expose a single `EmailConnector` object conforming to the platform-wide email contract
- Location: `src/email-connector.ts`
- Contains: `gmailEmailConnector` (implements `send`, `findReply`, `getStatus`)
- Depends on: `src/definition.ts` (definition), `src/index.ts` (transport functions)
- Used by: Host boot via `registerEmailConnector(gmailEmailConnector)`

**MCP Surface Layer:**
- Purpose: Expose Gmail capabilities as MCP tools for agentic access
- Location: `src/mcp/` (`handlers.ts`, `registry.ts`, `module.ts`)
- Contains: Zod schemas, tool handler map, `registerGmailPrimitives`, `createGmailModule`
- Depends on: `src/index.ts`, `@cinatra-ai/sdk-extensions`, `zod`
- Used by: Host MCP server at boot via `createGmailModule().registerCapabilities(server)`

**UI / Setup Layer:**
- Purpose: Connector setup page and server action for sendAs refresh
- Location: `src/setup-page.tsx`, `src/gmail-setup-impl.tsx`, `src/actions.ts`, `src/components/`
- Contains: Next.js RSC setup page, NangoUserConnectButton integration, sendAs alias list, `refreshGmailSendAsAddressesAction`
- Depends on: `@cinatra-ai/sdk-extensions`, `@cinatra-ai/sdk-ui/marketplace`, `src/index.ts`, `src/deps.ts`
- Used by: Host router (dispatched at `/connectors/cinatra-ai/gmail-connector/setup`)

## Data Flow

### Send Email (Primary Path)

1. Caller (host, MCP, email system) calls `sendGmailMessage(msg, opts)` (`src/index.ts:329`)
2. `applyDevelopmentRecipientOverride(msg)` reads `email-system-development` config; may rewrite to/cc/bcc (`src/index.ts:315`)
3. `getGmailDeps().oauth.refreshAccessTokenIfNeeded(...)` ensures a fresh Google OAuth token (`src/index.ts:331`)
4. `resolveGmailFromEmail(msg.fromEmail, userId)` validates the sender against Gmail sendAs aliases (`src/index.ts:190`)
5. MIME message is built as RFC 2822 lines; base64url-encoded (`src/index.ts:337–357`)
6. `gmailFetch` POSTs to `https://gmail.googleapis.com/gmail/v1/users/me/messages/send` via `deps.oauth.apiFetch` (`src/index.ts:352`)
7. Response `id` is used to fetch the internet `Message-ID` header; `EmailSendReceipt` is returned (`src/index.ts:362–373`)

### MCP Tool Call Path

1. MCP server routes tool call to handler registered in `src/mcp/registry.ts`
2. Handler validates input with zod schema from `src/mcp/handlers.ts`
3. Dispatches to core transport (`sendGmailMessage`, `findGmailReplyInThread`, etc.) in `src/index.ts`
4. Result JSON-serialized as `ExtensionMcpToolResult` (`src/mcp/registry.ts:41–51`)

### Find Reply Path

1. Caller provides `providerThreadId` + `recipientEmail` + optional `sentAfter` + optional `userId`
2. If `providerThreadId` provided: fetch thread minimal, iterate messages, fetch metadata for each, filter by `from` header matching `recipientEmail` and timestamp (`src/index.ts:387–423`)
3. Fallback: Gmail search query `from:<recipientEmail> to:<senderEmail> after:<unix>` (`src/index.ts:425–466`)
4. Returns `EmailReplyMatch | null`

**State Management:**
- Connector settings (sendAs aliases, dev-mode config) are stored externally via `deps.readConnectorConfigFromDatabase` / `deps.writeConnectorConfigToDatabase`. The connector itself holds no persistent state — only the module-level `_deps` singleton.

## Key Abstractions

**GmailConnectorDeps:**
- Purpose: Structural interface listing the exact host capabilities the connector needs; injected at boot
- Examples: `src/deps.ts:95`
- Pattern: Structural typing (no class inheritance); only the methods actually called are declared

**EmailConnector (facade):**
- Purpose: Provider-neutral interface (`send`, `findReply`, `getStatus`, `definition`) so the host can swap email providers
- Examples: `src/email-connector.ts`, `src/definition.ts`
- Pattern: Singleton object implementing an interface from `@cinatra-ai/sdk-extensions/email-contract`

**gmailFetch:**
- Purpose: Thin typed wrapper over `deps.oauth.apiFetch` that prepends the Gmail API base URL and threads through the optional `userId`
- Examples: `src/index.ts:94`
- Pattern: Internal helper; not exported

## Entry Points

**Package public API:**
- Location: `src/index.ts`
- Triggers: Imported by host at boot
- Responsibilities: Exports `gmailAPIConnector`, `gmailEmailConnector`, `registerGmailConnector`, `GmailConnectorDeps`, and all transport functions

**MCP module factory:**
- Location: `src/mcp/module.ts`
- Triggers: Called by host MCP wiring at boot
- Responsibilities: Returns `{ registerCapabilities }` for host to attach Gmail tools to the MCP server

**Setup page:**
- Location: `src/setup-page.tsx`
- Triggers: Host router dispatches at `/connectors/cinatra-ai/gmail-connector/setup`
- Responsibilities: Renders `GmailConnectorPageImpl` with `ExtensionHostContext`

**Server action:**
- Location: `src/actions.ts`
- Triggers: Form submission on the setup page
- Responsibilities: `refreshGmailSendAsAddressesAction` — gated by `requireExtensionAction`, calls `refreshUserGmailSendAsAddresses`, redirects

## Architectural Constraints

- **Server-only:** `src/index.ts`, `src/email-connector.ts`, `src/definition.ts`, `src/gmail-setup-impl.tsx` all begin with `import "server-only"` — never import into client components.
- **Global state:** `_deps` in `src/deps.ts` is the sole module-level singleton. It must be set via `registerGmailConnector` before any transport function is called; tests must call `_resetGmailDepsForTests()` between suites to avoid cross-test contamination.
- **Circular imports:** `gmailAPIConnector` is isolated in `src/definition.ts` specifically to break the `index.ts ↔ email-connector.ts` circular TDZ that fired at server boot. Never move it back to `index.ts`.
- **Threading:** Node.js single-threaded event loop; all async calls use `await` / `Promise`.
- **SDK-only dependency rule:** The connector MUST NOT add direct imports of `@cinatra-ai/*` packages other than `@cinatra-ai/sdk-extensions` and `@cinatra-ai/sdk-ui`. All other host capabilities must be injected via `GmailConnectorDeps`.

## Anti-Patterns

### Importing host internals directly

**What happens:** Adding `import { something } from "@/lib/database"` or any non-SDK `@cinatra-ai/*` package
**Why it's wrong:** Anchors the package to the host's `src/` tree; prevents the connector from running as an extension; breaks the SDK-only decouple contract
**Do this instead:** Extend `GmailConnectorDeps` in `src/deps.ts` with the new capability, inject it via `registerGmailConnector`, and access it via `getGmailDeps()`

### Applying dev-mode override outside `sendGmailMessage`

**What happens:** Caller rewrites `to`/`cc`/`bcc` before calling `sendGmailMessage`, or the override is moved to the email-system facade
**Why it's wrong:** MCP and direct callers would bypass the override, creating a security gap in development environments
**Do this instead:** Keep `applyDevelopmentRecipientOverride` as the first step inside `sendGmailMessage` in `src/index.ts`

### Moving `gmailAPIConnector` back to `index.ts`

**What happens:** The constant is defined in `index.ts` and imported in `email-connector.ts`
**Why it's wrong:** Creates a circular import TDZ (`index.ts → email-connector.ts → index.ts`) that fails at server boot
**Do this instead:** Keep the constant in the leaf file `src/definition.ts` with no local imports

## Error Handling

**Strategy:** Throw `Error` with user-readable messages; no custom error classes.

**Patterns:**
- OAuth/alias failures throw descriptive strings that propagate to the caller (e.g., `"The connected Gmail account cannot send as ${requestedFromEmail}"`)
- Missing DI registration throws immediately with the name of the missing registration call
- Server action catches errors, classifies stale Nango token errors by message pattern, clears connection records, then redirects with `?error=` query param
- `sendGmailMessage` throws if Gmail returns no `id` in the response

## Cross-Cutting Concerns

**Logging:** Not detected — no logger is imported or used; errors surface by throwing.
**Validation:** Zod schemas in `src/mcp/handlers.ts` validate MCP tool inputs; manual checks elsewhere.
**Authentication:** All API calls go through `deps.oauth.apiFetch` which handles token refresh; `requireExtensionAction` gates server actions; setup page reads actor from `ctx.authSession.getActor()`.

---

*Architecture analysis: 2026-06-09*
