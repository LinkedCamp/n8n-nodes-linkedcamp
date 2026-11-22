# Testing log

## Automated (no network): updated on 22 Nov 2026

| Check | Result |
|---|---|
| `npm run lint` | Pass, 0 errors, 0 warnings |
| `npm run build` | Pass |
| `npm test` | 24 of 24 pass |
| `npx @n8n/scan-community-package` on the packed package | Pass (see below) |

`test/apiClient.test.ts` covers the REST API v2 client:

- the request shape (`POST /v2/<endpoint>` with JSON arguments)
- body parsing: text, pre-parsed, empty, non-JSON
- 401, 403, 404, 400, 422 and 5xx mapping, using the server's own message and hint
- no retries
- reading endpoints from `openapi.json`
- three live captures: no key, a wrong key, and an unknown endpoint

`test/nodes.test.ts` drives the built nodes with a fake n8n context and a fake REST API v2:

- the mapping from fields to endpoint arguments
- Return All pagination and Limit
- Simplify
- epoch-ms ranges
- the single-call bulk upload
- continue-on-fail
- Call Any Tool
- poll dedupe across runs and manual mode
- webhook create, check, delete and reuse
- the webhook payload passing through unchanged

## Live probes (no account touched): done on 22 Nov 2026

See `dev/captures/probe-api-v2.json`:

- `POST /v2/whoami` with no key → HTTP 401 `UNAUTHENTICATED`
- `POST /v2/whoami` with a random UUID → HTTP 401 `UNAUTHENTICATED` (this is what the credential test relies on)
- `POST /v2/no_such_endpoint` → HTTP 404 `NOT_FOUND`

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
