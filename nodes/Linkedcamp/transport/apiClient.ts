/**
 * Client for the Linkedcamp REST API v2.
 *
 *   POST https://api.linkedcamp.com/v2/{endpoint}   body: JSON object of arguments
 *   200 → the endpoint's JSON output
 *   4xx/5xx → { "error": { "code", "message", "hint"? } }
 *
 * Docs: https://docs.linkedcamp.com/api-v2/overview
 * Spec: https://api.linkedcamp.com/v2/openapi.json
 *
 * This file has no imports, so it can be unit-tested without n8n or a network.
 * The n8n glue (HTTP helper, credential, error classes) lives in `request.ts`.
 */

export const API_BASE_URL = 'https://api.linkedcamp.com/v2';

export const AUTH_MESSAGE =
	'Linkedcamp rejected the API key. Check it under Settings → Integrations → API.';
export const FORBIDDEN_MESSAGE =
	'Not allowed for this Linkedcamp key (plan, permission, access tier or a server-side block).';

export interface ApiRequest {
	method: 'GET' | 'POST';
	/** Path below the API base, e.g. "/campaign_list". */
	path: string;
	body?: unknown;
}

export interface ApiRawResponse {
	statusCode: number;
	headers: Record<string, unknown>;
	/** Raw text, or an already-parsed object if the HTTP layer parsed it. */
	body: unknown;
}

export type ApiSender = (request: ApiRequest) => Promise<ApiRawResponse>;

/**
 * auth       401: key missing, wrong or rotated
 * forbidden  403: plan, permission or access tier
 * notFound   404: unknown endpoint, or the record does not exist
 * invalid    400 / 413 / 422: the arguments or the request were refused
 * upstream   5xx: Linkedcamp could not complete it right now
 */
export type ApiErrorKind = 'auth' | 'forbidden' | 'notFound' | 'invalid' | 'upstream';

export class LinkedcampApiError extends Error {
	readonly kind: ApiErrorKind;
	readonly httpCode: number;
	readonly code?: string;
	readonly hint?: string;

	constructor(kind: ApiErrorKind, message: string, opts: { httpCode: number; code?: string; hint?: string }) {
		super(message);
		this.name = 'LinkedcampApiError';
		this.kind = kind;
		this.httpCode = opts.httpCode;
		this.code = opts.code;
		this.hint = opts.hint;
	}
}

export interface EndpointInfo {
	name: string;
	description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a response body that may be text, bytes or already-parsed JSON. */
export function parseBody(body: unknown): unknown {
	if (body === undefined || body === null) return undefined;
	if (typeof body === 'string') {
		if (!body.trim()) return undefined;
		try {
			return JSON.parse(body) as unknown;
		} catch {
			return { result: body };
		}
	}
	if (body instanceof Uint8Array) return parseBody(new TextDecoder().decode(body));
	return body;
}

/** Turn a non-2xx response into a typed error with the server's own message. */
export function toApiError(response: ApiRawResponse): LinkedcampApiError {
	const status = response.statusCode;
	const parsed = parseBody(response.body);
	const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
	const code = typeof error.code === 'string' ? error.code : undefined;
	const serverMessage = typeof error.message === 'string' ? error.message.trim() : '';
	const hint = typeof error.hint === 'string' ? error.hint.trim() : undefined;
	const withHint = (message: string) => (hint ? `${message} ${hint}` : message);

	if (status === 401) return new LinkedcampApiError('auth', AUTH_MESSAGE, { httpCode: status, code, hint });
	if (status === 403) {
		const message = serverMessage ? `${FORBIDDEN_MESSAGE} ${serverMessage}` : FORBIDDEN_MESSAGE;
		return new LinkedcampApiError('forbidden', withHint(message), { httpCode: status, code, hint });
	}
	if (status === 404) {
		return new LinkedcampApiError('notFound', withHint(serverMessage || 'Linkedcamp could not find that record.'), {
			httpCode: status,
			code,
			hint,
		});
	}
	if (status >= 500) {
		return new LinkedcampApiError(
			'upstream',
			withHint(serverMessage || `Linkedcamp could not complete the request (HTTP ${status}). Try again shortly.`),
			{ httpCode: status, code, hint },
		);
	}
	return new LinkedcampApiError(
		'invalid',
		withHint(serverMessage || `Linkedcamp refused the request (HTTP ${status}). Check the input values.`),
		{ httpCode: status, code, hint },
	);
}

export class ApiClient {
	private readonly send: ApiSender;

	constructor(send: ApiSender) {
		this.send = send;
	}

	/** Call one endpoint. Never retried: many endpoints write. */
	async call(endpoint: string, args: Record<string, unknown> = {}): Promise<unknown> {
		const response = await this.send({ method: 'POST', path: `/${endpoint}`, body: args });
		if (response.statusCode < 200 || response.statusCode >= 300) throw toApiError(response);
		const output = parseBody(response.body);
		return output === undefined ? {} : output;
	}

	/** Every endpoint in the published OpenAPI description. */
	async listEndpoints(): Promise<EndpointInfo[]> {
		const response = await this.send({ method: 'GET', path: '/openapi.json' });
		if (response.statusCode < 200 || response.statusCode >= 300) throw toApiError(response);
		const spec = parseBody(response.body);
		const paths = isRecord(spec) && isRecord(spec.paths) ? spec.paths : {};
		return Object.entries(paths).map(([path, item]) => {
			const post = isRecord(item) && isRecord(item.post) ? item.post : {};
			const text = typeof post.summary === 'string' ? post.summary : typeof post.description === 'string' ? post.description : '';
			return { name: path.replace(/^\//, ''), description: text };
		});
	}
}
