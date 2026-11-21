/**
 * Behaviour tests for the built nodes (dist/), driven through a fake n8n
 * context and a fake MCP server. No network. Run `npm run build` first
 * (`npm test` does).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(import.meta.dirname, '..', 'dist', 'nodes', 'Linkedcamp');
const { Linkedcamp } = require(join(dist, 'Linkedcamp.node.js'));
const { LinkedcampPollTrigger } = require(join(dist, 'LinkedcampPollTrigger.node.js'));
const { LinkedcampTrigger } = require(join(dist, 'LinkedcampTrigger.node.js'));

type Json = Record<string, unknown>;
type ToolImpl = (args: Json) => unknown;

/** A fake MCP server: answers initialize / notifications / tools/call from a tool map. */
function fakeServer(tools: Record<string, ToolImpl>) {
	const calls: Array<{ name: string; args: Json }> = [];
	const request = async (_cred: string, options: { body?: string; headers: Json }) => {
		assert.equal(options.headers['X-Api-Key'], undefined, 'node code must not set the key itself');
		const body = options.body ? (JSON.parse(options.body) as Json) : {};
		const reply = (payload: Json, status = 200) => ({
			statusCode: status,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: body.id, ...payload }),
		});
		if (body.method === 'initialize') return reply({ result: { protocolVersion: '2025-06-18', capabilities: {} } });
		if (body.method === 'notifications/initialized') return { statusCode: 202, headers: {}, body: '' };
		if (body.method === 'tools/call') {
			const { name, arguments: args } = body.params as { name: string; arguments: Json };
			calls.push({ name, args });
			const impl = tools[name];
			if (!impl) return reply({ result: { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true } });
			try {
				return reply({ result: { content: [{ type: 'text', text: JSON.stringify(impl(args)) }] } });
			} catch (e) {
				return reply({ result: { content: [{ type: 'text', text: (e as Error).message }], isError: true } });
			}
		}
		return reply({ error: { code: -32601, message: 'Method not found' } });
	};
	return { request, calls };
}

function getParam(params: Json[], i: number, name: string, fallback: unknown, opts?: { extractValue?: boolean }) {
	const p = params[i] ?? params[0];
	let value = p[name] === undefined ? fallback : p[name];
	if (opts?.extractValue && value && typeof value === 'object' && 'value' in (value as Json)) value = (value as Json).value;
	return value;
}

function executeContext(params: Json[], server: ReturnType<typeof fakeServer>, opts: { continueOnFail?: boolean; items?: Json[] } = {}) {
	const items = (opts.items ?? params.map(() => ({}))).map((json) => ({ json }));
	return {
		getInputData: () => items,
		getNodeParameter: (name: string, i: number, fallback?: unknown, o?: { extractValue?: boolean }) =>
			getParam(params, i, name, fallback, o),
		getNode: () => ({ name: 'Linkedcamp', type: 'linkedcamp', typeVersion: 1, parameters: {} }),
		continueOnFail: () => opts.continueOnFail ?? false,
		helpers: {
			httpRequestWithAuthentication: server.request,
			returnJsonArray: (rows: Json | Json[]) => (Array.isArray(rows) ? rows : [rows]).map((json) => ({ json })),
			constructExecutionMetaData: (rows: Array<{ json: Json }>, meta: { itemData: Json }) =>
				rows.map((r) => ({ ...r, pairedItem: meta.itemData })),
		},
	};
}

const run = async (params: Json[], server: ReturnType<typeof fakeServer>, opts = {}) =>
	(await new Linkedcamp().execute.call(executeContext(params, server, opts)))[0] as Array<{ json: Json }>;

test('Lead → Add to Campaign maps fields to lead_add', async () => {
	const server = fakeServer({ lead_add: () => ({ ok: true, message: 'Lead added.' }) });
	await run(
		[
			{
				resource: 'lead',
				operation: 'addToCampaign',
				campaignId: { mode: 'list', value: 'camp1' },
				profileLink: 'https://www.linkedin.com/in/jane-doe',
				email: '',
				additionalFields: {
					firstName: 'Jane',
					designation: 'Head of Growth',
					customFields: { field: [{ key: 'companySize', value: '50' }] },
				},
			},
		],
		server,
	);
	assert.deepEqual(server.calls, [
		{
			name: 'lead_add',
			args: {
				campaignId: 'camp1',
				profileLink: 'https://www.linkedin.com/in/jane-doe',
				firstName: 'Jane',
				designation: 'Head of Growth',
				customFields: { companySize: '50' },
			},
		},
	]);
});

