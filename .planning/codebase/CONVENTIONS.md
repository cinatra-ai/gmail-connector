# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- kebab-case for all source files: `email-connector.ts`, `gmail-setup-impl.tsx`, `setup-page.tsx`
- Double-underscore prefix for test-internal helpers and reset utilities: `_resetGmailDepsForTests()`
- Test files live in `src/__tests__/` and use `.test.ts` suffix

**Functions:**
- camelCase for all exported and internal functions: `sendGmailMessage`, `applyDevelopmentRecipientOverride`, `resolveGmailFromEmail`
- Action files (Next.js Server Actions) use an `Action` suffix: `refreshGmailSendAsAddressesAction`
- Private/module-internal helpers are unexported regular functions (no underscore prefix, except explicit `@internal` test helpers)

**Variables:**
- camelCase throughout: `connectedAccountEmail`, `normalizedRequestedFromEmail`, `matchingAlias`
- Constants in SCREAMING_SNAKE_CASE for top-level module constants: `ALLOWED`, `SCAN_DIRS`, `EXTENSIONS`, `TOOL_META`, `GMAIL_PACKAGE_ID`

**Types/Interfaces:**
- PascalCase for all type aliases and interfaces: `GmailConnectorDeps`, `GmailNangoCapability`, `GmailOAuthCapability`, `GmailSendAsAlias`
- `type` keyword preferred over `interface` for shapes unless structural extension is intended; both are used (`export type` for re-exported aliases, `export interface` for injectable contracts)

**Schemas:**
- Zod schemas exported with a `Schema` suffix: `sendMessageSchema`, `findReplySchema`

## Code Style

**Formatting:**
- No project-level `.prettierrc` or `eslint.config.*` detected — formatting relies on the monorepo host's tooling when the package is consumed there
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`), but `noImplicitAny` is overridden to `false`
- `verbatimModuleSyntax: true` — all type-only imports must use `import type`

**Linting:**
- No standalone ESLint config present in this repo; lint runs in the monorepo context
- `import type` enforced everywhere types are imported: `import type { EmailConnector, ... }` in `src/email-connector.ts`

## Import Organization

**Order (observed pattern):**
1. Node built-ins (`node:fs`, `node:path`)
2. External third-party packages (`zod`, `clsx`, `next/navigation`, `vitest`)
3. SDK packages (`@cinatra-ai/sdk-extensions`, `@cinatra-ai/sdk-extensions/email-contract`)
4. Local relative imports (`../index`, `./deps`, `./definition`)

**Path Aliases:**
- No `@/` alias within this package itself — `@/` aliases (`@/lib/database`) point to the host monorepo's `src/` and are only valid when running in the monorepo context (vitest config maps them via alias)
- Local imports always use relative paths (`./index`, `../index`, `./deps`)

**`import type` usage:**
- Mandatory for all type-only imports (`import type { EmailConnectorDefinition }`)
- Mixed value+type imports use inline `type` modifier where needed

## Error Handling

**Patterns:**
- Functions throw `new Error("...")` with descriptive human-readable messages that name the broken condition and suggest a fix: `"The Gmail send-as alias ${requestedFromEmail} is not verified yet. Verify it in Gmail administration before sending campaign emails."`
- Async functions propagate errors naturally (no silent swallowing)
- Where errors are caught and re-thrown, the original message is extracted via `error instanceof Error ? error.message : "fallback"` before wrapping
- Dev-mode guard throws explicitly if misconfigured: `throw new Error("Development mode is enabled, but no override recipient email is configured.")`
- Actions (`src/actions.ts`) catch errors and redirect to the setup page with an `?error=` query param rather than propagating to the render layer

**Guard patterns:**
- Dependency injection throws loudly if `registerGmailConnector` was not called at boot — fail-loud over silent fallback (`src/deps.ts`)

## Logging

**Framework:** None — no structured logger is used
**Patterns:** No `console.log`/`console.error` calls detected in production source. Error context is conveyed through thrown Error messages, not logs.

## Comments

**When to Comment:**
- Module-level JSDoc block comments explain architectural intent, coupling decisions, and why a pattern was chosen (not just what the code does): see `src/deps.ts`, `src/email-connector.ts`, `src/actions.ts`
- Multi-line `//` comments document non-obvious constraints inline above the relevant code
- Test files open with a long JSDoc comment explaining the test's scope, what it mocks, and what architectural invariant it guards

**JSDoc/TSDoc:**
- Used for exported functions and types in `src/deps.ts` to document the contract and host-boot wiring requirements (`/** ... */` blocks)
- `@internal` JSDoc tag used for test-only exports: `/** @internal Only for tests — clear deps so a fresh registration is required. */`

## Function Design

**Size:** Functions are kept focused on a single responsibility. Long orchestration functions (like `sendGmailMessage`) are broken into private helper functions (`applyDevelopmentRecipientOverride`, `resolveGmailFromEmail`, `gmailFetch`)

**Parameters:** Options grouped into a single object parameter when more than one optional param is needed: `sendGmailMessage(rawMessage, options?: { userId?: string })`

**Return Values:** Async functions always return typed promises. `null` is used as the explicit "not found" sentinel for search operations (`findGmailReplyInThread` returns `EmailReplyMatch | null`)

## Module Design

**Exports:**
- `src/index.ts` is the primary public surface; it re-exports `gmailAPIConnector` from `./definition` and `gmailEmailConnector` from `./email-connector` to avoid circular deps
- `src/deps.ts` exports the DI registration and retrieval functions (`registerGmailConnector`, `getGmailDeps`, `_resetGmailDepsForTests`)
- Leaf definition files (`src/definition.ts`) exist specifically to break circular-dependency TDZ chains

**Barrel Files:**
- `src/index.ts` acts as the package barrel; it exports all public symbols via named exports plus selected re-exports
- No `index.ts` barrel files inside subdirectories — `src/mcp/` exports `createGmailModule` from `src/mcp/module.ts` directly

**Server-Only Gating:**
- Files that must not run in the browser include `import "server-only"` at the top: `src/definition.ts`, `src/email-connector.ts`

---

*Convention analysis: 2026-06-09*
