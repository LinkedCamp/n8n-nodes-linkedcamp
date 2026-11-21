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

import { McpClient, McpError } from './mcpClient';
import type { McpRawResponse, McpSender } from './mcpClient';

export const MCP_URL = 'https://mcp.linkedcamp.com/mcp';
export const CREDENTIAL_NAME = 'linkedcampApi';

/** Kept in step with package.json by `npm run release`; only reported to the server. */
export const CLIENT_INFO = { name: 'n8n-nodes-linkedcamp', version: '0.1.0' };

export type LinkedcampContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions | IHookFunctions;

/** Build an MCP client that sends every request through the n8n credential. */
export function createMcpClient(ctx: LinkedcampContext): McpClient {
	const send: McpSender = async ({ method, headers, body }) => {
		const options: IHttpRequestOptions = {
			method,
			url: MCP_URL,
			headers,
			json: false,
			encoding: 'text',
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			timeout: 60000,
		};
		if (body !== undefined) options.body = JSON.stringify(body);

		const response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			CREDENTIAL_NAME,
			options,
		)) as { statusCode?: number; headers?: Record<string, unknown>; body?: unknown };

		const raw: McpRawResponse = {
			statusCode: response.statusCode ?? 0,
			headers: response.headers ?? {},
			body: response.body,
		};
		return raw;
	};
	return new McpClient(send, CLIENT_INFO);
}

/** Convert a transport error into the n8n error class the UI expects. */
export function toNodeError(
	ctx: LinkedcampContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	if (error instanceof McpError) {
		if (error.kind === 'tool') {
			return new NodeOperationError(ctx.getNode(), error.message, { itemIndex });
		}
		return new NodeApiError(
			ctx.getNode(),
			{ message: error.message, code: error.rpcCode ?? null } as JsonObject,
			{
				message: error.message,
				httpCode: error.httpCode !== undefined ? String(error.httpCode) : undefined,
				itemIndex,
			},
		);
	}
	return new NodeApiError(ctx.getNode(), error as JsonObject, { itemIndex });
}

/** Call one tool, mapping failures to n8n errors. */
export async function callTool(
	ctx: LinkedcampContext,
	client: McpClient,
	name: string,
	args: IDataObject = {},
	itemIndex?: number,
): Promise<unknown> {
	try {
		return await client.callTool(name, args);
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
 * The server documents ISO 8601 as accepted, but `lead_list` compares the
 * value straight against numeric `updatedAt`, so numbers are the safe form.
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
