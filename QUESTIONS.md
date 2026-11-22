# Open questions and findings

Sources checked on 21–22 Nov 2026:

- the Linkedcamp MCP server source (`linkedcamp/mcp`, v1.1.0), which backs the REST API v2
- the REST API v2 router (`linkedcamp-api/routes/v2.js`) and its live `openapi.json`
- the REST API source (`linkedcamp-api`)
- the backend and worker source (`linkedcamp-backend`, `linkedcamp-service-v3`)
- live probes against `https://api.linkedcamp.com/v2` with no key and a random, non-existent key, saved in `dev/captures/probe-api-v2.json`

No real account was called. Real-key captures are still pending (see TESTING.md).

## A. Backend bugs found (need a fix in other repos)

1. **REST `POST /webhooks` creates an automation that never fires.**
   - The route (`linkedcamp-api/routes/webhooks.js`) no longer writes a `Webhooks` document. It calls GraphQL `addAutomation`.
   - `addAutomation` inserts the automation with `isActive: false`.
   - The dispatcher (`integration.processor.js`) only runs automations with `isActive: true`. So a webhook created through the documented endpoint never fires until someone switches it on in the web app.
2. **REST `GET /webhooks` and `DELETE /webhooks/{id}` cannot see webhooks created by `POST /webhooks`.** They still read the legacy `Webhooks` collection.
3. **`POST /webhooks` does return an id.** The response spreads `addAutomation`'s `{ success, message, automationId }`. The docs say it returns no id.
4. **`automation_upsert` drops `sequences` on create.** The dispatcher matches automations on `sequences: { $in: [event] }`. Only `updateAutomation`, called with a `flow`, recomputes `sequences`. So an automation created in one call never fires. The node works around this with a create call followed by an update call.
5. **`lead_list` with an ISO date `range` probably matches nothing.**
   - The API docs say epoch ms **or ISO 8601**.
   - `rangeSchema` passes the value through unchanged, and `getLeads` compares it against numeric `updatedAt` with `$gte`/`$lte`.
   - `getLeads` also applies `$lte: to` even when `to` is missing.
   - The node always sends both ends as epoch ms. The server should normalise the range.
6. **There is no tool to delete an automation.** On deactivate, the trigger sets `isActive: false` and reuses the same automation next time. Inactive `n8n – …` automations stay listed in Linkedcamp's Automations page.

## B. Deviations from the build brief (decided with Arslan)

- **Transport is the REST API v2, not the MCP server (22 Nov 2026).**
  - n8n's scanner rejected 0.1.0 under its new rule `no-mcp-protocol-client`: "a package that only proxies an MCP server duplicates a built-in. Use the vendor's REST API… If the vendor has no REST API, the package is not currently eligible for verification."
  - `https://api.linkedcamp.com/v2` exposes the same 133 endpoints as plain REST (`POST /v2/<name>`, JSON in, JSON out, HTTP status errors), with the same API key and the same output shapes.
  - Every operation is unchanged.
  - 0.1.0, which used MCP, should be deprecated on npm once 0.2.0 is out.
- **The instant trigger uses the automation endpoints (`automation_upsert`, `automation_get`), not the legacy REST `/webhooks`.** Reason: A1 and A2. Arslan chose this on 21 Nov 2026. There is no `token` header, and the same API key covers everything.
- **The credential test calls `POST /v2/whoami`.** A missing, wrong or rotated key gets HTTP 401; the probes are in `dev/captures/`.
- **The icon is an SVG container around the official 512×512 PNG** (`mcp-icon-512.png` from the website repo). The n8n linter rejects PNG icons. Nothing was traced or redrawn.
- **Output fields for Simplify come from the server's GraphQL selections** (`mcp/src/client/operations.ts`), because there are no real-key captures yet. The list keys and id fields are the same source: `campaigns`, `leads`, `conversations`, `appointments`, `accounts`, `subaccounts`, `tags`, plus `total` and `_id`. Confirm with `dev/bootstrap.mjs`.

## C. Questions for Arslan / the Linkedcamp backend

1. **Response format: answered.** REST API v2 returns plain JSON on 200, and `{ error: { code, message, hint } }` with a matching HTTP status otherwise.
2. **Output shapes.** `openapi.json` describes request bodies but not response bodies. Can response schemas be added, at least for the list endpoints? Their ids and timestamps drive polling and Simplify.
3. **Webhook payloads.**
   - Per `services/Webhooks.js`, the body is `{ success, statusCode, data: { leadId, fullName, …, campaign, company, linkedAccount } }`.
   - The body carries **no event name and no signature**, so a receiver can't verify it came from Linkedcamp or tell events apart.
   - Can an `event` field and an HMAC signature header be added?
   - The worker also skips sending when the lead has no `firstName` or `lastName`, or no campaign or LinkedIn account. Is that intended for email-only leads?
4. **Rate limits** per key, for polling and bulk adds.
5. **Agency webhooks:** do an owner key's automations fire for client sub-accounts' events? The dispatcher filters on `createdBy: userId`, which suggests not.
6. **Brand:** is there an official SVG of the rocket mark (light and dark), and what is the official brand hex? `#2CC5F4` is still unconfirmed.
7. **Reply tags:** `lead_update` says reply tags are changed through `conversation_update`, but that tool has no tag argument. How are reply tags set?
8. **OAuth (later):** a static OAuth client for n8n, or is dynamic client registration enough?
9. **Clean-up of inactive automations (A6):** add an `automation_delete` endpoint? The trigger would then delete on deactivate.
10. **Lead status enum:** the node uses the 22 statuses from the `lead_list` enum in `/v2/openapi.json`, which mirrors the backend's GraphQL `LeadStatus`.
11. **npm maintainer.** 0.1.0 shows the maintainer as `mobylogixllc`, because the publish token came from that account. n8n checks that the npm maintainer matches the repo owner. Decide which npm account should own `@linkedcampai`, and add the same account as the Trusted Publisher.
