# Gmail

Send mail from your Gmail account through Cinatra and pick up the replies. Each user connects their own Google account, and Cinatra agents that send email — outreach, follow-ups, transactional sends — can route through Gmail as the sender.

## Works with

- `@cinatra-ai/sdk-extensions` — the Cinatra extension SDK (peer dependency)
- `@cinatra-ai/email-connector` — the facade that routes the `email-send` capability to the active email provider

## Capabilities

- Send email from a connected Gmail account on a user's behalf
- Send as one of the user's verified Gmail send-as aliases
- Detect the reply to an email Cinatra has previously sent
- Keep each user's send-as alias list in sync with Gmail

---

## Purpose

The Gmail connector implements Cinatra's `email-send` capability provider using the Gmail API. It is a **per-user** connector: each workspace member connects their own Google account (via OAuth through Nango), and outbound email is sent as that user rather than a shared system address.

It supports:

- **Sending** plain-text email from the user's primary Gmail address or any verified send-as alias.
- **Alias sync** — fetching and caching the user's Gmail send-as aliases so agents and human-in-the-loop workflows can present a From-address picker without an extra API call on every send.
- **Reply detection** — searching a Gmail thread or the full mailbox to find a recipient's reply to a previously sent message.
- **MCP primitives** — exposing `gmail_status`, `gmail_aliases_list`, `gmail_aliases_refresh`, `gmail_email_send`, and `gmail_email_find_reply` through the connector's MCP surface.
- **Development-mode recipient override** — when enabled in the email-system settings, every outbound message is silently redirected to a configured override address so test sends never reach real recipients.

---

## Install

This package is a Cinatra extension. It is not installed as a standalone npm package — it ships as part of the Cinatra extension hub and is activated by the Cinatra host at boot.

If you are building a connector extension and want to import from this package in tests:

```sh
npm install @cinatra-ai/gmail-connector
```

Peer dependencies required at runtime:

```json
{
  "@cinatra-ai/sdk-extensions": "*",
  "@cinatra-ai/sdk-ui": "*",
  "react": "^19.2.3",
  "react-dom": "^19.2.3"
}
```

---

## Usage

### Connecting a Google account

Each user connects through the Gmail connector setup page at `/connectors/cinatra-ai/gmail-connector/setup`. The page shows the current OAuth connection status and provides a button to refresh the send-as alias list.

After connecting, Cinatra automatically syncs the user's Gmail send-as aliases. Any email agents or workflows configured to send via Gmail will use the connected account.

### Example: sending an email via MCP primitive

The connector exposes a `gmail_email_send` primitive through the MCP surface. Inputs:

| Field | Required | Description |
|---|---|---|
| `to` | Yes | Array of recipient email addresses |
| `subject` | Yes | Email subject line |
| `textBody` | Yes | Plain-text message body |
| `fromEmail` | No | Sender address; must be the connected Gmail address or a verified send-as alias |
| `fromName` | No | Display name for the From header |
| `cc` | No | Array of CC addresses |
| `bcc` | No | Array of BCC addresses |
| `replyTo` | No | Reply-To address |
| `inReplyTo` | No | `Message-ID` of the message being replied to |
| `references` | No | Array of `Message-ID` values for threading |
| `providerThreadId` | No | Gmail thread ID to append to |
| `userId` | No | Cinatra user ID; scopes the send to that user's OAuth token |

On success it returns:

```json
{
  "providerId": "gmail",
  "providerMessageId": "<gmail message id>",
  "providerThreadId": "<gmail thread id>",
  "internetMessageId": "<RFC 2822 Message-ID>",
  "sentAt": "<ISO 8601 timestamp>"
}
```

**Failure modes:**

- `No Gmail sender account is connected.` — the user has not completed the OAuth flow.
- `The connected Gmail account cannot send as <address>.` — `fromEmail` is not a verified send-as alias on the connected account.
- `The Gmail send-as alias <address> is not verified yet.` — the alias exists in Gmail but its verification is pending.
- `Development mode is enabled, but no override recipient email is configured.` — development-mode recipient override is on but missing the target address.

### Example: checking for a reply

The `gmail_email_find_reply` primitive searches for a recipient's reply:

| Field | Required | Description |
|---|---|---|
| `recipientEmail` | Yes | The address you expect the reply to come from |
| `providerThreadId` | No | If supplied, only messages in this Gmail thread are checked |
| `sentAfter` | No | ISO 8601 timestamp; only messages after this time are considered |
| `userId` | No | Cinatra user ID; scopes the search to that user's mailbox |

Returns the first matching reply message, or `null` when no reply is found yet.

---

## Configuration

### OAuth connection (per user)

Each user must authenticate via the Gmail connector setup page. The OAuth flow is managed through Nango using the `gmail` connector key. No manual credential entry is needed — the connector handles token refresh automatically.

