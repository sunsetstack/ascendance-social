import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../context/useSocket";
import { MessagingUpdatePayload, MessageDTO, ConversationMessagesResponse } from "../../types";
import type { InfiniteData } from "@tanstack/react-query";
import { useAuth } from "../context/useAuth";

type MessageSentPayload = Extract<MessagingUpdatePayload, { type: "message_sent" }>;
type MessageStatusPayload = Extract<MessagingUpdatePayload, { type: "message_status_updated" }>;

function hasMessagingUpdateBaseFields(
	value: unknown,
): value is { type: unknown; conversationId: string; timestamp: string } {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.conversationId === "string" && typeof candidate.timestamp === "string";
}

function isMessageSentPayload(value: unknown): value is MessageSentPayload {
	if (!hasMessagingUpdateBaseFields(value)) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return candidate.type === "message_sent" && typeof candidate.senderId === "string";
}

function isMessageStatusPayload(value: unknown): value is MessageStatusPayload {
	if (!hasMessagingUpdateBaseFields(value)) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		candidate.type === "message_status_updated" &&
		(candidate.status === "delivered" || candidate.status === "read")
	);
}

function isMessagingUpdatePayload(value: unknown): value is MessagingUpdatePayload {
	return isMessageSentPayload(value) || isMessageStatusPayload(value);
}

export const useMessagingSocketIntegration = (): void => {
	const socket = useSocket();
	const queryClient = useQueryClient();
	const { user } = useAuth();

	useEffect(() => {
		if (!socket) return;

		const handleMessagingUpdate = (payload: unknown) => {
			if (!isMessagingUpdatePayload(payload)) return;

			const { conversationId } = payload;

			queryClient.invalidateQueries({ queryKey: ["messaging", "conversations"], exact: false });
			if (conversationId) {
				if (payload.type === "message_status_updated") {
					const { status } = payload;
					queryClient.setQueriesData<InfiniteData<ConversationMessagesResponse>>(
						{ queryKey: ["messaging", "conversation", conversationId], exact: false },
						(existing) => {
							if (!existing) return existing;

							const updatedPages = existing.pages.map((page) => ({
								...page,
								messages: page.messages.map((message: MessageDTO) => {
									if (message.status === "read") return message;
									if (status === "read") {
										return { ...message, status: "read" as const };
									}
									if (status === "delivered" && message.status === "sent") {
										return { ...message, status: "delivered" as const };
									}
									return message;
								}),
							}));

							return { ...existing, pages: updatedPages };
						},
					);
					return;
				}

				if (payload.senderId !== user?.publicId) {
					queryClient.invalidateQueries({
						predicate: (query) => {
							const key = query.queryKey;
							return (
								Array.isArray(key) &&
								key[0] === "messaging" &&
								key[1] === "conversation" &&
								key[2] === conversationId
							);
						},
					});

					queryClient.refetchQueries({
						predicate: (query) => {
							const key = query.queryKey;
							return (
								Array.isArray(key) &&
								key[0] === "messaging" &&
								key[1] === "conversation" &&
								key[2] === conversationId
							);
						},
						type: "active",
					});
				}
			}
		};

		socket.on("messaging_update", handleMessagingUpdate);

		return () => {
			socket.off("messaging_update", handleMessagingUpdate);
		};
	}, [socket, queryClient, user?.publicId]);
};
