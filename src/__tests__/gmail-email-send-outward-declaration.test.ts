import { describe, it, expect } from "vitest";

import { registerGmailPrimitives } from "../mcp/registry";

// cinatra#3745: a tool that sends a message on a person's behalf declares `outward` on
// its registration, so the host holds each call of it in an agent run for the
// person's recorded decision. `gmail_email_send` takes free text and no stored item, so its declaration names no
// subject: it is exactly `{}`. No other tool of this connector acts outward,
// and none declares it.
describe("gmail_email_send declares that it acts outward (cinatra#3745)", () => {
  function registeredConfigs(): Map<string, Record<string, unknown>> {
    const configs = new Map<string, Record<string, unknown>>();
    const server = {
      registerTool: (name: string, config: Record<string, unknown>) => {
        configs.set(name, config);
      },
    } as unknown as Parameters<typeof registerGmailPrimitives>[0];
    registerGmailPrimitives(server);
    return configs;
  }

  it("registers gmail_email_send with outward: {}", () => {
    const config = registeredConfigs().get("gmail_email_send");
    expect(config).toBeDefined();
    expect("outward" in config!).toBe(true);
    expect(config!.outward).toEqual({});
  });

  it("declares outward on gmail_email_send only", () => {
    const declared = [...registeredConfigs()]
      .filter(([, config]) => "outward" in config)
      .map(([name]) => name);
    expect(declared).toEqual(["gmail_email_send"]);
  });
});
