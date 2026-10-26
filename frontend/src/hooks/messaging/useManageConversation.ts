import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  manageConversation,
  type ConversationAction,
} from "../../api/messagingApi";

export function useManageConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      action,
    }: {
      conversationId: string;
      action: ConversationAction;
    }) => manageConversation(conversationId, action),
    onSuccess: async (_data, { conversationId, action }) => {
      const queryKey = ["messaging", "conversation", conversationId];
      await queryClient.cancelQueries({ queryKey });
      if (action === "delete" || action === "purge") {
        queryClient.removeQueries({ queryKey });
      } else {
        await queryClient.invalidateQueries({ queryKey });
      }
      await queryClient.invalidateQueries({
        queryKey: ["messaging", "conversations"],
      });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
