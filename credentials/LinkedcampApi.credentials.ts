import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class LinkedcampApi implements ICredentialType {
	name = 'linkedcampApi';

	displayName = 'Linkedcamp API';

	icon: Icon = { light: 'file:../nodes/Linkedcamp/linkedcamp.svg', dark: 'file:../nodes/Linkedcamp/linkedcamp.svg' };

	documentationUrl = 'https://docs.linkedcamp.com/api-v2/overview';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Find it in Linkedcamp under Settings → Integrations → API. Needs a plan with Pro features (Pro or Agency) and the Integrations permission.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	/** A wrong, rotated or missing key gets HTTP 401 from `whoami`. */
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.linkedcamp.com/v2',
			url: '/whoami',
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: {},
			json: true,
		},
	};
}
