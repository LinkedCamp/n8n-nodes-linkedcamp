# Testing log

## Automated (no network): done on 21 Nov 2026

| Check | Result |
|---|---|
| `npm run lint` | Pass, 0 errors, 0 warnings |
| `npm run build` | Pass |
| `npm test` | 27 of 27 pass |

`test/mcpClient.test.ts` covers the transport:

- structuredContent
- text-only JSON
- plain text
- SSE with a progress notification
- `isError`
- `-32001` with HTTP 401 and with HTTP 200
- HTTP 403
- other JSON-RPC errors
- 404 → re-initialise → success
- a second 404 is not retried
- session reuse
- DELETE on close
- a replay of the live invalid-key capture

`test/nodes.test.ts` drives the built nodes with a fake n8n context and a fake MCP server:

- the mapping from fields to tool arguments
- Return All pagination and Limit
- Simplify
- epoch-ms ranges
- the single-call bulk upload
- continue-on-fail
- Call Any Tool
- poll dedupe across runs and manual mode
- webhook create, check, delete and reuse
- the webhook payload passing through unchanged

## Live probes (no account touched): done on 21 Nov 2026

See `dev/captures/probe-*.json`:

- `initialize` with no key → HTTP 401 with JSON-RPC `-32001`
- `initialize` with a random UUID → HTTP 200, plain JSON, no `mcp-session-id`
- `tools/call whoami` with a random UUID, sent without `initialize` → HTTP 200 with `result.isError: true`
- `notifications/initialized` → HTTP 202

## Pending: needs `LINKEDCAMP_TEST_API_KEY` and Arslan

- [ ] `node dev/bootstrap.mjs`. Review `dev/captures/`, then copy any differences from `schema-diff.json` into QUESTIONS.md.
- [ ] Credential test in local n8n (`npm run dev`): the real key passes, and a key with one character changed fails with the readable message.
- [ ] Get / Get Many on every resource.
- [ ] Add to Campaign on a PAUSED or DRAFTED test campaign that Arslan names: once with Arslan's own LinkedIn URL, once with an email-only lead.
- [ ] Update Lead and Add Note.
- [ ] Pause or Resume on the test campaign.
- [ ] Send Message, Launch and Add to Blacklist. **Run these only after Arslan names the target and says yes.**
- [ ] Webhook trigger, for each of the 8 events:
  1. Activate the workflow and check that `automation_list` shows `n8n – <event>` as active.
  2. Cause one real event and save the anonymised body to `dev/captures/payload-<EVENT>.json`.
  3. Deactivate the workflow and check that the automation shows as inactive.
- [ ] Poll trigger: activate the workflow and confirm two runs don't emit duplicates.
- [ ] Error path: a bad campaign id gives a readable error, and continue-on-fail works.
- [ ] `npx @n8n/scan-community-package @linkedcampai/n8n-nodes-linkedcamp` (after the first npm release).
