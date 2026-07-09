import "server-only";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
// Shared connector setup-page shell (cinatra-ai/cinatra#1247): pins the page
// header AND the content to the single centered "Wide" column (max-w-3xl ·
// 768px) so the header's left edge aligns with the content frame — the §II
// item-1 alignment guarantee, structural instead of hand-rolled Main/PageHeader.
import { ConnectorSetupPage } from "@cinatra-ai/sdk-ui/connector-setup-page";
// The two-column single-connection body (cinatra-ai/cinatra#1254): a
// minmax(0,1fr) 236px grid — wider left = configuration, narrower right = the
// Connection status card — that reflows to one column on a narrow viewport
// (§II items 5, 32).
import { ConnectorSetupColumns } from "@cinatra-ai/sdk-ui/connector-setup-columns";
import { NangoUserConnectButton } from "@cinatra-ai/sdk-ui/marketplace";
import { SearchParamToast } from "@cinatra-ai/sdk-ui/search-param-toast";
// Shared design-system Tabs primitive (cinatra-ai/cinatra#1103) — own subpath
// only, deliberately NOT re-exported from `/marketplace` (route-graph ratchet).
// `TabsListRow` (cinatra-ai/cinatra#1242) is the under-header row that pairs
// the tablist with the etched section rule to the right of the last tab —
// the shared primitive now owns that composition, so this extension vendors
// no local Separator (see the tablist-conformance contract on #42).
import { Tabs, TabsListRow, TabsTrigger, TabsContent } from "@cinatra-ai/sdk-ui/tabs";
import { getStoredGmailSendAsAddresses } from "@cinatra-ai/gmail-connector";
import {
  refreshGmailSendAsAddressesAction,
  disconnectGmailConnectionAction,
  checkGmailStatusAction,
} from "./actions";
import { getGmailDeps } from "./deps";
import { GMAIL_FLASH_TOASTS } from "./gmail-flash";
import { Button } from "./components/ui/button";
// The two interactive client islands — the right-column Connection status card
// + its Check probe, and the destructive Disconnect button + its confirmation
// AlertDialog (§II items 10–16). Twins of the github-connector setup islands.
import { ConnectionStatusPanel, DisconnectAction } from "./setup-client";

// Nango data (frontend config + the user's primary saved connection) is read
// from the injected host port `ctx.nango.*` (host-port inversion) — the impl
// carries no `@cinatra-ai/nango-connector` import.
export type GmailConnectorPageImplProps = {
  searchParams?: Promise<SearchParams>;
  ctx: ExtensionHostContext;
};

export const metadata: Metadata = { title: "Gmail | Cinatra" };
export const dynamic = "force-dynamic";

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString();
}

type SearchParams = Record<string, string | string[] | undefined>;
function pick(v: string | string[] | undefined) { return Array.isArray(v) ? v[0] : v; }

// The setup page's tablist, per the connector setup-page design spec
// (app-connectors §II): the account connect/disconnect card is the primary
// "Setup" tab, "Sender addresses" is gmail's own custom tab, and "Help" is the
// reserved tab that always sits last. Single-connection layout (one mailbox) —
// no "Connections" tab.
//
// The tablist is a CONTROLLED navigation (each trigger `asChild`-wraps a real
// `<Link>` to `?tab=<value>`, mirroring the app's own
// `src/app/configuration/permissions/page.tsx` tablist convention), not
// uncontrolled client state. That matters here specifically: ./actions.ts
// redirects back to this page after Refresh/Disconnect, and on the stale-token
// path it deliberately OMITS `tab` so the page falls back to Setup (where
// Reconnect lives) even if the user had manually clicked into the
// Sender-addresses tab beforehand — an uncontrolled `defaultValue` only applies
// on first mount and cannot force that fallback on a same-route redirect.
const SETUP_PATH = "/connectors/cinatra-ai/gmail-connector/setup";
type GmailSetupTab = "setup" | "sender-addresses" | "help";
const GMAIL_TABS: readonly GmailSetupTab[] = ["setup", "sender-addresses", "help"];
function normalizeTab(v: string | undefined): GmailSetupTab {
  return (GMAIL_TABS as readonly string[]).includes(v ?? "") ? (v as GmailSetupTab) : "setup";
}

