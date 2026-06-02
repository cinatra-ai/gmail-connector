/**
 * Architectural lint guard.
 *
 * Forbids direct imports of `sendGmailMessage` outside an allowed list.
 * The connector applies `applyDevelopmentRecipientOverride` inside
 * sendGmailMessage, so direct callers are technically covered, but this
 * guard preserves the intent that `src/lib/email-system.ts:sendEmailThroughSystem`
 * remains the canonical app-layer chokepoint. New direct callers must be
 * explicitly allowlisted here with a justification.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../../..");

// Allowlist: files where direct import of sendGmailMessage is permitted.
// Any path NOT in this list that imports sendGmailMessage will fail this test.
const ALLOWED = new Set([
  "extensions/cinatra-ai/gmail-connector/src/index.ts", // definition site
  "extensions/cinatra-ai/gmail-connector/src/email-connector.ts", // EmailConnector adapter — delegates straight to sendGmailMessage so the dev override still wraps the call
  "extensions/cinatra-ai/gmail-connector/src/mcp/handlers.ts", // gmail_email_send MCP handler — applyDevelopmentRecipientOverride applied inside sendGmailMessage
  "src/lib/email-system.ts", // canonical chokepoint sendEmailThroughSystem
  "src/lib/trigger-email-send-use-cases.ts", // dependency injection path
]);

const SCAN_DIRS = ["extensions", "packages", "src"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);

function walk(dir: string, hits: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "tests" || entry.name === "dist") continue;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, hits);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      const raw = fs.readFileSync(full, "utf8");
      // Strip line comments and block comments before matching so that prose
      // references to the override do not trigger false positives when the lazy
      // regex below spans across an unrelated `import...from`.
      const content = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      // Match `import { ... sendGmailMessage ... } from ...` or `mod.sendGmailMessage`
      // (the dynamic-import alias case in trigger-email-send-use-cases.ts)
      if (
        /\bimport[\s\S]*?\bsendGmailMessage\b[\s\S]*?\bfrom\b/.test(content) ||
        /\.sendGmailMessage\b/.test(content)
      ) {
        const rel = path.relative(repoRoot, full);
        hits.push(rel);
      }
    }
  }
}

describe("no direct sendGmailMessage import bypass", () => {
  it("only allowlisted files import sendGmailMessage directly", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = path.join(repoRoot, dir);
      if (fs.existsSync(abs)) walk(abs, hits);
    }
    const violations = hits.filter((h) => !ALLOWED.has(h));
    expect(violations).toEqual([]);
  });
});
