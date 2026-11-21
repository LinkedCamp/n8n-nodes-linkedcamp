/**
 * Account (whoami), Client (agency sub-accounts) and Tool (call any MCP tool).
 */
import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { callTool, compact } from '../transport/mcp';
import { asObject, collectPages, returnAllAndLimit } from '../shared';
import type { HandlerMap } from './types';

/* ================================= Account ================================ */

export const accountOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['account'] } },
	options: [
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve the account behind this API key: plan, role and permissions',
			action: 'Get the account',
		},
	],
	default: 'get',
};

export const accountHandlers: HandlerMap = {
	async get(ctx, client, i) {
		return asObject(await callTool(ctx, client, 'whoami', {}, i));
	},
};

/* ================================= Client ================================= */

export const clientOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['client'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Retrieve a list of client sub-accounts. Needs an account owner key.',
			action: 'Get many clients',
		},
	],
	default: 'getMany',
};

export const clientFields: INodeProperties[] = [
	...returnAllAndLimit({ resource: ['client'], operation: ['getMany'] }, 1000),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['client'], operation: ['getMany'] } },
		options: [
			{
				displayName: 'Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Match on client name or email',
			},
		],
	},
];

export const clientHandlers: HandlerMap = {
	async getMany(ctx, client, i) {
		const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
		const returnAll = ctx.getNodeParameter('returnAll', i, false) as boolean;
		const limit = ctx.getNodeParameter('limit', i, 50) as number;
		return await collectPages(ctx, client, 'subaccount_list', compact({ keyword: filters.keyword }), 'subaccounts', {
			returnAll,
			limit,
			pageSize: returnAll ? 200 : Math.min(200, limit),
			pageSizeArg: 'pageSize',
			i,
		});
	},
};

/* ================================== Tool ================================== */

export const toolOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['tool'] } },
	options: [
		{
			name: 'Call Any Tool',
			value: 'call',
			description: 'Call any Linkedcamp MCP tool by name with JSON arguments. For advanced users.',
			action: 'Call a tool',
		},
	],
	default: 'call',
};

export const toolFields: INodeProperties[] = [
	{
		displayName: 'Tool Name or ID',
		name: 'toolName',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTools' },
		required: true,
		default: '',
		description:
			'The MCP tool to call. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: { resource: ['tool'], operation: ['call'] } },
	},
	{
		displayName: 'Arguments (JSON)',
		name: 'toolArguments',
		type: 'json',
		default: '{}',
		description:
			'Arguments as a JSON object. See the tool list at https://docs.linkedcamp.com/mcp/overview.',
		displayOptions: { show: { resource: ['tool'], operation: ['call'] } },
	},
];

export const toolHandlers: HandlerMap = {
	async call(ctx, client, i) {
		const name = ctx.getNodeParameter('toolName', i) as string;
		const raw = ctx.getNodeParameter('toolArguments', i, '{}') as unknown;
		let args: unknown = raw;
		if (typeof raw === 'string') {
			try {
				args = raw.trim() ? JSON.parse(raw) : {};
			} catch {
				throw new NodeOperationError(ctx.getNode(), "'Arguments (JSON)' is not valid JSON", { itemIndex: i });
			}
		}
		if (typeof args !== 'object' || args === null || Array.isArray(args)) {
			throw new NodeOperationError(ctx.getNode(), "'Arguments (JSON)' must be a JSON object", { itemIndex: i });
		}
		const out = await callTool(ctx, client, name, args as IDataObject, i);
		return typeof out === 'object' && out !== null && !Array.isArray(out)
			? (out as IDataObject)
			: { result: out as IDataObject[] };
	},
};
