<p align="center">
  <a href="https://www.linkedcamp.com"><img src="assets/logo-wide-1200.png" alt="Linkedcamp" width="480"></a>
</p>

# @linkedcampai/n8n-nodes-linkedcamp

The official [n8n](https://n8n.io) nodes for [Linkedcamp](https://www.linkedcamp.com).

Linkedcamp is agentic LinkedIn and email outreach for lead generation agencies. Each client runs as its own sub-account, and every LinkedIn account gets a country-matched dedicated IP, free on every plan. Use this node to add leads to campaigns from any form, CRM or enrichment tool, react instantly when a prospect accepts a connection or replies, write enrichment data back to leads, and manage campaigns and replies. The node uses the Linkedcamp REST API, and the same API key also works in AI assistants. Plans start from $79/mo with a 14-day trial.

The package contains three nodes:

| Node | What it does |
|---|---|
| **Linkedcamp** | Actions on campaigns, leads, conversations, tags, tasks, reminders, appointments and clients |
| **Linkedcamp Trigger** | Starts a workflow instantly when a Linkedcamp event happens (reply, connection accepted, email opened, ...) |
| **Linkedcamp Poll Trigger** | Checks Linkedcamp on a schedule for new appointments, campaigns, replies and connections |

## Installation

**n8n Cloud and self-hosted n8n (v1.94.0 or later):** once the node is verified, open the nodes panel, search for **Linkedcamp** and install it.

**Self-hosted n8n:** go to **Settings → Community Nodes → Install**, enter `@linkedcampai/n8n-nodes-linkedcamp` and confirm. See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/).

## Credentials

