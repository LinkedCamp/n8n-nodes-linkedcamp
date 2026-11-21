# Open questions and findings

Sources checked on 21 Nov 2026:

- the Linkedcamp MCP server source (`linkedcamp/mcp`, v1.1.0)
- the REST API source (`linkedcamp-api`)
- the backend and worker source (`linkedcamp-backend`, `linkedcamp-service-v3`)
- three live probes against `https://mcp.linkedcamp.com/mcp` with no key and a random, non-existent key, saved in `dev/captures/probe-*.json`

No real account was called. Real-key captures are still pending (see TESTING.md).

## A. Backend bugs found (need a fix in other repos)

1. **REST `POST /webhooks` creates an automation that never fires.**
   - The route (`linkedcamp-api/routes/webhooks.js`) no longer writes a `Webhooks` document. It calls GraphQL `addAutomation`.
   - `addAutomation` inserts the automation with `isActive: false`.
   - The dispatcher (`integration.processor.js`) only runs automations with `isActive: true`. So a webhook created through the documented endpoint never fires until someone switches it on in the web app.
2. **REST `GET /webhooks` and `DELETE /webhooks/{id}` cannot see webhooks created by `POST /webhooks`.** They still read the legacy `Webhooks` collection.
3. **`POST /webhooks` does return an id.** The response spreads `addAutomation`'s `{ success, message, automationId }`. The docs say it returns no id.
4. **`automation_upsert` (MCP) drops `sequences` on create.** The dispatcher matches automations on `sequences: { $in: [event] }`. Only `updateAutomation`, called with a `flow`, recomputes `sequences`. So an automation created in one MCP call never fires. The node works around this with a create call followed by an update call.
5. **`lead_list` with an ISO date `range` probably matches nothing.**
   - The MCP docs say epoch ms **or ISO 8601**.
   - `rangeSchema` passes the value through unchanged, and `getLeads` compares it against numeric `updatedAt` with `$gte`/`$lte`.
   - `getLeads` also applies `$lte: to` even when `to` is missing.
   - The node always sends both ends as epoch ms. The server should normalise the range.
6. **There is no tool to delete an automation.** On deactivate, the trigger sets `isActive: false` and reuses the same automation next time. Inactive `n8n – …` automations stay listed in Linkedcamp's Automations page.

## B. Deviations from the build brief (decided with Arslan)

- **The instant trigger uses MCP automations, not REST `/webhooks`.** Reason: A1 and A2. Arslan chose this on 21 Nov 2026. There is no `transport/rest.ts` and no `token` header, and the same API key covers everything.
- **The credential test calls `tools/call whoami` instead of `initialize`.**
  - `initialize` returns 200 for any well-formed key, so the brief's test would pass a wrong key.
  - `whoami` returns `result.isError: true` for a wrong key; the probe is in `dev/captures/`.
  - A missing or malformed key still gets HTTP 401.
- **The icon is an SVG container around the official 512×512 PNG** (`mcp-icon-512.png` from the website repo). The n8n linter rejects PNG icons. Nothing was traced or redrawn.
- **Output fields for Simplify come from the server's GraphQL selections** (`mcp/src/client/operations.ts`), because there are no real-key captures yet. The list keys and id fields are the same source: `campaigns`, `leads`, `conversations`, `appointments`, `accounts`, `subaccounts`, `tags`, plus `total` and `_id`. Confirm with `dev/bootstrap.mjs`.

## C. Questions for Arslan / the Linkedcamp backend

1. **Response format and sessions: answered.** Plain JSON, no `mcp-session-id`, stateless, protocol `2025-06-18`. `tools/call` works without `initialize`. The client still handles sessions and SSE in case this changes.
2. **Output shapes.** The tools return JSON text only: no `outputSchema`, no `structuredContent`. Can `structuredContent` and an `outputSchema` be added, at least for the list tools? Their ids and timestamps drive polling and Simplify.
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
9. **Clean-up of inactive automations (A6):** add `automation_delete` to MCP? The trigger would then delete on deactivate.
10. **Lead status enum:** the node copies the 22 statuses from the MCP server's `lead_list` enum, which mirrors the backend's GraphQL `LeadStatus`. Confirm it with `reference(topic: "leads")` once a key is available.
