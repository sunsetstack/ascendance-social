import { Document } from "mongoose";

export interface IRequestLog extends Document {
  timestamp: Date;
  metadata: {
    userId?: string;
    method: string;
    route: string;
    ip: string;
    userAgent?: string;
    statusCode: number;
    responseTimeMs: number;
    correlationId?: string;
  };
}
