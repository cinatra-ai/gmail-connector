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
import { flashHref } from "@cinatra-ai/sdk-extensions/flash-href";
import { refreshUserGmailSendAsAddresses } from "./index";
import { getGmailDeps } from "./deps";
import type { GmailErrorCode, GmailNoticeCode } from "./gmail-flash";

const GMAIL_PACKAGE_ID = "@cinatra-ai/gmail-connector";
const SETUP_PATH = "/connectors/cinatra-ai/gmail-connector/setup";

function isStaleNangoTokenError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : "";
  return (
    msg.includes("from Nango") ||
    msg.includes("Google OAuth is not connected") ||
    msg.includes("not connected")
  );
}

// Codes-only flash protocol (cinatra-ai/cinatra#1108): the redirect target
// carries a stable CODE, never dynamic error text — the <SearchParamToast>
// island mounted in ./gmail-setup-impl.tsx maps each code to a STATIC message
// (see ./gmail-flash.ts). `tab` is a plain (non-flash) param preserved
// alongside the flash code so the redirect still lands on the tab the user
// refreshed from; it is OMITTED for the stale-token-reauth redirect so it
// falls back to the "setup" tab, where Reconnect lives.
function gmailSetupRedirect(params: {
  error?: GmailErrorCode;
  notice?: GmailNoticeCode;
  tab?: "sender-addresses";
}): string {
  const base = params.tab ? `${SETUP_PATH}?tab=${params.tab}` : SETUP_PATH;
  return flashHref(base, { error: params.error, notice: params.notice });
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
      redirect(gmailSetupRedirect({ error: "reauth-required" }));
    }
    redirect(gmailSetupRedirect({ error: "refresh-failed", tab: "sender-addresses" }));
  }

  redirect(gmailSetupRedirect({ notice: "sender-addresses-refreshed", tab: "sender-addresses" }));
}
