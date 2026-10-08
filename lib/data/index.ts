"use client";

/**
 * Client data layer re-exported under one stable name.
 *
 * Route handlers and Server Components no longer import any data module: reads
 * and writes happen in the browser, guarded by Security Rules. This barrel
 * exists so that components import from a single place and so the storage mode
 * can be changed in one file if the architecture ever moves back.
 */

export * from "@/lib/firebase/repositories-client";