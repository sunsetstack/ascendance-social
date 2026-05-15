import mongoose from "mongoose";
import { MaybePopulatedParticipant, PopulatedSender, IMessageWithPopulatedSender, IMessage } from "@/types";

export function buildParticipantHash(participantIds: string[]): string {
  return participantIds
    .map((id) => id.toString())
    .sort()
    .join(":");
}

export function extractUnreadCounts(
  unreadCounts:
    | Map<string, number>
    | Record<string, number>
    | null
    | undefined,
): Record<string, number> {
  if (!unreadCounts) {
    return {};
  }

  if (unreadCounts instanceof Map) {
    return Object.fromEntries(unreadCounts.entries());
  }

  return unreadCounts;
}

export function extractParticipantId(
  participant: mongoose.Types.ObjectId | MaybePopulatedParticipant,
): string | null {
  if (participant instanceof mongoose.Types.ObjectId) {
    return participant.toString();
  }
  if (typeof participant === "string") {
    return participant;
  }
  if (
    typeof participant === "object" &&
    participant !== null &&
    "_id" in participant
  ) {
    return participant._id?.toString() ?? null;
  }
  return null;
}

export function getParticipantIds(
  participants: (mongoose.Types.ObjectId | MaybePopulatedParticipant)[],
): string[] {
  if (!participants || !Array.isArray(participants)) {
    return [];
  }
  return participants
    .map((p) => extractParticipantId(p))
    .filter((id): id is string => id !== null);
}

export function isPopulatedSender(
  sender: unknown,
): sender is PopulatedSender {
  return (
    typeof sender === "object" &&
    sender !== null &&
    ("publicId" in sender || "username" in sender || "handle" in sender)
  );
}

export function asPopulatedMessage(
  message: IMessage,
): IMessageWithPopulatedSender {
  if (!isPopulatedSender(message.sender)) {
    throw new Error("Message sender is not populated");
  }
  return message as IMessageWithPopulatedSender;
}
