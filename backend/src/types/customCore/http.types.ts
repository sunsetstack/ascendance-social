import type { NextFunction, Request, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";

/**
 * `TypedRequest` is a workaround for Express's generics, not a solution
 * this is a shape-based cast with a validation invariant, not true end-to-end typing
 * if middleware ever fails to fire the controller's type promises become lies
 * the cast is safe only because the middleware contract holds
 *
 * The mitigation here is integration tests that actually run the full middleware chain
 * not just controller unit tests with mocked requests due to TypedRequest's potential for abuse
 * eg: asyncHandler(async (req: TypedRequest<never, SomeMadeUpBody>, res) => { ... }) - without  a corresponding `ValidationMiddleware` on the route
 *
 */

export type TypedRequest<
  TParams = ParamsDictionary,
  TBody = unknown,
  TQuery = Record<string, unknown>,
  TResBody = unknown,
> = Request<ParamsDictionary, TResBody> & {
  params: TParams;
  body: TBody;
  query: TQuery;
};

export type TypedResponse<TResBody = unknown> = Response<TResBody>;

export type AsyncRouteHandler<
  TRequest extends Request = Request,
  TResBody = unknown,
> = (
  req: TRequest,
  res: TypedResponse<TResBody>,
  next: NextFunction,
) => Promise<void>;
