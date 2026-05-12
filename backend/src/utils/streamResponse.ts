import { Response } from "express";

/**
 * Options for streaming JSON responses
 */
export interface StreamResponseOptions {
  /** Initial data to send before streaming begins (e.g., metadata) */
  prelude?: Record<string, unknown>;
  /** Key name for the array being streamed (default: "data") */
  arrayKey?: string;
  /** Whether to include a total count after streaming (default: false) */
  includeTotal?: boolean;
}

/**
 * Safely write to response, checking if connection is still open.
 * Returns false if write failed (client disconnected).
 */
function safeWrite(res: Response, data: string): boolean {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  try {
    res.write(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stream a paginated response with cursor-based pagination.
 * Efficiently streams large arrays without buffering entire response in memory.
 *
 * @example
 * ```typescript
 * // In controller:
 * const result = await repository.findWithCursor(limit, cursor);
 * streamCursorResponse(res, result.data, {
 *   hasMore: result.hasMore,
 *   nextCursor: result.nextCursor,
 * });
 * ```
 */
export function streamCursorResponse<T>(
  res: Response,
  data: T[],
  pagination: { hasMore: boolean; nextCursor?: string },
  options: StreamResponseOptions = {},
): void {
  const { arrayKey = "data" } = options;

  // Build response structure for small responses or fallback
  const buildFullResponse = (): Record<string, unknown> => {
    const response: Record<string, unknown> = {
      hasMore: pagination.hasMore,
      [arrayKey]: data,
    };
    if (pagination.nextCursor) {
      response.nextCursor = pagination.nextCursor;
    }
    return response;
  };

  // For small responses, just send directly (streaming overhead not worth it)
  if (data.length < 100) {
    res.json(buildFullResponse());
    return;
  }

  // Set headers for streaming
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    // Start JSON object
    if (!safeWrite(res, "{")) return;

    // Write pagination metadata first (use JSON.stringify to escape special chars)
    if (!safeWrite(res, `"hasMore":${JSON.stringify(pagination.hasMore)}`))
      return;
    if (pagination.nextCursor) {
      if (
        !safeWrite(
          res,
          `,"nextCursor":${JSON.stringify(pagination.nextCursor)}`,
        )
      )
        return;
    }

    // Start the data array
    if (!safeWrite(res, `,"${arrayKey}":[`)) return;

    // Stream each item
    for (let i = 0; i < data.length; i++) {
      const json = JSON.stringify(data[i]);
      const chunk = i > 0 ? "," + json : json;
      if (!safeWrite(res, chunk)) return;
    }

    // Close array and object
    safeWrite(res, "]}");
  } catch (error) {
    // If we havent started writing, we can still send a proper error
    // If we have then the response is already corrupted so we just end it
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to serialize response" });
      return;
    }
    //to close the JSON structure
    try {
      res.write("]}");
    } catch {
      //connection probablky closed
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Stream a paginated response with traditional pagination.
 * Efficiently streams large arrays without buffering entire response in memory.
 *
 * @example
 * ```typescript
 * // In controller:
 * const result = await repository.findWithPagination(options);
 * streamPaginatedResponse(res, result.data, {
 *   total: result.total,
 *   page: result.page,
 *   limit: result.limit,
 *   totalPages: result.totalPages,
 * });
 * ```
 */
export function streamPaginatedResponse<T>(
  res: Response,
  data: T[],
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  },
  options: StreamResponseOptions = {},
): void {
  const { arrayKey = "data" } = options;

  // For small responses, just send directly
  if (data.length < 100) {
    const response: Record<string, unknown> = {
      ...pagination,
      [arrayKey]: data,
    };
    res.json(response);
    return;
  }

  // Set headers for streaming
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  try {
    // Start JSON object
    if (!safeWrite(res, "{")) return;

    // Write pagination metadata first
    if (!safeWrite(res, `"total":${pagination.total}`)) return;
    if (!safeWrite(res, `,"page":${pagination.page}`)) return;
    if (!safeWrite(res, `,"limit":${pagination.limit}`)) return;
    if (!safeWrite(res, `,"totalPages":${pagination.totalPages}`)) return;

    // Start the data array
    if (!safeWrite(res, `,"${arrayKey}":[`)) return;

    // Stream each item
    for (let i = 0; i < data.length; i++) {
      const json = JSON.stringify(data[i]);
      const chunk = i > 0 ? "," + json : json;
      if (!safeWrite(res, chunk)) return;
    }

    // Close array and object
    safeWrite(res, "]}");
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to serialize response" });
      return;
    }
    try {
      res.write("]}");
    } catch {
      // Ignore
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Stream data from an async generator to the response.
 * Useful for streaming database cursors or other async data sources.
 *
 * @example
 * ```typescript
 * // Stream logs from database cursor
 * const generator = repository.streamLogsByDateRange(startDate, endDate);
 * await streamFromGenerator(res, generator);
 * ```
 */
export async function streamFromGenerator<T>(
  res: Response,
  generator: AsyncGenerator<T[], void, unknown>,
  options: StreamResponseOptions = {},
): Promise<void> {
  const { arrayKey = "data" } = options;

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  let isFirst = true;
  let totalCount = 0;
  let aborted = false;

  // Handle client disconnect
  res.on("close", () => {
    aborted = true;
  });

  try {
    // Start JSON object and array
    if (!safeWrite(res, `{"${arrayKey}":[`)) return;

    for await (const batch of generator) {
      if (aborted) break;

      for (const item of batch) {
        if (aborted) break;

        const json = JSON.stringify(item);
        const chunk = isFirst ? json : "," + json;
        if (!safeWrite(res, chunk)) {
          aborted = true;
          break;
        }
        isFirst = false;
        totalCount++;
      }
    }

    if (!aborted) {
      // Close array
      safeWrite(res, "]");

      // Add total if requested
      if (options.includeTotal) {
        safeWrite(res, `,"total":${totalCount}`);
      }

      // Close object
      safeWrite(res, "}");
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream response" });
      return;
    }
    // Try to close gracefully
    try {
      res.write("]}");
    } catch {
      // Ignore
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
