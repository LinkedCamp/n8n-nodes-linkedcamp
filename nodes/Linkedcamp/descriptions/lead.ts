import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { buildRange, callTool, compact } from '../transport/mcp';
import {
	asArray,
	asObject,
	collectPages,
	customFieldsCollection,
	dateRangeFields,
	enumOptions,
	keyValuePairs,
	LEAD_STATUSES,
	locatorField,
	locatorValue,
	nestedLocator,
	optionalLocator,
	pick,
	returnAllAndLimit,
	simplifyField,
	splitIds,
} from '../shared';
import type { HandlerMap } from './types';

const show = (operation: string[]) => ({ resource: ['lead'], operation });

export const leadOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['lead'] } },
	options: [
		{
			name: 'Add Many to Campaign',
			value: 'addManyToCampaign',
			description:
				'Upload a list of leads into a campaign that is not running yet. Rows without a LinkedIn URL or email are skipped.',
			action: 'Add many leads to a campaign',
		},
		{
			name: 'Add Note',
			value: 'addNote',
			description: 'Add an internal note to a lead. Notes are never sent to the lead.',
			action: 'Add a note to a lead',
		},
		{
			name: 'Add to Blacklist',
			value: 'addToBlacklist',
			description:
				'Blacklist a lead permanently across the whole account. No campaign will contact them again.',
			action: 'Add a lead to the blacklist',
		},
		{
			name: 'Add to Campaign',
			value: 'addToCampaign',
			description: 'Add one lead to a campaign by LinkedIn Profile URL or email',
			action: 'Add a lead to a campaign',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve one lead with its activity',
			action: 'Get a lead',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Retrieve a list of leads',
			action: 'Get many leads',
		},
		{
			name: 'Update',
			value: 'update',
			description: 'Update the details or flags of a lead',
			action: 'Update a lead',
		},
	],
	default: 'addToCampaign',
};

const UPLOAD_TARGETS = [
	{ name: 'Custom Variable (Merge Field)', value: 'customVariable' },
	{ name: 'Email', value: 'email' },
	{ name: 'First Name', value: 'firstName' },
	{ name: 'Full Name', value: 'fullName' },
	{ name: 'Last Name', value: 'lastName' },
	{ name: 'LinkedIn Profile URL', value: 'profileUrl' },
	{ name: 'Personalization', value: 'personalization' },
	{ name: 'Phone', value: 'phone' },
	{ name: 'Recruiter URL', value: 'recruiterUrl' },
	{ name: 'Sales Navigator URL', value: 'salesNavUrl' },
	{ name: 'Website', value: 'website' },
];

