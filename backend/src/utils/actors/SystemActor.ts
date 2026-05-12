/**
 * @pattern Null Object
 *
 * Canonical identity for system-generated actions (IP monitoring alerts,
 * automated notifications, etc.).  Centralises the magic strings that were
 * previously duplicated across NotificationService and IpMonitorWorker.
 */
export const SystemActor = Object.freeze({
  id: "system-monitor",
  username: "System Monitor",
  handle: "system",
  avatar:
    process.env.SYSTEM_ACTOR_AVATAR ??
    "https://res.cloudinary.com/dfyqaqnj7/image/upload/v1737562142/defaultAvatar_evsmmj.jpg",
} as const);
