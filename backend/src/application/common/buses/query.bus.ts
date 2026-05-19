import { IQueryHandler } from "../interfaces/query-handler.interface";
import { IQuery } from "../interfaces/query.interface";
import { Errors } from "@/utils/errors";

type QueryClass<TQuery extends IQuery> = {
	new (...args: any[]): TQuery;
	readonly type?: TQuery["type"];
};

export class QueryBus {
	// Stores query handlers, mapping query names to their respective handlers
	private handlers = new Map<string, unknown>();

	private resolveQueryType<TQuery extends IQuery>(
		queryType: QueryClass<TQuery>,
	): TQuery["type"] {
		if (typeof queryType.type === "string" && queryType.type.length > 0) {
			return queryType.type;
		}

		if (typeof queryType.name === "string" && queryType.name.length > 0) {
			return queryType.name as TQuery["type"];
		}

		throw Errors.internal("Could not resolve query type for constructor");
	}

	/**
	 * Registers a query handler for a specific query type.
	 * @param queryType - The class constructor of the query type.
	 * @param handler - The handler responsible for processing the query.
	 */
	register<TQuery extends IQuery, TResult>(
		queryType: QueryClass<TQuery>,
		handler: IQueryHandler<TQuery, TResult>
	): void {
		this.handlers.set(this.resolveQueryType(queryType), handler);
	}

	/**
	 * Executes a query by finding its corresponding handler.
	 * @param query - The query instance to be processed.
	 * @returns The result of the query execution.
	 * @throws An error if no handler is found for the query.
	 */
	async execute<TResult>(query: IQuery): Promise<TResult> {
		const handler = this.handlers.get(query.type) as IQueryHandler<IQuery, TResult> | undefined;

		if (!handler) {
			throw Errors.internal(`No handler found for query ${query.type}`);
		}

		return handler.execute(query);
	}
}
