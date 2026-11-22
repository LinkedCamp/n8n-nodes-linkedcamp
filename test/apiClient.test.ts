/* eslint-disable @n8n/community-nodes/no-restricted-imports -- tests are not published; Node built-ins are fine here */
/**
 * Unit tests for the REST API v2 client. No network. Run with `npm test`
 * (Node 22.18+ runs .ts directly via type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
	AUTH_MESSAGE,
	ApiClient,
	FORBIDDEN_MESSAGE,
	LinkedcampApiError,
	parseBody,
} from '../nodes/Linkedcamp/transport/apiClient.ts';
import type { ApiRawResponse, ApiRequest } from '../nodes/Linkedcamp/transport/apiClient.ts';

const reply = (status: number, body: unknown): ApiRawResponse => ({
	statusCode: status,
	headers: { 'content-type': 'application/json' },
	body: typeof body === 'string' ? body : JSON.stringify(body),
});

function scripted(responses: ApiRawResponse[]) {
	const requests: ApiRequest[] = [];
	const send = async (req: ApiRequest): Promise<ApiRawResponse> => {
		requests.push(req);
		const next = responses.shift();
		if (!next) throw new Error(`Unexpected request #${requests.length}`);
		return next;
	};
	return { send, requests };
}

const probes = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'dev', 'captures', 'probe-api-v2.json'), 'utf8'),
) as { probes: Array<{ request: string; status: number; body: unknown }> };

test('call POSTs the arguments to /<endpoint> and returns the JSON body', async () => {
	const { send, requests } = scripted([reply(200, { total: 1, campaigns: [{ _id: 'c1' }] })]);
	const out = await new ApiClient(send).call('campaign_list', { status: 'ACTIVE', page: 1 });
	assert.deepEqual(out, { total: 1, campaigns: [{ _id: 'c1' }] });
	assert.deepEqual(requests, [{ method: 'POST', path: '/campaign_list', body: { status: 'ACTIVE', page: 1 } }]);
});

test('a body the HTTP layer already parsed is used as is', async () => {
	const { send } = scripted([{ statusCode: 200, headers: {}, body: { ok: true } }]);
	assert.deepEqual(await new ApiClient(send).call('whoami'), { ok: true });
});

test('an empty 200 body becomes {}', async () => {
	const { send } = scripted([{ statusCode: 200, headers: {}, body: '' }]);
	assert.deepEqual(await new ApiClient(send).call('tag_list'), {});
});

test('non-JSON text comes back as { result }', () => {
	assert.deepEqual(parseBody('plain words'), { result: 'plain words' });
});

test('real capture: no key → 401 → auth message', async () => {
	const p = probes.probes[0];
	const { send } = scripted([reply(p.status, p.body)]);
	await assert.rejects(new ApiClient(send).call('whoami'), (err) => {
		assert.ok(err instanceof LinkedcampApiError);
		assert.equal(err.kind, 'auth');
		assert.equal(err.httpCode, 401);
		assert.equal(err.message, AUTH_MESSAGE);
		return true;
	});
});

test('real capture: wrong key → 401 → auth', async () => {
	const p = probes.probes[1];
	const { send } = scripted([reply(p.status, p.body)]);
	await assert.rejects(new ApiClient(send).call('whoami'), { kind: 'auth', code: 'UNAUTHENTICATED' });
});

test('real capture: unknown endpoint → 404 → notFound with the server message and hint', async () => {
	const p = probes.probes[2];
	const { send } = scripted([reply(p.status, p.body)]);
	await assert.rejects(new ApiClient(send).call('no_such_endpoint'), (err) => {
		assert.ok(err instanceof LinkedcampApiError);
		assert.equal(err.kind, 'notFound');
		assert.match(err.message, /No endpoint named `no_such_endpoint`/);
		assert.match(err.message, /openapi\.json/);
		return true;
	});
});

test('record not found → notFound', async () => {
	const { send } = scripted([reply(404, { error: { code: 'NOT_FOUND', message: 'Campaign not found: bad' } })]);
	await assert.rejects(new ApiClient(send).call('campaign_get', { campaignId: 'bad' }), {
		kind: 'notFound',
		message: 'Campaign not found: bad',
	});
});

test('403 → forbidden with the standard prefix and the server reason', async () => {
	const { send } = scripted([
		reply(403, { error: { code: 'FORBIDDEN', message: '`subaccount_list` is not available to this API key.' } }),
	]);
	await assert.rejects(new ApiClient(send).call('subaccount_list'), (err) => {
		assert.ok(err instanceof LinkedcampApiError);
		assert.equal(err.kind, 'forbidden');
		assert.ok(err.message.startsWith(FORBIDDEN_MESSAGE));
		assert.match(err.message, /subaccount_list/);
		return true;
	});
});

test('400 and 422 → invalid with the server message', async () => {
	const { send } = scripted([
		reply(400, { error: { code: 'VALIDATION', message: 'campaignId: Required' } }),
		reply(422, { error: { code: 'UPSTREAM', message: 'Campaign is not PAUSED.' } }),
	]);
	const client = new ApiClient(send);
	await assert.rejects(client.call('campaign_get', {}), { kind: 'invalid', message: 'campaignId: Required' });
	await assert.rejects(client.call('campaign_set_status', {}), { kind: 'invalid', message: 'Campaign is not PAUSED.' });
});

test('5xx → upstream, and nothing is retried', async () => {
	const { send, requests } = scripted([
		reply(504, { error: { code: 'UPSTREAM', message: 'The request timed out. A write may still complete; read it back before retrying.' } }),
	]);
	await assert.rejects(new ApiClient(send).call('message_send', { conversationId: 'c', content: 'hi' }), {
		kind: 'upstream',
		httpCode: 504,
	});
	assert.equal(requests.length, 1);
});

test('an error body that is not JSON still gives a readable message', async () => {
	const { send } = scripted([{ statusCode: 502, headers: {}, body: '<html>Bad gateway</html>' }]);
	await assert.rejects(new ApiClient(send).call('whoami'), {
		kind: 'upstream',
		message: 'Linkedcamp could not complete the request (HTTP 502). Try again shortly.',
	});
});

test('listEndpoints reads names and summaries from openapi.json', async () => {
	const spec = {
		paths: {
			'/whoami': { post: { summary: 'Who am I' } },
			'/campaign_list': { post: { description: 'Campaigns in your account' } },
		},
	};
	const { send, requests } = scripted([reply(200, spec)]);
	const out = await new ApiClient(send).listEndpoints();
	assert.deepEqual(out, [
		{ name: 'whoami', description: 'Who am I' },
		{ name: 'campaign_list', description: 'Campaigns in your account' },
	]);
	assert.deepEqual(requests, [{ method: 'GET', path: '/openapi.json' }]);
});
