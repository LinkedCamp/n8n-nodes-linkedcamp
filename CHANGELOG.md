# Changelog

## 0.2.0 (2026-11-22)

- The nodes now call the Linkedcamp REST API v2 (`https://api.linkedcamp.com/v2`) instead of the MCP server. Operations, fields and outputs are unchanged, and the same API key works.
- The credential test now uses `POST /v2/whoami`.
- Errors now carry Linkedcamp's own message and hint, with the right HTTP status.

## 0.1.0 (2026-11-21)

First version.

- **Linkedcamp** node:
  - **Account:** Get
  - **Appointment:** Get Many
  - **Blacklist:** Add Entry
  - **Campaign:** Create, Get, Get Funnel, Get Many, Get Stats, Launch, Pause or Resume
  - **Client:** Get Many
  - **Conversation:** Draft AI Reply, Get, Get Many, Send Message, Update
  - **Lead:** Add Many to Campaign, Add Note, Add to Blacklist, Add to Campaign, Get, Get Many, Update
  - **Reminder:** Create
  - **Tag:** Create, Get Many
  - **Task:** Create or Update
  - **Tool:** Call Any Tool
- **Linkedcamp Trigger:** instant events for New Reply, Connection Accepted, Connection Request Sent, Email Sent, Email Opened, Email Link Clicked, Email Bounced and Unsubscribed.
- **Linkedcamp Poll Trigger:** New Appointment Booked, New Campaign, New Replied Lead and New Connected Lead.
- **Linkedcamp API** credential, using one API key for all nodes.
