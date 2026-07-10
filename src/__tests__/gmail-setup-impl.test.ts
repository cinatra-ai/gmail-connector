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

  // ── Owner review (gmail-connector#46, CHANGES_REQUESTED) ──────────────
  it("labels the Connect button 'Connect' per the setup-page spec — never 'Connect Gmail'", () => {
    expect(SOURCE).toMatch(/connectLabel="Connect"/);
    expect(SOURCE).not.toMatch(/connectLabel="Connect Gmail"/);
  });

  it("shows the OAuth-prerequisite card when the shared client is unconfigured, linking 'Google OAuth credentials' to the google-oauth setup page", () => {
    // The reason the Connect button is greyed must be named inline (not silent).
    expect(SOURCE).toMatch(/oauthConfigured \? null : \(/);
    expect(SOURCE).toMatch(/Connecting requires shared/);
    expect(SOURCE).toMatch(/Google OAuth credentials/);
    expect(SOURCE).toMatch(
      /href="\/connectors\/cinatra-ai\/google-oauth-connector\/setup"/,
    );
  });

  it("renders the Sender-addresses Refresh button unconditionally — the empty-state copy tells the user to click it, so it must not be gated on `connection`", () => {
    // The refresh <form> is present and NOT wrapped in a `{connection ? … : null}`
    // guard (which previously hid the very control the copy names).
    expect(SOURCE).toMatch(/action=\{refreshGmailSendAsAddressesAction\}/);
    expect(SOURCE).not.toMatch(
      /\{connection \? \(\s*<form action=\{refreshGmailSendAsAddressesAction\}>/,
    );
  });

  it("places the Sender-addresses Refresh action at the END of the tab content (owner contract cinatra-ai/cinatra#1101, 2026-07-10) — after the list/empty-state and the last-refreshed line, never in a top header row", () => {
    // Placement contract: an action button inside tab content sits at the end.
    const emptyStateIdx = SOURCE.indexOf("No sender addresses loaded yet");
    const lastRefreshedIdx = SOURCE.indexOf("Last refreshed {formatTimestamp");
    const refreshFormIdx = SOURCE.indexOf(
      "<form action={refreshGmailSendAsAddressesAction}>",
    );
    expect(emptyStateIdx).toBeGreaterThan(-1);
    expect(lastRefreshedIdx).toBeGreaterThan(-1);
    expect(refreshFormIdx).toBeGreaterThan(-1);
    // The action form must come AFTER both the content list/empty-state and the
    // last-refreshed line — i.e. it is the last thing in the tab.
    expect(refreshFormIdx).toBeGreaterThan(emptyStateIdx);
    expect(refreshFormIdx).toBeGreaterThan(lastRefreshedIdx);
    // The old top-of-tab header row that paired the copy with Refresh is gone.
    expect(SOURCE).not.toMatch(
      /<div className="flex items-center justify-between gap-4">\s*<p[^>]*>Verified send-as addresses/,
    );
  });
});
