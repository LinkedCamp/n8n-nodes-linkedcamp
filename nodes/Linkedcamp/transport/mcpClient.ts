/**
 * Minimal MCP (Model Context Protocol) client over Streamable HTTP.
 *
 * Hand-written on purpose: verified n8n community nodes may not carry runtime
 * dependencies, so `@modelcontextprotocol/sdk` is not an option. This file has
 * no imports at all; the n8n-specific glue (HTTP helper, error classes) lives
 * in `mcp.ts`, which keeps this part unit-testable without n8n or a network.
 *
 * Protocol: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *
 * The Linkedcamp server is stateless and answers with plain JSON
 * (no `mcp-session-id`, no SSE). The client still handles session ids and
 * SSE framing, because both are allowed by the spec and may be enabled later.
 */

export const PROTOCOL_VERSION = '2025-06-18';

export const AUTH_MESSAGE =
	'Linkedcamp rejected the API key. Check it under Settings → Integrations → API.';
export const FORBIDDEN_MESSAGE =
	'Not allowed for this Linkedcamp key (plan, permission, access tier or a server-side block).';

export type HttpMethod = 'POST' | 'DELETE';

export interface McpRequest {
	method: HttpMethod;
	headers: Record<string, string>;
	body?: unknown;
}

export interface McpRawResponse {
	statusCode: number;
	headers: Record<string, unknown>;
	/** Raw text, or an already-parsed object if the HTTP layer parsed it. */
	body: unknown;
}

export type McpSender = (request: McpRequest) => Promise<McpRawResponse>;

export type McpErrorKind = 'auth' | 'forbidden' | 'rpc' | 'tool' | 'http' | 'protocol';

export class McpError extends Error {
	readonly kind: McpErrorKind;
	readonly httpCode?: number;
	readonly rpcCode?: number;

	constructor(kind: McpErrorKind, message: string, opts: { httpCode?: number; rpcCode?: number } = {}) {
		super(message);
		this.name = 'McpError';
		this.kind = kind;
		this.httpCode = opts.httpCode;
		this.rpcCode = opts.rpcCode;
	}
}

interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcMessage {
	jsonrpc?: string;
	id?: number | string | null;
	method?: string;
	result?: Record<string, unknown>;
	error?: JsonRpcError;
}

interface ToolContent {
	type?: string;
	text?: string;
}

export interface ToolResult {
	content?: ToolContent[];
	structuredContent?: unknown;
	isError?: boolean;
}

export interface ToolDescriptor {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
}

function header(headers: Record<string, unknown>, name: string): string | undefined {
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() !== wanted) continue;
		if (Array.isArray(value)) return value.length ? String(value[0]) : undefined;
		return value === undefined || value === null ? undefined : String(value);
	}
	return undefined;
}

function bodyAsText(body: unknown): string | undefined {
	if (body === undefined || body === null) return undefined;
	if (typeof body === 'string') return body;
	if (body instanceof Uint8Array) return new TextDecoder().decode(body);
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse every JSON-RPC message carried by an SSE stream body. */
export function parseSse(text: string): JsonRpcMessage[] {
	const messages: JsonRpcMessage[] = [];
	for (const block of text.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).replace(/^ /, ''))
			.join('\n');
		if (!data.trim()) continue;
		try {
			const parsed = JSON.parse(data) as unknown;
			if (Array.isArray(parsed)) messages.push(...(parsed as JsonRpcMessage[]));
			else if (isRecord(parsed)) messages.push(parsed as JsonRpcMessage);
		} catch {
			// A non-JSON event (keep-alive, comment) is not ours.
		}
	}
	return messages;
}

/**
 * Pick the JSON-RPC response with the given id out of an HTTP response,
 * whether it came back as one JSON object, a JSON batch, or an SSE stream.
 */
export function extractMessage(response: McpRawResponse, id: number): JsonRpcMessage | undefined {
	const contentType = (header(response.headers, 'content-type') ?? '').toLowerCase();
	const { body } = response;

	let candidates: JsonRpcMessage[] = [];
	if (isRecord(body)) {
		candidates = [body as JsonRpcMessage];
	} else if (Array.isArray(body)) {
		candidates = body as JsonRpcMessage[];
	} else {
		const text = bodyAsText(body);
		if (!text || !text.trim()) return undefined;
		if (contentType.includes('text/event-stream')) {
			candidates = parseSse(text);
		} else {
			try {
				const parsed = JSON.parse(text) as unknown;
				candidates = Array.isArray(parsed) ? (parsed as JsonRpcMessage[]) : [parsed as JsonRpcMessage];
			} catch {
				// Some servers send SSE without the right content type.
				candidates = parseSse(text);
			}
		}
	}

	// Only real JSON-RPC errors count: `{ "error": "not_found" }` from a plain
	// HTTP 404 is not one.
	const isRpcError = (m: JsonRpcMessage): boolean =>
		isRecord(m.error) && typeof (m.error as { code?: unknown }).code === 'number';
	const sanitize = (m: JsonRpcMessage): JsonRpcMessage =>
		m.error !== undefined && !isRpcError(m) ? { ...m, error: undefined } : m;

	const match = candidates.find((m) => isRecord(m) && m.id === id);
	if (match) return sanitize(match);
	// An error with a null id answers whatever was sent (e.g. auth failures).
	return candidates.find((m) => isRecord(m) && isRpcError(m) && (m.id === null || m.id === undefined));
}

/** Join the text parts of a tool result. */
export function joinText(result: ToolResult): string {
	return (result.content ?? [])
		.filter((c) => c && typeof c.text === 'string')
		.map((c) => c.text as string)
		.join('\n')
		.trim();
}

