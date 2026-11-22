import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { ApiClient } from './transport/apiClient';
import { callApi, createClient, toNodeError } from './transport/request';

/* -------------------------------------------------------------------------- */
/*                               Value helpers                                */
/* -------------------------------------------------------------------------- */

export function asObject(value: unknown): IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as IDataObject) : {};
}

export function asArray(value: unknown): IDataObject[] {
	return Array.isArray(value) ? (value as IDataObject[]) : [];
}

/** Read a resource locator parameter as its plain id. */
export function locatorValue(ctx: IExecuteFunctions, name: string, i: number, fallback = ''): string {
	const value = ctx.getNodeParameter(name, i, fallback, { extractValue: true }) as unknown;
	return typeof value === 'string' ? value.trim() : '';
}

/** Read a locator nested in a collection (e.g. options.campaignId). */
export function nestedLocator(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	const v = asObject(value).value;
	return typeof v === 'string' ? v.trim() : '';
}

/** Turn a key/value fixedCollection into a plain object. */
export function keyValuePairs(value: unknown): IDataObject | undefined {
	const pairs = asArray(asObject(value).field);
	if (!pairs.length) return undefined;
	const out: IDataObject = {};
	for (const pair of pairs) {
		const key = String(pair.key ?? '').trim();
		if (key) out[key] = pair.value as string;
	}
	return Object.keys(out).length ? out : undefined;
}

/** "a, b ,c" → ["a","b","c"] */
export function splitIds(value: unknown): string[] | undefined {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value !== 'string' || !value.trim()) return undefined;
	return value
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Keep only the listed keys, in that order. Used by the Simplify toggles. */
export function pick(record: IDataObject, keys: string[]): IDataObject {
	const out: IDataObject = {};
	for (const key of keys) if (record[key] !== undefined) out[key] = record[key];
	return out;
}

/* -------------------------------------------------------------------------- */
/*                                 Pagination                                 */
/* -------------------------------------------------------------------------- */

/**
 * Collect items from a paged list tool. Linkedcamp list tools answer
 * `{ total, page, <listKey>: [...] }` and take a 1-based `page`.
 */
export async function collectPages(
	ctx: IExecuteFunctions,
	client: ApiClient,
	tool: string,
	args: IDataObject,
	listKey: string,
	opts: { returnAll: boolean; limit: number; pageSize: number; i: number; pageSizeArg?: string },
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	const wanted = opts.returnAll ? Infinity : Math.max(1, opts.limit);
	for (let page = 1; page <= 1000; page++) {
		const callArgs: IDataObject = { ...args, page };
		if (opts.pageSizeArg) callArgs[opts.pageSizeArg] = opts.pageSize;
		const out = asObject(await callApi(ctx, client, tool, callArgs, opts.i));
		const batch = asArray(out[listKey]);
		items.push(...batch);
		const total = typeof out.total === 'number' ? out.total : undefined;
		if (items.length >= wanted) break;
		if (batch.length === 0) break;
		if (total !== undefined) {
			if (items.length >= total) break;
		} else if (batch.length < opts.pageSize) {
			break;
		}
	}
	return opts.returnAll ? items : items.slice(0, wanted);
}

/* -------------------------------------------------------------------------- */
/*                           Shared field builders                            */
/* -------------------------------------------------------------------------- */

type Show = Record<string, string[]>;

export function locatorField(opts: {
	name: string;
	displayName: string;
	searchMethod: string;
	show: Show;
	required?: boolean;
	description?: string;
	idPlaceholder?: string;
}): INodeProperties {
	return {
		displayName: opts.displayName,
		name: opts.name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: opts.required ?? true,
		description: opts.description,
		displayOptions: { show: opts.show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: opts.searchMethod, searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: opts.idPlaceholder ?? 'e.g. 64f1c2a9b7e4d10012ab34cd',
			},
		],
	};
}

/** A locator for use inside a collection (no displayOptions, not required). */
export function optionalLocator(
	name: string,
	displayName: string,
	searchMethod: string,
	description: string,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: searchMethod, searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 64f1c2a9b7e4d10012ab34cd',
			},
		],
	};
}

export function clientLocator(): INodeProperties {
	return optionalLocator(
		'userId',
		'Client',
		'searchClients',
		'Agency accounts only: read this client sub-account instead of your own. Needs an account owner key.',
	);
}

export function returnAllAndLimit(show: Show, maxLimit: number): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: maxLimit },
			default: 50,
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
		},
	];
}

export function simplifyField(show: Show): INodeProperties {
	return {
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: { show },
	};
}

export function dateRangeFields(): INodeProperties[] {
	return [
		{
			displayName: 'From Date',
			name: 'dateFrom',
			type: 'dateTime',
			default: '',
			description: 'Start of the date window',
		},
		{
			displayName: 'To Date',
			name: 'dateTo',
			type: 'dateTime',
			default: '',
			description: 'End of the date window. Defaults to now when only a start is set.',
		},
	];
}

