import { IQuery } from "../interfaces/query.interface";
import { Errors } from "@/utils/errors";
import { addRequestContextBreadcrumb } from "@/runtime/request-context";
import type {
	BusHandler,
	BusRequestClass,
	HandledRequest,
	HandledResult,
	HandlerBinding,
	QueryHandlers,
} from "./bus-contracts";

export class QueryBus<THandlers extends BusHandler = QueryHandlers> {
	// Stores query handlers, mapping query names to their respective handlers
	private handlers = new Map<string, BusHandler>();

	private resolveQueryType(
		queryType: BusRequestClass<IQuery>,
	): string {
		if (typeof queryType.type === "string" && queryType.type.length > 0) {
			return queryType.type;
		}

		if (typeof queryType.name === "string" && queryType.name.length > 0) {
			return queryType.name;
		}

		throw Errors.internal("Could not resolve query type for constructor");
	}

	/**
	 * Registers a query handler for a specific query type.
	 * @param queryType - The class constructor of the query type.
	 * @param handler - The handler responsible for processing the query.
	 */
	register(
		...[queryType, handler]: HandlerBinding<THandlers>
	): void {
		this.handlers.set(this.resolveQueryType(queryType), handler);
	}

	/**
	 * Executes a query by finding its corresponding handler.
	 * @param query - The query instance to be processed.
	 * @returns The result of the query execution.
	 * @throws An error if no handler is found for the query.
	 */
	execute<TQuery extends HandledRequest<THandlers>>(
		query: TQuery,
	): Promise<HandledResult<THandlers, TQuery>>;
	async execute(query: IQuery): Promise<unknown> {
		const handler = this.handlers.get(query.type);
		addRequestContextBreadcrumb("cqrs.query.dispatch", {
			operation: query.type,
		});

		if (!handler) {
			throw Errors.internal(`No handler found for query ${query.type}`);
		}

		addRequestContextBreadcrumb("cqrs.query.handler.enter", {
			operation: query.type,
		});
		try {
			return await handler.execute(query);
		} catch (error) {
			addRequestContextBreadcrumb("cqrs.query.handler.failed", {
				operation: query.type,
			});
			throw error;
		}
	}
}