/**
 * Turn a tool result into node output: `structuredContent` if present, else
 * the JSON parsed from the first text part, else `{ text }`.
 */
export function toolOutput(result: ToolResult): unknown {
	if (result.structuredContent !== undefined && result.structuredContent !== null) {
		return result.structuredContent;
	}
	const first = result.content?.find((c) => typeof c?.text === 'string')?.text;
	if (first !== undefined) {
		try {
			return JSON.parse(first) as unknown;
		} catch {
			// Not JSON; fall through to plain text.
		}
	}
	return { text: joinText(result) };
}

export class McpClient {
	private sessionId?: string;
	private protocolVersion = PROTOCOL_VERSION;
	private initialized = false;
	private nextId = 1;
	private readonly send: McpSender;
	private readonly clientInfo: { name: string; version: string };

	constructor(send: McpSender, clientInfo: { name: string; version: string }) {
		this.send = send;
		this.clientInfo = clientInfo;
	}

	/** Exposed for tests and diagnostics. */
	get session(): { sessionId?: string; protocolVersion: string; initialized: boolean } {
		return { sessionId: this.sessionId, protocolVersion: this.protocolVersion, initialized: this.initialized };
	}

	private baseHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
		};
		if (this.initialized) headers['MCP-Protocol-Version'] = this.protocolVersion;
		if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
		return headers;
	}

	private static throwForStatus(response: McpRawResponse, message?: JsonRpcMessage): void {
		const status = response.statusCode;
		if (status === 401 || message?.error?.code === -32001) {
			throw new McpError('auth', AUTH_MESSAGE, { httpCode: status, rpcCode: message?.error?.code });
		}
		if (status === 403) {
			const detail = message?.error?.message;
			throw new McpError('forbidden', detail ? `${FORBIDDEN_MESSAGE} ${detail}` : FORBIDDEN_MESSAGE, {
				httpCode: status,
				rpcCode: message?.error?.code,
			});
		}
		if (message?.error) {
			throw new McpError('rpc', `Linkedcamp refused the request (code ${message.error.code}): ${message.error.message}`, {
				httpCode: status,
				rpcCode: message.error.code,
			});
		}
		if (status >= 400) {
			throw new McpError('http', `Linkedcamp MCP server answered HTTP ${status}.`, { httpCode: status });
		}
	}

	async initialize(): Promise<void> {
		this.sessionId = undefined;
		this.initialized = false;
		const id = this.nextId++;
		const response = await this.send({
			method: 'POST',
			headers: this.baseHeaders(),
			body: {
				jsonrpc: '2.0',
				id,
				method: 'initialize',
				params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: this.clientInfo },
			},
		});
		const message = extractMessage(response, id);
		McpClient.throwForStatus(response, message);
		if (!message?.result) {
			throw new McpError('protocol', 'Linkedcamp MCP server sent no initialize result.', {
				httpCode: response.statusCode,
			});
		}

		this.sessionId = header(response.headers, 'mcp-session-id') || undefined;
		const version = message.result.protocolVersion;
		if (typeof version === 'string' && version) this.protocolVersion = version;
		this.initialized = true;

		const ack = await this.send({
			method: 'POST',
			headers: this.baseHeaders(),
			body: { jsonrpc: '2.0', method: 'notifications/initialized' },
		});
		if (ack.statusCode === 401 || ack.statusCode === 403) McpClient.throwForStatus(ack);
	}

	/** Send one JSON-RPC request, re-initialising once if the session expired. */
	private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (!this.initialized) await this.initialize();

		for (let attempt = 0; ; attempt++) {
			const id = this.nextId++;
			const hadSession = Boolean(this.sessionId);
			const response = await this.send({
				method: 'POST',
				headers: this.baseHeaders(),
				body: { jsonrpc: '2.0', id, method, params },
			});

			// 404 on a session means the server forgot it and never ran the call,
			// so one re-initialise and one retry is safe even for write tools.
			if (response.statusCode === 404 && hadSession && attempt === 0) {
				await this.initialize();
				continue;
			}

			const message = extractMessage(response, id);
			McpClient.throwForStatus(response, message);
			if (!message?.result) {
				throw new McpError('protocol', `Linkedcamp MCP server sent no result for ${method}.`, {
					httpCode: response.statusCode,
				});
			}
			return message.result;
		}
	}

	/** Call a tool and return its raw result. Throws on `isError`. */
	async callToolRaw(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
		const result = (await this.request('tools/call', { name, arguments: args })) as ToolResult;
		if (result.isError === true) {
			throw new McpError('tool', joinText(result) || `Linkedcamp could not complete "${name}". Check the input values and try again.`);
		}
		return result;
	}

	/** Call a tool and return its parsed output. */
	async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
		return toolOutput(await this.callToolRaw(name, args));
	}

	/** List every tool this key can see. Follows `nextCursor` pagination. */
	async listTools(): Promise<ToolDescriptor[]> {
		const tools: ToolDescriptor[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 50; page++) {
			const result = await this.request('tools/list', cursor ? { cursor } : {});
			tools.push(...((result.tools as ToolDescriptor[] | undefined) ?? []));
			cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
			if (!cursor) break;
		}
		return tools;
	}

	/** End the session on the server, if it issued one. Never throws. */
	async close(): Promise<void> {
		if (!this.sessionId) return;
		try {
			await this.send({ method: 'DELETE', headers: this.baseHeaders() });
		} catch {
			// Best effort; the server expires sessions on its own.
		}
		this.sessionId = undefined;
		this.initialized = false;
	}
}
