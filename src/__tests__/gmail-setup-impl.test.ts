/**
 * GmailConnectorPageImpl — toast-island composition (cinatra-ai/cinatra#1108,
 * gmail-connector#43).
 *
 * @testing-library/react is not available from this repo's package.json (see
 * ../actions.test.ts / the host's own src/components/__tests__/search-param-toast.test.tsx
 * for the same constraint), so this is a source-text contract test: it locks
 * that the setup page mounts the sdk-ui <SearchParamToast> island with the
 * connector's static code map, and that the legacy in-page Alert banners +
 * the stale-`?error` suppression hack they required are gone outright
 * (render->spec: stale elements are violations).
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const SOURCE = readFileSync(
  path.join(__dirname, "..", "gmail-setup-impl.tsx"),
  "utf-8",
);

describe("GmailConnectorPageImpl toast-island composition", () => {
  it("imports the sdk-ui SearchParamToast island and the connector's static flash map", () => {
    expect(SOURCE).toMatch(
      /import \{ SearchParamToast \} from "@cinatra-ai\/sdk-ui\/search-param-toast";/,
    );
    expect(SOURCE).toMatch(/import \{ GMAIL_FLASH_TOASTS \} from "\.\/gmail-flash";/);
  });

  it("mounts the island inside a Suspense boundary (useSearchParams requires one) with the static toasts config", () => {
    expect(SOURCE).toMatch(/<Suspense fallback=\{null\}>/);
    expect(SOURCE).toMatch(/<SearchParamToast toasts=\{GMAIL_FLASH_TOASTS\} \/>/);
  });

  it("deletes the legacy Alert banner markup outright — no Alert import, no success/error Alert blocks", () => {
    expect(SOURCE).not.toMatch(/components\/ui\/alert/);
    expect(SOURCE).not.toMatch(/<Alert\b/);
    expect(SOURCE).not.toMatch(/Sender email addresses refreshed\.<\/AlertDescription>/);
  });

  it("deletes the stale-error suppression hack — toast-once + param-strip supersedes it", () => {
    expect(SOURCE).not.toMatch(/visibleError/);
    expect(SOURCE).not.toMatch(/sendAsRefreshed/);
    expect(SOURCE).not.toMatch(/authorization expired/);
  });
});
