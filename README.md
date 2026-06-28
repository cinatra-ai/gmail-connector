# Gmail

Gmail connector for cinatra. Implements the `EmailConnector` interface and registers itself as the `gmail` provider behind the `email-connector` facade, so all provider-agnostic `email_send` operations route through a connected Google account without any host-side code naming this package directly. Each workspace member connects their own Google account via OAuth through Nango; outbound email is sent as that user rather than a shared system address. Full documentation lives in the Integrations hub at https://docs.cinatra.ai/integrations/gmail/

## Works with

- `@cinatra-ai/sdk-extensions` (the Cinatra extension SDK, peer dependency)
- `@cinatra-ai/email-connector` (the facade extension that routes `email_send` to the active email provider)
- Google Gmail API via OAuth through Nango (`gmail` connector key)

## Capabilities

- Send email from a connected Gmail account on a user's behalf via the `gmail_email_send` MCP primitive
- Send as one of the user's verified Gmail send-as aliases
- Fetch and cache the user's send-as alias list via `gmail_aliases_list` and `gmail_aliases_refresh`
- Detect replies to previously sent messages via `gmail_email_find_reply`
- Report connection status (connected / not_connected / incomplete) via `gmail_status`
- Development-mode recipient override: redirect all outbound sends to a configured address during testing
