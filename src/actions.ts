"use server";

// Gmail connection server action — relocated from the central
// `@cinatra-ai/connectors` host hub into the connector itself (SDK-only
// decouple). Gated by the SDK's `requireExtensionAction(pkg, "read")` — the gmail
// connector descriptor is `defaultVisibility: "workspace"` and the setup page
// gates on `enforceConnectorPolicy(..., "read")`, so this user-scoped self-service
// action (refresh MY own send-as aliases) must NOT require admin. `"read"` admits
// any workspace member; the operation is self-scoped to the session user id (a
// member can only affect their OWN connection). The hub copy used
// `requireAuthSession()` (any signed-in user) — `"read"` is the host-bound,
// workspace-scoped equivalent, fail-closed. The refresh logic
// (`refreshUserGmailSendAsAddresses`) is connector-local; the session user id +
// Nango record-clear come through the injected host deps. No `@/lib/*` import.

import { redirect } from "next/navigation";
import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";
import { refreshUserGmailSendAsAddresses } from "./index";
import { getGmailDeps } from "./deps";

const GMAIL_PACKAGE_ID = "@cinatra-ai/gmail-connector";

function isStaleNangoTokenError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : "";
  return (
    msg.includes("from Nango") ||
    msg.includes("Google OAuth is not connected") ||
    msg.includes("not connected")
  );
}

function gmailSetupRedirect(params: {
  error?: string;
  sendAsRefreshed?: boolean;
  // Which setup-page tab the redirect should land on (the setup page's own
  // tablist — see ./gmail-setup-impl.tsx). Omitted for the stale-token-reauth
  // redirect so it falls back to the "setup" tab, where Reconnect lives.
  tab?: "sender-addresses";
}): string {
  const base = "/connectors/cinatra-ai/gmail-connector/setup";
  const sp = new URLSearchParams();
  if (params.tab) sp.set("tab", params.tab);
  if (params.sendAsRefreshed) sp.set("sendAsRefreshed", "1");
  if (params.error) sp.set("error", params.error);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function refreshGmailSendAsAddressesAction() {
  await requireExtensionAction(GMAIL_PACKAGE_ID, "read");
  const { requireSessionUserId, nango } = getGmailDeps();
  const userId = await requireSessionUserId();

  try {
    await refreshUserGmailSendAsAddresses(userId);
  } catch (error) {
    if (isStaleNangoTokenError(error)) {
      // Stored connection record is stale — Nango can no longer return a valid
      // token. Clear the local record so the page shows "Not connected".
      await nango.clearConnectionRecords("gmail", { scope: "user", userId });
      await nango.clearConnectionRecords("googleOAuth", { scope: "user", userId });
      redirect(
        gmailSetupRedirect({
          error: "Gmail authorization expired. Please reconnect your Gmail account.",
        }),
      );
    }
    const message = error instanceof Error ? error.message : "Unable to load Gmail send addresses.";
    redirect(gmailSetupRedirect({ error: message, tab: "sender-addresses" }));
  }

  redirect(gmailSetupRedirect({ sendAsRefreshed: true, tab: "sender-addresses" }));
}
