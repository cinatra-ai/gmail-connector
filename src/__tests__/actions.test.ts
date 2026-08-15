/**
 * refreshGmailSendAsAddressesAction — codes-only flash protocol
 * (cinatra-ai/cinatra#1108).
 *
 * Every redirect this action issues must carry a stable CODE (never the raw,
 * dynamic error message) so the <SearchParamToast> island mounted in
 * ./gmail-setup-impl.tsx can map it to a static, server-trusted toast — a
 * regression here would either silently drop the message a user relied on to
 * copy/paste, or (worse) reopen the URL-reflection vector the codes-only
 * protocol was built to close.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@cinatra-ai/sdk-extensions", () => ({
  requireExtensionAction: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Capture the redirect target via a thrown sentinel so execution stops
    // exactly where the real `redirect()` would (Next throws internally).
    const err = new Error("REDIRECT:" + url);
    (err as unknown as { __isRedirect: true }).__isRedirect = true;
    throw err;
  }),
}));

const refreshUserGmailSendAsAddresses = vi.fn();
vi.mock("../index", () => ({
  refreshUserGmailSendAsAddresses: (...args: unknown[]) =>
    refreshUserGmailSendAsAddresses(...args),
}));

import { redirect } from "next/navigation";
import {
  refreshGmailSendAsAddressesAction,
  disconnectGmailConnectionAction,
  checkGmailStatusAction,
} from "../actions";
import { registerGmailConnector, _resetGmailDepsForTests } from "../deps";
import { GMAIL_ERROR_MESSAGES } from "../gmail-flash";

function redirectTarget(fn: () => Promise<void>): Promise<string> {
  return fn()
    .then(() => {
      throw new Error("expected the action to redirect");
    })
    .catch((err: Error) => {
      if (!err.message.startsWith("REDIRECT:")) throw err;
      return err.message.slice("REDIRECT:".length);
    });
}

describe("refreshGmailSendAsAddressesAction", () => {
  const clearConnectionRecords = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    registerGmailConnector({
      readConnectorConfigFromDatabase: vi.fn((_id, fallback) => fallback),
      writeConnectorConfigToDatabase: vi.fn(),
      nango: {
        getPrimarySavedConnection: vi.fn(() => null),
        clearConnectionRecords,
      },
      oauth: {
        getStatus: vi.fn(async () => ({ status: "connected" as const })),
        apiFetch: vi.fn(),
        refreshAccessTokenIfNeeded: vi.fn(),
      },
      requireSessionUserId: vi.fn(async () => "user-1"),
    });
  });

  afterEach(() => {
    _resetGmailDepsForTests();
  });

  it("redirects with the success notice code on the sender-addresses tab", async () => {
    refreshUserGmailSendAsAddresses.mockResolvedValueOnce(undefined);

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe(
      "/connectors/cinatra-ai/gmail-connector/setup?tab=sender-addresses&notice=sender-addresses-refreshed",
    );
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("redirects with a stable reauth-required error code (no tab, no raw message) and clears the stale connections", async () => {
    refreshUserGmailSendAsAddresses.mockRejectedValueOnce(
      new Error("Google OAuth is not connected for this user"),
    );

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe("/connectors/cinatra-ai/gmail-connector/setup?error=reauth-required");
    expect(clearConnectionRecords).toHaveBeenCalledWith("gmail", { scope: "user", userId: "user-1" });
    expect(clearConnectionRecords).toHaveBeenCalledWith("googleOAuth", { scope: "user", userId: "user-1" });
  });

  it("names the cause instead of collapsing it — a quota failure carries the rate-limited code, never the raw error text", async () => {
    refreshUserGmailSendAsAddresses.mockRejectedValueOnce(
      new Error("Gmail API quota exceeded for project 12345"),
    );

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe(
      "/connectors/cinatra-ai/gmail-connector/setup?tab=sender-addresses&error=gmail-rate-limited",
    );
    // The dynamic error text must never leak into the redirect URL.
    expect(target).not.toContain("quota");
    expect(target).not.toContain("12345");
  });

  it("keeps refresh-failed for a failure that carries no recognizable signal", async () => {
    refreshUserGmailSendAsAddresses.mockRejectedValueOnce(new Error("something went sideways"));

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe(
      "/connectors/cinatra-ai/gmail-connector/setup?tab=sender-addresses&error=refresh-failed",
    );
  });

  it("routes a 403 insufficient-scope failure to the Setup tab, where Reconnect lives", async () => {
    refreshUserGmailSendAsAddresses.mockRejectedValueOnce(new Error("Insufficient Permission"));

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    // No `tab` — the page falls back to Setup, the same fallback the
    // stale-token reauth path performs, so the Reconnect control is on screen.
    expect(target).toBe("/connectors/cinatra-ai/gmail-connector/setup?error=scope-missing");
  });

  it("stays on the Sender-addresses tab for causes the user cannot fix by reconnecting", async () => {
    refreshUserGmailSendAsAddresses.mockRejectedValueOnce(new Error("Backend Error"));

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe(
      "/connectors/cinatra-ai/gmail-connector/setup?tab=sender-addresses&error=gmail-unavailable",
    );
  });

  it("emits only allow-listed codes — every redirect target maps to a declared static message", async () => {
    const thrown = [
      new Error("Insufficient Permission"),
      new Error("Invalid Credentials"),
      new Error("User-rate limit exceeded"),
      new Error("Backend Error"),
      new TypeError("fetch failed"),
      new Error("unmapped failure"),
    ];
    const declared = new Set(Object.keys(GMAIL_ERROR_MESSAGES));

    for (const error of thrown) {
      refreshUserGmailSendAsAddresses.mockRejectedValueOnce(error);
      const target = await redirectTarget(refreshGmailSendAsAddressesAction);
      const code = new URL(target, "http://x.invalid").searchParams.get("error");
      expect(code).not.toBeNull();
      expect(declared.has(code as string)).toBe(true);
    }
  });
});

/**
 * The granted-scope pre-check (defect 2). It must short-circuit BEFORE the
 * Gmail call when — and only when — the granted set was read and proves
 * gmail.settings.basic is absent.
 */
