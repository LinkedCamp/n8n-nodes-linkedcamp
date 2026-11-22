#!/usr/bin/env node
/**
 * Dev bootstrap: capture what the live Linkedcamp REST API v2 really returns.
 *
 *   LINKEDCAMP_TEST_API_KEY=... node dev/bootstrap.mjs
 *
 * - Reads the key from the environment only. It is never printed or written.
 * - Calls READ-ONLY tools only (no lead_add, message_send, campaign_launch,
 *   campaign_set_status, automation_upsert, ...).
 * - Writes anonymised JSON to dev/captures/ (names, emails, URLs, free text
 *   replaced). Review the files before committing anyway.
 *
 * This folder is not published: package.json "files" only ships dist/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://api.linkedcamp.com/v2';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'captures');
const KEY = process.env.LINKEDCAMP_TEST_API_KEY;

if (!KEY) {
	console.error('Set LINKEDCAMP_TEST_API_KEY (test sub-account key). Nothing was called.');
	process.exit(1);
}

/** Arguments the node sends for each tool (§4 of the build brief). */
const EXPECTED_ARGS = {
	campaign_list: ['status', 'keyword', 'page', 'userId'],
	campaign_get: ['campaignId', 'includeFlow'],
	campaign_create: ['title', 'sourceUrl'],
	campaign_set_status: ['campaignId', 'status'],
	campaign_launch: ['campaignId', 'skipPreflight'],
	analytics_campaign: ['campaignId', 'range', 'includeGraph', 'userId'],
	analytics_campaign_funnel: ['campaignId', 'range'],
	lead_add: ['campaignId', 'profileLink', 'email', 'firstName', 'lastName', 'fullName', 'designation', 'location', 'phone', 'website', 'salesNavLink', 'recruiterLink', 'personalization', 'customFields'],
	campaign_upload_leads: ['campaignId', 'header', 'leads', 'removeDuplicates'],
	lead_list: ['campaignId', 'keyword', 'status', 'tags', 'range', 'page', 'pageSize'],
	lead_get: ['leadId', 'includeActivities', 'includeMessages'],
	lead_update: ['leadId', 'email', 'firstName', 'lastName', 'designation', 'phone', 'website', 'personalization', 'paused', 'isExcluded', 'isInterested', 'seen', 'customFields'],
	lead_note_add: ['leadId', 'content'],
	lead_blacklist: ['leadId'],
	conversation_list: ['campaignId', 'keyword', 'platform', 'type', 'tags', 'linkedAccountId', 'emailAccountId', 'page'],
	conversation_get: ['conversationId', 'includeMessages'],
	conversation_update: ['conversationId', 'isArchived', 'seen', 'assistant', 'pauseBotOnManualMessage'],
	message_send: ['conversationId', 'content', 'attachment'],
	message_draft_ai_reply: ['conversationId', 'provider', 'prompt'],
	blacklist_add: ['linkedAccountId', 'type', 'keyword'],
	tag_create: ['content', 'interest'],
	tag_list: ['userId'],
	task_upsert: ['taskId', 'title', 'content', 'leadId', 'conversationId', 'link', 'tag', 'date', 'isCompleted'],
	reminder_create: ['title', 'remindAt', 'description', 'leadId', 'conversationId', 'linkedAccountId'],
	appointment_list: ['leadId', 'conversationId', 'status', 'page'],
	subaccount_list: ['keyword', 'page', 'pageSize'],
	whoami: [],
	linkedin_account_list: ['keyword', 'status', 'userId'],
	automation_get: ['automationId'],
	automation_upsert: ['_id', 'title', 'description', 'flow', 'isActive'],
};

/* ------------------------------- transport ------------------------------- */

const results = {};

