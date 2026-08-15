/**
 * classifyGmailApiFailure — the send-as failure classifier
 * (cinatra-ai/cinatra#2767).
 *
 * The defect: every throw on the sendAs path collapsed to the single static
 * flash "Unable to load Gmail send addresses.", so an operator could not tell a
 * missing scope from an expired token from a Gmail outage. These tests pin one
 * branch per cause.
 *
 * PAYLOAD PROVENANCE: no live call to Google was made — no lane host holds
 * Google credentials. Every fixture below is a REAL-SHAPED Gmail error
 * envelope, reproduced from Google's two published error dialects (the classic
 * Gmail v1 `error.errors[]` form and the One Platform `error.status` /
 * `error.details[]` form). They are transcribed structures, not captured
 * traffic, and carry no real mailbox data.
 *
 * The `messageOnly()` helper reproduces exactly what the connector receives
 * TODAY: the host's shared `googleApiFetch` throws `new Error(payload.error.message)`
 * and drops the HTTP status, so the classifier must work from Google's message
 * text alone. `structured()` reproduces the richer error the same helper can
 * carry once it attaches status/reason — the classifier must prefer it.
 */
import { describe, it, expect } from "vitest";

import {
  classifyGmailApiFailure,
  extractGmailReason,
  extractHttpStatus,
  needsReconnect,
  GMAIL_FAILURE_CODES,
} from "../gmail-api-error";
import { GMAIL_ERROR_MESSAGES } from "../gmail-flash";

// ---------------------------------------------------------------------------
// Real-shaped Gmail error envelopes.
// ---------------------------------------------------------------------------

/** Gmail v1 classic 403 for a token that lacks gmail.settings.basic. */
const INSUFFICIENT_SCOPE_403 = {
  error: {
    code: 403,
    message: "Insufficient Permission",
    errors: [
      { domain: "global", reason: "insufficientPermissions", message: "Insufficient Permission" },
    ],
  },
};

/** One Platform 403 for the same cause, as returned by gmail.googleapis.com. */
const INSUFFICIENT_SCOPE_403_ONE_PLATFORM = {
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        domain: "googleapis.com",
        metadata: { service: "gmail.googleapis.com", method: "gmail.users.settings.sendAs.list" },
      },
    ],
  },
};

/** 401 for an expired/revoked access token. */
const INVALID_CREDENTIALS_401 = {
  error: {
    code: 401,
    message: "Invalid Credentials",
    errors: [
      {
        domain: "global",
        reason: "authError",
        message: "Invalid Credentials",
        locationType: "header",
        location: "Authorization",
      },
    ],
  },
};

/** 403 that is NOT a scope problem — a Workspace admin policy refusal. */
const POLICY_FORBIDDEN_403 = {
  error: {
    code: 403,
    message: "Domain policy prevents this operation.",
    errors: [{ domain: "global", reason: "domainPolicy", message: "Domain policy" }],
  },
};

/** 429 user-rate limit. */
const RATE_LIMIT_429 = {
  error: {
    code: 429,
    message: "User-rate limit exceeded. Retry after 2026-08-15T12:00:00.000Z",
    errors: [{ domain: "usageLimits", reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }],
  },
};

/** 500 backend error. */
const BACKEND_500 = {
  error: {
    code: 500,
    message: "Backend Error",
    errors: [{ domain: "global", reason: "backendError", message: "Backend Error" }],
  },
};

/** 404. */
const NOT_FOUND_404 = {
  error: {
    code: 404,
    message: "Not Found",
    errors: [{ domain: "global", reason: "notFound", message: "Not Found" }],
  },
};

/** 400 bad request. */
const BAD_REQUEST_400 = {
  error: {
    code: 400,
    message: "Bad Request",
    errors: [{ domain: "global", reason: "badRequest", message: "Bad Request" }],
  },
};

/**
 * What the connector receives TODAY: the host helper throws away everything
 * except Gmail's `error.message` string.
 */
function messageOnly(envelope: { error: { message: string } }): Error {
  return new Error(envelope.error.message);
}

/**
 * The richer error the same call path can carry once the host attaches the
 * status and the retained envelope.
 */
function structured(envelope: { error: { code: number; message: string } }): Error {
  const err = new Error(envelope.error.message) as Error & {
    status: number;
    response: unknown;
  };
  err.status = envelope.error.code;
  err.response = envelope;
  return err;
}

