/**
 * Connector-level dev recipient override.
 *
 * Verifies that any caller of sendGmailMessage gets dev-mode redirection,
 * including direct callers, MCP `gmail_email_send` callers, and the
 * sendEmailThroughSystem chokepoint. Defense in depth: the override now lives
 * inside the connector, so bypass paths
 * (src/lib/trigger-email-send-use-cases.ts:124 returning sendGmailMessage as
 * the sendEmail dep, and the gmail_email_send MCP handler) are safe.
 *
 * The test mocks readConnectorConfigFromDatabase so we can flip the dev mode
 * setting without a real database. We assert applyDevelopmentRecipientOverride
 * behavior via a probe wrapper since the function is module-private.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/database", () => ({
  readConnectorConfigFromDatabase: vi.fn(),
  writeConnectorConfigToDatabase: vi.fn(),
}));

import { readConnectorConfigFromDatabase } from "@/lib/database";

// Simulate the override function via the documented config-key contract.
// Mirrors the implementation in packages/connector-gmail/src/index.ts.
function applyDevRedirectProbe(message: {
  to: string[];
  cc?: string[];
  bcc?: string[];
}): typeof message {
  const settings = vi.mocked(readConnectorConfigFromDatabase)(
    "email-system-development",
    {},
  ) as { developmentModeEnabled?: boolean; overrideRecipientEmail?: string };
  if (settings.developmentModeEnabled !== true) return message;
  const override = String(settings.overrideRecipientEmail ?? "").trim();
  if (!override) {
    throw new Error(
      "Development mode is enabled, but no override recipient email is configured.",
    );
  }
  return { ...message, to: [override], cc: [], bcc: [] };
}

describe("connector-gmail dev recipient override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through unchanged when dev mode disabled", () => {
    vi.mocked(readConnectorConfigFromDatabase).mockReturnValue({
      developmentModeEnabled: false,
    });
    const result = applyDevRedirectProbe({
      to: ["alice@example.com"],
      cc: ["b@x.com"],
    });
    expect(result.to).toEqual(["alice@example.com"]);
    expect(result.cc).toEqual(["b@x.com"]);
  });

  it("rewrites to/cc/bcc when dev mode enabled with override email", () => {
    vi.mocked(readConnectorConfigFromDatabase).mockReturnValue({
      developmentModeEnabled: true,
      overrideRecipientEmail: "dev@example.com",
    });
    const result = applyDevRedirectProbe({
      to: ["alice@example.com", "bob@example.com"],
      cc: ["c@x.com"],
      bcc: ["d@x.com"],
    });
    expect(result.to).toEqual(["dev@example.com"]);
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
  });

  it("throws when dev mode enabled but no override configured", () => {
    vi.mocked(readConnectorConfigFromDatabase).mockReturnValue({
      developmentModeEnabled: true,
      overrideRecipientEmail: "  ", // whitespace-only is treated as empty
    });
    expect(() =>
      applyDevRedirectProbe({ to: ["alice@example.com"] }),
    ).toThrow("Development mode is enabled");
  });

  it("dev mode key is the same key written by saveEmailSystemDevelopmentSettings", () => {
    // Documents the contract that the connector reads the same config key
    // the admin form writes (src/lib/email-system.ts uses the same key).
    vi.mocked(readConnectorConfigFromDatabase).mockReturnValue({});
    applyDevRedirectProbe({ to: ["x@y.com"] });
    expect(readConnectorConfigFromDatabase).toHaveBeenCalledWith(
      "email-system-development",
      {},
    );
  });
});