export async function GmailConnectorPageImpl(props: GmailConnectorPageImplProps) {
  const actor = await props.ctx.authSession.getActor();
  if (!actor?.userId) {
    // Dispatch route already gated via enforceConnectorPolicy; defensive null
    // check so a misconfigured port never silently mis-scopes user data.
    throw new Error("[gmail-connector] no userId on actor");
  }
  const sp = await (props.searchParams ?? Promise.resolve({})) as SearchParams;
  // Which tab a redirect back to this page should land on — ./actions.ts sets
  // `tab=sender-addresses` on the Refresh flow's redirects so the user lands
  // back where they clicked Refresh; defaults to Setup otherwise.
  const activeTab = normalizeTab(pick(sp.tab));

  const nangoFrontendConfig = (await props.ctx.nango.getFrontendConfig?.()) ?? {};
  const gmailSettings = getStoredGmailSendAsAddresses(actor.userId);
  const connection =
    (await props.ctx.nango.getPrimarySavedConnections?.({ scope: "user", userId: actor.userId }))?.gmail ?? null;
  const connected = Boolean(connection);

  // Connecting Gmail requires the shared Google OAuth client (clientId +
  // secret, configured in the google-oauth connector) to exist first. Read the
  // connector-level status directly (deps.oauth.getStatus reports "connected"
  // once the client is configured, independent of any user connection). Fail
  // OPEN if the host google-oauth service is unavailable.
  let oauthConfigured = true;
  try {
    oauthConfigured = (await getGmailDeps().oauth.getStatus()).status === "connected";
  } catch {
    oauthConfigured = true;
  }

  return (
    // Standard connector-setup PAGE chrome (§II items 1–2): the connector name
    // as the page-title h1 + the muted "Connector setup" subtitle. The status
    // badge that once sat top-right of the header now lives in the Connection
    // status card (item 2). `divider={false}` — the section rule is the tab
    // row's etched rule (item 4), so the two rules never stack.
    <ConnectorSetupPage
      title="Gmail"
      description="Connector setup"
      divider={false}
      className="flex flex-col gap-6 pb-8"
    >
      {/* Codes-only flash island (cinatra-ai/cinatra#1108): ./actions.ts
          redirects here with a stable ?notice=<code> / ?error=<code>; this
          reads it once, toasts the STATIC mapped message from ./gmail-flash,
          then strips the consumed param — so a refresh/reconnect/disconnect
          never replays a stale toast (supersedes the old suppression hack). */}
      <Suspense fallback={null}>
        <SearchParamToast toasts={GMAIL_FLASH_TOASTS} />
      </Suspense>

      <Tabs value={activeTab} className="gap-6">
        {/* TabsListRow pairs the tablist with the etched section rule to the
            right of the last tab (design-system Tabs §Dividers; the page
            header's own divider is off above so the two rules never stack). */}
        <TabsListRow>
          <TabsTrigger value="setup" asChild>
            <Link href={`${SETUP_PATH}?tab=setup`}>Setup</Link>
          </TabsTrigger>
          <TabsTrigger value="sender-addresses" asChild>
            <Link href={`${SETUP_PATH}?tab=sender-addresses`}>Sender addresses</Link>
          </TabsTrigger>
          {/* Help is the reserved tab — always last (app-connectors §II). */}
          <TabsTrigger value="help" asChild>
            <Link href={`${SETUP_PATH}?tab=help`}>Help</Link>
          </TabsTrigger>
        </TabsListRow>

        <TabsContent value="setup" className="mt-6">
          {/* Single-connection two-column body (§II items 5–14): wider left =
              the account connect/disconnect controls, narrower right = the
              Connection status card. Gmail carries NO OAuth-admin form on this
              page — the shared Google OAuth client is configured in the
              google-oauth connector — so the left column holds the connection
              actions + account label rather than credential fields. */}
          <ConnectorSetupColumns
            conformanceId="connector-setup"
            state="ready"
            fields={
              <div className="flex flex-col gap-6">
                <div>
                  <p className="text-sm font-medium text-foreground">Gmail account</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connection ? `Connected${connection.email ? ` as ${connection.email}` : ""}` : "Not connected"}
                  </p>
                </div>

                {/* Actions — side by side, never stacked (§II item 7):
                    Connect (indigo primary) + Disconnect (destructive, unplug)
                    disabled until connected (item 8). Gmail's Connect
                    additionally requires the shared workspace Google OAuth
                    client to be configured first — the button carries that
                    prerequisite guidance inline (merged behavior, #23). */}
                <div className="flex flex-wrap items-center gap-3">
                  <NangoUserConnectButton
                    connectorKey="gmail"
                    reconnectConnectionId={connection?.connectionId}
                    connected={connected}
                    connectLabel="Connect Gmail"
                    reconnectLabel="Reconnect"
                    nangoFrontendConfig={nangoFrontendConfig}
                    disabled={!oauthConfigured}
                    prerequisiteErrorMessage={
                      oauthConfigured
                        ? undefined
                        : "Save your Google OAuth client ID and secret in Google OAuth configuration first."
                    }
                  />
                  <DisconnectAction
                    connected={connected}
                    disconnectAction={disconnectGmailConnectionAction}
                  />
                </div>
              </div>
            }
            aside={
              /* Connection status card (§II items 10–14): heading over a
                 divider, a status badge with icon + label, and a full-width
                 Check action beneath it. Pressing Check swaps in the transient
                 "Checking…" badge until the re-probe resolves. */
              <ConnectionStatusPanel initialConnected={connected} checkAction={checkGmailStatusAction} />
            }
          />
        </TabsContent>

        <TabsContent value="sender-addresses" className="mt-6 max-w-xl flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Verified send-as addresses for the connected account.</p>
            {connection ? (
              <form action={refreshGmailSendAsAddressesAction}>
                <Button type="submit" variant="outline" size="sm">Refresh</Button>
              </form>
            ) : null}
          </div>
          {gmailSettings.aliases.length > 0 ? (
            <div className="grid gap-3">
              {gmailSettings.aliases.map((alias) => (
                <div key={alias.email} className="rounded-control border border-line bg-surface px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">{alias.displayName || alias.email}</p>
                  {alias.displayName ? <p className="mt-1 text-sm text-muted-foreground">{alias.email}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No sender addresses loaded yet. Click Refresh to query Gmail.</p>
          )}
          {gmailSettings.syncedAt ? (
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Last refreshed {formatTimestamp(gmailSettings.syncedAt)}
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="help" className="mt-6 max-w-xl flex flex-col gap-4">
          <p className="text-sm leading-6 text-muted-foreground">
            The Gmail connector sends outreach email through your connected Gmail account and reads the verified{" "}
            <span className="font-medium text-foreground">send-as</span> aliases it can send from.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Connecting requires shared Google OAuth credentials, configured once per workspace. Save your client
            ID and secret in{" "}
            <Link
              href="/connectors/cinatra-ai/google-oauth-connector/setup"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Google OAuth configuration
            </Link>{" "}
            first — create them in the{" "}
            <Link
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Google Cloud Console
            </Link>
            .
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            Once connected, use <span className="font-medium text-foreground">Sender addresses</span> to refresh
            and review the verified aliases available to send from. Use{" "}
            <span className="font-medium text-foreground">Disconnect</span> on the Setup tab to remove the
            connection; the connector stops working until you connect it again.
          </p>
        </TabsContent>
      </Tabs>
    </ConnectorSetupPage>
  );
}