export const customFieldsCollection: INodeProperties = {
	displayName: 'Custom Fields',
	name: 'customFields',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	placeholder: 'Add Custom Field',
	options: [
		{
			displayName: 'Field',
			name: 'field',
			values: [
				{
					displayName: 'Name',
					name: 'key',
					type: 'string',
					default: '',
					placeholder: 'e.g. companySize',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
				},
			],
		},
	],
};

/** Lead statuses accepted by the Linkedcamp API v2 `lead_list` filter. */
export const LEAD_STATUSES = [
	'FOUND',
	'VIEWED',
	'CONNECT_SENT',
	'CONNECTED',
	'FOLLOWUP',
	'MESSAGE_SENT',
	'INMAILS',
	'INMAIL_SENT',
	'REPLIED',
	'WITHDRAWN',
	'INMAIL_CREDIT',
	'FOLLOWED',
	'EMAIL_SENT',
	'OPENED',
	'BOUNCED',
	'CLICKED',
	'UNSUBSCRIBED',
	'FAILED',
	'INVITED',
	'COMPLETED',
	'NOT_QUALIFIED',
	'OUT_OF_OFFICE',
];

export function enumOptions(values: string[]): INodePropertyOptions[] {
	return values
		.map((value) => ({
			name: value
				.toLowerCase()
				.split('_')
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' ')
				.replace(/Inmail/g, 'InMail'),
			value,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/*                          List search (locators)                            */
/* -------------------------------------------------------------------------- */

async function search(
	ctx: ILoadOptionsFunctions,
	tool: string,
	args: IDataObject,
	listKey: string,
	toResult: (item: IDataObject) => { name: string; value: string; url?: string } | undefined,
): Promise<INodeListSearchResult> {
	const client = createClient(ctx);
	try {
		const out = asObject(await client.call(tool, args));
		const results = asArray(out[listKey])
			.map(toResult)
			.filter((r): r is { name: string; value: string; url?: string } => Boolean(r?.value));
		const page = typeof args.page === 'number' ? args.page : 1;
		const total = typeof out.total === 'number' ? out.total : undefined;
		const pageSize = typeof args.pageSize === 'number' ? args.pageSize : 20;
		const more = total !== undefined ? page * pageSize < total : results.length >= pageSize;
		return { results, paginationToken: more && results.length ? String(page + 1) : undefined };
	} catch (error) {
		throw toNodeError(ctx, error);
	}
}

function pageFrom(token?: string): number {
	const n = Number(token);
	return Number.isFinite(n) && n > 1 ? n : 1;
}

export const listSearch = {
	async searchCampaigns(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		return await search(
			this,
			'campaign_list',
			{ keyword: filter || undefined, page: pageFrom(paginationToken) },
			'campaigns',
			(c) => ({
				name: `${String(c.title ?? 'Untitled')}${c.status ? ` (${String(c.status)})` : ''}`,
				value: String(c._id ?? ''),
			}),
		);
	},

	async searchLeads(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		return await search(
			this,
			'lead_list',
			{ keyword: filter || undefined, page: pageFrom(paginationToken), pageSize: 50 },
			'leads',
			(l) => ({
				name: [l.fullName, l.designation].filter(Boolean).join(' · ') || String(l.email ?? l._id ?? ''),
				value: String(l._id ?? ''),
			}),
		);
	},

	async searchConversations(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		return await search(
			this,
			'conversation_list',
			{ keyword: filter || undefined, page: pageFrom(paginationToken) },
			'conversations',
			(c) => ({
				name: [c.fullName, c.subject].filter(Boolean).join(' · ') || String(c._id ?? ''),
				value: String(c._id ?? ''),
			}),
		);
	},

	async searchLinkedinAccounts(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		return await search(
			this,
			'linkedin_account_list',
			{ keyword: filter || undefined },
			'accounts',
			(a) => ({
				name: String(a.fullName ?? a.email ?? a._id ?? ''),
				value: String(a._id ?? ''),
			}),
		);
	},

	async searchClients(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		// Only an account owner may read sub-accounts; say so instead of an empty list.
		const client = createClient(this);
		try {
			const me = asObject(await client.call('whoami', {}));
			if (me.role !== undefined && me.role !== 'OWNER') {
				throw new NodeOperationError(
					this.getNode(),
					'Clients are only available with an account owner key. This key belongs to a team member or client account.',
				);
			}
		} catch (error) {
			throw toNodeError(this, error);
		}
		return await search(
			this,
			'subaccount_list',
			{ keyword: filter || undefined, page: pageFrom(paginationToken), pageSize: 50 },
			'subaccounts',
			(u) => ({
				name: String(u.fullName ?? u.email ?? u._id ?? ''),
				value: String(u._id ?? ''),
			}),
		);
	},
};

export const loadOptions = {
	async getTools(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const client = createClient(this);
		try {
			const tools = await client.listEndpoints();
			return tools
				.map((t) => ({
					name: t.name,
					value: t.name,
					description: (t.description ?? '').split('. ')[0].slice(0, 200),
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch (error) {
			throw toNodeError(this, error);
		}
	},
};
