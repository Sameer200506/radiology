/**
 * Client-side capability probe.
 *
 * Whether image analysis is available depends on server configuration (which
 * OpenRouter model is set, and whether it supports vision). The browser cannot
 * read those variables, so the truth comes from the server. Until the answer
 * arrives we assume image analysis is NOT available, because over-claiming
 * vision support is the exact failure this product must not have.
 */

import * as React from "react";

import { api } from "@/lib/api/client";

export interface AiCapabilities {
  aiConfigured: boolean;
  visionAvailable: boolean;
  /** Present only when a specific vision model is pinned via env. */
  visionModel: string | null;
  primaryModel: string;
  fallbackModel: string | null;
}

const FALLBACK: AiCapabilities = {
  aiConfigured: false,
  visionAvailable: false,
  visionModel: null,
  primaryModel: "unknown",
  fallbackModel: null,
};

let cached: AiCapabilities | null = null;
let inflight: Promise<AiCapabilities> | null = null;

export function isVisionAnalysisAvailableHint(): boolean {
  return cached?.visionAvailable ?? false;
}

export function getCachedCapabilities(): AiCapabilities | null {
  return cached;
}

export async function fetchCapabilities(): Promise<AiCapabilities> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = api
    .get<AiCapabilities>("/api/ai/capabilities")
    .then((response) => {
      cached = response;
      return response;
    })
    .catch(() => FALLBACK)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Warms the cache on mount so the UI has the truth before the user uploads. */
export function useCapabilities(): AiCapabilities {
  const [capabilities, setCapabilities] = React.useState<AiCapabilities>(cached ?? FALLBACK);

  React.useEffect(() => {
    if (cached) {
      setCapabilities(cached);
      return;
    }
    let active = true;
    void fetchCapabilities().then((result) => {
      if (active) setCapabilities(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return capabilities;
}

export { FALLBACK as DEFAULT_CAPABILITIES };