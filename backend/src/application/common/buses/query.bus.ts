import { IQueryHandler } from "../interfaces/query-handler.interface";
import { IQuery } from "../interfaces/query.interface";
import { Errors } from "@/utils/errors";

export class QueryBus {
	// Stores query handlers, mapping query names to their respective handlers
	private handlers = new Map<string, unknown>();

	/**
	 * Registers a query handler for a specific query type.
	 * @param queryType - The class constructor of the query type.
	 * @param handler - The handler responsible for processing the query.
	 */
	register<TQuery extends IQuery, TResult>(
		queryType: { new (...args: any[]): TQuery },
		handler: IQueryHandler<TQuery, TResult>
	): void {
		this.handlers.set(queryType.name, handler);
	}

	/**
	 * Executes a query by finding its corresponding handler.
	 * @param query - The query instance to be processed.
	 * @returns The result of the query execution.
	 * @throws An error if no handler is found for the query.
	 */
	async execute<TResult>(query: IQuery): Promise<TResult> {
		const handler = this.handlers.get(query.constructor.name) as IQueryHandler<IQuery, TResult> | undefined;

		if (!handler) {
			throw Errors.internal(`No handler found for query ${query.constructor.name}`);
		}

		return handler.execute(query);
	}
}