describe("classifyGmailApiFailure — (a) 403 insufficient scope", () => {
  it("classifies the classic Gmail v1 403 from its message alone", () => {
    expect(classifyGmailApiFailure(messageOnly(INSUFFICIENT_SCOPE_403))).toBe("scope-missing");
  });

  it("classifies the One Platform 403 from its message alone", () => {
    expect(classifyGmailApiFailure(messageOnly(INSUFFICIENT_SCOPE_403_ONE_PLATFORM))).toBe(
      "scope-missing",
    );
  });

  it("classifies the structured 403 via the insufficientPermissions reason", () => {
    expect(classifyGmailApiFailure(structured(INSUFFICIENT_SCOPE_403))).toBe("scope-missing");
  });

  it("classifies the structured One Platform 403 via ACCESS_TOKEN_SCOPE_INSUFFICIENT", () => {
    expect(classifyGmailApiFailure(structured(INSUFFICIENT_SCOPE_403_ONE_PLATFORM))).toBe(
      "scope-missing",
    );
  });

  it("names the missing scope in the surfaced message", () => {
    expect(GMAIL_ERROR_MESSAGES["scope-missing"]).toContain("gmail.settings.basic");
    expect(GMAIL_ERROR_MESSAGES["scope-missing"]).toMatch(/reconnect/i);
  });
});

describe("classifyGmailApiFailure — (b) 401 expired token", () => {
  it("classifies the classic 401 from its message alone", () => {
    expect(classifyGmailApiFailure(messageOnly(INVALID_CREDENTIALS_401))).toBe("reauth-required");
  });

  it("classifies the structured 401 by status, whatever the message says", () => {
    expect(classifyGmailApiFailure(structured(INVALID_CREDENTIALS_401))).toBe("reauth-required");
  });

  it("classifies the One Platform long-form 401 message", () => {
    const err = new Error(
      "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
    );
    expect(classifyGmailApiFailure(err)).toBe("reauth-required");
  });

  it("classifies an expired-token refresh rejection", () => {
    expect(classifyGmailApiFailure(new Error("invalid_grant: Token has been expired or revoked."))).toBe(
      "reauth-required",
    );
  });

  it("tells the operator to reconnect", () => {
    expect(GMAIL_ERROR_MESSAGES["reauth-required"]).toMatch(/reconnect/i);
  });
});

describe("classifyGmailApiFailure — (c) other Gmail API statuses", () => {
  it("separates a policy 403 from a scope 403 — same status, opposite recourse", () => {
    expect(classifyGmailApiFailure(structured(POLICY_FORBIDDEN_403))).toBe("gmail-forbidden");
    expect(classifyGmailApiFailure(structured(INSUFFICIENT_SCOPE_403))).toBe("scope-missing");
  });

  it("classifies 429 by status and by message", () => {
    expect(classifyGmailApiFailure(structured(RATE_LIMIT_429))).toBe("gmail-rate-limited");
    expect(classifyGmailApiFailure(messageOnly(RATE_LIMIT_429))).toBe("gmail-rate-limited");
  });

  it("classifies 5xx by status and by message", () => {
    expect(classifyGmailApiFailure(structured(BACKEND_500))).toBe("gmail-unavailable");
    expect(classifyGmailApiFailure(messageOnly(BACKEND_500))).toBe("gmail-unavailable");
  });

  it("classifies 404 by status and by message", () => {
    expect(classifyGmailApiFailure(structured(NOT_FOUND_404))).toBe("gmail-not-found");
    expect(classifyGmailApiFailure(messageOnly(NOT_FOUND_404))).toBe("gmail-not-found");
  });

  it("classifies 400 by status and by message", () => {
    expect(classifyGmailApiFailure(structured(BAD_REQUEST_400))).toBe("gmail-bad-request");
    expect(classifyGmailApiFailure(messageOnly(BAD_REQUEST_400))).toBe("gmail-bad-request");
  });

  it("uses gmail-api-error for a status Gmail answered with but this code does not map", () => {
    const err = new Error("I'm a teapot") as Error & { status: number };
    err.status = 418;
    expect(classifyGmailApiFailure(err)).toBe("gmail-api-error");
  });

  it("names the status class in each surfaced message", () => {
    expect(GMAIL_ERROR_MESSAGES["gmail-forbidden"]).toContain("403");
    expect(GMAIL_ERROR_MESSAGES["gmail-rate-limited"]).toContain("429");
    expect(GMAIL_ERROR_MESSAGES["gmail-not-found"]).toContain("404");
    expect(GMAIL_ERROR_MESSAGES["gmail-bad-request"]).toContain("400");
  });
});

describe("classifyGmailApiFailure — (d) transport failure", () => {
  it("classifies undici's fetch rejection", () => {
    const err = new TypeError("fetch failed");
    (err as unknown as { cause: unknown }).cause = { code: "ECONNREFUSED" };
    expect(classifyGmailApiFailure(err)).toBe("gmail-unreachable");
  });

  it("classifies a DNS failure by cause code", () => {
    const err = new Error("request to gmail.googleapis.com failed");
    (err as unknown as { cause: unknown }).cause = { code: "ENOTFOUND" };
    expect(classifyGmailApiFailure(err)).toBe("gmail-unreachable");
  });

  it("classifies a timeout", () => {
    expect(classifyGmailApiFailure(new Error("The operation was aborted due to timeout"))).toBe(
      "gmail-unreachable",
    );
  });

  it("beats a status that a half-built wrapper may still carry — the request never reached Gmail", () => {
    const err = new TypeError("fetch failed") as TypeError & { status: number };
    err.status = 500;
    expect(classifyGmailApiFailure(err)).toBe("gmail-unreachable");
  });
});

