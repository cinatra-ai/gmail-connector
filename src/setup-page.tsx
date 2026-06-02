// Gmail connector setup page dispatch route.
// Delegates to the shared page implementation.

import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";
import { GmailConnectorPageImpl } from "./gmail-setup-impl";

// Nango data is read from `ctx.nango.*` inside the impl (host-port inversion);
// the refresh action is owned by the connector (./actions). No host props beyond
// the standard setup-page contract.
type ConnectorSetupPageProps = {
  packageId: string;
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
  ctx: ExtensionHostContext;
};

export default async function GmailConnectorSetupPage({
  searchParams,
  ctx,
}: ConnectorSetupPageProps) {
  return GmailConnectorPageImpl({
    searchParams: Promise.resolve(searchParams),
    ctx,
  });
}
