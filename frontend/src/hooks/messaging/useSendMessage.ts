import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendMessage } from "../../api/messagingApi";
import { SendMessageRequest } from "@/types";

export function useSendMessage() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (payload: SendMessageRequest | FormData) => sendMessage(payload),
		onSuccess: ({ message }) => {
			const conversationId = message.conversationId;

			queryClient.invalidateQueries({ queryKey: ["messaging", "conversations"], exact: false });

			if (conversationId) {
				queryClient.invalidateQueries({
					predicate: (query) => {
						const key = query.queryKey;
						return (
							Array.isArray(key) && key[0] === "messaging" && key[1] === "conversation" && key[2] === conversationId
						);
					},
				});
			}
		},
	});
}