test('Lead → Add to Campaign without URL or email is refused before any call', async () => {
	const server = fakeServer({});
	await assert.rejects(
		run([{ resource: 'lead', operation: 'addToCampaign', campaignId: 'c', profileLink: '', email: '' }], server),
		/LinkedIn Profile URL' or 'Email/,
	);
	assert.equal(server.calls.length, 0);
});

test('Campaign → Get Many with Return All follows pages until total, and simplifies', async () => {
	const all = Array.from({ length: 45 }, (_, n) => ({ _id: `c${n}`, title: `T${n}`, status: 'ACTIVE', extra: 'x', schedule: {} }));
	const server = fakeServer({
		campaign_list: (args) => {
			const page = args.page as number;
			return { total: all.length, page, campaigns: all.slice((page - 1) * 20, page * 20) };
		},
	});
	const out = await run([{ resource: 'campaign', operation: 'getMany', returnAll: true, filters: { status: 'ACTIVE' }, simplify: true }], server);
	assert.equal(out.length, 45);
	assert.deepEqual(server.calls.map((c) => c.args.page), [1, 2, 3]);
	assert.equal(server.calls[0].args.status, 'ACTIVE');
	assert.deepEqual(out[0].json, { _id: 'c0', title: 'T0', status: 'ACTIVE' });
});

test('Lead → Get Many sends range as epoch ms and respects Limit', async () => {
	const server = fakeServer({
		lead_list: (args) => ({ total: 500, leads: Array.from({ length: args.pageSize as number }, (_, n) => ({ _id: `l${n}` })) }),
	});
	const out = await run(
		[
			{
				resource: 'lead',
				operation: 'getMany',
				returnAll: false,
				limit: 7,
				simplify: false,
				filters: { status: 'REPLIED', dateFrom: '2026-11-01T00:00:00.000Z', dateTo: '2026-11-02T00:00:00.000Z', tags: 'a, b' },
			},
		],
		server,
	);
	assert.equal(out.length, 7);
	assert.deepEqual(server.calls[0].args, {
		status: 'REPLIED',
		tags: ['a', 'b'],
		range: { from: Date.parse('2026-11-01T00:00:00.000Z'), to: Date.parse('2026-11-02T00:00:00.000Z') },
		page: 1,
		pageSize: 7,
	});
});

test('Lead → Add Many to Campaign uploads all input items in one call', async () => {
	const server = fakeServer({ campaign_upload_leads: (args) => ({ ok: true, rows: (args.leads as unknown[]).length }) });
	const params = { resource: 'lead', operation: 'addManyToCampaign', campaignId: 'camp1', rowsSource: 'items', header: { column: [{ name: 'url', field: 'profileUrl' }] }, options: {} };
	const out = await run([params, params, params], server, {
		items: [{ url: 'https://www.linkedin.com/in/a' }, { url: 'https://www.linkedin.com/in/b' }, { url: 'https://www.linkedin.com/in/c' }],
	});
	assert.equal(server.calls.length, 1);
	assert.deepEqual(server.calls[0].args.header, { url: 'profileUrl' });
	assert.equal((server.calls[0].args.leads as unknown[]).length, 3);
	assert.equal(out.length, 1);
});

test('a tool error is readable and continue-on-fail keeps going', async () => {
	const campaignGet: ToolImpl = (args) => {
		if (args.campaignId === 'bad') throw new Error('Campaign not found: bad');
		return { _id: args.campaignId, title: 'Good' };
	};
	const params = [
		{ resource: 'campaign', operation: 'get', campaignId: 'bad', options: {} },
		{ resource: 'campaign', operation: 'get', campaignId: 'good', options: {} },
	];
	await assert.rejects(run(params, fakeServer({ campaign_get: campaignGet })), /Campaign not found: bad/);
	const out = await run(params, fakeServer({ campaign_get: campaignGet }), { continueOnFail: true });
	assert.equal(out.length, 2);
	assert.match(String(out[0].json.error), /Campaign not found: bad/);
	assert.equal(out[1].json._id, 'good');
});

test('Tool → Call Any Tool passes JSON arguments through', async () => {
	const server = fakeServer({ reference: (args) => ({ topic: args.topic }) });
	const out = await run([{ resource: 'tool', operation: 'call', toolName: 'reference', toolArguments: '{"topic":"leads"}' }], server);
	assert.deepEqual(out[0].json, { topic: 'leads' });
});

/* ------------------------------- poll trigger ------------------------------ */

function pollContext(event: string, server: ReturnType<typeof fakeServer>, staticData: Json, mode = 'trigger') {
	return {
		getNodeParameter: (name: string, fallback?: unknown) => (name === 'event' ? event : fallback),
		getWorkflowStaticData: () => staticData,
		getMode: () => mode,
		getNode: () => ({ name: 'Poll', type: 'linkedcampPollTrigger', typeVersion: 1, parameters: {} }),
		helpers: {
			httpRequestWithAuthentication: server.request,
			returnJsonArray: (rows: Json[]) => rows.map((json) => ({ json })),
		},
	};
}

