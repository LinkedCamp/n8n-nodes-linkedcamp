import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { callTool, compact } from '../transport/mcp';
import { asArray, asObject, clientLocator, nestedLocator, returnAllAndLimit } from '../shared';
import type { HandlerMap } from './types';

const show = (operation: string[]) => ({ resource: ['tag'], operation });

export const tagOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['tag'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Create a reply tag',
			action: 'Create a tag',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Retrieve a list of tags',
			action: 'Get many tags',
		},
	],
	default: 'getMany',
};

export const tagFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'content',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Meeting booked',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'Interest',
		name: 'interest',
		type: 'options',
		required: true,
		default: 'POSITIVE',
		displayOptions: { show: show(['create']) },
		options: [
			{ name: 'Negative', value: 'NEGATIVE' },
			{ name: 'Neutral', value: 'NEUTRAL' },
			{ name: 'Positive', value: 'POSITIVE' },
		],
	},
	...returnAllAndLimit(show(['getMany']), 1000),
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getMany']) },
		options: [clientLocator()],
	},
];

export const tagHandlers: HandlerMap = {
	async create(ctx, client, i) {
		const args = {
			content: ctx.getNodeParameter('content', i) as string,
			interest: ctx.getNodeParameter('interest', i) as string,
		};
		return asObject(await callTool(ctx, client, 'tag_create', args, i));
	},

	async getMany(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const out = asObject(
			await callTool(ctx, client, 'tag_list', compact({ userId: nestedLocator(options.userId) }), i),
		);
		const tags = asArray(out.tags);
		const returnAll = ctx.getNodeParameter('returnAll', i, false) as boolean;
		return returnAll ? tags : tags.slice(0, ctx.getNodeParameter('limit', i, 50) as number);
	},
};