describe("refreshGmailSendAsAddressesAction — granted-scope pre-check", () => {
  const SETTINGS_BASIC = "https://www.googleapis.com/auth/gmail.settings.basic";
  const SEND = "https://www.googleapis.com/auth/gmail.send";

  function installWithScopes(getConnection: unknown) {
    registerGmailConnector({
      readConnectorConfigFromDatabase: vi.fn((_id, fallback) => fallback),
      writeConnectorConfigToDatabase: vi.fn(),
      nango: {
        getPrimarySavedConnection: vi.fn(() => ({
          providerConfigKey: "google-mail",
          connectionId: "conn-1",
        })) as never,
        clearConnectionRecords: vi.fn(async () => undefined),
        getConnection: getConnection as never,
      },
      oauth: {
        getStatus: vi.fn(async () => ({ status: "connected" as const })),
        apiFetch: vi.fn(),
        refreshAccessTokenIfNeeded: vi.fn(),
      },
      requireSessionUserId: vi.fn(async () => "user-1"),
    });
  }

  const connectionWith = (scope?: string) => ({
    credentials: { type: "OAUTH2", raw: scope === undefined ? {} : { scope } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetGmailDepsForTests();
  });

  it("names the missing scope before calling Gmail at all", async () => {
    installWithScopes(vi.fn(async () => connectionWith(SEND)));
    // Deliberately NO queued outcome for refreshUserGmailSendAsAddresses: the
    // pre-check must short-circuit, so queueing one would leave it unconsumed
    // and leak into the next test.

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe("/connectors/cinatra-ai/gmail-connector/setup?error=scope-missing");
    // The whole point of a PRE-check: no pointless round trip to Gmail.
    expect(refreshUserGmailSendAsAddresses).not.toHaveBeenCalled();
  });

  it("proceeds normally when the scope was granted", async () => {
    installWithScopes(vi.fn(async () => connectionWith(`${SEND} ${SETTINGS_BASIC}`)));
    refreshUserGmailSendAsAddresses.mockResolvedValueOnce(undefined);

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe(
      "/connectors/cinatra-ai/gmail-connector/setup?tab=sender-addresses&notice=sender-addresses-refreshed",
    );
    expect(refreshUserGmailSendAsAddresses).toHaveBeenCalledWith("user-1");
  });

  it("fails OPEN when the grant is unreadable — the refresh still runs", async () => {
    installWithScopes(vi.fn(async () => connectionWith(undefined)));
    refreshUserGmailSendAsAddresses.mockResolvedValueOnce(undefined);

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(target).toBe(
      "/connectors/cinatra-ai/gmail-connector/setup?tab=sender-addresses&notice=sender-addresses-refreshed",
    );
    expect(refreshUserGmailSendAsAddresses).toHaveBeenCalledWith("user-1");
  });

  it("fails OPEN when the probe itself throws, and still classifies the live 403", async () => {
    installWithScopes(
      vi.fn(async () => {
        throw new Error("connection service unreachable");
      }),
    );
    refreshUserGmailSendAsAddresses.mockRejectedValueOnce(new Error("Insufficient Permission"));

    const target = await redirectTarget(refreshGmailSendAsAddressesAction);

    expect(refreshUserGmailSendAsAddresses).toHaveBeenCalledWith("user-1");
    expect(target).toBe("/connectors/cinatra-ai/gmail-connector/setup?error=scope-missing");
  });
});

/**
 * disconnectGmailConnectionAction — the Setup-tab destructive Disconnect
 * (app-connectors.html §II items 15–16). Read-gated + self-scoped: it clears
 * ONLY the user's own `gmail` saved-connection record and must NEVER revoke the
 * shared workspace `googleOAuth` client, and it always redirects with a stable
 * flash code (never raw text).
 */
describe("disconnectGmailConnectionAction", () => {
  const clearConnectionRecords = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    registerGmailConnector({
      readConnectorConfigFromDatabase: vi.fn((_id, fallback) => fallback),
      writeConnectorConfigToDatabase: vi.fn(),
      nango: {
        getPrimarySavedConnection: vi.fn(() => null),
        clearConnectionRecords,
      },
      oauth: {
        getStatus: vi.fn(async () => ({ status: "connected" as const })),
        apiFetch: vi.fn(),
        refreshAccessTokenIfNeeded: vi.fn(),
      },
      requireSessionUserId: vi.fn(async () => "user-1"),
    });
  });

  afterEach(() => {
    _resetGmailDepsForTests();
  });

  it("clears only the user's gmail record (never the shared googleOAuth client) and redirects with the disconnected notice", async () => {
    const target = await redirectTarget(disconnectGmailConnectionAction);

    expect(target).toBe("/connectors/cinatra-ai/gmail-connector/setup?notice=disconnected");
    expect(clearConnectionRecords).toHaveBeenCalledWith("gmail", { scope: "user", userId: "user-1" });
    expect(clearConnectionRecords).not.toHaveBeenCalledWith("googleOAuth", expect.anything());
    expect(clearConnectionRecords).toHaveBeenCalledTimes(1);
  });

  it("redirects with the generic disconnect-failed error code when the record clear throws, never raw text", async () => {
    clearConnectionRecords.mockRejectedValueOnce(new Error("nango DELETE 500 for connection abc-123"));

    const target = await redirectTarget(disconnectGmailConnectionAction);

    expect(target).toBe("/connectors/cinatra-ai/gmail-connector/setup?error=disconnect-failed");
    expect(target).not.toContain("abc-123");
    expect(target).not.toContain("500");
  });
});