### Send-as aliases

After connecting, click **Refresh send addresses** on the setup page to pull the current list of verified Gmail send-as aliases for your account. This list is cached locally and used by agents and human-in-the-loop workflows to present a From-address picker.

The alias list updates automatically each time a user completes the OAuth connection flow.

### Development-mode recipient override

When `developmentModeEnabled` is set in the `email-system-development` connector config, every outbound Gmail message is redirected to `overrideRecipientEmail` regardless of the To/CC/BCC fields. Enable this during local testing to prevent accidental sends to real recipients.

---

## API contract

The connector exports the following public API from `@cinatra-ai/gmail-connector`:

| Export | Description |
|---|---|
| `gmailAPIConnector` | The `EmailConnectorDefinition` descriptor (id, name, slug, OAuth/API-key flags) |
| `gmailEmailConnector` | The `EmailConnector` singleton — `send`, `findReply`, `getStatus`, `listFromAddresses` |
| `registerGmailConnector(deps)` | Wire host runtime deps at activation; also used by tests to inject stubs |
| `getGmailConnectorStatus(userId?)` | Returns `connected / not_connected / incomplete` plus the connected account email |
| `getStoredGmailSendAsAddresses(userId?)` | Returns the cached alias list (no network call) |
| `refreshGmailSendAsAddresses()` | Fetches and stores the alias list for the connector-level (non-user-scoped) connection |
| `refreshUserGmailSendAsAddresses(userId)` | Fetches and stores the alias list for a specific user |
| `sendGmailMessage(message, opts?)` | Send a message and return an `EmailSendReceipt` |
| `findGmailReplyInThread(input)` | Search for a recipient's reply; returns `EmailReplyMatch` or `null` |

Entry points declared in `package.json`:

| Path | Module |
|---|---|
| `.` (default) | `src/index.ts` — public connector API |
| `./register` | `src/register.ts` — host activation entry (`register(ctx)`) |
| `./setup-page` | `src/setup-page.tsx` — React server component for the connector setup UI |
| `./mcp-module` | `src/mcp/module.ts` — MCP capability module |
| `./mcp-handlers` | `src/mcp/handlers.ts` — MCP primitive handler factory + Zod schemas |

---

## Development

### Prerequisites

- Node.js with ESM support
- Peer packages installed (`@cinatra-ai/sdk-extensions`, React)

### Running tests

```sh
npm test
```

Tests use [Vitest](https://vitest.dev/). The connector's host dependencies (database config, Nango, Google OAuth) are injected via `registerGmailConnector(stubDeps)` in test setup — no live Google account is needed to run the test suite.

To reset injected deps between test blocks:

```ts
import { _resetGmailDepsForTests, registerGmailConnector } from "@cinatra-ai/gmail-connector";

beforeEach(() => {
  _resetGmailDepsForTests();
  registerGmailConnector(mockDeps);
});
```

### Linting

```sh
npm run lint
```

### Package structure

```
src/
  index.ts           — public exports (send, find reply, alias ops, DI registration)
  definition.ts      — EmailConnectorDefinition descriptor (avoids circular TDZ)
  email-connector.ts — EmailConnector singleton wrapping the index.ts functions
  register.ts        — host activation entry; binds capabilities at boot
  actions.ts         — Next.js server action for the alias-refresh UI button
  deps.ts            — host DI contract types + globalThis-based singleton slot
  setup-page.tsx     — connector setup page dispatch
  mcp/
    module.ts        — MCP module factory
    handlers.ts      — primitive handlers (gmail_status, gmail_email_send, etc.)
  components/        — UI components for the setup page
  lib/               — shared utilities
```

---

## Troubleshooting

**"No Gmail sender account is connected."**
The user's OAuth token is missing. Direct them to the connector setup page to reconnect their Google account.

**"Gmail authorization expired. Please reconnect your Gmail account."**
The stored Nango token is stale (for example, the Google OAuth refresh token was revoked). The connector clears the connection record automatically; the user needs to reconnect via the setup page.

**Alias not appearing as a From-address option**
Click **Refresh send addresses** on the setup page to re-sync aliases from Gmail. If the alias still does not appear, confirm it is added and verified in Gmail's Settings → Accounts.

**"The Gmail send-as alias is not verified yet."**
The alias exists in Gmail but Google's verification email has not been clicked. Ask the user to check their inbox for the Gmail verification message and confirm the alias before retrying.

**Send succeeds but the wrong address appears as the sender**
If `fromEmail` is omitted, the connector defaults to the primary connected Gmail address. Pass the intended alias email explicitly in `fromEmail`.

**Development-mode override is active in production**
Check the `email-system-development` connector config. Set `developmentModeEnabled` to `false` (or remove the key) to allow messages to reach their real recipients.
