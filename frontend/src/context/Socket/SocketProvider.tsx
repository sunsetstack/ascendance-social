import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { SocketContext } from "./SocketContext";
import { useAuth } from "../../hooks/context/useAuth";
import { devError, devWarn } from "@/lib/devLogger";

interface SocketProviderProps {
  children: React.ReactNode;
}
export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { user, isLoggedIn } = useAuth();

  // Avoid re-render every time the socket is set
  const socketRef = useRef<Socket | null>(null);
  const [, setReady] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || !user) return;
    // in production (nginx), use same origin; in dev, use explicit socket URL or API URL
    const base =
      import.meta.env.VITE_SOCKET_URL ||
      import.meta.env.VITE_API_URL ||
      window.location.origin;
    const socketUrl = base.replace(/\/$/, "");

    const socket = io(socketUrl, {
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelayMax: 10000,
    });

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
        socket.connect();
      }
    };
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleError);
    socket.on("disconnect", handleDisconnect);

    // Store and explicitly connect
    socketRef.current = socket;
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
      socket.off("disconnect", handleDisconnect);
      socket.disconnect();
    };
  }, [isLoggedIn, user, user?.publicId]);

  return (
    <SocketContext.Provider value={socketRef.current}>
      {children}
    </SocketContext.Provider>
  );
};