const leadDetailFields: INodeProperties[] = [
	{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'e.g. jane@example.com', default: '' },
	{ displayName: 'First Name', name: 'firstName', type: 'string', default: '', placeholder: 'e.g. Jane' },
	{ displayName: 'Job Title', name: 'designation', type: 'string', default: '', placeholder: 'e.g. Head of Growth' },
	{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '', placeholder: 'e.g. Doe' },
	{
		displayName: 'Personalization',
		name: 'personalization',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'Text available to the sequence as a merge field',
	},
	{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
	{ displayName: 'Website', name: 'website', type: 'string', default: '', placeholder: 'e.g. https://example.com' },
];

export const leadFields: INodeProperties[] = [
	/* ---------------------------- campaign ----------------------------- */
	locatorField({
		name: 'campaignId',
		displayName: 'Campaign',
		searchMethod: 'searchCampaigns',
		show: show(['addToCampaign', 'addManyToCampaign']),
	}),

	/* -------------------------- addToCampaign -------------------------- */
	{
		displayName: 'LinkedIn Profile URL',
		name: 'profileLink',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://www.linkedin.com/in/jane-doe',
		description: 'Required unless an email is given',
		displayOptions: { show: show(['addToCampaign']) },
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		default: '',
		placeholder: 'e.g. jane@example.com',
		description: 'Required unless a LinkedIn Profile URL is given',
		displayOptions: { show: show(['addToCampaign']) },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['addToCampaign']) },
		options: [
			customFieldsCollection,
			{ displayName: 'First Name', name: 'firstName', type: 'string', default: '', placeholder: 'e.g. Jane' },
			{ displayName: 'Full Name', name: 'fullName', type: 'string', default: '', placeholder: 'e.g. Jane Doe' },
			{ displayName: 'Job Title', name: 'designation', type: 'string', default: '', placeholder: 'e.g. Head of Growth' },
			{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '', placeholder: 'e.g. Doe' },
			{ displayName: 'Location', name: 'location', type: 'string', default: '', placeholder: 'e.g. London, United Kingdom' },
			{
				displayName: 'Personalization',
				name: 'personalization',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Text available to the sequence as a merge field',
			},
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
			{
				displayName: 'Recruiter URL',
				name: 'recruiterLink',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://www.linkedin.com/talent/profile/AEMAA...',
			},
			{
				displayName: 'Sales Navigator URL',
				name: 'salesNavLink',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://www.linkedin.com/sales/lead/ACwAA...',
			},
			{ displayName: 'Website', name: 'website', type: 'string', default: '', placeholder: 'e.g. https://example.com' },
		],
	},

	/* ------------------------ addManyToCampaign ------------------------ */
	{
		displayName: 'Rows Source',
		name: 'rowsSource',
		type: 'options',
		default: 'items',
		displayOptions: { show: show(['addManyToCampaign']) },
		options: [
			{
				name: 'Input Items',
				value: 'items',
				description: 'Use every input item as one row and upload them in a single call',
			},
			{
				name: 'JSON',
				value: 'json',
				description: 'Give the rows as a JSON array of objects',
			},
		],
	},
	{
		displayName: 'Rows (JSON)',
		name: 'rowsJson',
		type: 'json',
		default: '[]',
		required: true,
		description: 'Array of row objects keyed by the column names mapped below (max 5,000 rows)',
		displayOptions: { show: { ...show(['addManyToCampaign']), rowsSource: ['json'] } },
	},
	{
		displayName: 'Column Mapping',
		name: 'header',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		required: true,
		default: {},
		placeholder: 'Add Column',
		description: 'Map each column in the rows to a Linkedcamp field',
		displayOptions: { show: show(['addManyToCampaign']) },
		options: [
			{
				displayName: 'Column',
				name: 'column',
				values: [
					{
						displayName: 'Column Name',
						name: 'name',
						type: 'string',
						default: '',
						placeholder: 'e.g. linkedin_url',
					},
					{
						displayName: 'Linkedcamp Field',
						name: 'field',
						type: 'options',
						default: 'profileUrl',
						options: UPLOAD_TARGETS,
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['addManyToCampaign']) },
		options: [
			{
				displayName: 'Remove Duplicates',
				name: 'removeDuplicates',
				type: 'boolean',
				default: true,
				description: 'Whether to skip leads already in another active or paused campaign on this account',
			},
		],
	},

	/* ------------------------------ lead id ------------------------------ */
	locatorField({
		name: 'leadId',
		displayName: 'Lead',
		searchMethod: 'searchLeads',
		show: show(['get', 'update', 'addNote', 'addToBlacklist']),
	}),

	/* -------------------------------- get -------------------------------- */
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['get']) },
		options: [
			{
				displayName: 'Include Activities',
				name: 'includeActivities',
				type: 'boolean',
				default: true,
				description: 'Whether to include the sequence steps already run for this lead',
			},
			{
				displayName: 'Include Messages',
				name: 'includeMessages',
				type: 'boolean',
				default: false,
				description: 'Whether to include the conversation messages',
			},
		],
	},

	/* ------------------------------ getMany ------------------------------ */
	...returnAllAndLimit(show(['getMany']), 1000),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getMany']) },
		options: [
			optionalLocator('campaignId', 'Campaign', 'searchCampaigns', 'Leave empty to search all campaigns'),
			...dateRangeFields(),
			{
				displayName: 'Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Match on name, email or company',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'REPLIED',
				options: enumOptions(LEAD_STATUSES),
			},
			{
				displayName: 'Tag IDs',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'e.g. 64f1c2a9b7e4d10012ab34cd, 64f1c2a9b7e4d10012ab34ce',
				description: 'Comma-separated tag IDs (from Tag → Get Many)',
			},
		],
	},
	simplifyField(show(['getMany'])),

	/* ------------------------------- update ------------------------------ */
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['update']) },
		options: ([
			customFieldsCollection,
			...leadDetailFields,
			{
				displayName: 'Excluded',
				name: 'isExcluded',
				type: 'boolean',
				default: false,
				description: 'Whether the lead is excluded from the campaign',
			},
			{
				displayName: 'Interested',
				name: 'isInterested',
				type: 'boolean',
				default: false,
				description: 'Whether the lead is marked as interested',
			},
			{
				displayName: 'Paused',
				name: 'paused',
				type: 'boolean',
				default: false,
				description: 'Whether the sequence is paused for this lead',
			},
			{
				displayName: 'Seen',
				name: 'seen',
				type: 'boolean',
				default: false,
				description: 'Whether the lead is marked as seen',
			},
		] as INodeProperties[]).sort((a, b) => a.displayName.localeCompare(b.displayName)),
	},

	/* ------------------------------- addNote ----------------------------- */
	{
		displayName: 'Note',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Internal note. It is never sent to the lead.',
		displayOptions: { show: show(['addNote']) },
	},
];

