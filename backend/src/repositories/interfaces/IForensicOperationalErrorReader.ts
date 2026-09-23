import type { ForensicOperationalErrorRecord } from "@/types";

/**
 * Closed-day read access used only by forensic archive sealing. Keeping this
 * separate from the writer permits a dedicated read-only sealer credential.
 */
export interface IForensicOperationalErrorReader {
  findRecordedBetween(
    start: Date,
    end: Date,
  ): Promise<readonly ForensicOperationalErrorRecord[]>;
}