/**
 * checkGmailStatusAction — the Connection status card's Check probe
 * (app-connectors.html §II items 13–14). Returns the badge-shaped status and
 * NEVER redirects, so the client island can swap its transient "Checking…"
 * badge in place. It reads the SAME saved-connection pointer the page renders
 * from, so Check and the initial render can never disagree.
 */
describe("checkGmailStatusAction", () => {
  const getPrimarySavedConnection = vi.fn(() => null as unknown);

  beforeEach(() => {
    vi.clearAllMocks();
    registerGmailConnector({
      readConnectorConfigFromDatabase: vi.fn((_id, fallback) => fallback),
      writeConnectorConfigToDatabase: vi.fn(),
      nango: {
        getPrimarySavedConnection: getPrimarySavedConnection as never,
        clearConnectionRecords: vi.fn(async () => undefined),
      },
      oauth: {
        getStatus: vi.fn(async () => ({ status: "connected" as const })),
        apiFetch: vi.fn(),
        refreshAccessTokenIfNeeded: vi.fn(),
      },
      requireSessionUserId: vi.fn(async () => "user-1"),
    });
  });

  afterEach(() => {
    _resetGmailDepsForTests();
  });

  it("returns 'connected' when a saved connection exists — and never redirects", async () => {
    getPrimarySavedConnection.mockReturnValueOnce({
      providerConfigKey: "google-mail",
      connectionId: "conn-1",
      email: "person@example.com",
    });

    const status = await checkGmailStatusAction();

    expect(status).toBe("connected");
    expect(getPrimarySavedConnection).toHaveBeenCalledWith("gmail", { scope: "user", userId: "user-1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns 'disconnected' when there is no saved connection", async () => {
    getPrimarySavedConnection.mockReturnValueOnce(null);

    const status = await checkGmailStatusAction();

    expect(status).toBe("disconnected");
    expect(redirect).not.toHaveBeenCalled();
  });
});
