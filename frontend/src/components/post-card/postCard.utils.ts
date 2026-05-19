export const formatCount = (count: number | undefined): string => {
	if (count === undefined || count === null) {
		return "0";
	}

	if (count >= 1000000) {
		return `${(count / 1000000).toFixed(1)}M`;
	}

	if (count >= 1000) {
		return `${(count / 1000).toFixed(1)}K`;
	}

	return count.toString();
};
