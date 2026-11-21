/**
 * Unit tests for the MCP transport. No network: every response comes from a
 * fixture under test/fixtures. Run with `npm test` (Node 22.18+ runs .ts
 * directly via type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	AUTH_MESSAGE,
	FORBIDDEN_MESSAGE,
	McpClient,
	McpError,
	extractMessage,
	toolOutput,
} from '../nodes/Linkedcamp/transport/mcpClient.ts';
import type { McpRawResponse, McpRequest } from '../nodes/Linkedcamp/transport/mcpClient.ts';

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): McpRawResponse => ({
	statusCode: status,
	headers: { 'content-type': 'application/json', ...headers },
	body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** An initialize reply that echoes the request id, optionally with extra headers. */
const initReply = (headers: Record<string, string> = {}) => (req: McpRequest): McpRawResponse => {
	const body = { ...JSON.parse(fixture('initialize.json')), id: (req.body as { id: number }).id };
	return json(body, 200, headers);
};
const INIT_OK = initReply();
const ACK = (): McpRawResponse => ({ statusCode: 202, headers: {}, body: '' });

/** A sender that replays responses in order and records every request. */
function scripted(responses: Array<McpRawResponse | ((req: McpRequest) => McpRawResponse)>) {
	const requests: McpRequest[] = [];
	const send = async (req: McpRequest): Promise<McpRawResponse> => {
		requests.push(req);
		const next = responses.shift();
		if (!next) throw new Error(`Unexpected request #${requests.length}`);
		return typeof next === 'function' ? next(req) : next;
	};
	return { send, requests };
}

/** Rewrite a fixture's id so it answers the request it is replying to. */
const answer = (text: string) => (req: McpRequest): McpRawResponse => {
	const id = (req.body as { id: number }).id;
	const body = JSON.parse(text) as { id: number };
	body.id = id;
	return json(body);
};

const CLIENT_INFO = { name: 'n8n-nodes-linkedcamp', version: 'test' };

test('handshake sends initialize then notifications/initialized with the right headers', async () => {
	const { send, requests } = scripted([INIT_OK, ACK(), answer(fixture('result-structured.json'))]);
	const client = new McpClient(send, CLIENT_INFO);
	await client.callTool('whoami', {});

	assert.equal(requests.length, 3);
	const [init, ack, call] = requests;
	assert.equal((init.body as { method: string }).method, 'initialize');
	assert.equal(init.headers.Accept, 'application/json, text/event-stream');
	assert.equal(init.headers['Content-Type'], 'application/json');
	assert.equal((ack.body as { method: string }).method, 'notifications/initialized');
	assert.equal(ack.headers['MCP-Protocol-Version'], '2025-06-18');
	const body = call.body as { method: string; params: { name: string; arguments: object } };
	assert.equal(body.method, 'tools/call');
	assert.deepEqual(body.params, { name: 'whoami', arguments: {} });
	assert.equal(call.headers['Mcp-Session-Id'], undefined, 'stateless server: no session header');
});

test('JSON result with structuredContent returns structuredContent', async () => {
	const { send } = scripted([INIT_OK, ACK(), answer(fixture('result-structured.json'))]);
	const out = await new McpClient(send, CLIENT_INFO).callTool('campaign_list', {});
	assert.deepEqual(out, { campaigns: [{ _id: 'c1', title: 'Structured' }], total: 1 });
});

test('JSON result with text content only parses the JSON text', async () => {
	const { send } = scripted([INIT_OK, ACK(), answer(fixture('result-text.json'))]);
	const out = await new McpClient(send, CLIENT_INFO).callTool('campaign_list', {});
	assert.deepEqual(out, { total: 1, page: 1, campaigns: [{ _id: 'c1', title: 'Test campaign', status: 'PAUSED' }] });
});

test('non-JSON text content comes back as { text }', () => {
	assert.deepEqual(toolOutput({ content: [{ type: 'text', text: 'plain words' }] }), { text: 'plain words' });
});

test('SSE-framed result skips a progress notification and picks the matching id', async () => {
	const sse = fixture('result-sse.txt');
	const { send } = scripted([
		INIT_OK,
		ACK(),
		(req) => ({
			statusCode: 200,
			headers: { 'Content-Type': 'text/event-stream' },
			body: sse.replace(/"id":2/g, `"id":${(req.body as { id: number }).id}`),
		}),
	]);
	const out = await new McpClient(send, CLIENT_INFO).callTool('lead_list', {});
	assert.deepEqual(out, { total: 1, leads: [{ _id: 'l1', status: 'REPLIED' }] });
});

test('isError: true throws a tool McpError with the joined text', async () => {
	const { send } = scripted([INIT_OK, ACK(), answer(fixture('result-iserror.json'))]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('campaign_get', { campaignId: 'bad' }), (err) => {
		assert.ok(err instanceof McpError);
		assert.equal(err.kind, 'tool');
		assert.match(err.message, /Campaign not found: bad/);
		return true;
	});
});

