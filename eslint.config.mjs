import { config } from '@n8n/node-cli/eslint';

export default [
	// Tests and dev scripts are not published; they may use Node built-ins.
	{ ignores: ['test/**', 'dev/**'] },
	...config,
];
