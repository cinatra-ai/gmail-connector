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