test('poll trigger: first run stores a baseline, second run emits only new ids', async () => {
	let appointments = [{ _id: 'a1' }, { _id: 'a2' }];
	const server = fakeServer({ appointment_list: () => ({ total: appointments.length, appointments }) });
	const state: Json = {};
	const trigger = new LinkedcampPollTrigger();

	const first = await trigger.poll.call(pollContext('newAppointment', server, state));
	assert.equal(first, null);
	assert.deepEqual(state.seenIds, ['a1', 'a2']);
	assert.equal(server.calls[0].args.status, 'CONFIRMED');

	appointments = [{ _id: 'a3' }, { _id: 'a1' }, { _id: 'a2' }];
	const second = await trigger.poll.call(pollContext('newAppointment', server, state));
	assert.deepEqual(second, [[{ json: { _id: 'a3' } }]]);

	const third = await trigger.poll.call(pollContext('newAppointment', server, state));
	assert.equal(third, null);
});

test('poll trigger: manual run emits the newest item and leaves state alone', async () => {
	const server = fakeServer({ lead_list: () => ({ total: 2, leads: [{ _id: 'l9' }, { _id: 'l8' }] }) });
	const state: Json = {};
	const out = await new LinkedcampPollTrigger().poll.call(pollContext('newRepliedLead', server, state, 'manual'));
	assert.deepEqual(out, [[{ json: { _id: 'l9' } }]]);
	assert.deepEqual(state, {});
	const range = server.calls[0].args.range as { from: number; to: number };
	assert.equal(typeof range.from, 'number');
	assert.equal(typeof range.to, 'number');
	assert.equal(server.calls[0].args.status, 'REPLIED');
});

/* ----------------------------- webhook trigger ----------------------------- */

test('webhook trigger: create makes an automation and switches it on; delete switches it off', async () => {
	const automations: Record<string, Json> = {};
	const server = fakeServer({
		automation_upsert: (args) => {
			const id = (args._id as string) ?? 'auto1';
			automations[id] = { ...automations[id], ...args, _id: id };
			return { ok: true, message: 'ok', data: { automationId: id } };
		},
		automation_get: (args) => automations[args.automationId as string] ?? null,
	});
	const state: Json = {};
	const url = 'https://n8n.example.com/webhook/abc/webhook';
	const ctx = {
		getNodeParameter: (name: string, fallback?: unknown) => (name === 'event' ? 'REPLY_DETECTED' : fallback),
		getWorkflowStaticData: () => state,
		getNodeWebhookUrl: () => url,
		getNode: () => ({ name: 'Trigger', type: 'linkedcampTrigger', typeVersion: 1, parameters: {} }),
		helpers: { httpRequestWithAuthentication: server.request },
	};
	const hooks = new LinkedcampTrigger().webhookMethods.default;

	assert.equal(await hooks.checkExists.call(ctx), false);
	assert.equal(await hooks.create.call(ctx), true);
	assert.equal(state.automationId, 'auto1');
	assert.deepEqual(server.calls.map((c) => c.name), ['automation_upsert', 'automation_upsert']);
	assert.equal(server.calls[0].args.isActive, false);
	assert.equal(server.calls[1].args.isActive, true);
	assert.equal(server.calls[1].args._id, 'auto1');
	const nodes = (server.calls[1].args.flow as { nodes: Json[] }).nodes;
	assert.deepEqual(nodes.map((n) => (n.data as Json | undefined)?.type), ['REPLY_DETECTED', 'WEBHOOK', undefined]);
	assert.equal((nodes[1].data as Json).url, url);

	assert.equal(await hooks.checkExists.call(ctx), true);
	assert.equal(await hooks.delete.call(ctx), true);
	assert.equal(automations.auto1.isActive, false);
	assert.equal(await hooks.checkExists.call(ctx), false);

	// Re-activation reuses the same automation instead of creating another.
	server.calls.length = 0;
	await hooks.create.call(ctx);
	assert.deepEqual(server.calls.map((c) => [c.name, c.args._id]), [['automation_upsert', 'auto1']]);
});

test('webhook trigger passes the payload through unchanged', async () => {
	const body = { success: true, statusCode: 200, data: { leadId: 'l1', firstName: 'Jane' } };
	const out = await new LinkedcampTrigger().webhook.call({
		getBodyData: () => body,
		helpers: { returnJsonArray: (b: Json) => [{ json: b }] },
	});
	assert.deepEqual(out, { workflowData: [[{ json: body }]] });
});
