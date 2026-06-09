# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript 5.x (ES2023 target) - All source and test files under `src/`

**Secondary:**
- TSX - React component files: `src/components/ui/alert.tsx`, `src/components/ui/button.tsx`, `src/gmail-setup-impl.tsx`, `src/setup-page.tsx`

## Runtime

**Environment:**
- Node.js (server-side); `vitest.config.ts` sets `environment: "node"`
- Next.js server context implied by `"use server"` directive in `src/actions.ts` and `import "server-only"` in `src/definition.ts`

**Package Manager:**
- npm (`.npmrc` present — existence only, contents not read)
- Lockfile: Not present in repo root (likely managed by a host monorepo)

## Frameworks

**Core:**
- React 19.x (peer dependency) - UI components in `src/components/ui/` and setup pages
- Next.js (implied peer via `next/navigation` import in `src/actions.ts`) - Server actions, routing

**Testing:**
- Vitest - Test runner, config at `vitest.config.ts`
- Test files under `src/__tests__/`

**Build/Dev:**
- TypeScript compiler (`tsc`) - Config at `tsconfig.json`, targets `ESNext` modules with bundler resolution
- `isolatedModules: true`, `verbatimModuleSyntax: true` enforced

## Key Dependencies

**Critical:**
- `@cinatra-ai/sdk-extensions` (peer, optional) - Provides `EmailConnectorDefinition`, `requireExtensionAction`, `ExtensionPrimitiveRequest`, and `email-contract` types; core SDK contract
- `@cinatra-ai/sdk-ui` (peer, optional) - UI primitives from Cinatra SDK
- `zod` (imported in `src/mcp/handlers.ts`) - Runtime input validation for MCP primitive handlers

**Infrastructure:**
- `class-variance-authority` ^0.7.1 - Component variant styling utility
- `clsx` ^2.1.1 - Conditional class name utility
- `radix-ui` ^1.4.3 - Headless UI primitives (used in `src/components/ui/`)
- `tailwind-merge` ^3.5.0 - Tailwind class merging utility

**React:**
- `react` ^19.2.3 (peer dependency)
- `react-dom` ^19.2.3 (peer dependency)

## Configuration

**Environment:**
- `.env` file existence noted — contents not read
- Runtime secrets (OAuth tokens, Nango credentials) are injected at boot via `registerGmailConnector(deps)` in `src/deps.ts` — no env vars read directly by this package
- Connector config stored in host database via injected `readConnectorConfigFromDatabase` / `writeConnectorConfigToDatabase`

**Build:**
- `tsconfig.json` — strict mode, `noImplicitAny: false`, `outDir: "dist"`, `rootDir: "src"`, JSX `react-jsx`
- `vitest.config.ts` — aliases `server-only` and `@/lib/database` to stubs from a parent monorepo test path; resolves `@/` to the monorepo `src/`

**Cinatra Connector Manifest:**
Defined in `package.json` under the `"cinatra"` key:
- `apiVersion: "cinatra.ai/v1"`
- `kind: "connector"`
- `displayName: "Gmail"`
- `requestedHostPorts: ["authSession", "nango"]`

## Platform Requirements

**Development:**
- Node.js with ESM support (`"type": "module"` in `package.json`)
- Host monorepo must be present for vitest stubs (paths like `../../..` from `vitest.config.ts`)

**Production:**
- Next.js server environment (server actions, `server-only` guard)
- Host must call `registerGmailConnector(deps)` at boot to wire database, Nango, and Google OAuth dependencies
- Deployed as a Cinatra connector extension inside a host Next.js application

---

*Stack analysis: 2026-06-09*
