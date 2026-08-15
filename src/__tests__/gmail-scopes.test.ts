/**
 * Granted-Google-scope probe (cinatra-ai/cinatra#2767, defect 2).
 *
 * The claim under test is narrow and must stay narrow: the probe may report
 * "scope missing" ONLY on positive evidence — a granted-scope list that was
 * actually read and demonstrably lacks gmail.settings.basic. Every other
 * outcome is "unknown", and an unknown probe must let the refresh proceed to
 * Gmail so the 403 classifier decides. A probe that guessed would strand a
 * working mailbox behind a reconnect prompt it does not need.
 *
 * PAYLOAD PROVENANCE: no live Google or connection-service call was made — no
 * lane host holds Google credentials. The connection fixtures below are
 * real-shaped: an OAuth2 credential bundle whose `raw` preserves the provider's
 * token response, with `scope` as the space-delimited GRANTED list. Scope URLs
 * are Google's real constants; nothing else is real data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GMAIL_SETTINGS_BASIC_SCOPE,
  hasSettingsBasicScope,
  isSettingsBasicScopeMissing,
  parseGrantedScopes,
  probeGrantedGoogleScopes,
} from "../gmail-scopes";
import { registerGmailConnector, _resetGmailDepsForTests } from "../deps";

const SEND = "https://www.googleapis.com/auth/gmail.send";
const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const USERINFO = "https://www.googleapis.com/auth/userinfo.email";

/** A Google token response as the connection service preserves it. */
function connectionWithScopes(scope: string | undefined) {
  return {
    credentials: {
      type: "OAUTH2",
      access_token: "ya29.redacted",
      refresh_token: "1//redacted",
      raw: {
        access_token: "ya29.redacted",
        expires_in: 3599,
        token_type: "Bearer",
        ...(scope === undefined ? {} : { scope }),
      },
    },
    end_user: { email: "operator@example.com" },
  };
}

const savedConnection = { providerConfigKey: "google-mail", connectionId: "conn-1" };

function install(opts: {
  getConnection?: unknown;
  getPrimarySavedConnection?: unknown;
}) {
  registerGmailConnector({
    readConnectorConfigFromDatabase: vi.fn((_id, fallback) => fallback),
    writeConnectorConfigToDatabase: vi.fn(),
    nango: {
      getPrimarySavedConnection:
        (opts.getPrimarySavedConnection as never) ?? (vi.fn(() => savedConnection) as never),
      clearConnectionRecords: vi.fn(async () => undefined),
      getConnection: opts.getConnection as never,
    },
    oauth: {
      getStatus: vi.fn(async () => ({ status: "connected" as const })),
      apiFetch: vi.fn(),
      refreshAccessTokenIfNeeded: vi.fn(),
    },
    requireSessionUserId: vi.fn(async () => "user-1"),
  });
}

afterEach(() => {
  _resetGmailDepsForTests();
  vi.clearAllMocks();
});

describe("parseGrantedScopes", () => {
  it("splits Google's space-delimited scope field", () => {
    expect(parseGrantedScopes(`${SEND} ${READONLY} ${USERINFO}`)).toEqual([SEND, READONLY, USERINFO]);
  });

  it("also accepts a comma-delimited list", () => {
    expect(parseGrantedScopes(`${SEND},${READONLY}`)).toEqual([SEND, READONLY]);
  });

  it("accepts an already-split array", () => {
    expect(parseGrantedScopes([SEND, READONLY])).toEqual([SEND, READONLY]);
  });

  it("returns null for anything that is not a usable scope list", () => {
    expect(parseGrantedScopes(undefined)).toBeNull();
    expect(parseGrantedScopes(null)).toBeNull();
    expect(parseGrantedScopes("")).toBeNull();
    expect(parseGrantedScopes("   ")).toBeNull();
    expect(parseGrantedScopes(42)).toBeNull();
    expect(parseGrantedScopes([])).toBeNull();
  });
});

describe("hasSettingsBasicScope", () => {
  it("is null — not false — when the granted set is unknown", () => {
    expect(hasSettingsBasicScope({ known: false })).toBeNull();
  });

  it("is true when the scope is present", () => {
    expect(
      hasSettingsBasicScope({ known: true, granted: [SEND, GMAIL_SETTINGS_BASIC_SCOPE] }),
    ).toBe(true);
  });

  it("is false when the set was read and the scope is absent", () => {
    expect(hasSettingsBasicScope({ known: true, granted: [SEND, READONLY] })).toBe(false);
  });

  it("matches a short-form scope name too", () => {
    expect(hasSettingsBasicScope({ known: true, granted: ["gmail.settings.basic"] })).toBe(true);
  });

  it("does not match a different gmail scope by prefix", () => {
    expect(hasSettingsBasicScope({ known: true, granted: ["gmail.settings.sharing"] })).toBe(false);
  });
});