1. In Linkedcamp, open **Settings → Integrations → API** ([direct link](https://app.linkedcamp.com/settings/integrations?type=api)) and copy your API key. The key needs a plan with Pro features (Pro or Agency) and the **Integrations** permission.
2. In n8n, create a **Linkedcamp API** credential and paste the key.
3. Click **Test**. n8n asks Linkedcamp who the key belongs to; a wrong or rotated key is rejected.

One key covers all three nodes. It is sent as the `X-Api-Key` header to the [Linkedcamp REST API v2](https://docs.linkedcamp.com/api-v2/overview) at `https://api.linkedcamp.com/v2`.

Agency owners: the key of the account owner can read client sub-accounts. Use the **Client** option on Campaign → Get Many, Campaign → Get Stats and Tag → Get Many.

## Operations

| Resource | Operation | Notes |
|---|---|---|
| Account | Get | Plan, role and permissions behind the key |
| Appointment | Get Many | Filter by lead, conversation or status |
| Blacklist | Add Entry | Profile URL, company URL, keyword, job title or email, per LinkedIn account |
| Campaign | Create | Creates a **draft**. Nothing is sent until it is launched |
| Campaign | Get | Optionally includes the sequence |
| Campaign | Get Funnel | How many leads reached each stage |
| Campaign | Get Many | Filter by status or keyword. Simplify toggle |
| Campaign | Get Stats | One campaign, or the whole account when no campaign is set |
| Campaign | Launch | **Starts sending real outreach** to the campaign's leads |
| Campaign | Pause or Resume | Resume works only on a paused campaign |
| Client | Get Many | Agency client sub-accounts (owner key only) |
| Conversation | Draft AI Reply | Writes a suggested reply with a connected AI provider. Sends nothing |
| Conversation | Get | Includes messages. **Marks the thread as read** in Linkedcamp |
| Conversation | Get Many | The unified inbox. Simplify toggle |
| Conversation | Send Message | **Delivered immediately on LinkedIn or email; cannot be recalled** |
| Conversation | Update | Archive, mark read, hand over between the AI agent and a human |
| Lead | Add Many to Campaign | Upload up to 5,000 rows (from input items or JSON) with a column mapping |
| Lead | Add Note | Internal note, never sent |
| Lead | Add to Blacklist | **Permanent and account-wide** |
| Lead | Add to Campaign | By LinkedIn Profile URL or email, with optional details and custom fields |
| Lead | Get | Optionally with activities and messages |
| Lead | Get Many | Filter by campaign, status, keyword, tags or date. Simplify toggle |
| Lead | Update | Contact details, custom fields and flags (paused, excluded, interested, seen) |
| Reminder | Create | Optionally linked to a lead, conversation or LinkedIn account |
| Tag | Create | Name plus interest (positive, neutral, negative) |
| Tag | Get Many | |
| Task | Create or Update | Leave Task ID empty to create |
| Tool | Call Any Tool | Advanced: call any [REST API v2 endpoint](https://docs.linkedcamp.com/api-v2/overview) by name with JSON arguments |

Campaign, Lead, Conversation, LinkedIn Account and Client fields can be picked **From List** (searchable) or entered **By ID**.

## Triggers

### Linkedcamp Trigger (instant)

| Event | Fires when |
|---|---|
| New Reply | A lead replies on LinkedIn or email |
| Connection Accepted | A lead accepts a connection request |
| Connection Request Sent | A connection request is sent |
| Email Sent | An email is sent to a lead |
| Email Opened | A lead opens an email |
| Email Link Clicked | A lead clicks a tracked link |
| Email Bounced | An email bounces |
| Unsubscribed | A lead unsubscribes |

Activating the workflow creates a Linkedcamp automation called `n8n – <event>` that posts each event to the workflow. Deactivating the workflow switches that automation off. Optionally limit it to one campaign. The event body is passed to the workflow exactly as Linkedcamp sends it (lead, campaign, company and LinkedIn account details under `data`).

### Linkedcamp Poll Trigger (scheduled)

| Event | Checks |
|---|---|
| New Appointment Booked | Confirmed appointments |
| New Campaign | Newly created campaigns |
| New Replied Lead | Leads with status Replied |
| New Connected Lead | Leads with status Connected |

The first run records what already exists and emits nothing, so only new items start the workflow. A manual test run returns the newest item.

## Example workflows

**New reply → Slack.** Linkedcamp Trigger (New Reply) → Slack (Send Message) with `{{ $json.data.fullName }}` and the campaign name. Optionally add Linkedcamp → Conversation → Draft AI Reply and post the draft for a human to approve.

**Form → add lead to campaign.** n8n Form Trigger (or Typeform, HubSpot, Tally) → Linkedcamp → Lead → Add to Campaign, mapping the LinkedIn URL or email, first name and job title. Add enrichment in between and pass extra data as custom fields for personalisation.

**Appointment booked → CRM.** Linkedcamp Poll Trigger (New Appointment Booked) → Linkedcamp → Lead → Get (with the appointment's lead ID) → HubSpot / Pipedrive (Create Deal).

## Using Linkedcamp in an AI Agent

The same API key works with n8n's **MCP Client Tool** in an AI Agent workflow:

- Endpoint: `https://mcp.linkedcamp.com/mcp`
- Transport: HTTP Streamable
- Authentication: header `X-Api-Key: <your key>`

The Linkedcamp node is also marked as usable as an AI tool, so it can be attached to an AI Agent directly.

## Links

- [Linkedcamp + n8n](https://www.linkedcamp.com/integrations/n8n)
- [Linkedcamp REST API v2](https://docs.linkedcamp.com/api-v2/overview)
- [Linkedcamp MCP server](https://docs.linkedcamp.com/mcp/overview)
- [Linkedcamp](https://www.linkedcamp.com)

## Development

```bash
npm install
npm run build      # compile to dist/
npm run lint       # n8n community node lint
npm test           # unit + node behaviour tests (no network)
npm run dev        # local n8n with the nodes loaded
```

`dev/bootstrap.mjs` captures real, anonymised responses from a test account into `dev/captures/`:

```bash
LINKEDCAMP_TEST_API_KEY=... node dev/bootstrap.mjs
```

It calls read-only endpoints only. The `dev/` and `test/` folders are not published to npm.

## License

[MIT](LICENSE)
