/**
 * Dev-only console logging. All calls are no-ops in production builds.
 */
export const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args);
};

export const devWarn = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.warn(...args);
};

export const devError = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.error(...args);
};
