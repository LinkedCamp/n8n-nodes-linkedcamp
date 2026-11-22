import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { API_BASE_URL, ApiClient, LinkedcampApiError } from './apiClient';
import type { ApiRawResponse, ApiSender } from './apiClient';

export const CREDENTIAL_NAME = 'linkedcampApi';

export type LinkedcampContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions | IHookFunctions;

/** Build an API client that sends every request through the n8n credential. */
export function createClient(ctx: LinkedcampContext): ApiClient {
	const send: ApiSender = async ({ method, path, body }) => {
		const options: IHttpRequestOptions = {
			method,
			url: `${API_BASE_URL}${path}`,
			headers: { Accept: 'application/json' },
			json: false,
			encoding: 'text',
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			timeout: 120000,
		};
		if (body !== undefined) {
			options.body = JSON.stringify(body);
			(options.headers as IDataObject)['Content-Type'] = 'application/json';
		}

		const response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			CREDENTIAL_NAME,
			options,
		)) as { statusCode?: number; headers?: Record<string, unknown>; body?: unknown };

		const raw: ApiRawResponse = {
			statusCode: response.statusCode ?? 0,
			headers: response.headers ?? {},
			body: response.body,
		};
		return raw;
	};
	return new ApiClient(send);
}

/** Convert an API error into the n8n error class the UI expects. */
export function toNodeError(
	ctx: LinkedcampContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	if (error instanceof LinkedcampApiError) {
		// The record or the input is the problem: something the user can fix in the node.
		if (error.kind === 'notFound' || error.kind === 'invalid') {
			return new NodeOperationError(ctx.getNode(), error.message, { itemIndex });
		}
		return new NodeApiError(
			ctx.getNode(),
			{ message: error.message, code: error.code ?? null } as JsonObject,
			{ message: error.message, httpCode: String(error.httpCode), itemIndex },
		);
	}
	return new NodeApiError(ctx.getNode(), error as JsonObject, { itemIndex });
}

/** Call one endpoint, mapping failures to n8n errors. */
export async function callApi(
	ctx: LinkedcampContext,
	client: ApiClient,
	endpoint: string,
	args: IDataObject = {},
	itemIndex?: number,
): Promise<unknown> {
	try {
		return await client.call(endpoint, args);
	} catch (error) {
		throw toNodeError(ctx, error, itemIndex);
	}
}

/** Remove keys whose value is undefined, null or an empty string. */
export function compact(args: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null || value === '') continue;
		out[key] = value;
	}
	return out;
}

/**
 * Normalise a date field to epoch milliseconds.
 *
 * The API documents ISO 8601 as accepted, but `lead_list` compares the value
 * straight against numeric `updatedAt`, so numbers are the safe form.
 */
export function toEpochMs(value: unknown): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return value;
	const parsed = Date.parse(String(value));
	return Number.isNaN(parsed) ? undefined : parsed;
}

/** Build a `{ from, to }` range, filling a missing end so the window is closed. */
export function buildRange(from: unknown, to: unknown): IDataObject | undefined {
	const start = toEpochMs(from);
	const end = toEpochMs(to);
	if (start === undefined && end === undefined) return undefined;
	return { from: start ?? 0, to: end ?? Date.now() };
}