describe("probeGrantedGoogleScopes", () => {
  it("reads the granted list off credentials.raw.scope", async () => {
    const getConnection = vi.fn(async () =>
      connectionWithScopes(`${SEND} ${GMAIL_SETTINGS_BASIC_SCOPE} ${USERINFO}`),
    );
    install({ getConnection });

    const probe = await probeGrantedGoogleScopes("user-1");

    expect(probe).toEqual({
      known: true,
      granted: [SEND, GMAIL_SETTINGS_BASIC_SCOPE, USERINFO],
    });
  });

  it("never forces a token refresh — the probe sits on the Refresh hot path", async () => {
    const getConnection = vi.fn(async () => connectionWithScopes(SEND));
    install({ getConnection });

    await probeGrantedGoogleScopes("user-1");

    expect(getConnection).toHaveBeenCalledWith("google-mail", "conn-1", {
      forceRefresh: false,
      refreshToken: false,
    });
  });

  it("is unknown when the host binding predates getConnection", async () => {
    install({ getConnection: undefined });
    expect(await probeGrantedGoogleScopes("user-1")).toEqual({ known: false });
  });

  it("is unknown when there is no saved connection", async () => {
    install({
      getConnection: vi.fn(async () => connectionWithScopes(SEND)),
      getPrimarySavedConnection: vi.fn(() => null),
    });
    expect(await probeGrantedGoogleScopes("user-1")).toEqual({ known: false });
  });

  it("is unknown when the connection service returns null", async () => {
    install({ getConnection: vi.fn(async () => null) });
    expect(await probeGrantedGoogleScopes("user-1")).toEqual({ known: false });
  });

  it("is unknown when the connection service throws", async () => {
    install({
      getConnection: vi.fn(async () => {
        throw new Error("connection service unreachable");
      }),
    });
    expect(await probeGrantedGoogleScopes("user-1")).toEqual({ known: false });
  });

  it("is unknown when raw carries no scope field — absence of evidence, not evidence of absence", async () => {
    install({ getConnection: vi.fn(async () => connectionWithScopes(undefined)) });
    expect(await probeGrantedGoogleScopes("user-1")).toEqual({ known: false });
  });

  it("is unknown for a credential bundle with no raw at all", async () => {
    install({
      getConnection: vi.fn(async () => ({ credentials: { type: "OAUTH2", access_token: "x" } })),
    });
    expect(await probeGrantedGoogleScopes("user-1")).toEqual({ known: false });
  });

  it("falls back to the shared workspace client when the mailbox connection has no scope list", async () => {
    const getPrimarySavedConnection = vi.fn((key: string) =>
      key === "gmail"
        ? { providerConfigKey: "google-mail", connectionId: "conn-1" }
        : { providerConfigKey: "google-oauth", connectionId: "conn-2" },
    );
    const getConnection = vi.fn(async (_pck: string, connectionId: string) =>
      connectionId === "conn-1"
        ? connectionWithScopes(undefined)
        : connectionWithScopes(`${SEND} ${GMAIL_SETTINGS_BASIC_SCOPE}`),
    );
    install({ getConnection, getPrimarySavedConnection });

    const probe = await probeGrantedGoogleScopes("user-1");

    expect(probe).toEqual({ known: true, granted: [SEND, GMAIL_SETTINGS_BASIC_SCOPE] });
    expect(getConnection).toHaveBeenCalledTimes(2);
  });
});

describe("isSettingsBasicScopeMissing — the pre-check gate", () => {
  it("is true only on positive evidence the scope was not granted", async () => {
    install({ getConnection: vi.fn(async () => connectionWithScopes(`${SEND} ${READONLY}`)) });
    expect(await isSettingsBasicScopeMissing("user-1")).toBe(true);
  });

  it("is false when the scope IS granted", async () => {
    install({
      getConnection: vi.fn(async () => connectionWithScopes(`${SEND} ${GMAIL_SETTINGS_BASIC_SCOPE}`)),
    });
    expect(await isSettingsBasicScopeMissing("user-1")).toBe(false);
  });

  it("is false — fail-open — whenever the grant cannot be read", async () => {
    for (const getConnection of [
      undefined,
      vi.fn(async () => null),
      vi.fn(async () => connectionWithScopes(undefined)),
      vi.fn(async () => {
        throw new Error("boom");
      }),
    ]) {
      install({ getConnection });
      expect(await isSettingsBasicScopeMissing("user-1")).toBe(false);
      _resetGmailDepsForTests();
    }
  });
});
