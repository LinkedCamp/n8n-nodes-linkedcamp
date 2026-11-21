import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import type { McpClient } from '../transport/mcpClient';

/** Runs one operation for input item `i` and returns zero or more output items. */
export type OperationHandler = (
	ctx: IExecuteFunctions,
	client: McpClient,
	i: number,
) => Promise<IDataObject | IDataObject[]>;

export type HandlerMap = Record<string, OperationHandler>;
