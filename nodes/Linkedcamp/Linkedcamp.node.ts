import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { createClient, toNodeError } from './transport/request';
import { listSearch, loadOptions } from './shared';
import type { HandlerMap } from './descriptions/types';
import { accountHandlers, accountOperations, clientFields, clientHandlers, clientOperations, toolFields, toolHandlers, toolOperations } from './descriptions/account';
import { blacklistFields, blacklistHandlers, blacklistOperations } from './descriptions/blacklist';
import { campaignFields, campaignHandlers, campaignOperations } from './descriptions/campaign';
import { conversationFields, conversationHandlers, conversationOperations } from './descriptions/conversation';
import {
	appointmentFields,
	appointmentHandlers,
	appointmentOperations,
	reminderFields,
	reminderHandlers,
	reminderOperations,
	taskFields,
	taskHandlers,
	taskOperations,
} from './descriptions/crm';
import { leadFields, leadHandlers, leadOperations } from './descriptions/lead';
import { tagFields, tagHandlers, tagOperations } from './descriptions/tag';

const HANDLERS: Record<string, HandlerMap> = {
	account: accountHandlers,
	appointment: appointmentHandlers,
	blacklist: blacklistHandlers,
	campaign: campaignHandlers,
	client: clientHandlers,
	conversation: conversationHandlers,
	lead: leadHandlers,
	reminder: reminderHandlers,
	tag: tagHandlers,
	task: taskHandlers,
	tool: toolHandlers,
};

export class Linkedcamp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Linkedcamp',
		name: 'linkedcamp',
		icon: { light: 'file:linkedcamp.svg', dark: 'file:linkedcamp.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Run Linkedcamp LinkedIn and email outreach: campaigns, leads, inbox replies and AI agents',
		defaults: { name: 'Linkedcamp' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'linkedcampApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Appointment', value: 'appointment' },
					{ name: 'Blacklist', value: 'blacklist' },
					{ name: 'Campaign', value: 'campaign' },
					{ name: 'Client', value: 'client', description: 'Client sub-accounts of an agency' },
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Lead', value: 'lead' },
					{ name: 'Reminder', value: 'reminder' },
					{ name: 'Tag', value: 'tag' },
					{ name: 'Task', value: 'task' },
					{ name: 'Tool', value: 'tool', description: 'Call any Linkedcamp API v2 endpoint' },
				],
				default: 'lead',
			},
			accountOperations,
			appointmentOperations,
			...appointmentFields,
			blacklistOperations,
			...blacklistFields,
			campaignOperations,
			...campaignFields,
			clientOperations,
			...clientFields,
			conversationOperations,
			...conversationFields,
			leadOperations,
			...leadFields,
			reminderOperations,
			...reminderFields,
			tagOperations,
			...tagFields,
			taskOperations,
			...taskFields,
			toolOperations,
			...toolFields,
		],
	};

	methods = { listSearch, loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const client = createClient(this);

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const handler = HANDLERS[resource]?.[operation];
				if (!handler) {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const result = await handler(this, client, i);
				const rows: IDataObject[] = Array.isArray(result) ? result : [result];
				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(rows), {
						itemData: { item: i },
					}),
				);

				// "Add Many to Campaign" from input items uploads every item in one call.
				if (
					resource === 'lead' &&
					operation === 'addManyToCampaign' &&
					this.getNodeParameter('rowsSource', i, 'items') === 'items'
				) {
					break;
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw toNodeError(this, error, i);
			}
		}

		return [returnData];
	}
}
