import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

import type { ApiClient } from '../transport/apiClient';

/** Runs one operation for input item `i` and returns zero or more output items. */
export type OperationHandler = (
	ctx: IExecuteFunctions,
	client: ApiClient,
	i: number,
) => Promise<IDataObject | IDataObject[]>;

export type HandlerMap = Record<string, OperationHandler>;
