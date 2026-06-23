import "server-only";
import type { Metadata } from "next";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { NangoUserConnectButton } from "@cinatra-ai/sdk-ui/marketplace";
import { getStoredGmailSendAsAddresses } from "@cinatra-ai/gmail-connector";
import { refreshGmailSendAsAddressesAction } from "./actions";
import { getGmailDeps } from "./deps";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";

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

export async function GmailConnectorPageImpl(props: GmailConnectorPageImplProps) {
  const actor = await props.ctx.authSession.getActor();
  if (!actor?.userId) {
    // Dispatch route already gated via enforceConnectorPolicy; defensive null
    // check so a misconfigured port never silently mis-scopes user data.
    throw new Error("[gmail-connector] no userId on actor");
  }
  const sp = await (props.searchParams ?? Promise.resolve({})) as SearchParams;
  const sendAsRefreshed = pick(sp.sendAsRefreshed) === "1";
  const error = pick(sp.error);

  const nangoFrontendConfig = (await props.ctx.nango.getFrontendConfig?.()) ?? {};
  const gmailSettings = getStoredGmailSendAsAddresses(actor.userId);
  const connection =
    (await props.ctx.nango.getPrimarySavedConnections?.({ scope: "user", userId: actor.userId }))?.gmail ?? null;

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
  // Suppress the "authorization expired" error once the user has successfully reconnected,
  // since router.refresh() re-renders with the same ?error= URL param still present.
  const visibleError = connection && error?.includes("authorization expired") ? undefined : error;

  return (
    <Main className="min-h-screen">
      <PageHeader
        title="Gmail"
        description="Connect your Gmail account and manage the verified send-as addresses available for outreach."
              className="max-w-3xl"
      />
      <PageContent className="max-w-3xl flex flex-col gap-6 pb-8">
        {sendAsRefreshed ? (
          <Alert variant="success" className="rounded-control">
            <AlertDescription>Sender email addresses refreshed.</AlertDescription>
          </Alert>
        ) : null}
        {visibleError ? (
          <Alert variant="destructive" className="rounded-control">
            <AlertDescription>{visibleError}</AlertDescription>
          </Alert>
        ) : null}

        <section className="soft-panel rounded-panel p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Gmail account</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {connection ? `Connected${connection.email ? ` as ${connection.email}` : ""}` : "Not connected"}
            </p>
          </div>
          <NangoUserConnectButton
            connectorKey="gmail"
            reconnectConnectionId={connection?.connectionId}
            connected={Boolean(connection)}
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
        </section>

        {oauthConfigured ? null : (
          <p className="-mt-3 text-sm leading-6 text-muted-foreground">
            Connecting requires shared Google OAuth credentials. Save your client
            ID and secret in{" "}
            <a
              href="/connectors/cinatra-ai/google-oauth-connector/setup"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Google OAuth configuration
            </a>{" "}
            first — create them in the{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Google Cloud Console
            </a>
            .
          </p>
        )}

        <section className="soft-panel rounded-panel p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Sender addresses</p>
              <p className="mt-1 text-sm text-muted-foreground">Verified send-as addresses for the connected account.</p>
            </div>
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
        </section>
      </PageContent>
    </Main>
  );
}
