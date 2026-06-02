import "server-only";
import type { EmailConnectorDefinition } from "@cinatra-ai/sdk-extensions";

// Leaf definition shared by index.ts and email-connector.ts to avoid a
// circular-dependency TDZ around gmailAPIConnector initialization.
export const gmailAPIConnector: EmailConnectorDefinition = {
  connectorId: "gmail",
  name: "Gmail",
  slug: "connector-gmail",
  description: "Send and read campaign emails through the Gmail API.",
  settingsHref: "/configuration/llm/gmail",
  supportsOAuth: true,
  supportsApiKey: true,
  supportsCustomFrom: true,
};
