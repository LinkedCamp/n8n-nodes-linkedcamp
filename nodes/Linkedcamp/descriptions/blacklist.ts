import type { INodeProperties } from 'n8n-workflow';

import { callApi } from '../transport/request';
import { asObject, locatorField, locatorValue } from '../shared';
import type { HandlerMap } from './types';

const show = (operation: string[]) => ({ resource: ['blacklist'], operation });

export const blacklistOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['blacklist'] } },
	options: [
		{
			name: 'Add Entry',
			value: 'addEntry',
			description: 'Add a profile, company, keyword, job title or email to a LinkedIn account blacklist',
			action: 'Add an entry to the blacklist',
		},
	],
	default: 'addEntry',
};

export const blacklistFields: INodeProperties[] = [
	locatorField({
		name: 'linkedAccountId',
		displayName: 'LinkedIn Account',
		searchMethod: 'searchLinkedinAccounts',
		show: show(['addEntry']),
	}),
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		required: true,
		default: 'PROFILE_URL',
		displayOptions: { show: show(['addEntry']) },
		options: [
			{ name: 'Company URL', value: 'COMPANY_URL' },
			{ name: 'Email', value: 'EMAIL' },
			{ name: 'Job Title', value: 'JOB_TITLE' },
			{ name: 'Keyword', value: 'KEYWORD' },
			{ name: 'LinkedIn Profile URL', value: 'PROFILE_URL' },
		],
	},
	{
		displayName: 'Value',
		name: 'keyword',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. https://www.linkedin.com/in/jane-doe',
		description: 'The profile URL, company URL, keyword, job title or email to block',
		displayOptions: { show: show(['addEntry']) },
	},
];

export const blacklistHandlers: HandlerMap = {
	async addEntry(ctx, client, i) {
		const args = {
			linkedAccountId: locatorValue(ctx, 'linkedAccountId', i),
			type: ctx.getNodeParameter('type', i) as string,
			keyword: ctx.getNodeParameter('keyword', i) as string,
		};
		return asObject(await callApi(ctx, client, 'blacklist_add', args, i));
	},
};
