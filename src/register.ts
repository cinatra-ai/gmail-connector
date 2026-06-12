// The gmail connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerGmailConnector` — this
// entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:*` — connector-config, google-oauth) plus the
// connector-authored `nango-system` surface (the legacy
// `@cinatra-ai/host:nango-connection-storage` adapter id is retired —
// cinatra#151 Stage 3) and the granted `ctx.authSession` port. Every adapter field
// resolves the host service LAZILY at call time, so activation order against
// the host's boot imports never matters.
//
// It also registers:
//   - the `email-send` capability provider (`gmailEmailConnector`) so email
//     routing resolves gmail without any host import, and
//   - a `nango-connection-saved` hook so the host's nango save route refreshes
//     this user's send-as aliases registration-driven (no gmail literal in the
//     host route).
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the host
// services arrive as DATA through `ctx.capabilities`.

import "server-only";
import type {
  ExtensionHostContext,
  HostConnectorConfigService,
  HostGoogleOAuthService,
  NangoSystemSurface,
} from "@cinatra-ai/sdk-extensions";
import { registerGmailConnector, type GmailConnectorDeps } from "./deps";
import { gmailEmailConnector } from "./email-connector";
import {
  gmailChatUserContextProvider,
  refreshUserGmailSendAsAddresses,
} from "./index";

const PACKAGE_NAME = "@cinatra-ai/gmail-connector";

// Lazy per-concern host-service resolution (capability ids are inlined string
// literals — the SDK constants are values and this graph must stay type-only).
function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

function buildDeps(ctx: ExtensionHostContext): GmailConnectorDeps {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  // The connector-authored nango-system surface (registered by the nango
  // gateway's own register(ctx) — a systemExtension, required at boot).
  const nango = (): NangoSystemSurface => {
    const provider = ctx.capabilities.resolveProviders("nango-system")[0];
    const surface = provider?.impl as NangoSystemSurface | undefined;
    if (!surface || typeof surface.isNangoConfigured !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: the "nango-system" capability surface is not registered — ` +
          `resolve at call time (post-activation), never at module eval.`,
      );
    }
    return surface;
  };
  const oauth = () =>
    hostService<HostGoogleOAuthService>(ctx, "@cinatra-ai/host:google-oauth");

  return {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    nango: {
      getPrimarySavedConnection: (connectorKey, opts) =>
        nango().getPrimarySavedNangoConnection(connectorKey, opts),
      clearConnectionRecords: (connectorKey, opts) =>
        nango().clearNangoConnectionRecords(connectorKey, opts) as Promise<unknown>,
    },
    oauth: {
      getStatus: () =>
        oauth().getStatus() as ReturnType<GmailConnectorDeps["oauth"]["getStatus"]>,
      apiFetch: <T>(
        input: { url: string; method?: string; body?: unknown },
        options?: { userId?: string; connectorKey?: "gmail" | "googleOAuth" },
      ) => oauth().apiFetch<T>(input, options),
      refreshAccessTokenIfNeeded: (input) =>
        oauth().refreshAccessTokenIfNeeded(input) as ReturnType<
          GmailConnectorDeps["oauth"]["refreshAccessTokenIfNeeded"]
        >,
    },
    requireSessionUserId: async () => {
      const actor = await ctx.authSession.getActor();
      const userId = actor?.userId;
      if (!userId) {
        throw new Error(`${PACKAGE_NAME}: no authenticated session user.`);
      }
      return userId;
    },
  };
}

export function register(ctx: ExtensionHostContext): void {
  registerGmailConnector(buildDeps(ctx));

  ctx.capabilities.registerProvider("email-send", {
    packageName: PACKAGE_NAME,
    impl: gmailEmailConnector,
  });

  // Chat user-context: contributes the user's verified send-as addresses to
  // the chat system prompt, registration-driven (the chat runner resolves
  // this capability instead of importing this package by name). The record
  // carries this package's name, so the host's transitional boot-bridge
  // registration of the SAME record idempotently collapses with this one.
  ctx.capabilities.registerProvider(
    "chat-user-context",
    gmailChatUserContextProvider,
  );

  // Post-save hook for the host's nango connection-save route: when a gmail
  // user-scope connection is saved, refresh that user's send-as aliases.
  // Best-effort by the route's contract — a failure is retried from the UI.
  ctx.capabilities.registerProvider("nango-connection-saved", {
    packageName: PACKAGE_NAME,
    impl: {
      connectorKey: "gmail",
      scope: "user",
      run: async ({ userId }: { userId?: string }) => {
        if (!userId) return;
        await refreshUserGmailSendAsAddresses(userId);
      },
    },
  });
}
