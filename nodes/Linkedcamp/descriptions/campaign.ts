import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { buildRange, callTool, compact } from '../transport/mcp';
import {
	asObject,
	clientLocator,
	collectPages,
	dateRangeFields,
	locatorField,
	locatorValue,
	nestedLocator,
	optionalLocator,
	pick,
	returnAllAndLimit,
	simplifyField,
} from '../shared';
import type { HandlerMap } from './types';

const show = (operation: string[]) => ({ resource: ['campaign'], operation });

export const campaignOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['campaign'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Create a draft campaign. Nothing is sent until it is launched.',
			action: 'Create a draft campaign',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve one campaign with its settings and sequence',
			action: 'Get a campaign',
		},
		{
			name: 'Get Funnel',
			value: 'getFunnel',
			description: 'Retrieve how many leads reached each stage of a campaign',
			action: 'Get campaign funnel',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Retrieve a list of campaigns',
			action: 'Get many campaigns',
		},
		{
			name: 'Get Stats',
			value: 'getStats',
			description: 'Retrieve performance numbers for one campaign, or for the whole account',
			action: 'Get campaign stats',
		},
		{
			name: 'Launch',
			value: 'launch',
			description:
				'Launch a campaign. This starts sending real connection requests, messages and emails to its leads.',
			action: 'Launch a campaign',
		},
		{
			name: 'Pause or Resume',
			value: 'setStatus',
			description:
				'Pause a running campaign or resume a paused one. Never archives, completes or deletes.',
			action: 'Pause or resume a campaign',
		},
	],
	default: 'getMany',
};

const CAMPAIGN_STATUSES = [
	{ name: 'Active', value: 'ACTIVE' },
	{ name: 'Archived', value: 'ARCHIVED' },
	{ name: 'Completed', value: 'COMPLETED' },
	{ name: 'Deleted', value: 'DELETED' },
	{ name: 'Drafted', value: 'DRAFTED' },
	{ name: 'Failed', value: 'FAILED' },
	{ name: 'Paused', value: 'PAUSED' },
];

export const campaignFields: INodeProperties[] = [
	/* ------------------------------ create ------------------------------ */
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Agency founders, UK',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['create']) },
		options: [
			{
				displayName: 'Source URL',
				name: 'sourceUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://www.linkedin.com/search/results/people/?keywords=founder',
				description:
					'Where the leads come from: a LinkedIn, Sales Navigator or Recruiter search, or a group, event or post URL',
			},
		],
	},

	/* --------------------- campaign locator (required) -------------------- */
	locatorField({
		name: 'campaignId',
		displayName: 'Campaign',
		searchMethod: 'searchCampaigns',
		show: show(['get', 'getFunnel', 'launch', 'setStatus']),
	}),

	/* ------------------------------- get -------------------------------- */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['get']) },
		options: [
			{
				displayName: 'Include Sequence',
				name: 'includeFlow',
				type: 'boolean',
				default: true,
				description: 'Whether to include the campaign sequence (its steps and branches)',
			},
		],
	},

	/* ----------------------------- getMany ------------------------------ */
	...returnAllAndLimit(show(['getMany']), 1000),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getMany']) },
		options: [
			clientLocator(),
			{
				displayName: 'Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Only campaigns whose title matches this text',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'ACTIVE',
				options: CAMPAIGN_STATUSES,
			},
		],
	},
	simplifyField(show(['getMany'])),

	/* ----------------------------- setStatus ---------------------------- */
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		required: true,
		default: 'PAUSED',
		description: 'Resume works only on a paused campaign',
		displayOptions: { show: show(['setStatus']) },
		options: [
			{ name: 'Pause', value: 'PAUSED' },
			{ name: 'Resume', value: 'ACTIVE' },
		],
	},

	/* ------------------------------ launch ------------------------------ */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['launch']) },
		options: [
			{
				displayName: 'Skip Preflight Checks',
				name: 'skipPreflight',
				type: 'boolean',
				default: false,
				description: 'Whether to launch without the readiness checks Linkedcamp runs first',
			},
		],
	},

	/* ----------------------------- getStats ----------------------------- */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getStats']) },
		options: [
			optionalLocator(
				'campaignId',
				'Campaign',
				'searchCampaigns',
				'Leave empty for numbers across the whole account',
			),
			clientLocator(),
			...dateRangeFields(),
			{
				displayName: 'Include Graph',
				name: 'includeGraph',
				type: 'boolean',
				default: false,
				description: 'Whether to include day-by-day series',
			},
		],
	},

	/* ----------------------------- getFunnel ---------------------------- */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getFunnel']) },
		options: [...dateRangeFields()],
	},
];

/** Ten list-view fields kept by Simplify (from the server's campaign selection). */
const SIMPLE_CAMPAIGN = [
	'_id',
	'title',
	'status',
	'type',
	'url',
	'stats',
	'linkedAccountId',
	'launchedAt',
	'createdAt',
	'updatedAt',
];

export const campaignHandlers: HandlerMap = {
	async create(ctx, client, i) {
		const extra = ctx.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const args = compact({ title: ctx.getNodeParameter('title', i) as string, sourceUrl: extra.sourceUrl });
		return asObject(await callTool(ctx, client, 'campaign_create', args, i));
	},

	async get(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({ campaignId: locatorValue(ctx, 'campaignId', i), includeFlow: options.includeFlow });
		return asObject(await callTool(ctx, client, 'campaign_get', args, i));
	},

	async getMany(ctx, client, i) {
		const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
		const args = compact({
			status: filters.status,
			keyword: filters.keyword,
			userId: nestedLocator(filters.userId),
		});
		const items = await collectPages(ctx, client, 'campaign_list', args, 'campaigns', {
			returnAll: ctx.getNodeParameter('returnAll', i, false) as boolean,
			limit: ctx.getNodeParameter('limit', i, 50) as number,
			pageSize: 20,
			i,
		});
		const simplify = ctx.getNodeParameter('simplify', i, true) as boolean;
		return simplify ? items.map((c) => pick(c, SIMPLE_CAMPAIGN)) : items;
	},

	async setStatus(ctx, client, i) {
		const args = {
			campaignId: locatorValue(ctx, 'campaignId', i),
			status: ctx.getNodeParameter('status', i) as string,
		};
		return asObject(await callTool(ctx, client, 'campaign_set_status', args, i));
	},

	async launch(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({ campaignId: locatorValue(ctx, 'campaignId', i), skipPreflight: options.skipPreflight });
		return asObject(await callTool(ctx, client, 'campaign_launch', args, i));
	},

	async getStats(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({
			campaignId: nestedLocator(options.campaignId),
			userId: nestedLocator(options.userId),
			range: buildRange(options.dateFrom, options.dateTo),
			includeGraph: options.includeGraph,
		});
		return asObject(await callTool(ctx, client, 'analytics_campaign', args, i));
	},

	async getFunnel(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({
			campaignId: locatorValue(ctx, 'campaignId', i),
			range: buildRange(options.dateFrom, options.dateTo),
		});
		return asObject(await callTool(ctx, client, 'analytics_campaign_funnel', args, i));
	},
};
