import type { NewForensicOperationalErrorRecord } from "@/types";

/**
 * Phase A's application-level append-only boundary. Database-enforced
 * immutability requires a separately permissioned Mongo credential.
 */
export interface IForensicOperationalErrorWriter {
  append(record: NewForensicOperationalErrorRecord): Promise<void>;
}
