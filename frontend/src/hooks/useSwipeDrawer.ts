import { useRef, useEffect, useCallback, useState } from "react";

interface SwipeDrawerOptions {
	edgeWidth?: number;
	velocityThreshold?: number;
	minSwipeDistance?: number;
}

interface SwipeDrawerReturn {
	isOpen: boolean;
	open: () => void;
	close: () => void;
	toggle: () => void;
	drawerRef: React.RefObject<HTMLDivElement>;
	backdropRef: React.RefObject<HTMLDivElement>;
	dragOffset: number;
	isDragging: boolean;
}

const DRAWER_WIDTH = 280;

export function useSwipeDrawer(options: SwipeDrawerOptions = {}): SwipeDrawerReturn {
	const {
		// swipe can start from left ~40% of screen
		edgeWidth = 150,
		velocityThreshold = 0.3,
		minSwipeDistance = 30,
	} = options;

	const [isOpen, setIsOpen] = useState(false);
	const [dragOffset, setDragOffset] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const isOpenRef = useRef(isOpen);
	const dragOffsetRef = useRef(dragOffset);
	const isDraggingRef = useRef(isDragging);

	const drawerRef = useRef<HTMLDivElement>(null);
	const backdropRef = useRef<HTMLDivElement>(null);

	// track touch state with refs to avoid stale closure issues
	const touchState = useRef({
		startX: 0,
		startY: 0,
		startTime: 0,
		lastX: 0,
		isTracking: false,
		direction: null as "open" | "close" | null,
	});

	const resetDrag = useCallback(() => {
		dragOffsetRef.current = 0;
		isDraggingRef.current = false;
		setDragOffset(0);
		setIsDragging(false);
	}, []);

	const open = useCallback(() => {
		isOpenRef.current = true;
		setIsOpen(true);
		resetDrag();
	}, [resetDrag]);

	const close = useCallback(() => {
		isOpenRef.current = false;
		setIsOpen(false);
		resetDrag();
	}, [resetDrag]);

	const toggle = useCallback(() => {
		const next = !isOpenRef.current;
		isOpenRef.current = next;
		setIsOpen(next);
		resetDrag();
	}, [resetDrag]);

	useEffect(() => {
		const handleTouchStart = (e: TouchEvent) => {
			const touch = e.touches[0];
			const x = touch.clientX;

			touchState.current = {
				startX: x,
				startY: touch.clientY,
				startTime: Date.now(),
				lastX: x,
				isTracking: false,
				direction: null,
			};

			// determine if we should track this touch
			if (isOpenRef.current) {
				// when open, track any touch to potentially close
				touchState.current.isTracking = true;
				touchState.current.direction = "close";
			} else if (x <= edgeWidth) {
				// when closed, only track touches starting from left zone
				touchState.current.isTracking = true;
				touchState.current.direction = "open";
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (!touchState.current.isTracking) return;

			const touch = e.touches[0];
			const deltaX = touch.clientX - touchState.current.startX;
			const deltaY = touch.clientY - touchState.current.startY;

			// if this is early in the gesture, check if it's more vertical than horizontal
			if (
				!isDraggingRef.current &&
				Math.abs(deltaY) > Math.abs(deltaX) + 10
			) {
				// user is scrolling vertically, abort
				touchState.current.isTracking = false;
				return;
			}

			touchState.current.lastX = touch.clientX;

			const { direction } = touchState.current;

			if (direction === "open") {
				// opening: only respond to rightward movement
				if (deltaX > 10) {
					isDraggingRef.current = true;
					setIsDragging(true);
					const offset = Math.min(DRAWER_WIDTH, Math.max(0, deltaX));
					dragOffsetRef.current = offset;
					setDragOffset(offset);
				}
			} else if (direction === "close") {
				// closing: only respond to leftward movement
				if (deltaX < -10) {
					isDraggingRef.current = true;
					setIsDragging(true);
					const offset = Math.min(0, Math.max(-DRAWER_WIDTH, deltaX));
					dragOffsetRef.current = offset;
					setDragOffset(offset);
				}
			}
		};

		const handleTouchEnd = () => {
			if (!touchState.current.isTracking) return;

			const deltaX = touchState.current.lastX - touchState.current.startX;
			const elapsed = Date.now() - touchState.current.startTime;
			const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
			const isFastSwipe = velocity > velocityThreshold;

			const { direction } = touchState.current;

			if (direction === "open") {
				// check if should open
				const shouldOpen =
					(deltaX > minSwipeDistance && isFastSwipe) ||
					dragOffsetRef.current > DRAWER_WIDTH / 3;
				if (shouldOpen) {
					open();
				} else {
					resetDrag();
				}
			} else if (direction === "close") {
				// check if should close
				const shouldClose =
					(deltaX < -minSwipeDistance && isFastSwipe) ||
					dragOffsetRef.current < -DRAWER_WIDTH / 3;
				if (shouldClose) {
					close();
				} else {
					resetDrag();
				}
			}

			touchState.current.isTracking = false;
			touchState.current.direction = null;
		};

		const handleTouchCancel = () => {
			touchState.current.isTracking = false;
			touchState.current.direction = null;
			resetDrag();
		};

		document.addEventListener("touchstart", handleTouchStart, { passive: true });
		document.addEventListener("touchmove", handleTouchMove, { passive: true });
		document.addEventListener("touchend", handleTouchEnd, { passive: true });
		document.addEventListener("touchcancel", handleTouchCancel, { passive: true });

		return () => {
			document.removeEventListener("touchstart", handleTouchStart);
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("touchend", handleTouchEnd);
			document.removeEventListener("touchcancel", handleTouchCancel);
		};
	}, [
		edgeWidth,
		velocityThreshold,
		minSwipeDistance,
		open,
		close,
		resetDrag,
	]);

	// handle escape key
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isOpen) close();
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, close]);

	// prevent body scroll when open
	useEffect(() => {
		if (!isOpen) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [isOpen]);

	return {
		isOpen,
		open,
		close,
		toggle,
		drawerRef,
		backdropRef,
		dragOffset,
		isDragging,
	};
}
