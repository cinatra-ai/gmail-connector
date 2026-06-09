# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**Dual send-as storage formats (legacy + current):**
- Issue: `readSettings()` in `src/index.ts` reads both the old `sendAsAddresses: string[]` format and the new `sendAsAliases: Array<{email, displayName}>` format from the same connector-config key, merging them with `??` fallbacks. This dual-path legacy shim is never cleaned up.
- Files: `src/index.ts` (lines 36–49)
- Impact: Any code that reads stored aliases may get inconsistently shaped data depending on when the record was last written. Adding new alias fields in future requires updating both read paths.
- Fix approach: Write a one-time migration that converts all stored `sendAsAddresses`-only records to the `sendAsAliases` shape, then remove the `legacy` read path and the `??` fallback chains.

**Module-level mutable singleton for DI:**
- Issue: `src/deps.ts` uses a module-level `let _deps: GmailConnectorDeps | null = null` singleton. Re-calling `registerGmailConnector` replaces the previous wiring silently, which is intentional for tests but creates a risk: if the registration races or is called multiple times in production (e.g., hot-reload scenarios), the connector silently operates with stale or swapped deps.
- Files: `src/deps.ts` (lines 114–142)
- Impact: Unpredictable behaviour in development hot-reload; test isolation requires manual `_resetGmailDepsForTests()` calls.
- Fix approach: Enforce single-registration in production (throw on second call outside test mode); alternatively use a proper dependency injection container.

**`package.json` `main` points to source, not dist:**
- Issue: `"main": "./src/index.ts"` and `"types": "./src/index.ts"` in `package.json`. This is valid only inside a monorepo that bundles the source, but makes the package non-consumable as a standalone published npm artifact.
- Files: `package.json`
- Impact: `npm pack --dry-run` passes (it validates shape only), but any consumer that installs the package from a registry will get TypeScript source files, not compiled output. The CI skips this scenario for source-mirror repos, so the gap is invisible in CI.
- Fix approach: Add a build step (`tsc`) and update `main`/`types` to point at `dist/index.js` / `dist/index.d.ts`.

**Test for `sendGmailMessage` bypass scans external repo paths:**
- Issue: `src/__tests__/no-direct-send-bypass.test.ts` hardcodes relative repo-root paths like `extensions/cinatra-ai/gmail-connector`, `src/lib/email-system.ts`, and `src/lib/trigger-email-send-use-cases.ts`. The scan also walks `SCAN_DIRS = ["extensions", "packages", "src"]` which are sibling directories outside the connector package itself.
- Files: `src/__tests__/no-direct-send-bypass.test.ts` (lines 16–29)
- Impact: Test always passes in isolation (none of the external dirs exist) but silently loses its guard value — it is effectively a no-op when run outside the monorepo. Any new direct caller in the monorepo would go undetected until the test is run from the monorepo root.
- Fix approach: Run this test only within the monorepo (via a monorepo-level jest/vitest config that resolves the correct `repoRoot`), or remove it from the connector's own test suite and move it to a monorepo-level lint rule.

**Dev-mode override test duplicates production logic:**
- Issue: `src/__tests__/dev-recipient-override.test.ts` re-implements `applyDevelopmentRecipientOverride` as a local probe function (`applyDevRedirectProbe`) copied from the source, rather than testing the actual exported function. The test validates the copy, not the real code path.
- Files: `src/__tests__/dev-recipient-override.test.ts` (lines 26–43)
- Impact: If the production implementation diverges, the tests continue to pass. The comment "Mirrors the implementation in packages/connector-gmail/src/index.ts" acknowledges this but does not mitigate it.
- Fix approach: Export `applyDevelopmentRecipientOverride` (or a testable wrapper) from `src/index.ts` under a `@internal` TSDoc tag, and test the real function directly.

## Known Bugs

**`getMessageInternetId` is a separate network round-trip after send:**
- Symptoms: After `sendGmailMessage` succeeds and returns a `providerMessageId`, the connector immediately fires a second Gmail API call (`getMessageInternetId`) to fetch the `Message-ID` header. If this second call fails (transient network error, rate limit), the `EmailSendReceipt` is never returned even though the email was delivered.
- Files: `src/index.ts` (lines 363–372)
- Trigger: Any transient Gmail API error in the 50–200 ms window after a successful send.
- Workaround: None — the error propagates to the caller. The `internetMessageId` could be made optional (return `undefined` on failure) to decouple delivery confirmation from metadata retrieval.

**`findGmailReplyInThread` fetches metadata for every message serially:**
- Symptoms: For a thread with many messages, the function iterates `payload.messages` and calls `getMessageMetadata(message.id)` inside a `for...of` loop — one sequential network call per message.
- Files: `src/index.ts` (lines 399–423)
- Trigger: Threads with > 5 messages become noticeably slow; the issue compounds when the fallback list search path also fetches metadata serially (lines 439–464).
- Workaround: None currently.

