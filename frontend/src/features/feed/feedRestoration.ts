import { useMemo, useSyncExternalStore } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

interface FeedAnchorCapture {
	feedId: string;
	postId: string;
	top: number;
	sourceLocationKey: string;
}

interface FeedPendingSnapshot {
	hasPending: boolean;
	isUnknown: boolean;
	count: number;
}

interface ActiveFeedPair {
	feedId: string;
	registrations: number;
}

interface FeedPendingState {
	unknown: boolean;
	postIds: Set<string>;
	version: number;
}

type Listener = () => void;

const MAX_KNOWN_PENDING_POSTS = 500;
const EMPTY_PENDING: FeedPendingSnapshot = Object.freeze({
	hasPending: false,
	isUnknown: false,
	count: 0,
});

export const formatNewPostsLabel = (
	pending: FeedPendingSnapshot,
): string => {
	if (pending.isUnknown) return "New posts";
	return pending.count === 1 ? "1 new post" : `${pending.count} new posts`;
};

const pairKey = (feedId: string, locationKey: string): string =>
	`${feedId}\u0000${locationKey}`;

export class FeedRestorationStore {
	private restoration: FeedAnchorCapture | null = null;

	private readonly activePairs = new Map<string, ActiveFeedPair>();

	private readonly pending = new Map<string, FeedPendingState>();

	private readonly listeners = new Set<Listener>();

	private revision = 0;

	private nextPendingVersion = 0;

	readonly subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getRevision = (): number => this.revision;

	captureAnchor = (capture: FeedAnchorCapture): void => {
		if (
			!capture.feedId ||
			!capture.postId ||
			!capture.sourceLocationKey ||
			!Number.isFinite(capture.top)
		) {
			return;
		}

		this.restoration = { ...capture };
		this.pruneOrphanedPending();
		this.emit();
	};

	getRestoration = (
		feedId: string,
		locationKey: string,
	): FeedAnchorCapture | null => {
		if (
			!feedId ||
			!locationKey ||
			!this.restoration ||
			this.restoration.feedId !== feedId ||
			this.restoration.sourceLocationKey !== locationKey
		) {
			return null;
		}

		return this.restoration;
	};

	isRestorationFor = (feedId: string, locationKey: string): boolean =>
		this.getRestoration(feedId, locationKey) !== null;

	consumeRestoration = (feedId: string, locationKey: string): boolean => {
		if (!this.getRestoration(feedId, locationKey)) return false;
		this.restoration = null;
		this.emit();
		return true;
	};

	registerSession = (feedId: string, locationKey: string): (() => void) => {
		if (!feedId || !locationKey) return () => undefined;

		const key = pairKey(feedId, locationKey);
		if (
			this.restoration?.sourceLocationKey === locationKey &&
			this.restoration.feedId !== feedId
		) {
			this.restoration = null;
		}
		const activePair = this.activePairs.get(key);
		if (activePair) {
			activePair.registrations += 1;
		} else {
			this.activePairs.set(key, { feedId, registrations: 1 });
		}
		this.pruneOrphanedPending();
		this.emit();

		let registered = true;
		return () => {
			if (!registered) return;
			registered = false;
			this.unregisterSession(key);
		};
	};

	getPending = (
		feedId: string,
		locationKey: string,
	): FeedPendingSnapshot => {
		if (!feedId || !locationKey) return EMPTY_PENDING;

		const key = pairKey(feedId, locationKey);
		if (!this.activePairs.has(key) && !this.isRestorationFor(feedId, locationKey)) {
			return EMPTY_PENDING;
		}

		const pending = this.pending.get(key);
		if (!pending) return EMPTY_PENDING;
		return {
			hasPending: pending.unknown || pending.postIds.size > 0,
			isUnknown: pending.unknown,
			count: pending.unknown ? 0 : pending.postIds.size,
		};
	};

	getPendingVersion = (feedId: string, locationKey: string): number | null =>
		this.pending.get(pairKey(feedId, locationKey))?.version ?? null;

