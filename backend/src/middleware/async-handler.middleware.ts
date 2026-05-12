import type { Request, RequestHandler } from "express";
import type { AsyncRouteHandler, TypedResponse } from "@/types";

// Eliminates the need for try-catch blocks in async route handlers by automatically catching errors
// and passing them to the global(in this case initialized inside the Server class) error handler.
export function asyncHandler<
  TRequest extends Request = Request,
  TResBody = unknown,
>(fn: AsyncRouteHandler<TRequest, TResBody>): RequestHandler {
  return (req, res, next): void => {
    fn(req as TRequest, res as TypedResponse<TResBody>, next).catch(next);
  };
}
