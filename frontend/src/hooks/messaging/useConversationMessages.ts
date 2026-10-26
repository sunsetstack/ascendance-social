import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchConversationMessages } from "../../api/messagingApi";
import { ConversationMessagesResponse } from "@/types";
import { isAxiosError } from "axios";

const DEFAULT_PAGE_SIZE = 50;
const MAX_CACHE_MESSAGES = 240;

export function useConversationMessages(conversationPublicId: string | null, limit: number = DEFAULT_PAGE_SIZE) {
	return useInfiniteQuery<ConversationMessagesResponse>({
		queryKey: ["messaging", "conversation", conversationPublicId, limit],
		enabled: Boolean(conversationPublicId),
		staleTime: 60000,
		retry: (failureCount, error) => {
			if (isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0)) return false;
			return failureCount < 3;
		},
		initialPageParam: 1,
		getNextPageParam: (lastPage) => {
			const nextPage = lastPage.page + 1;
			return nextPage <= lastPage.totalPages ? nextPage : undefined;
		},
		queryFn: ({ pageParam }) =>
			fetchConversationMessages(conversationPublicId as string, { page: (pageParam as number) ?? 1, limit }),
		select: (data) => {
			const totalMessages = data.pages.reduce((count, page) => count + page.messages.length, 0);
			if (totalMessages <= MAX_CACHE_MESSAGES) {
				return data;
			}

			let remaining = MAX_CACHE_MESSAGES;
			const trimmedPages = [...data.pages]
				.reverse()
				.map((page) => {
					if (remaining <= 0) {
						return { ...page, messages: [] };
					}
					if (page.messages.length <= remaining) {
						remaining -= page.messages.length;
						return page;
					}
					const sliceStart = page.messages.length - remaining;
					remaining = 0;
					return { ...page, messages: page.messages.slice(sliceStart) };
				})
				.reverse();

			return {
				...data,
				pages: trimmedPages,
			};
		},
	});
}
