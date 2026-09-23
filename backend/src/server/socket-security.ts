import type { Server as SocketIOServer } from "socket.io";
import type { DecodedUser } from "@/types";

type SessionValidator = (user: DecodedUser) => Promise<void>;
type SecuredSocket = {
  data: { user?: DecodedUser; authenticated?: boolean };
  disconnect(close?: boolean): unknown;
};

const validators = new WeakMap<SocketIOServer, SessionValidator>();
const AUTH_TIMEOUT_MS = 5000;

export function registerSocketSessionValidator(
  io: SocketIOServer,
  validate: SessionValidator,
): void {
  validators.set(io, validate);
}

export async function assertSocketSession(
  io: SocketIOServer,
  user: DecodedUser,
): Promise<void> {
  const validate = validators.get(io);
  if (!validate) throw new Error("Socket authentication is unavailable");

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      validate(user),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Socket authentication timed out"));
        }, AUTH_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
    if (typeof user.exp !== "number" || !Number.isFinite(user.exp) ||
      user.exp * 1000 <= Date.now()) {
      throw new Error("Socket session expired");
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function validateSocketSession(
  io: SocketIOServer,
  socket: SecuredSocket,
): Promise<boolean> {
  try {
    if (!socket.data.authenticated || !socket.data.user) {
      throw new Error("Socket is not authenticated");
    }
    await assertSocketSession(io, socket.data.user);
    return socket.data.authenticated === true;
  } catch {
    socket.data.authenticated = false;
    socket.disconnect(true);
    return false;
  }
}

export async function emitToAuthenticatedUser(
  io: SocketIOServer,
  userPublicId: string,
  event: string,
  ...args: unknown[]
): Promise<void> {
  const sockets = await io.in(userPublicId).fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      if (
        socket.data.user?.publicId === userPublicId &&
        await validateSocketSession(io, socket)
      ) {
        socket.emit(event, ...args);
      }
    }),
  );
}

export async function broadcastToAuthenticatedSockets(
  io: SocketIOServer,
  event: string,
  ...args: unknown[]
): Promise<void> {
  const sockets = await io.fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      if (await validateSocketSession(io, socket)) socket.emit(event, ...args);
    }),
  );
}