## Security Considerations

**Error messages expose internal OAuth/Nango detail:**
- Risk: `resolveGmailFromEmail` catches alias-list errors and re-throws with the raw `error.message` prepended (line 206–208 in `src/index.ts`). If the upstream error includes internal URLs, token fragments, or provider-specific identifiers, those leak to callers.
- Files: `src/index.ts` (lines 203–209)
- Current mitigation: The error is only surfaced to authenticated, workspace-scoped callers (gated by `requireExtensionAction`).
- Recommendations: Sanitize upstream error messages before re-throwing; log full detail server-side only.

**MCP `gmail_email_send` accepts arbitrary `userId`:**
- Risk: The MCP handler at `src/mcp/handlers.ts` accepts `userId` as an optional string from the tool input schema (`sendMessageSchema`). An agent that supplies a different user's ID could trigger `sendGmailMessage` with that user's OAuth token — there is no server-side check that the requesting actor owns the supplied `userId`.
- Files: `src/mcp/handlers.ts` (lines 47–51), `src/mcp/registry.ts` (lines 40–51)
- Current mitigation: MCP tool calls require an authenticated actor, and the `actor` field is injected by the framework — but the `userId` field from tool input is not cross-checked against `actor.userId`.
- Recommendations: In `gmail_email_send` handler, validate that `input.userId` (when provided) matches the actor's resolved user ID before passing to `sendGmailMessage`.

**`.npmrc` present in repo root:**
- `.npmrc` file exists at the repo root. It currently contains only `auto-install-peers=false` (no auth tokens), but its presence is a reminder that auth tokens could be accidentally committed here.
- Files: `.npmrc`

## Performance Bottlenecks

**Serial per-message metadata fetches in reply search:**
- Problem: `findGmailReplyInThread` makes one `getMessageMetadata` network call per message inside sequential loops — both in the thread-path (lines 399–423) and the fallback list-path (lines 439–464).
- Files: `src/index.ts` (lines 375–468)
- Cause: No parallelism (`Promise.all`) applied to the metadata fetches.
- Improvement path: Batch metadata fetches with `Promise.all` (up to the `maxResults=10` cap), or switch to the Gmail batch API endpoint.

**`refreshAccessTokenIfNeeded` called redundantly:**
- Problem: `sendGmailMessage` calls `refreshAccessTokenIfNeeded` (line 331) and then `resolveGmailFromEmail` also calls it internally (line 191). This results in two token-refresh checks on every send, even when the token is already fresh.
- Files: `src/index.ts` (lines 190–228, 329–373)
- Cause: `resolveGmailFromEmail` needs the `accountEmail` from the refresh result, and `sendGmailMessage` also guards the token before the fetch. No shared result is threaded between them.
- Improvement path: Hoist one `refreshAccessTokenIfNeeded` call in `sendGmailMessage`, pass the `accountEmail` into `resolveGmailFromEmail` as a parameter so the second call is avoided.

## Fragile Areas

**`applyDevelopmentRecipientOverride` is module-private and untestable against real code:**
- Files: `src/index.ts` (lines 315–327)
- Why fragile: The function is not exported, so tests cannot call it directly. The test file duplicates its logic instead. A refactor of the function body would not be caught by the existing tests.
- Safe modification: Any change to the override logic must be manually mirrored in the test probe, otherwise the test becomes misleading.
- Test coverage: The existing test covers the copied probe, not the real function.

**DI singleton has no guard against use before registration:**
- Files: `src/deps.ts` (lines 133–142)
- Why fragile: `getGmailDeps()` throws at runtime if called before `registerGmailConnector`. In the monorepo this is caught at boot, but in test environments without proper setup the error surface is a runtime exception rather than a compile-time or import-time guard.
- Safe modification: Always call `registerGmailConnector(mockDeps)` in test `beforeEach`; use `_resetGmailDepsForTests()` in `afterEach` to prevent state bleed between test files.
- Test coverage: The two existing tests mock `@/lib/database` directly rather than calling `registerGmailConnector`, bypassing the DI layer entirely — this means the DI wiring is not exercised in any test.

**`gmailSetupRedirect` constructs redirect URLs with raw user error strings:**
- Files: `src/actions.ts` (lines 32–39)
- Why fragile: The error string from a caught exception is put directly into a query parameter. If the message contains characters that break URL parsing (e.g., `?`, `#`, `&`), `URLSearchParams` will encode them, but downstream consumers reading the raw query string without proper decoding may misbehave.
- Safe modification: Ensure all consumers use `URLSearchParams.get()` to decode, not manual string splitting.
- Test coverage: Not tested.

