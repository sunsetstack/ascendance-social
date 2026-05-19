import { createContext, useContext } from "react";

export interface BottomNavContextData {
	isVisible: boolean;
}

export const BottomNavContext = createContext<BottomNavContextData>({
	isVisible: true,
});

export const useBottomNav = () => useContext(BottomNavContext);
