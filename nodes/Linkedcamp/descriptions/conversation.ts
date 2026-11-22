import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { callApi, compact } from '../transport/request';
import {
	asObject,
	collectPages,
	locatorField,
	locatorValue,
	nestedLocator,
	optionalLocator,
	pick,
	returnAllAndLimit,
	simplifyField,
} from '../shared';
import type { HandlerMap } from './types';

const show = (operation: string[]) => ({ resource: ['conversation'], operation });

export const conversationOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['conversation'] } },
	options: [
		{
			name: 'Draft AI Reply',
			value: 'draftAiReply',
			description:
				'Write a suggested reply with an AI provider connected in Linkedcamp. Nothing is sent.',
			action: 'Draft an AI reply in a conversation',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve one conversation with its messages. This marks the thread as read in Linkedcamp.',
			action: 'Get a conversation',
		},
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Retrieve a list of conversations from the unified inbox',
			action: 'Get many conversations',
		},
		{
			name: 'Send Message',
			value: 'sendMessage',
			description:
				'Send a message to the lead on LinkedIn or email. It is delivered immediately and cannot be recalled.',
			action: 'Send a message in a conversation',
		},
		{
			name: 'Update',
			value: 'update',
			description: 'Archive, mark as read, or hand the conversation between the AI agent and a human',
			action: 'Update a conversation',
		},
	],
	default: 'getMany',
};