## Scaling Limits

**Reply search capped at 10 messages:**
- Current capacity: `maxResults=10` hardcoded in the Gmail list query (line 435 of `src/index.ts`).
- Limit: If the recipient sent more than 10 replies (or the mailbox has 10+ unrelated messages from that sender), replies beyond the cap are silently missed.
- Scaling path: Implement pagination using Gmail's `pageToken` response field and iterate until a match is found or a time-based cutoff is reached.

## Dependencies at Risk

**`radix-ui` version pinned with `^1.4.3` (major-version risk):**
- Risk: `radix-ui` v1 is the "all-in-one" combined package that recently replaced individual `@radix-ui/react-*` packages. The API surface changes significantly across major versions, and the `^` range allows minor bumps that could silently pull in breaking changes before Radix considers them breaking.
- Files: `package.json`
- Impact: UI components in `src/components/ui/` could break on a minor Radix update.
- Migration plan: Pin to an exact version or narrow the range; monitor Radix changelog for the v1 → v2 transition.

**`@cinatra-ai/sdk-extensions` and `@cinatra-ai/sdk-ui` are optional peers with wildcard range (`"*"`):**
- Risk: The wildcard range means any version satisfies the peer constraint. There is no minimum version guard — if the monorepo downgrades these packages, the connector will still install without warning but may fail at runtime.
- Files: `package.json`
- Impact: Silent compatibility breaks at runtime; no version-mismatch warning from the package manager.
- Migration plan: Narrow peer ranges to a minimum semver (e.g., `">=0.1.0"`) once the SDK stabilises.

## Missing Critical Features

**No HTML email body support:**
- Problem: `sendGmailMessage` constructs a plain-text MIME message only (`Content-Type: text/plain`). There is no `htmlBody` field in `EmailSystemMessage` handling.
- Files: `src/index.ts` (lines 336–351)
- Blocks: Sending formatted campaign emails with HTML content through the Gmail connector.

**No attachment support:**
- Problem: The connector has no MIME multipart handling; attachments cannot be sent.
- Files: `src/index.ts` (lines 336–360)
- Blocks: Any use-case requiring file attachments in outbound campaign emails.

**No rate-limit handling or retry logic:**
- Problem: All `gmailFetch` calls propagate raw Gmail API errors (including 429 Too Many Requests) directly to callers with no retry or backoff.
- Files: `src/index.ts` (lines 94–105)
- Blocks: Reliable bulk-send campaigns that could hit Gmail's per-user send quota.

## Test Coverage Gaps

**DI registration path is not tested:**
- What's not tested: `registerGmailConnector`, `getGmailDeps`, and `_resetGmailDepsForTests` are never exercised in the test suite. Both existing tests bypass DI entirely by mocking `@/lib/database` at the module level.
- Files: `src/deps.ts`, `src/__tests__/dev-recipient-override.test.ts`, `src/__tests__/no-direct-send-bypass.test.ts`
- Risk: A regression in DI wiring (e.g., `getGmailDeps()` throwing prematurely, or `registerGmailConnector` not persisting deps correctly) would not be caught.
- Priority: High

**`sendGmailMessage` happy-path and error-path are not tested:**
- What's not tested: The full send flow including MIME construction, base64URL encoding, `gmailFetch` invocation, and the `getMessageInternetId` post-send call.
- Files: `src/index.ts` (lines 329–373)
- Risk: Regressions in header encoding, recipient formatting, or receipt construction go undetected.
- Priority: High

**`findGmailReplyInThread` is not tested:**
- What's not tested: Neither the thread-based nor the fallback list-based reply-search paths.
- Files: `src/index.ts` (lines 375–468)
- Risk: Silent breakage of reply-detection logic used by campaign follow-up tracking.
- Priority: Medium

**`refreshGmailSendAsAddressesAction` (server action) is not tested:**
- What's not tested: The error handling paths in `src/actions.ts` — stale token detection, redirect construction, and `clearConnectionRecords` invocation.
- Files: `src/actions.ts`
- Risk: Stale-token error handling or redirect URL construction bugs would surface only in production.
- Priority: Medium

**MCP handler wiring and tool registration are not tested:**
- What's not tested: `src/mcp/registry.ts` tool registration loop, schema validation, and the `structuredContent` serialisation in the handler wrapper.
- Files: `src/mcp/registry.ts`, `src/mcp/handlers.ts`
- Risk: A malformed `structuredContent` result or a schema mismatch in `sendMessageSchema` would only be caught at runtime when an agent calls the tool.
- Priority: Low

---

*Concerns audit: 2026-06-09*
