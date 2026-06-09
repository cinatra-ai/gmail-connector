# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no separate assertion library

**Run Commands:**
```bash
pnpm test          # Run all tests (vitest)
pnpm test --watch  # Watch mode
# Coverage: no coverage script configured in package.json
```

## Test File Organization

**Location:**
- Separate `src/__tests__/` directory (not co-located with source)

**Naming:**
- `<kebab-case-description>.test.ts`
- Examples: `dev-recipient-override.test.ts`, `no-direct-send-bypass.test.ts`

**Structure:**
```
src/
└── __tests__/
    ├── dev-recipient-override.test.ts    # behavioral unit test for dev-mode redirect
    └── no-direct-send-bypass.test.ts     # architectural lint guard (filesystem scan)
```

## Test Structure

**Suite Organization:**
```typescript
describe("connector-gmail dev recipient override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through unchanged when dev mode disabled", () => { ... });
  it("rewrites to/cc/bcc when dev mode enabled with override email", () => { ... });
  it("throws when dev mode enabled but no override configured", () => { ... });
  it("dev mode key is the same key written by saveEmailSystemDevelopmentSettings", () => { ... });
});
```

**Patterns:**
- `beforeEach(() => vi.clearAllMocks())` is the standard reset pattern; no `afterEach` teardown needed
- Each `it()` name describes the expected behavior as a complete sentence
- Tests open with a long JSDoc block comment describing the architectural invariant being guarded and what is mocked

## Mocking

**Framework:** Vitest (`vi.mock`, `vi.fn`, `vi.mocked`)

**Patterns:**
```typescript
// Module-level mock declaration (hoisted by Vitest)
vi.mock("@/lib/database", () => ({
  readConnectorConfigFromDatabase: vi.fn(),
  writeConnectorConfigToDatabase: vi.fn(),
}));

// Import mocked value after vi.mock block
import { readConnectorConfigFromDatabase } from "@/lib/database";

// Per-test mock return value
vi.mocked(readConnectorConfigFromDatabase).mockReturnValue({
  developmentModeEnabled: true,
  overrideRecipientEmail: "dev@example.com",
});
```

**What to Mock:**
- Host-internal modules that are not available standalone: `@/lib/database` (mapped to a stub via vitest alias)
- External dependencies that require live infrastructure (OAuth, Nango, Gmail API)

**What NOT to Mock:**
- The function under test itself — tests probe behavior through a local wrapper (`applyDevRedirectProbe`) that mirrors the private production implementation
- Pure utility logic in `src/lib/utils.ts`

## Fixtures and Factories

**Test Data:**
- Inline object literals within each `it()` block — no shared fixtures or factory functions
- Example: `{ to: ["alice@example.com"], cc: ["b@x.com"] }` passed directly to the probe function

**Location:**
- No separate fixture files in this repo
- Stub files for host-internal modules live in the monorepo at `tests/__stubs__/server-only.ts` and `tests/__stubs__/database.ts` (resolved via `vitest.config.ts` aliases, not present in this package)

## Coverage

**Requirements:** Not enforced — no coverage threshold configured
**View Coverage:** No dedicated coverage script in `package.json`

## Test Types

**Unit Tests:**
- `src/__tests__/dev-recipient-override.test.ts`: behavioral test of the `applyDevelopmentRecipientOverride` logic via a local probe wrapper; mocks the database dep, asserts redirect behavior across enabled/disabled/misconfigured dev-mode states

**Integration Tests:**
- Not applicable — no integration tests present

**Architectural Lint Tests:**
- `src/__tests__/no-direct-send-bypass.test.ts`: filesystem-scanning guard that walks the monorepo source tree and asserts that only explicitly allowlisted files import `sendGmailMessage` directly. This is a static-analysis guard enforced as a Vitest test. The `ALLOWED` set inside this file is the authoritative allowlist and must be updated when new legitimate callers are added.

**E2E Tests:**
- Not used in this package

## Vitest Alias Configuration

The `vitest.config.ts` maps host-internal aliases that resolve only in the monorepo:

```typescript
resolve: {
  alias: [
    { find: "server-only", replacement: "<repoRoot>/tests/__stubs__/server-only.ts" },
    { find: "@/lib/database", replacement: "<repoRoot>/tests/__stubs__/database.ts" },
    { find: /^@\/(.+)$/, replacement: "<repoRoot>/src/$1" },
  ],
},
test: {
  environment: "node",
  include: ["src/__tests__/**/*.test.ts"],
  exclude: ["**/node_modules/**"],
},
```

Tests that use `@/lib/database` rely on the `vi.mock("@/lib/database", ...)` factory rather than the stub file directly — the stub provides the module shape; `vi.mock` overrides the implementation per test.

## Common Patterns

**Async Testing:**
```typescript
// Not used in current tests — all tested functions are synchronous probes
// For async: standard async/await with vitest
it("sends email", async () => {
  await expect(someAsyncFn()).resolves.toEqual(...);
});
```

**Error Testing:**
```typescript
// Synchronous throw
expect(() =>
  applyDevRedirectProbe({ to: ["alice@example.com"] }),
).toThrow("Development mode is enabled");

// Async throw (pattern for future tests)
await expect(asyncFn()).rejects.toThrow("...");
```

**Spy / Call Assertion:**
```typescript
expect(readConnectorConfigFromDatabase).toHaveBeenCalledWith(
  "email-system-development",
  {},
);
```

---

*Testing analysis: 2026-06-09*
