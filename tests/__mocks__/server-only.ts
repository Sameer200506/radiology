/**
 * Empty stand-in for the `server-only` package.
 *
 * Vitest runs in plain Node, where the real package throws unconditionally.
 * Next.js aliases it to an empty module for server bundles, which is the
 * behaviour being reproduced here.
 */
export {};