import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { BottomNavContext } from "./BottomNavContext";

const SCROLL_THRESHOLD = 15;
const SCROLL_UP_MULTIPLIER = 0.5;
const TOUCH_THRESHOLD = 30;

interface BottomNavProviderProps {
	children: ReactNode;
}

export const BottomNavProvider: React.FC<BottomNavProviderProps> = ({ children }) => {
	const location = useLocation();
	const [isVisible, setIsVisible] = useState(true);
	const lastScrollY = useRef(0);
	const accumulatedDelta = useRef(0);
	const touchStartY = useRef(0);
	const isTouching = useRef(false);

	const handleScroll = useCallback(() => {
		const currentScrollY = window.scrollY;
		const delta = currentScrollY - lastScrollY.current;

		if (currentScrollY <= 50) {
			setIsVisible(true);
			accumulatedDelta.current = 0;
			lastScrollY.current = currentScrollY;
			return;
		}

		accumulatedDelta.current += delta;

		if (accumulatedDelta.current > SCROLL_THRESHOLD) {
			setIsVisible(false);
			accumulatedDelta.current = 0;
		} else if (accumulatedDelta.current < -SCROLL_THRESHOLD * SCROLL_UP_MULTIPLIER) {
			setIsVisible(true);
			accumulatedDelta.current = 0;
		}

		lastScrollY.current = currentScrollY;
	}, []);

	const handleTouchStart = useCallback((e: TouchEvent) => {
		touchStartY.current = e.touches[0].clientY;
		isTouching.current = true;
	}, []);

	const handleTouchMove = useCallback((e: TouchEvent) => {
		if (!isTouching.current) return;

		const currentY = e.touches[0].clientY;
		const deltaY = touchStartY.current - currentY;

		if (deltaY > TOUCH_THRESHOLD) {
			setIsVisible(false);
			touchStartY.current = currentY;
		} else if (deltaY < -TOUCH_THRESHOLD) {
			setIsVisible(true);
			touchStartY.current = currentY;
		}
	}, []);

	const handleTouchEnd = useCallback(() => {
		isTouching.current = false;
	}, []);

	useEffect(() => {
		let rafId = 0;

		const onScroll = () => {
			if (rafId) return;

			rafId = requestAnimationFrame(() => {
				handleScroll();
				rafId = 0;
			});
		};

		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("touchstart", handleTouchStart, { passive: true });
		window.addEventListener("touchmove", handleTouchMove, { passive: true });
		window.addEventListener("touchend", handleTouchEnd, { passive: true });

		return () => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("touchstart", handleTouchStart);
			window.removeEventListener("touchmove", handleTouchMove);
			window.removeEventListener("touchend", handleTouchEnd);
			if (rafId) cancelAnimationFrame(rafId);
		};
	}, [handleScroll, handleTouchStart, handleTouchMove, handleTouchEnd]);

	useEffect(() => {
		setIsVisible(true);
		lastScrollY.current = 0;
		accumulatedDelta.current = 0;
	}, [location.pathname]);

	return <BottomNavContext.Provider value={{ isVisible }}>{children}</BottomNavContext.Provider>;
};
