"use client";

import * as React from "react";
import {
  CircleCheck,
  ExternalLink,
  Link2Off,
  Loader2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/components/auth/auth-provider";
import { clearCapabilitiesCache } from "@/components/medical/vision-note";
import { api, errorMessage } from "@/lib/api/client";

interface ChatGptStatus {
  configured: boolean;
  available: boolean;
  reason: string | null;
  clientId: string;
  connected: boolean;
  email: string | null;
  name: string | null;
  planUsage: boolean;
  model: string | null;
  visionModel: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
}

const RESULT_MESSAGES: Record<string, string> = {
  connected: "ChatGPT connected. AI analysis for your account will use your ChatGPT plan.",
  denied: "ChatGPT connection was cancelled.",
  plan_not_granted:
    "ChatGPT connected, but plan usage was not approved. Reconnect and approve the plan-usage permission.",
  unavailable: "ChatGPT connection is not enabled on this deployment.",
  error: "ChatGPT could not be connected. Please try again.",
};

const REASON_MESSAGES: Record<string, string> = {
  access_denied: "ChatGPT connection was cancelled.",
  state_invalid: "That sign-in attempt expired. Please start again.",
  code_expired: "The sign-in code expired. Please start again.",
  registration_incomplete: "OpenAI did not finish registering this app. Please try again.",
  client_mismatch: "That sign-in response belonged to a different app registration.",
  verification_failed: "OpenAI's sign-in response could not be verified. Please try again.",
  no_identity: "OpenAI did not return an account identity. Please try again.",
  exchange_failed: "OpenAI could not complete the token exchange. Please try again.",
  handoff_failed: "The connection could not be completed in this browser. Please try again.",
  rate_limited: "Too many attempts. Please wait a minute and try again.",
  oauth_error: "OpenAI reported an error during sign-in. Please try again.",
};

function accountLabel(status: ChatGptStatus): string {
  return status.name?.trim() || status.email?.trim() || "ChatGPT account";
}

export function ChatGptConnection() {
  const { user, ready } = useAuth();
  const [status, setStatus] = React.useState<ChatGptStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const handledResult = React.useRef(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.get<ChatGptStatus>("/api/ai/connection/chatgpt");
      setStatus(result);
    } catch (error) {
      setLoadError(errorMessage(error, "Could not check your ChatGPT connection."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!ready || !user) return;
    void load();
  }, [load, ready, user]);

  React.useEffect(() => {
    if (handledResult.current) return;

    const params = new URLSearchParams(window.location.search);
    const result = params.get("chatgpt");
    if (!result) return;

    handledResult.current = true;
    const reason = params.get("reason") ?? "";

    if (result === "connected") {
      toast.success(RESULT_MESSAGES.connected);
    } else if (result === "plan_not_granted") {
      toast.error(RESULT_MESSAGES.plan_not_granted);
    } else if (result === "unavailable") {
      toast.error(RESULT_MESSAGES.unavailable);
    } else if (result === "denied") {
      toast.error(RESULT_MESSAGES.denied);
    } else {
      toast.error(REASON_MESSAGES[reason] ?? RESULT_MESSAGES.error ?? "ChatGPT could not be connected.");
    }

    params.delete("chatgpt");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
    void load();
  }, [load]);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await api.delete("/api/ai/connection/chatgpt");
      setConfirmOpen(false);
      toast.success("ChatGPT disconnected. This account will use the deployment's AI again.");
      clearCapabilitiesCache();
      window.location.reload();
    } catch (error) {
      toast.error(errorMessage(error, "ChatGPT could not be disconnected."));
      setDisconnecting(false);
    }
  };

  if (loading && !status) {
    return (
      <Card variant="glass" padding="md">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your ChatGPT connection…
        </div>
      </Card>
    );
  }

  if (loadError && !status) {
    return (
      <Card variant="glass" padding="md">
        <div className="flex items-start gap-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-ink">ChatGPT account</h2>
            <p className="mt-1 text-sm text-muted">{loadError}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!status) return null;

  return (
    <>
      <Card variant="glass" padding="md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-2xl border border-brand/20 bg-brand/10 text-brand">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ink">ChatGPT account</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
                Connect your ChatGPT Plus or Pro account to run this app&apos;s AI analysis on your
                own plan instead of the deployment&apos;s shared AI key.
              </p>
            </div>
          </div>

          {status.connected ? (
            <Badge tone="good" size="sm">
              <CircleCheck className="size-3" aria-hidden="true" />
              Connected
            </Badge>
          ) : null}
        </div>

        {status.connected ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-line/80 bg-surface/35 p-4 backdrop-blur-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">{accountLabel(status)}</p>
                  <p className="mt-0.5 text-xs text-subtle">{status.email ?? "ChatGPT account"}</p>
                </div>
                <Badge tone={status.planUsage ? "brand" : "caution"} size="sm">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  {status.planUsage ? "Plan usage enabled" : "Plan usage not granted"}
                </Badge>
              </div>

              <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-subtle">Model</dt>
                  <dd className="mt-0.5 font-medium text-ink">{status.model ?? "Automatic"}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Image analysis</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {status.visionModel ? status.visionModel : "Unavailable with this model"}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-xs leading-relaxed text-subtle">
                Usage counts toward your ChatGPT plan limits and is shared with other apps that
                use your plan. You can review or revoke access in{" "}
                <a
                  href="https://chatgpt.com/settings/usage"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  ChatGPT Settings &rarr; Usage
                </a>
                .
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={disconnecting}
              >
                <Link2Off className="size-4" aria-hidden="true" />
                Disconnect ChatGPT
              </Button>
              <span className="text-xs text-subtle">
                Disconnecting returns this account to the deployment&apos;s shared AI.
              </span>
            </div>
          </div>
        ) : status.configured ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-line/80 bg-surface/35 p-4 backdrop-blur-sm">
              <p className="text-sm font-medium text-ink">Use your own ChatGPT plan</p>
              <p className="mt-1 text-xs leading-relaxed text-subtle">
                You will be sent to OpenAI to sign in and approve access. MedAssist AI never sees
                your ChatGPT password, and the connection can be revoked at any time.
              </p>

              <div className="mt-4">
                <Button asChild>
                  <a
                    href="/api/ai/connection/chatgpt/start"
                    data-oai-siwc-button
                    data-oai-siwc-button-client={status.clientId || "dynamic_agent_client"}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    Continue with ChatGPT
                  </a>
                </Button>
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-subtle">
              <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                ChatGPT Plus usage limits are shared across apps. Pro accounts are not subject to
                the five-hour app limit.
              </span>
            </p>
          </div>
        ) : (
          <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-caution/30 bg-caution-soft/40 p-4">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-ink">Not available on this deployment</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {status.reason ??
                  "An administrator needs to enable Sign in with ChatGPT for this app."}
              </p>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect ChatGPT?</DialogTitle>
            <DialogDescription>
              This browser will stop using your ChatGPT plan for AI analysis and return to the
              deployment&apos;s shared AI. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void disconnect()} loading={disconnecting}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
