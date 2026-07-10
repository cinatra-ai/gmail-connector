"use client";

// Client islands for the Gmail connector setup page. The server component in
// ./gmail-setup-impl.tsx renders the page chrome, tabs, and prose; these own
// the two interactive affordances that need client state (design/specs/
// app-connectors.html §II · "One connection"):
//
//   ConnectionStatusPanel — the right-column Connection status card + its Check
//     action. Pressing Check swaps the badge for the transient indigo
//     "Checking…" (spinner) until the re-probe server action resolves, then
//     shows Connected / Disconnected (§II items 10–14 · Check flow).
//
//   DisconnectAction — the destructive Disconnect button + its confirmation
//     AlertDialog (§II items 15–16). Disabled until the connector is connected
//     (nothing to disconnect otherwise). Confirming fires the self-scoped,
//     read-gated disconnect server action, which redirects back with the
//     outcome flash code.
//
// Both are the direct twins of the github-connector setup islands
// (cinatra-ai/github-connector s4) — the SAME shared sdk-ui ConnectionStatusCard
// and the SAME vendored AlertDialog chrome, so the two OAuth-shaped connectors
// speak one status + disconnect language.

import * as React from "react";
import { PlugZap, RefreshCw, Unplug } from "lucide-react";
import { ConnectionStatusCard } from "@cinatra-ai/sdk-ui/connection-status-card";
import type { ConnectionStatus } from "@cinatra-ai/sdk-ui/connection-status-badge";
import { NangoUserConnectButton } from "@cinatra-ai/sdk-ui/marketplace";
import type { NangoFrontendConfig } from "@cinatra-ai/sdk-ui/marketplace";
import { Button } from "./components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/ui/dialog";

// The setup page's primary Connect control (app-connectors.html §II · the
// icon-led indigo "Connect" pair). Rendered in this CLIENT island rather than
// the server impl so the decorative PlugZap glyph — the SAME plug the Connected
// status badge shows (sdk-ui connection-status-badge · PlugZap) — is bundled on
// the client and never crosses the RSC boundary as a bare (non-"use client")
// component reference. It wraps the shared NangoUserConnectButton WITHOUT
// re-implementing its Nango connect-session flow: it only fixes gmail's label
// and the leading glyph, and forwards the shared-Google-OAuth-client
// prerequisite gate. Its unplug twin is DisconnectAction below.
export function GmailConnectButton({
  connected,
  reconnectConnectionId,
  nangoFrontendConfig,
  oauthConfigured,
}: {
  connected: boolean;
  reconnectConnectionId?: string;
  nangoFrontendConfig: NangoFrontendConfig;
  /** The shared workspace Google OAuth client is configured — Connect is muted until then. */
  oauthConfigured: boolean;
}) {
  return (
    <NangoUserConnectButton
      connectorKey="gmail"
      reconnectConnectionId={reconnectConnectionId}
      connected={connected}
      connectLabel="Connect"
      reconnectLabel="Reconnect"
      leadingIcon={<PlugZap aria-hidden="true" />}
      nangoFrontendConfig={nangoFrontendConfig}
      disabled={!oauthConfigured}
      prerequisiteErrorMessage={
        oauthConfigured
          ? undefined
          : "Save your Google OAuth client ID and secret in Google OAuth configuration first."
      }
    />
  );
}

export function ConnectionStatusPanel({
  initialConnected,
  checkAction,
}: {
  initialConnected: boolean;
  /** Server action that re-probes the live connection status. */
  checkAction: () => Promise<"connected" | "disconnected">;
}) {
  const [status, setStatus] = React.useState<ConnectionStatus>(
    initialConnected ? "connected" : "disconnected",
  );
  const [isPending, startTransition] = React.useTransition();

  function onCheck() {
    // Guard against overlapping checks (the button is also disabled while
    // pending): a second probe must not race an in-flight one and let an older
    // response overwrite a newer result.
    if (status === "checking") return;
    // Capture the last-known status so a probe FAILURE restores it rather than
    // misreporting a network / auth / server error as "Disconnected" (only a
    // resolved probe changes the badge).
    const previous = status;
    setStatus("checking");
    startTransition(async () => {
      try {
        setStatus(await checkAction());
      } catch {
        setStatus(previous);
      }
    });
  }

  return (
    <ConnectionStatusCard
      status={status}
      action={
        <Button
          type="button"
          variant="outline"
          onClick={onCheck}
          disabled={isPending || status === "checking"}
        >
          <RefreshCw aria-hidden="true" />
          Check
        </Button>
      }
    />
  );
}

export function DisconnectAction({
  connected,
  disconnectAction,
  title = "Disconnect connector?",
  description = "Disconnect this connector and remove its saved connection? It will stop working until you connect it again.",
}: {
  connected: boolean;
  /** Read-gated, self-scoped server action; redirects back with the flash code. */
  disconnectAction: () => Promise<void>;
  title?: string;
  description?: string;
}) {
  const [isPending, startTransition] = React.useTransition();

  return (
    <AlertDialog>
      {/* Disabled until connected — there is nothing to disconnect otherwise
          (app-connectors.html §II item 8). Connect stays always-available
          (rendered separately by the server component). */}
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" disabled={!connected}>
          <Unplug aria-hidden="true" />
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={(event) => {
                // Keep the dialog controlling focus/close; run the redirecting
                // server action inside a transition.
                event.preventDefault();
                startTransition(() => {
                  void disconnectAction();
                });
              }}
            >
              <Unplug aria-hidden="true" />
              Disconnect
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
