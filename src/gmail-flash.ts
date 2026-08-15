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
  "disconnected": "Gmail account disconnected.",
} as const;

// Every send-as failure code below is produced by classifyGmailApiFailure in
// ./gmail-api-error.ts, which picks from a CLOSED set — so the dynamic part of
// a Gmail failure (status and reason) is folded into the choice of code, and
// the text the operator reads stays a static, server-trusted string. That is
// what keeps the codes-only guarantee intact while still naming the cause: the
// allow-list of codes IS the truncation of Gmail's error surface, and no
// substring of a Gmail response body ever reaches the URL or the toast.
//
// Each message names the cause AND the recourse, because the defect these
// replace was that "Unable to load Gmail send addresses." left the operator
// with no next step. `refresh-failed` survives as the terminal code for a
// failure that carries no recognizable signal at all.
export const GMAIL_ERROR_MESSAGES = {
  "reauth-required": "Gmail authorization expired. Please reconnect your Gmail account.",
  "scope-missing":
    "Gmail did not grant permission to read send addresses (gmail.settings.basic). Reconnect your Gmail account and allow that permission.",
  "gmail-forbidden":
    "Gmail refused the request (403). The account may be blocked by a Google Workspace policy from reading its send-as settings.",
  "gmail-rate-limited":
    "Gmail is rate-limiting requests (429). Wait a moment, then refresh again.",
  "gmail-not-found":
    "Gmail could not find send-as settings for this account (404).",
  "gmail-bad-request":
    "Gmail rejected the send-addresses request (400). Reconnect the account; if it repeats, report it.",
  "gmail-unavailable":
    "Gmail is temporarily unavailable (server error). Try refreshing again shortly.",
  "gmail-api-error":
    "Gmail returned an unexpected API error. Try again; if it repeats, reconnect your Gmail account.",
  "gmail-unreachable":
    "Could not reach Gmail (network error). Check connectivity, then refresh again.",
  "refresh-failed": "Unable to load Gmail send addresses.",
  "disconnect-failed": "Unable to disconnect the Gmail account. Please try again.",
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