describe("classifyGmailApiFailure — terminal fallback", () => {
  it("keeps refresh-failed only for a value with no recognizable signal", () => {
    expect(classifyGmailApiFailure(new Error("something went sideways"))).toBe("refresh-failed");
    expect(classifyGmailApiFailure(undefined)).toBe("refresh-failed");
    expect(classifyGmailApiFailure(null)).toBe("refresh-failed");
    expect(classifyGmailApiFailure({})).toBe("refresh-failed");
    expect(classifyGmailApiFailure("")).toBe("refresh-failed");
  });
});

describe("classifyGmailApiFailure — containment", () => {
  it("only ever returns a member of the closed code set", () => {
    const samples: unknown[] = [
      structured(INSUFFICIENT_SCOPE_403),
      structured(INVALID_CREDENTIALS_401),
      structured(POLICY_FORBIDDEN_403),
      structured(RATE_LIMIT_429),
      structured(BACKEND_500),
      structured(NOT_FOUND_404),
      structured(BAD_REQUEST_400),
      new TypeError("fetch failed"),
      new Error("unmapped"),
      null,
    ];
    for (const sample of samples) {
      expect(GMAIL_FAILURE_CODES).toContain(classifyGmailApiFailure(sample));
    }
  });

  it("never echoes PII or identifiers out of the Gmail error body", () => {
    const err = structured({
      error: {
        code: 403,
        message:
          "Domain policy prevents access for mailbox operator@example.com in project 1234567890, message id 18f0c2a9b7",
      },
    });
    const code = classifyGmailApiFailure(err);
    expect(code).toBe("gmail-forbidden");
    expect(code).not.toContain("operator@example.com");
    expect(code).not.toContain("1234567890");
    expect(code).not.toContain("18f0c2a9b7");
    // The static message behind the code is likewise free of the body.
    expect(GMAIL_ERROR_MESSAGES[code as keyof typeof GMAIL_ERROR_MESSAGES]).not.toContain("example.com");
  });

  it("every classifier code has a static flash message behind it", () => {
    for (const code of GMAIL_FAILURE_CODES) {
      expect(GMAIL_ERROR_MESSAGES).toHaveProperty(code);
      expect(typeof GMAIL_ERROR_MESSAGES[code as keyof typeof GMAIL_ERROR_MESSAGES]).toBe("string");
    }
  });
});

describe("field extraction", () => {
  it("reads the status off the error, a cause, a response, or a retained envelope", () => {
    expect(extractHttpStatus({ status: 403 })).toBe(403);
    expect(extractHttpStatus({ cause: { status: 401 } })).toBe(401);
    expect(extractHttpStatus({ response: { status: 429 } })).toBe(429);
    expect(extractHttpStatus(INSUFFICIENT_SCOPE_403)).toBe(403);
    expect(extractHttpStatus({ message: "no status here" })).toBeUndefined();
  });

  it("ignores a non-numeric code so a socket reason is never read as a status", () => {
    expect(extractHttpStatus({ code: "ECONNREFUSED" })).toBeUndefined();
  });

  it("reads the reason from both Gmail dialects", () => {
    expect(extractGmailReason(INSUFFICIENT_SCOPE_403)).toBe("insufficientpermissions");
    expect(extractGmailReason(INSUFFICIENT_SCOPE_403_ONE_PLATFORM)).toBe("permission_denied");
    expect(extractGmailReason(RATE_LIMIT_429)).toBe("ratelimitexceeded");
    expect(extractGmailReason({ message: "none" })).toBeUndefined();
  });

  it("terminates on a self-referential error instead of looping", () => {
    const err: Record<string, unknown> = { status: 403 };
    err.cause = err;
    expect(extractHttpStatus(err)).toBe(403);
    expect(() => extractGmailReason(err)).not.toThrow();
  });
});

describe("needsReconnect", () => {
  it("is true exactly for the two codes whose fix is reconnecting", () => {
    expect(needsReconnect("scope-missing")).toBe(true);
    expect(needsReconnect("reauth-required")).toBe(true);
  });

  it("is false for every other code, including non-classifier flash codes", () => {
    for (const code of GMAIL_FAILURE_CODES) {
      if (code === "scope-missing" || code === "reauth-required") continue;
      expect(needsReconnect(code)).toBe(false);
    }
    expect(needsReconnect("disconnect-failed")).toBe(false);
  });
});