test('JSON-RPC -32001 maps to the auth message', async () => {
	const { send } = scripted([json(JSON.parse(fixture('error-32001.json')), 401)]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('whoami', {}), (err) => {
		assert.ok(err instanceof McpError);
		assert.equal(err.kind, 'auth');
		assert.equal(err.message, AUTH_MESSAGE);
		return true;
	});
});

test('-32001 inside an HTTP 200 still maps to auth', async () => {
	const body = { ...JSON.parse(fixture('error-32001.json')), id: 1 };
	const { send } = scripted([json(body, 200)]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('whoami', {}), { kind: 'auth' });
});

test('HTTP 403 maps to the forbidden message', async () => {
	const { send } = scripted([INIT_OK, ACK(), json({ error: 'FORBIDDEN' }, 403)]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('subaccount_list', {}), (err) => {
		assert.ok(err instanceof McpError);
		assert.equal(err.kind, 'forbidden');
		assert.equal(err.httpCode, 403);
		assert.ok(err.message.startsWith(FORBIDDEN_MESSAGE));
		return true;
	});
});

test('other JSON-RPC errors surface code and message', async () => {
	const { send } = scripted([
		INIT_OK,
		ACK(),
		(req) => json({ jsonrpc: '2.0', id: (req.body as { id: number }).id, error: { code: -32602, message: 'Invalid params' } }),
	]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('lead_get', {}), (err) => {
		assert.ok(err instanceof McpError);
		assert.equal(err.kind, 'rpc');
		assert.equal(err.rpcCode, -32602);
		assert.match(err.message, /Invalid params/);
		return true;
	});
});

test('404 with a session id re-initialises once and retries once', async () => {
	const withSession = initReply({ 'Mcp-Session-Id': 'sess-1' });
	const withNewSession = initReply({ 'mcp-session-id': 'sess-2' });
	const { send, requests } = scripted([
		withSession,
		ACK(),
		json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } }, 404),
		withNewSession,
		ACK(),
		answer(fixture('result-text.json')),
	]);
	const client = new McpClient(send, CLIENT_INFO);
	const out = await client.callTool('campaign_list', {});
	assert.equal((out as { total: number }).total, 1);
	assert.equal(requests.length, 6);
	assert.equal(requests[2].headers['Mcp-Session-Id'], 'sess-1');
	assert.equal(requests[5].headers['Mcp-Session-Id'], 'sess-2');
	assert.equal(client.session.sessionId, 'sess-2');
});

test('a second 404 is not retried again', async () => {
	const withSession = initReply({ 'mcp-session-id': 'sess-1' });
	const notFound = json({ error: 'gone' }, 404);
	const { send, requests } = scripted([withSession, ACK(), notFound, withSession, ACK(), notFound]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('campaign_list', {}), { kind: 'http', httpCode: 404 });
	assert.equal(requests.length, 6);
});

test('one session is reused across calls', async () => {
	const { send, requests } = scripted([
		INIT_OK,
		ACK(),
		answer(fixture('result-text.json')),
		answer(fixture('result-text.json')),
	]);
	const client = new McpClient(send, CLIENT_INFO);
	await client.callTool('campaign_list', {});
	await client.callTool('campaign_list', { page: 2 });
	assert.equal(requests.filter((r) => (r.body as { method?: string })?.method === 'initialize').length, 1);
});

test('close sends DELETE only when a session id was issued', async () => {
	const stateless = scripted([INIT_OK, ACK(), answer(fixture('result-text.json'))]);
	const a = new McpClient(stateless.send, CLIENT_INFO);
	await a.callTool('campaign_list', {});
	await a.close();
	assert.equal(stateless.requests.length, 3);

	const withSession = initReply({ 'mcp-session-id': 'sess-9' });
	const stateful = scripted([withSession, ACK(), answer(fixture('result-text.json')), ACK()]);
	const b = new McpClient(stateful.send, CLIENT_INFO);
	await b.callTool('campaign_list', {});
	await b.close();
	assert.equal(stateful.requests[3].method, 'DELETE');
	assert.equal(stateful.requests[3].headers['Mcp-Session-Id'], 'sess-9');
});

test('extractMessage accepts a body the HTTP layer already parsed', () => {
	const msg = extractMessage({ statusCode: 200, headers: {}, body: { jsonrpc: '2.0', id: 7, result: { ok: 1 } } }, 7);
	assert.deepEqual(msg?.result, { ok: 1 });
});

test('real capture: random key → whoami isError (live probe, 21 Nov 2026)', async () => {
	const capture = JSON.parse(
		readFileSync(join(import.meta.dirname, '..', 'dev', 'captures', 'probe-whoami-invalid-key.json'), 'utf8'),
	) as { response: { body: unknown } };
	const { send } = scripted([INIT_OK, ACK(), (req) => json({ ...(capture.response.body as object), id: (req.body as { id: number }).id })]);
	await assert.rejects(new McpClient(send, CLIENT_INFO).callTool('whoami', {}), { kind: 'tool' });
});
