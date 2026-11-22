import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import type { ApiClient } from './transport/apiClient';
import { compact, createClient, toNodeError } from './transport/request';
import { asArray, asObject, listSearch, nestedLocator, optionalLocator } from './shared';

/** How far back each lead poll reaches before the previous poll, to absorb clock skew. */
const OVERLAP_MS = 5 * 60 * 1000;
/** Window used for a manual first run, so the test has something to show. */
const MANUAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
/** Seen ids kept for dedupe. */
const MAX_SEEN = 5000;
/** Pages read per lead poll (100 leads each). */
const MAX_LEAD_PAGES = 10;

interface PollState {
	seenIds?: string[];
	lastPoll?: number;
}

type EventName = 'newAppointment' | 'newCampaign' | 'newRepliedLead' | 'newConnectedLead';

async function fetchItems(
	client: ApiClient,
	event: EventName,
	window: { from: number; to: number },
	campaignId: string,
): Promise<IDataObject[]> {
	if (event === 'newAppointment') {
		const out = asObject(await client.call('appointment_list', { status: 'CONFIRMED', page: 1 }));
		return asArray(out.appointments);
	}
	if (event === 'newCampaign') {
		const out = asObject(await client.call('campaign_list', { page: 1 }));
		return asArray(out.campaigns);
	}

	// Leads: `range` filters on `updatedAt`, and both ends must be set.
	const status = event === 'newRepliedLead' ? 'REPLIED' : 'CONNECTED';
	const leads: IDataObject[] = [];
	for (let page = 1; page <= MAX_LEAD_PAGES; page++) {
		const out = asObject(
			await client.call(
				'lead_list',
				compact({ status, campaignId, range: window, page, pageSize: 100 }),
			),
		);
		const batch = asArray(out.leads);
		leads.push(...batch);
		const total = typeof out.total === 'number' ? out.total : undefined;
		if (batch.length < 100 || (total !== undefined && leads.length >= total)) break;
	}
	return leads;
}

export class LinkedcampPollTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Linkedcamp Poll Trigger',
		name: 'linkedcampPollTrigger',
		icon: { light: 'file:linkedcamp.svg', dark: 'file:linkedcamp.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when Linkedcamp has new appointments, campaigns, replies or connections',
		defaults: { name: 'Linkedcamp Poll Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'linkedcampApi', required: true }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'newRepliedLead',
				options: [
					{
						name: 'New Appointment Booked',
						value: 'newAppointment',
						description: 'A confirmed appointment appears',
					},
					{
						name: 'New Campaign',
						value: 'newCampaign',
						description: 'A campaign is created',
					},
					{
						name: 'New Connected Lead',
						value: 'newConnectedLead',
						description: 'A lead accepts a connection request',
					},
					{
						name: 'New Replied Lead',
						value: 'newRepliedLead',
						description: 'A lead replies',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { event: ['newRepliedLead', 'newConnectedLead'] } },
				options: [
					optionalLocator('campaignId', 'Campaign', 'searchCampaigns', 'Only leads from this campaign'),
				],
			},
		],
	};

	methods = { listSearch };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as EventName;
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const campaignId = nestedLocator(options.campaignId);
		const state = this.getWorkflowStaticData('node') as PollState;
		const manual = this.getMode() === 'manual';
		const firstRun = state.lastPoll === undefined;
		const now = Date.now();

		const from = firstRun ? now - MANUAL_LOOKBACK_MS : (state.lastPoll as number) - OVERLAP_MS;
		const client = createClient(this);
		let items: IDataObject[];
		try {
			items = await fetchItems(client, event, { from, to: now }, campaignId);
		} catch (error) {
			throw toNodeError(this, error);
		}

		const seen = new Set(state.seenIds ?? []);
		const fresh = items.filter((item) => {
			const id = item._id === undefined || item._id === null ? '' : String(item._id);
			return id !== '' && !seen.has(id);
		});

		if (!manual) {
			const ids = [...(state.seenIds ?? []), ...fresh.map((item) => String(item._id))];
			state.seenIds = ids.slice(-MAX_SEEN);
			state.lastPoll = now;
		}

		if (firstRun && !manual) return null;
		const emit = manual ? items.slice(0, 1) : fresh;
		if (!emit.length) return null;
		return [this.helpers.returnJsonArray(emit)];
	}
}
