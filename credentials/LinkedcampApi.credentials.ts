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

	documentationUrl = 'https://docs.linkedcamp.com/mcp/quickstart';

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

	/**
	 * The MCP server accepts any well-formed key at `initialize`, so the test
	 * calls the read-only `whoami` tool instead: a wrong key comes back as
	 * `result.isError: true` (HTTP 200), a missing or malformed one as HTTP 401.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://mcp.linkedcamp.com',
			url: '/mcp',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2025-06-18',
			},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: { name: 'whoami', arguments: {} },
			},
			json: true,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'result.isError',
					value: true,
					message: 'Linkedcamp did not accept this API key. Copy it again from Settings → Integrations → API.',
				},
			},
		],
	};
}
