import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { createClient, toNodeError } from './transport/request';
import { LinkedcampApiError } from './transport/apiClient';
import { asArray, asObject, listSearch, nestedLocator, optionalLocator } from './shared';

/**
 * Instant trigger.
 *
 * Linkedcamp delivers events through "automations": a trigger node wired to a
 * WEBHOOK integration node. The legacy REST `/webhooks` endpoints cannot see or
 * switch on these automations, so this node manages its automation through
 * the REST API v2 automation endpoints with the same API key:
 *
 *   subscribe   → automation_upsert (create), then automation_upsert with
 *                 `flow` + `isActive: true` (the update recomputes `sequences`,
 *                 which the event dispatcher matches on)
 *   check       → automation_get on the stored id
 *   unsubscribe → automation_upsert `isActive: false` (there is no delete tool;
 *                 the id is kept and reused on the next activation)
 */

const EVENTS = [
	{ name: 'Connection Accepted', value: 'ACCEPTS_REQUEST', description: 'A lead accepts a connection request' },
	{ name: 'Connection Request Sent', value: 'CONNECT_INVITED', description: 'A connection request is sent to a lead' },
	{ name: 'Email Bounced', value: 'BOUNCED', description: 'An email to a lead bounces' },
	{ name: 'Email Link Clicked', value: 'CLICKED', description: 'A lead clicks a tracked link in an email' },
	{ name: 'Email Opened', value: 'OPENED', description: 'A lead opens an email' },
	{ name: 'Email Sent', value: 'EMAIL_SENT', description: 'An email is sent to a lead' },
	{ name: 'New Reply', value: 'REPLY_DETECTED', description: 'A lead replies on LinkedIn or email' },
	{ name: 'Unsubscribed', value: 'UNSUBSCRIBED', description: 'A lead unsubscribes from emails' },
];

function eventLabel(value: string): string {
	return EVENTS.find((e) => e.value === value)?.name ?? value;
}

/** The automation graph, mirroring what Linkedcamp's own `POST /webhooks` builds. */
function buildFlow(event: string, url: string, campaignId: string): IDataObject {
	const triggerId = 'n8n-trigger';
	const webhookId = 'n8n-webhook';
	const endId = 'n8n-end';
	return {
		nodes: [
			{
				id: triggerId,
				type: 'trigger',
				width: 350,
				height: 84,
				data: { type: event, ...(campaignId ? { campaignId } : {}) },
				position: { x: 0, y: 0 },
				targetPosition: 'top',
				sourcePosition: 'bottom',
			},
			{
				id: webhookId,
				type: 'integration',
				width: 350,
				height: 75,
				data: { type: 'WEBHOOK', url },
				position: { x: 0, y: 120 },
				targetPosition: 'top',
				sourcePosition: 'bottom',
			},
			{
				id: endId,
				type: 'end',
				width: 350,
				height: 52,
				position: { x: 0, y: 240 },
				targetPosition: 'top',
				sourcePosition: 'bottom',
			},
		],
		edges: [
			{ id: `${triggerId}-${webhookId}`, source: triggerId, target: webhookId, type: 'default', animated: false },
			{ id: `${webhookId}-${endId}`, source: webhookId, target: endId, type: 'end', animated: true },
		],
		viewport: { x: 0, y: 0, zoom: 1 },
	};
}

function webhookUrlOf(automation: IDataObject): string | undefined {
	const nodes = asArray(asObject(automation.flow).nodes);
	const node = nodes.find((n) => asObject(n.data).type === 'WEBHOOK');
	const url = asObject(node?.data).url;
	return typeof url === 'string' ? url : undefined;
}

function isNotFound(error: unknown): boolean {
	return error instanceof LinkedcampApiError && error.kind === 'notFound';
}

interface TriggerState {
	automationId?: string;
}

export class LinkedcampTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Linkedcamp Trigger',
		name: 'linkedcampTrigger',
		icon: { light: 'file:linkedcamp.svg', dark: 'file:linkedcamp.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow instantly when a Linkedcamp event happens',
		defaults: { name: 'Linkedcamp Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'linkedcampApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'REPLY_DETECTED',
				options: EVENTS,
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					optionalLocator('campaignId', 'Campaign', 'searchCampaigns', 'Only fire for events from this campaign'),
				],
			},
			{
				displayName:
					'Activating this workflow creates a Linkedcamp automation named "n8n – <event>" that posts each event here. Deactivating it switches that automation off.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};

	methods = { listSearch };

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				if (!state.automationId) return false;
				const client = createClient(this);
				try {
					const automation = asObject(
						await client.call('automation_get', { automationId: state.automationId }),
					);
					if (!automation._id) return false;
					return automation.isActive === true && webhookUrlOf(automation) === this.getNodeWebhookUrl('default');
				} catch (error) {
					if (isNotFound(error)) {
						delete state.automationId;
						return false;
					}
					throw toNodeError(this, error);
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				const event = this.getNodeParameter('event') as string;
				const options = this.getNodeParameter('options', {}) as IDataObject;
				const url = this.getNodeWebhookUrl('default') as string;
				const flow = buildFlow(event, url, nestedLocator(options.campaignId));
				const title = `n8n – ${eventLabel(event)}`;
				const description = `Sends "${eventLabel(event)}" events to an n8n workflow. Managed by the n8n Linkedcamp Trigger node.`;

				const client = createClient(this);
				try {
					let automationId = state.automationId;
					if (!automationId) {
						const created = asObject(
							await client.call('automation_upsert', { title, description, flow, isActive: false }),
						);
						const id = asObject(created.data).automationId;
						if (typeof id !== 'string' || !id) {
							throw new NodeOperationError(this.getNode(), 'Linkedcamp did not return an automation ID. Try activating the workflow again.');
						}
						automationId = id;
						state.automationId = id;
					}
					// The update (with `flow`) is what sets `sequences` and turns it on.
					await client.call('automation_upsert', {
						_id: automationId,
						title,
						description,
						flow,
						isActive: true,
					});
					return true;
				} catch (error) {
					throw toNodeError(this, error);
				}
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as TriggerState;
				if (!state.automationId) return true;
				const event = this.getNodeParameter('event') as string;
				const client = createClient(this);
				try {
					await client.call('automation_upsert', {
						_id: state.automationId,
						title: `n8n – ${eventLabel(event)}`,
						description: `Switched off: the n8n workflow using it was deactivated.`,
						isActive: false,
					});
					return true;
				} catch (error) {
					if (isNotFound(error)) {
						delete state.automationId;
						return true;
					}
					return false;
				}
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		// The payload schema is not documented, so it is passed through unchanged.
		return { workflowData: [this.helpers.returnJsonArray(this.getBodyData())] };
	}
}
