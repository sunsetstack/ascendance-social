interface LogEvidenceMetadata {
  userId?: string;
  authState?: string;
}

export function isUnauthenticatedEvidence(
  metadata: LogEvidenceMetadata,
): boolean {
  return !metadata.userId && metadata.authState !== "authenticated";
}

export function buildUnauthenticatedEvidenceFilter(): Record<string, unknown> {
  return {
    $and: [
      {
        $or: [
          { "metadata.userId": { $exists: false } },
          { "metadata.userId": null },
          { "metadata.userId": "" },
        ],
      },
      { "metadata.authState": { $ne: "authenticated" } },
    ],
  };
}
