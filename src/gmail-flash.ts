// Gmail connector codes-only flash protocol.
//
// ./actions.ts redirects back to the setup page carrying an outcome CODE on
// `?notice=<code>` / `?error=<code>` (never raw, dynamic error text — a
// crafted `?error=<spoofed link>` must map to nothing rather than being
// reflected into a toast). The <SearchParamToast> island mounted in
// ./gmail-setup-impl.tsx maps each code to a STATIC message here, mirroring
// the host setup wizard's own code->message map
// (cinatra main src/app/setup/setup-flash.ts).
//
// This supersedes the old in-page Alert banners AND the stale-`?error`
// suppression hack (reconnecting used to leave a stale `?error=` on the URL
// after a `router.refresh()`; the island's toast-once + param-strip semantics
// make that suppression logic unnecessary — a consumed code is stripped from
// the URL immediately, so a refresh never replays it).

import type { SearchParamToastConfig } from "@cinatra-ai/sdk-ui/search-param-toast";

export const GMAIL_NOTICE_MESSAGES = {
  "sender-addresses-refreshed": "Sender email addresses refreshed.",
} as const;

export const GMAIL_ERROR_MESSAGES = {
  "reauth-required": "Gmail authorization expired. Please reconnect your Gmail account.",
  "refresh-failed": "Unable to load Gmail send addresses.",
} as const;

export type GmailNoticeCode = keyof typeof GMAIL_NOTICE_MESSAGES;
export type GmailErrorCode = keyof typeof GMAIL_ERROR_MESSAGES;

export const GMAIL_FLASH_TOASTS: SearchParamToastConfig[] = [
  ...Object.entries(GMAIL_NOTICE_MESSAGES).map(([code, message]) => ({
    param: "notice",
    value: code,
    message,
    variant: "success" as const,
  })),
  ...Object.entries(GMAIL_ERROR_MESSAGES).map(([code, message]) => ({
    param: "error",
    value: code,
    message,
    variant: "error" as const,
  })),
];
