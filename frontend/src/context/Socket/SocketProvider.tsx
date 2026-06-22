import { useEffect, useState, useRef } from "react";
import type { Socket } from "socket.io-client";
import { SocketContext } from "./SocketContext";
import { useAuth } from "../../hooks/context/useAuth";
import { devError, devWarn } from "@/lib/devLogger";

interface SocketProviderProps {
  children: React.ReactNode;
}
export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { user, isLoggedIn } = useAuth();
  const userId = user?.publicId;

  // Avoid re-render every time the socket is set
  const socketRef = useRef<Socket | null>(null);
  const [, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !userId) return;

    let cancelled = false;
    let socket: Socket | null = null;

    // Connect
    const handleConnect = () => {
      setReady(true);
    };

    // Error
    const handleError = (err: Error) => {
      devError("Socket connection error:", err);
    };

    // Disconnect
    const handleDisconnect = (reason: string) => {
      devWarn("Socket disconnected:", reason);
      if (reason === "io server disconnect") {
        socketRef.current?.connect();
      }
    };

    const connectSocket = async (): Promise<void> => {
      const { io } = await import("socket.io-client");
      if (cancelled) return;

      // in production (nginx), use same origin; in dev, use explicit socket URL or API URL
      const base =
        import.meta.env.VITE_SOCKET_URL ||
        import.meta.env.VITE_API_URL ||
        window.location.origin;
      const socketUrl = base.replace(/\/$/, "");

      socket = io(socketUrl, {
        path: "/socket.io",
        withCredentials: true,
        transports: ["websocket", "polling"],
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelayMax: 10000,
      });

      socket.on("connect", handleConnect);
      socket.on("connect_error", handleError);
      socket.on("disconnect", handleDisconnect);

      // Store and explicitly connect
      socketRef.current = socket;
      socket.connect();
    };

    void connectSocket();

    return () => {
      cancelled = true;
      setReady(false);
      if (!socket) return;
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
      socket.off("disconnect", handleDisconnect);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [isLoggedIn, userId]);

  return (
    <SocketContext.Provider value={socketRef.current}>
      {children}
    </SocketContext.Provider>
  );
};