/** Ten list-view fields kept by Simplify (from the server's lead selection). */
const SIMPLE_LEAD = [
	'_id',
	'fullName',
	'designation',
	'location',
	'email',
	'profileLink',
	'status',
	'tags',
	'repliedAt',
	'updatedAt',
];

export const leadHandlers: HandlerMap = {
	async addToCampaign(ctx, client, i) {
		const profileLink = (ctx.getNodeParameter('profileLink', i, '') as string).trim();
		const email = (ctx.getNodeParameter('email', i, '') as string).trim();
		if (!profileLink && !email) {
			throw new NodeOperationError(ctx.getNode(), "Set 'LinkedIn Profile URL' or 'Email' to add a lead", {
				itemIndex: i,
			});
		}
		const extra = ctx.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const args = compact({
			campaignId: locatorValue(ctx, 'campaignId', i),
			profileLink,
			email,
			firstName: extra.firstName,
			lastName: extra.lastName,
			fullName: extra.fullName,
			designation: extra.designation,
			location: extra.location,
			phone: extra.phone,
			website: extra.website,
			salesNavLink: extra.salesNavLink,
			recruiterLink: extra.recruiterLink,
			personalization: extra.personalization,
			customFields: keyValuePairs(extra.customFields),
		});
		return asObject(await callTool(ctx, client, 'lead_add', args, i));
	},

	async addManyToCampaign(ctx, client, i) {
		const columns = asArray(asObject(ctx.getNodeParameter('header', i, {})).column);
		const header: IDataObject = {};
		for (const c of columns) {
			const name = String(c.name ?? '').trim();
			if (name) header[name] = c.field as string;
		}
		if (!Object.keys(header).length) {
			throw new NodeOperationError(ctx.getNode(), "Add at least one entry under 'Column Mapping'", {
				itemIndex: i,
			});
		}

		const source = ctx.getNodeParameter('rowsSource', i, 'items') as string;
		let rows: IDataObject[];
		if (source === 'json') {
			const raw = ctx.getNodeParameter('rowsJson', i, '[]') as unknown;
			const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
			if (!Array.isArray(parsed)) {
				throw new NodeOperationError(ctx.getNode(), "'Rows (JSON)' must be an array of objects", {
					itemIndex: i,
				});
			}
			rows = parsed as IDataObject[];
		} else {
			rows = ctx.getInputData().map((item) => item.json);
		}
		if (rows.length > 5000) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Linkedcamp accepts at most 5,000 rows per upload; got ${rows.length}. Split the list with a Loop Over Items node.`,
				{ itemIndex: i },
			);
		}

		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({
			campaignId: locatorValue(ctx, 'campaignId', i),
			header,
			leads: rows,
			removeDuplicates: options.removeDuplicates,
		});
		return asObject(await callTool(ctx, client, 'campaign_upload_leads', args, i));
	},

	async get(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({
			leadId: locatorValue(ctx, 'leadId', i),
			includeActivities: options.includeActivities,
			includeMessages: options.includeMessages,
		});
		return asObject(await callTool(ctx, client, 'lead_get', args, i));
	},

	async getMany(ctx, client, i) {
		const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
		const returnAll = ctx.getNodeParameter('returnAll', i, false) as boolean;
		const limit = ctx.getNodeParameter('limit', i, 50) as number;
		const args = compact({
			campaignId: nestedLocator(filters.campaignId),
			keyword: filters.keyword,
			status: filters.status,
			tags: splitIds(filters.tags),
			range: buildRange(filters.dateFrom, filters.dateTo),
		});
		const items = await collectPages(ctx, client, 'lead_list', args, 'leads', {
			returnAll,
			limit,
			pageSize: returnAll ? 100 : Math.min(100, limit),
			pageSizeArg: 'pageSize',
			i,
		});
		const simplify = ctx.getNodeParameter('simplify', i, true) as boolean;
		return simplify ? items.map((l) => pick(l, SIMPLE_LEAD)) : items;
	},

	async update(ctx, client, i) {
		const fields = ctx.getNodeParameter('updateFields', i, {}) as IDataObject;
		const { customFields, ...rest } = fields;
		const args = compact({
			leadId: locatorValue(ctx, 'leadId', i),
			...rest,
			customFields: keyValuePairs(customFields),
		});
		return asObject(await callTool(ctx, client, 'lead_update', args, i));
	},

	async addNote(ctx, client, i) {
		const args = {
			leadId: locatorValue(ctx, 'leadId', i),
			content: ctx.getNodeParameter('content', i) as string,
		};
		return asObject(await callTool(ctx, client, 'lead_note_add', args, i));
	},

	async addToBlacklist(ctx, client, i) {
		const args = { leadId: locatorValue(ctx, 'leadId', i) };
		return asObject(await callTool(ctx, client, 'lead_blacklist', args, i));
	},
};
