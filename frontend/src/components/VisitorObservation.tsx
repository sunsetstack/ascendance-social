import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../hooks/context/useAuth";

const MAX_PATH_LENGTH = 2_048;
const MAX_TEXT_LENGTH = 256;
const MAX_LANGUAGES = 10;

let lastObservedLocationKey: string | null = null;

const boundedText = (value: string | undefined, maxLength = MAX_TEXT_LENGTH): string | undefined => {
	if (!value) return undefined;
	return value.slice(0, maxLength);
};

const boundedNumber = (value: number | undefined, maxValue: number): number | undefined => {
	if (value === undefined || !Number.isFinite(value) || value < 0 || value > maxValue) return undefined;
	return value;
};

const boundedInteger = (value: number | undefined, minValue: number, maxValue: number): number | undefined => {
	if (value === undefined || !Number.isInteger(value) || value < minValue || value > maxValue) return undefined;
	return value;
};

const sanitizedPath = (pathname: string): string => {
	const path = pathname.startsWith("/") ? pathname : "/";
	return path.slice(0, MAX_PATH_LENGTH);
};

const sanitizedReferrer = (value: string): string | undefined => {
	if (!value) return undefined;

	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return `${url.protocol}//${url.host}${url.pathname}`.slice(0, MAX_PATH_LENGTH);
	} catch {
		return undefined;
	}
};

const browserTimezone = (): string | undefined => {
	try {
		return boundedText(Intl.DateTimeFormat().resolvedOptions().timeZone, 64);
	} catch {
		return undefined;
	}
};

const sendObservation = (pathname: string): void => {
	const browser = navigator;
	const screenDetails = window.screen;
	const viewport = window.visualViewport;
	const language = boundedText(browser.language, 32);
	const referrer = sanitizedReferrer(document.referrer);
	const platform = boundedText(browser.platform, 64);
	const timezone = browserTimezone();
	const deviceMemory = boundedNumber((browser as Navigator & { deviceMemory?: number }).deviceMemory, 1_024);
	const devicePixelRatio = boundedNumber(window.devicePixelRatio, 100);
	const hardwareConcurrency = boundedNumber(browser.hardwareConcurrency, 256);
	const maxTouchPoints = boundedNumber(browser.maxTouchPoints, 100);
	const languages = (browser.languages ?? []).map((entry) => boundedText(entry, 32)).filter((entry): entry is string => Boolean(entry)).slice(0, MAX_LANGUAGES);
	const screenWidth = boundedInteger(screenDetails?.width, 0, 10_000);
	const screenHeight = boundedInteger(screenDetails?.height, 0, 10_000);
	const screenColorDepth = boundedInteger(screenDetails?.colorDepth, 1, 64);
	const viewportWidth = boundedNumber(viewport?.width ?? window.innerWidth, 10_000);
	const viewportHeight = boundedNumber(viewport?.height ?? window.innerHeight, 10_000);

	const payload = { events: [], visitor: {
		schemaVersion: 1 as const, path: sanitizedPath(pathname), ...(referrer ? { referrer } : {}), ...(language ? { language } : {}), ...(languages.length ? { languages } : {}), ...(platform ? { platform } : {}), ...(timezone ? { timezone } : {}),
		...(screenWidth !== undefined && screenHeight !== undefined && screenColorDepth !== undefined ? { screen: { width: screenWidth, height: screenHeight, colorDepth: screenColorDepth } } : {}),
		...(viewportWidth !== undefined && viewportHeight !== undefined ? { viewport: { width: viewportWidth, height: viewportHeight } } : {}),
		...(devicePixelRatio !== undefined ? { devicePixelRatio } : {}), ...(hardwareConcurrency !== undefined ? { hardwareConcurrency } : {}), ...(deviceMemory !== undefined ? { deviceMemory } : {}), ...(maxTouchPoints !== undefined ? { maxTouchPoints } : {}),
	} };
	void fetch("/api/telemetry", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => undefined);
};

const VisitorObservation = () => {
	const location = useLocation();
	const { isLoggedIn, loading } = useAuth();

	useEffect(() => {
		if (loading || isLoggedIn || lastObservedLocationKey === location.key) return;

		lastObservedLocationKey = location.key;
		sendObservation(location.pathname);
	}, [isLoggedIn, loading, location.key, location.pathname]);

	useEffect(() => {
		if (loading || isLoggedIn) return;
		const onPageShow = (event: PageTransitionEvent): void => {
			if (event.persisted) sendObservation(location.pathname);
		};
		window.addEventListener("pageshow", onPageShow);
		return () => window.removeEventListener("pageshow", onPageShow);
	}, [isLoggedIn, loading, location.pathname]);

	return null;
};

export default VisitorObservation;