async function callTool(name, args = {}) {
	const res = await fetch(`${BASE}/${name}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': KEY },
		body: JSON.stringify(args),
	});
	const text = await res.text();
	let body;
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		body = { text };
	}
	return res.ok ? { ok: true, status: res.status, output: body } : { ok: false, status: res.status, error: body.error ?? body };
}

/* ------------------------------- anonymise ------------------------------- */

const SENSITIVE = /^(fullName|firstName|lastName|name|email|phone|website|headline|bio|location|address|profileLink|profileUrl|salesNavLink|recruiterLink|profilePic|profileUrn|url|link|lastMsg|subject|content|text|message|description|personalization|title|keyword|query|domain|companyName|company|contact|callbackUrl|groupUrls|ip)$/i;

function scrubString(s) {
	return s
		.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'user@example.com')
		.replace(/https?:\/\/[^\s"')]+/g, 'https://example.com/redacted')
		.replace(/\/in\/[\w-]+/g, '/in/redacted');
}

function anonymise(value, key = '') {
	if (Array.isArray(value)) return value.map((v) => anonymise(v, key));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = anonymise(v, k);
		return out;
	}
	if (typeof value === 'string') {
		if (SENSITIVE.test(key)) return value ? `<${key}>` : value;
		return scrubString(value);
	}
	return value;
}

async function save(name, data) {
	await writeFile(join(OUT, name), JSON.stringify(data, null, 2) + '\n');
	console.log(`  saved dev/captures/${name}`);
}

/* --------------------------------- main ---------------------------------- */

await mkdir(OUT, { recursive: true });

const who = await callTool('whoami', {});
if (!who.ok) {
	console.error(`whoami failed (HTTP ${who.status}). Check the key; nothing else was called.`);
	process.exit(1);
}
console.log('whoami OK');

// OpenAPI spec + schema diff
const spec = await (await fetch(`${BASE}/openapi.json`)).json();
const endpoints = Object.entries(spec.paths ?? {}).map(([path, item]) => ({
	name: path.slice(1),
	inputSchema: item.post?.requestBody?.content?.['application/json']?.schema,
	readOnly: item.post?.['x-read-only'],
	destructive: item.post?.['x-destructive'],
}));
await save('endpoints.json', endpoints);

const diff = {};
const byName = Object.fromEntries(endpoints.map((t) => [t.name, t]));
for (const [name, expected] of Object.entries(EXPECTED_ARGS)) {
	const tool = byName[name];
	if (!tool) {
		diff[name] = { missing: 'not in /v2/openapi.json' };
		continue;
	}
	const actual = Object.keys(tool.inputSchema?.properties ?? {});
	const notOnServer = expected.filter((a) => !actual.includes(a));
	const notInNode = actual.filter((a) => !expected.includes(a) && !['startDate', 'endDate'].includes(a));
	if (notOnServer.length || notInNode.length) diff[name] = { notOnServer, notInNode };
}
await save('schema-diff.json', diff);
console.log(Object.keys(diff).length ? `  schema differences: ${Object.keys(diff).join(', ')} (see schema-diff.json → QUESTIONS.md)` : '  input schemas match the node');

// reference
for (const topic of ['leads', 'campaign']) {
	const r = await callTool('reference', { topic });
	await save(`reference-${topic}.json`, r.output);
}

// read-only tools
async function capture(file, name, args) {
	const r = await callTool(name, args);
	results[name] = { ok: r.ok, status: r.status, error: r.error };
	await save(file, anonymise({ tool: name, args, ...r }));
	return r;
}

await capture('whoami.json', 'whoami', {});
const campaigns = await capture('campaign_list.json', 'campaign_list', { page: 1 });
const campaignId = campaigns.output?.campaigns?.[0]?._id;
if (campaignId) {
	await capture('campaign_get.json', 'campaign_get', { campaignId, includeFlow: true });
	await capture('analytics_campaign_funnel.json', 'analytics_campaign_funnel', { campaignId });
}
await capture('analytics_campaign.json', 'analytics_campaign', {});
const leads = await capture('lead_list.json', 'lead_list', { page: 1, pageSize: 5 });
const leadId = leads.output?.leads?.[0]?._id;
if (leadId) await capture('lead_get.json', 'lead_get', { leadId });
await capture('lead_list-replied-range.json', 'lead_list', {
	status: 'REPLIED',
	range: { from: Date.now() - 30 * 864e5, to: Date.now() },
	pageSize: 5,
});
// conversation_get is skipped on purpose: it marks the thread as read.
await capture('conversation_list.json', 'conversation_list', { page: 1 });
await capture('appointment_list.json', 'appointment_list', { page: 1 });
await capture('tag_list.json', 'tag_list', {});
await capture('linkedin_account_list.json', 'linkedin_account_list', {});
await capture('subaccount_list.json', 'subaccount_list', { page: 1, pageSize: 5 });
await capture('automation_list.json', 'automation_list', {});

await save('summary.json', {
	capturedAt: new Date().toISOString(),
	endpointCount: endpoints.length,
	results,
});
console.log('Done. Review dev/captures/ before committing.');