	markKnownPostPending = (feedId: string, postId: string): void => {
		if (!feedId || !postId) return;

		let changed = false;
		for (const key of this.pendingTargets(feedId)) {
			const pending = this.pending.get(key) ?? {
				unknown: false,
				postIds: new Set<string>(),
				version: 0,
			};
			if (pending.unknown) {
				pending.version = ++this.nextPendingVersion;
				this.pending.set(key, pending);
				changed = true;
				continue;
			}
			if (pending.postIds.has(postId)) continue;

			if (pending.postIds.size >= MAX_KNOWN_PENDING_POSTS) {
				pending.unknown = true;
				pending.postIds.clear();
			} else {
				pending.postIds.add(postId);
			}
			pending.version = ++this.nextPendingVersion;
			this.pending.set(key, pending);
			changed = true;
		}
		if (changed) this.emit();
	};

	markUnknownPostPending = (feedId: string): void => {
		if (!feedId) return;

		let changed = false;
		for (const key of this.pendingTargets(feedId)) {
			const pending = this.pending.get(key) ?? {
				unknown: false,
				postIds: new Set<string>(),
				version: 0,
			};
			pending.unknown = true;
			pending.postIds.clear();
			pending.version = ++this.nextPendingVersion;
			this.pending.set(key, pending);
			changed = true;
		}
		if (changed) this.emit();
	};

	removePendingPost = (postId: string): void => {
		if (!postId) return;

		let changed = false;
		for (const [key, pending] of this.pending) {
			if (pending.unknown || !pending.postIds.delete(postId)) continue;
			changed = true;
			if (pending.postIds.size === 0) {
				this.pending.delete(key);
			} else {
				pending.version = ++this.nextPendingVersion;
			}
		}
		if (changed) this.emit();
	};

	clearPending = (
		feedId: string,
		locationKey: string,
		expectedVersion?: number | null,
	): boolean => {
		const key = pairKey(feedId, locationKey);
		const pending = this.pending.get(key);
		if (!pending) return false;
		if (expectedVersion !== undefined && pending.version !== expectedVersion) {
			return false;
		}
		this.pending.delete(key);
		this.emit();
		return true;
	};

	private pendingTargets = (feedId: string): Set<string> => {
		const targets = new Set<string>();
		if (this.restoration?.feedId === feedId) {
			targets.add(pairKey(feedId, this.restoration.sourceLocationKey));
		}
		for (const [key, activePair] of this.activePairs) {
			if (activePair.feedId === feedId) {
				targets.add(key);
			}
		}
		return targets;
	};

	private unregisterSession = (key: string): void => {
		const activePair = this.activePairs.get(key);
		if (!activePair) return;
		activePair.registrations -= 1;
		if (activePair.registrations === 0) this.activePairs.delete(key);
		this.emit();
	};

	private pruneOrphanedPending = (): void => {
		const restorationKey = this.restoration
			? pairKey(this.restoration.feedId, this.restoration.sourceLocationKey)
			: null;
		for (const key of this.pending.keys()) {
			if (key === restorationKey) continue;
			if (this.activePairs.has(key)) continue;
			this.pending.delete(key);
		}
	};

	private emit = (): void => {
		this.revision += 1;
		for (const listener of this.listeners) listener();
	};
}

export const feedRestorationStore = new FeedRestorationStore();

export const useFeedPending = (
	feedId: string | undefined,
	locationKey: string | undefined,
): FeedPendingSnapshot => {
	useSyncExternalStore(
		feedRestorationStore.subscribe,
		feedRestorationStore.getRevision,
		feedRestorationStore.getRevision,
	);
	if (!feedId || !locationKey) return EMPTY_PENDING;
	return feedRestorationStore.getPending(feedId, locationKey);
};

export const useIsFeedRestoreNavigation = (feedId: string): boolean => {
	const location = useLocation();
	const navigationType = useNavigationType();

	// Keep the initial POP decision stable after Gallery consumes the anchor.
	return useMemo(
		() =>
			Boolean(feedId && location.key) &&
			navigationType === "POP" &&
			feedRestorationStore.isRestorationFor(feedId, location.key),
		[feedId, location.key, navigationType],
	);
};
