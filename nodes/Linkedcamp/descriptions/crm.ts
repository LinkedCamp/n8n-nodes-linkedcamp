/**
 * Task, Reminder and Appointment: the Linkedcamp CRM tools.
 */
import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { callApi, compact, toEpochMs } from '../transport/request';
import { asObject, collectPages, returnAllAndLimit } from '../shared';
import type { HandlerMap } from './types';

const leadIdField: INodeProperties = {
	displayName: 'Lead ID',
	name: 'leadId',
	type: 'string',
	default: '',
	description: 'Link it to this lead',
};
const conversationIdField: INodeProperties = {
	displayName: 'Conversation ID',
	name: 'conversationId',
	type: 'string',
	default: '',
	description: 'Link it to this conversation',
};

/* ================================== Task ================================== */

export const taskOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['task'] } },
	options: [
		{
			name: 'Create or Update',
			value: 'upsert',
			description: 'Create a new record, or update the current one if it already exists (upsert)',
			action: 'Create or update a task',
		},
	],
	default: 'upsert',
};

export const taskFields: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Send proposal',
		displayOptions: { show: { resource: ['task'], operation: ['upsert'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['task'], operation: ['upsert'] } },
		options: [
			{
				displayName: 'Completed',
				name: 'isCompleted',
				type: 'boolean',
				default: false,
				description: 'Whether the task is done',
			},
			conversationIdField,
			{
				displayName: 'Description',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
			},
			{ displayName: 'Due Date', name: 'date', type: 'dateTime', default: '' },
			leadIdField,
			{
				displayName: 'Link',
				name: 'link',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/deal/42',
			},
			{ displayName: 'Tag', name: 'tag', type: 'string', default: '' },
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				description: 'Set to update an existing task. Leave empty to create a new one.',
			},
		],
	},
];

export const taskHandlers: HandlerMap = {
	async upsert(ctx, client, i) {
		const extra = ctx.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const args = compact({
			title: ctx.getNodeParameter('title', i) as string,
			taskId: extra.taskId,
			content: extra.content,
			leadId: extra.leadId,
			conversationId: extra.conversationId,
			link: extra.link,
			tag: extra.tag,
			date: toEpochMs(extra.date),
			isCompleted: extra.isCompleted,
		});
		return asObject(await callApi(ctx, client, 'task_upsert', args, i));
	},
};

/* ================================ Reminder ================================ */

export const reminderOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['reminder'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Create a reminder',
			action: 'Create a reminder',
		},
	],
	default: 'create',
};

export const reminderFields: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Follow up with Jane',
		displayOptions: { show: { resource: ['reminder'], operation: ['create'] } },
	},
	{
		displayName: 'Remind At',
		name: 'remindAt',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: { show: { resource: ['reminder'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['reminder'], operation: ['create'] } },
		options: [
			conversationIdField,
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
			},
			leadIdField,
			{
				displayName: 'LinkedIn Account ID',
				name: 'linkedAccountId',
				type: 'string',
				default: '',
				description: 'Link it to this LinkedIn account',
			},
		],
	},
];

export const reminderHandlers: HandlerMap = {
	async create(ctx, client, i) {
		const extra = ctx.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const args = compact({
			title: ctx.getNodeParameter('title', i) as string,
			remindAt: toEpochMs(ctx.getNodeParameter('remindAt', i)),
			description: extra.description,
			leadId: extra.leadId,
			conversationId: extra.conversationId,
			linkedAccountId: extra.linkedAccountId,
		});
		return asObject(await callApi(ctx, client, 'reminder_create', args, i));
	},
};

/* =============================== Appointment ============================== */

export const appointmentOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['appointment'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getMany',
			description: 'Retrieve a list of booked appointments',
			action: 'Get many appointments',
		},
	],
	default: 'getMany',
};

export const appointmentFields: INodeProperties[] = [
	...returnAllAndLimit({ resource: ['appointment'], operation: ['getMany'] }, 1000),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['appointment'], operation: ['getMany'] } },
		options: [
			conversationIdField,
			leadIdField,
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'CONFIRMED',
				options: [
					{ name: 'Cancelled', value: 'CANCELLED' },
					{ name: 'Completed', value: 'COMPLETED' },
					{ name: 'Confirmed', value: 'CONFIRMED' },
					{ name: 'No Show', value: 'NO_SHOW' },
					{ name: 'Rescheduled', value: 'RESCHEDULED' },
				],
			},
		],
	},
];

export const appointmentHandlers: HandlerMap = {
	async getMany(ctx, client, i) {
		const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
		const args = compact({ leadId: filters.leadId, conversationId: filters.conversationId, status: filters.status });
		return await collectPages(ctx, client, 'appointment_list', args, 'appointments', {
			returnAll: ctx.getNodeParameter('returnAll', i, false) as boolean,
			limit: ctx.getNodeParameter('limit', i, 50) as number,
			pageSize: 20,
			i,
		});
	},
};
