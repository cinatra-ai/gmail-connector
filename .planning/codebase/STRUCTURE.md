# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
gmail-connector/
├── src/
│   ├── __tests__/                    # Vitest test files (co-located with src, not with subjects)
│   │   ├── dev-recipient-override.test.ts
│   │   └── no-direct-send-bypass.test.ts
│   ├── components/
│   │   └── ui/                       # Local UI primitives for the setup page
│   │       ├── alert.tsx
│   │       └── button.tsx
│   ├── mcp/                          # MCP tool surface (agentic access)
│   │   ├── handlers.ts               # Zod schemas + handler map
│   │   ├── module.ts                 # createGmailModule() factory (host entry)
│   │   └── registry.ts               # registerGmailPrimitives() — attaches tools to MCP server
│   ├── actions.ts                    # Next.js server action: refreshGmailSendAsAddressesAction
│   ├── definition.ts                 # Leaf: gmailAPIConnector constant (no local deps, breaks TDZ)
│   ├── deps.ts                       # DI singleton: GmailConnectorDeps interface + register/get
│   ├── email-connector.ts            # EmailConnector facade: gmailEmailConnector singleton
│   ├── gmail-setup-impl.tsx          # RSC setup page implementation
│   ├── index.ts                      # Public package entry: all transport exports
│   ├── lib/
│   │   └── utils.ts                  # Shared UI utilities (e.g., cn() for class merging)
│   └── setup-page.tsx                # Thin dispatch route → GmailConnectorPageImpl
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── .npmrc
├── LICENSE
├── README.md
├── package.json                      # Cinatra connector manifest + package metadata
├── tsconfig.json
└── vitest.config.ts
```

## Directory Purposes

**`src/`:**
- Purpose: All connector source code — transport, DI, MCP surface, setup UI
- Key files: `src/index.ts` (public API), `src/deps.ts` (DI), `src/email-connector.ts` (facade)

**`src/__tests__/`:**
- Purpose: Vitest unit tests; separated from subject files under a shared `__tests__` folder
- Key files: `src/__tests__/dev-recipient-override.test.ts`, `src/__tests__/no-direct-send-bypass.test.ts`

**`src/components/ui/`:**
- Purpose: Local Radix-based UI primitives scoped to the Gmail setup page
- Key files: `src/components/ui/alert.tsx`, `src/components/ui/button.tsx`
- Note: These are self-contained; do not pull unrelated host UI from here

**`src/mcp/`:**
- Purpose: MCP (Model Context Protocol) tool surface exposing Gmail capabilities to AI agents
- Key files: `src/mcp/handlers.ts` (logic + schemas), `src/mcp/registry.ts` (tool registration), `src/mcp/module.ts` (factory)

**`src/lib/`:**
- Purpose: Shared utility helpers (currently only `utils.ts` for Tailwind class merging)
- Key files: `src/lib/utils.ts`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Main package entry (`"main"` and `"types"` in `package.json`); exports all public transport functions and re-exports `gmailAPIConnector`, `gmailEmailConnector`, `registerGmailConnector`, `GmailConnectorDeps`
- `src/mcp/module.ts`: MCP module factory called by the host at boot
- `src/setup-page.tsx`: Setup page component dispatched by the host router

**Configuration:**
- `package.json`: Package metadata, Cinatra connector manifest (`cinatra.apiVersion`, `kind`, `requestedHostPorts`), peer/runtime dependencies
- `tsconfig.json`: TypeScript compiler options
- `vitest.config.ts`: Test runner configuration

**Core Logic:**
- `src/deps.ts`: Dependency injection interface and singleton — start here when adding new host capabilities
- `src/index.ts`: All Gmail API operations — edit here for send/reply/alias logic
- `src/mcp/handlers.ts`: Zod schemas and handler dispatch — edit here to add or modify MCP tools

**Testing:**
- `src/__tests__/dev-recipient-override.test.ts`: Dev-mode override contract tests
- `src/__tests__/no-direct-send-bypass.test.ts`: Direct-send bypass guard tests

## Naming Conventions

**Files:**
- kebab-case for all source files: `email-connector.ts`, `gmail-setup-impl.tsx`, `dev-recipient-override.test.ts`
- `.tsx` extension for files containing JSX (setup page, UI components)
- `.ts` extension for all non-JSX files
- Test files named `<subject>.test.ts` placed in `src/__tests__/`

**Directories:**
- kebab-case: `src/mcp/`, `src/components/ui/`
- `__tests__` for all Vitest test files (double underscore, all lowercase)

**Exports:**
- Named exports throughout; no default exports except `setup-page.tsx` (required by Next.js routing convention)
- Constants: camelCase (`gmailAPIConnector`, `gmailEmailConnector`)
- Types/Interfaces: PascalCase (`GmailConnectorDeps`, `GmailNangoCapability`, `GmailSendAsAlias`)
- Functions: camelCase (`sendGmailMessage`, `getGmailDeps`, `registerGmailConnector`)

## Where to Add New Code

**New Gmail API operation (e.g., list labels, archive thread):**
- Implementation: Add exported async function to `src/index.ts`
- MCP exposure: Add zod schema + handler entry in `src/mcp/handlers.ts`, add `TOOL_META` entry in `src/mcp/registry.ts`
- Tests: Add test file in `src/__tests__/`

**New host capability dependency:**
- Extend `GmailConnectorDeps` interface in `src/deps.ts`
- Update callers to access the new dep via `getGmailDeps().newDep`
- The host must inject the concrete impl via `registerGmailConnector(deps)`

**New setup page UI section:**
- Edit `src/gmail-setup-impl.tsx`
- If new UI primitives are needed: add to `src/components/ui/`

**New server action:**
- Add to `src/actions.ts` (mark `"use server"` at file top)
- Gate with `requireExtensionAction(GMAIL_PACKAGE_ID, "<permission>")` from `@cinatra-ai/sdk-extensions`

**New MCP tool only (no new Gmail API call):**
- Add handler in `src/mcp/handlers.ts` + metadata in `src/mcp/registry.ts`

**Shared utility:**
- UI helpers (class merging, etc.): `src/lib/utils.ts`
- Transport helpers (header encoding, email parsing): add private function in `src/index.ts` (do not export)

## Special Directories

**`.github/workflows/`:**
- Purpose: CI (test) and release pipelines
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents (this file)
- Generated: Yes (by gsd-map-codebase)
- Committed: Up to team preference

---

*Structure analysis: 2026-06-09*