export const conversationFields: INodeProperties[] = [
	locatorField({
		name: 'conversationId',
		displayName: 'Conversation',
		searchMethod: 'searchConversations',
		show: show(['get', 'update', 'sendMessage', 'draftAiReply']),
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
				displayName: 'Include Messages',
				name: 'includeMessages',
				type: 'boolean',
				default: true,
				description: 'Whether to include the messages in the thread',
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
			optionalLocator('campaignId', 'Campaign', 'searchCampaigns', 'Only conversations from this campaign'),
			{
				displayName: 'Email Account ID',
				name: 'emailAccountId',
				type: 'string',
				default: '',
				description: 'Only conversations on this connected mailbox',
			},
			{
				displayName: 'Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Match on the lead name or message text',
			},
			optionalLocator(
				'linkedAccountId',
				'LinkedIn Account',
				'searchLinkedinAccounts',
				'Only conversations on this LinkedIn account',
			),
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'string',
				default: '',
				placeholder: 'e.g. linkedin',
				description: 'Channel to filter by, for example linkedin or email',
			},
			{
				displayName: 'Tag IDs',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'e.g. 64f1c2a9b7e4d10012ab34cd, 64f1c2a9b7e4d10012ab34ce',
				description: 'Comma-separated tag IDs (from Tag → Get Many)',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'string',
				default: '',
				description: 'Inbox view to filter by, as named in Linkedcamp',
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
		options: [
			{
				displayName: 'AI Agent Active',
				name: 'assistant',
				type: 'boolean',
				default: true,
				description: 'Whether the AI agent handles this conversation. Turn off to hand it to a human.',
			},
			{
				displayName: 'Archived',
				name: 'isArchived',
				type: 'boolean',
				default: false,
				description: 'Whether the conversation is archived',
			},
			{
				displayName: 'Pause AI on Manual Message',
				name: 'pauseBotOnManualMessage',
				type: 'boolean',
				default: true,
				description: 'Whether the AI agent pauses after someone replies by hand',
			},
			{
				displayName: 'Seen',
				name: 'seen',
				type: 'boolean',
				default: true,
				description: 'Whether the conversation is marked as read',
			},
		],
	},

	/* ---------------------------- sendMessage ---------------------------- */
	{
		displayName: 'Message',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'Delivered immediately to a real person and cannot be recalled',
		displayOptions: { show: show(['sendMessage']) },
	},
	{
		displayName: 'Attachment',
		name: 'attachment',
		type: 'collection',
		placeholder: 'Add Attachment Field',
		default: {},
		displayOptions: { show: show(['sendMessage']) },
		options: [
			{
				displayName: 'File Name',
				name: 'name',
				type: 'string',
				default: '',
				placeholder: 'e.g. proposal.pdf',
			},
			{
				displayName: 'File Type',
				name: 'type',
				type: 'string',
				default: '',
				placeholder: 'e.g. application/pdf',
			},
			{
				displayName: 'File URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/proposal.pdf',
				description: 'Public URL of the file. Required to send an attachment.',
			},
		],
	},

	/* ---------------------------- draftAiReply --------------------------- */
	{
		displayName: 'AI Provider',
		name: 'provider',
		type: 'options',
		required: true,
		default: 'OPENAI',
		description: 'The provider must be connected in Linkedcamp',
		displayOptions: { show: show(['draftAiReply']) },
		options: [
			{ name: 'Anthropic', value: 'ANTHROPIC' },
			{ name: 'DeepSeek', value: 'DEEPSEEK' },
			{ name: 'Gemini', value: 'GEMINI' },
			{ name: 'Grok', value: 'GROK' },
			{ name: 'OpenAI', value: 'OPENAI' },
		],
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		placeholder: 'e.g. Reply politely and suggest a call next week',
		displayOptions: { show: show(['draftAiReply']) },
	},
];

/** Ten list-view fields kept by Simplify (from the server's conversation selection). */
const SIMPLE_CONVERSATION = [
	'_id',
	'type',
	'fullName',
	'headline',
	'profileLink',
	'lastMsg',
	'lastMessageAt',
	'seen',
	'isArchived',
	'leadId',
];

export const conversationHandlers: HandlerMap = {
	async get(ctx, client, i) {
		const options = ctx.getNodeParameter('options', i, {}) as IDataObject;
		const args = compact({
			conversationId: locatorValue(ctx, 'conversationId', i),
			includeMessages: options.includeMessages,
		});
		return asObject(await callApi(ctx, client, 'conversation_get', args, i));
	},

	async getMany(ctx, client, i) {
		const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
		const args = compact({
			campaignId: nestedLocator(filters.campaignId),
			linkedAccountId: nestedLocator(filters.linkedAccountId),
			emailAccountId: filters.emailAccountId,
			keyword: filters.keyword,
			platform: filters.platform,
			type: filters.type,
			tags: typeof filters.tags === 'string' ? filters.tags.replace(/\s+/g, '') : undefined,
		});
		const items = await collectPages(ctx, client, 'conversation_list', args, 'conversations', {
			returnAll: ctx.getNodeParameter('returnAll', i, false) as boolean,
			limit: ctx.getNodeParameter('limit', i, 50) as number,
			pageSize: 20,
			i,
		});
		const simplify = ctx.getNodeParameter('simplify', i, true) as boolean;
		return simplify ? items.map((c) => pick(c, SIMPLE_CONVERSATION)) : items;
	},

	async update(ctx, client, i) {
		const fields = ctx.getNodeParameter('updateFields', i, {}) as IDataObject;
		const args = compact({ conversationId: locatorValue(ctx, 'conversationId', i), ...fields });
		return asObject(await callApi(ctx, client, 'conversation_update', args, i));
	},

	async sendMessage(ctx, client, i) {
		const attachment = ctx.getNodeParameter('attachment', i, {}) as IDataObject;
		const args = compact({
			conversationId: locatorValue(ctx, 'conversationId', i),
			content: ctx.getNodeParameter('content', i) as string,
			attachment: attachment.url ? compact({ url: attachment.url, name: attachment.name, type: attachment.type }) : undefined,
		});
		return asObject(await callApi(ctx, client, 'message_send', args, i));
	},

	async draftAiReply(ctx, client, i) {
		const args = {
			conversationId: locatorValue(ctx, 'conversationId', i),
			provider: ctx.getNodeParameter('provider', i) as string,
			prompt: ctx.getNodeParameter('prompt', i) as string,
		};
		return asObject(await callApi(ctx, client, 'message_draft_ai_reply', args, i));
	},
};
