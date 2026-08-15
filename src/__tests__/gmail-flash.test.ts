/**
 * Codes-only flash protocol (cinatra-ai/cinatra#1108) for the gmail connector
 * setup page — ./actions.ts redirects with a stable CODE only, never dynamic
 * error text, and ./gmail-flash.ts maps each code to a STATIC message that
 * <SearchParamToast> mounts in ./gmail-setup-impl.tsx.
 */
import { describe, it, expect } from "vitest";

import {
  GMAIL_ERROR_MESSAGES,
  GMAIL_NOTICE_MESSAGES,
  GMAIL_FLASH_TOASTS,
} from "../gmail-flash";
import { GMAIL_FAILURE_CODES } from "../gmail-api-error";

describe("gmail-flash", () => {
  it("defines a static message for every notice code", () => {
    expect(GMAIL_NOTICE_MESSAGES["sender-addresses-refreshed"]).toBe(
      "Sender email addresses refreshed.",
    );
  });

  it("defines a static message for every error code the action can emit", () => {
    expect(GMAIL_ERROR_MESSAGES["reauth-required"]).toBe(
      "Gmail authorization expired. Please reconnect your Gmail account.",
    );
    expect(GMAIL_ERROR_MESSAGES["refresh-failed"]).toBe(
      "Unable to load Gmail send addresses.",
    );
  });

  it("has a static message for every code the send-as classifier can return", () => {
    for (const code of GMAIL_FAILURE_CODES) {
      expect(GMAIL_ERROR_MESSAGES).toHaveProperty(code);
    }
  });

  it("declares no orphan send-as code — every classifier code is reachable and every error code is declared", () => {
    // `disconnect-failed` belongs to the Disconnect action, not the send-as
    // path, so it is the one declared code outside the classifier's set.
    const declared = new Set(Object.keys(GMAIL_ERROR_MESSAGES));
    const fromClassifier = new Set<string>(GMAIL_FAILURE_CODES);
    const unexplained = [...declared].filter(
      (code) => !fromClassifier.has(code) && code !== "disconnect-failed",
    );
    expect(unexplained).toEqual([]);
  });

  it("names a cause and a next step — no send-as message is the bare opaque failure", () => {
    // The defect (cinatra-ai/cinatra#2767) was one message that named neither.
    // `refresh-failed` is the deliberate exception: it is the terminal code for
    // a failure that carries no signal, so it has no cause to name.
    for (const code of GMAIL_FAILURE_CODES) {
      if (code === "refresh-failed") continue;
      const message = GMAIL_ERROR_MESSAGES[code as keyof typeof GMAIL_ERROR_MESSAGES];
      expect(message).not.toBe("Unable to load Gmail send addresses.");
      // Either it names a recourse or it names the HTTP status class.
      expect(/reconnect|try again|wait|refresh|report/i.test(message) || /\d{3}/.test(message)).toBe(
        true,
      );
    }
  });

  it("builds one SearchParamToast config entry per code, on the right param, with the right variant", () => {
    const byParamValue = (param: string, value: string) =>
      GMAIL_FLASH_TOASTS.find((t) => t.param === param && t.value === value);

    const notice = byParamValue("notice", "sender-addresses-refreshed");
    expect(notice).toBeDefined();
    expect(notice?.variant).toBe("success");
    expect(notice?.message).toBe(GMAIL_NOTICE_MESSAGES["sender-addresses-refreshed"]);

    const reauth = byParamValue("error", "reauth-required");
    expect(reauth).toBeDefined();
    expect(reauth?.variant).toBe("error");
    expect(reauth?.message).toBe(GMAIL_ERROR_MESSAGES["reauth-required"]);

    const refreshFailed = byParamValue("error", "refresh-failed");
    expect(refreshFailed).toBeDefined();
    expect(refreshFailed?.variant).toBe("error");
    expect(refreshFailed?.message).toBe(GMAIL_ERROR_MESSAGES["refresh-failed"]);
  });

  it("covers exactly the declared codes — no orphaned or extra entries", () => {
    const noticeCount = Object.keys(GMAIL_NOTICE_MESSAGES).length;
    const errorCount = Object.keys(GMAIL_ERROR_MESSAGES).length;
    expect(GMAIL_FLASH_TOASTS.length).toBe(noticeCount + errorCount);
  });

  it("never derives a toast message from anything but the static map (no template/interpolation markers)", () => {
    for (const entry of GMAIL_FLASH_TOASTS) {
      expect(entry.message).not.toMatch(/\$\{|%s|<%/);
    }
  });
});
