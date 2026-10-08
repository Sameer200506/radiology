"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Database, Info, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SwitchField } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { errorMessage } from "@/lib/api/client";
import { deleteUserAccount, getUserProfile, updateUserProfile } from "@/lib/data";
import { useAuth } from "@/components/auth/auth-provider";
import { signOutUser } from "@/lib/auth/client";
import { useCapabilities } from "@/components/medical/vision-note";
import { TRIAGE_RULESET_VERSION, describeRuleSet } from "@/lib/medical/triage";
import type { UserSettings } from "@/types/assessment";

export function SettingsView() {
  const router = useRouter();
  const capabilities = useCapabilities();
  const { user, ready } = useAuth();

  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [analyticsOptIn, setAnalyticsOptIn] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [rulesOpen, setRulesOpen] = React.useState(false);

  const loadSettings = React.useCallback(async () => {
    try {
      if (!user) return;
      const profile = await getUserProfile(user.uid);
      setReducedMotion(profile?.settings.reducedMotion ?? false);
      setAnalyticsOptIn(profile?.settings.analyticsOptIn ?? false);
    } catch {
      // Settings are non-critical; the page still works with defaults.
    }
  }, [user]);

  React.useEffect(() => {
    if (!ready) return;
    void loadSettings();
  }, [loadSettings, ready]);

  React.useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
  }, [reducedMotion]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
await updateUserProfile({ settings: patch as unknown as UserSettings });
      toast.success("Settings saved");
    } catch (error) {
      toast.error(errorMessage(error, "Settings could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm.trim() !== "DELETE") {
      toast.error("Type DELETE to confirm");
      return;
    }
    setDeleting(true);
    try {
      // Firestore and Storage records are deleted first, then the auth account,
      // so no orphaned clinical data survives a cancelled or failed sign-out.
      await deleteUserAccount();
      await signOutUser();
      router.replace("/login");
    } catch (error) {
      toast.error(errorMessage(error, "The account could not be deleted."));
      setDeleting(false);
    }
  };

  const ruleSet = React.useMemo(() => describeRuleSet(), []);

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Preferences</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Settings</h1>
      </header>

      <Card variant="glass" padding="md">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Appearance</h2>
        <p className="mt-1 text-sm text-muted">Choose light, dark, or follow your system setting.</p>
        <div className="mt-4">
          <ThemeToggle className="max-w-sm" />
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Motion & data</h2>

        <div className="mt-2 divide-y divide-line">
          <SwitchField
            id="reduced-motion"
            label="Reduce motion"
            description="Minimise animation and transitions across the interface."
            checked={reducedMotion}
            onCheckedChange={(checked) => {
              setReducedMotion(checked);
              void saveSettings({ reducedMotion: checked });
            }}
            disabled={saving}
          />

          <SwitchField
            id="analytics"
            label="Anonymous usage analytics"
            description="Off by default. No clinical content, prompts or documents are ever included in analytics."
            checked={analyticsOptIn}
            onCheckedChange={(checked) => {
              setAnalyticsOptIn(checked);
              void saveSettings({ analyticsOptIn: checked });
            }}
            disabled={saving}
          />
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <h2 className="text-sm font-semibold tracking-tight text-ink">What this deployment can do</h2>
        <p className="mt-1 text-sm text-muted">
          Determined from the server configuration, so it reflects reality rather than intent.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
              AI analysis
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-ink">
              <Badge tone={capabilities.aiConfigured ? "good" : "caution"} size="sm">
                {capabilities.aiConfigured ? "Available" : "Not configured"}
              </Badge>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-subtle">
              Model: <span className="font-medium text-muted">{capabilities.primaryModel}</span>
{capabilities.fallbackModel && capabilities.fallbackModel !== capabilities.primaryModel
                ? ` - fallback: ${capabilities.fallbackModel}`
                : ""}
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-surface/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
              Image analysis
            </p>
            <p className="mt-2">
              <Badge tone={capabilities.visionAvailable ? "good" : "neutral"} size="sm">
                {capabilities.visionAvailable ? "Vision model configured" : "Not available"}
              </Badge>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-subtle">
              {capabilities.visionAvailable
                ? "Uploaded images can be described. Written radiology reports are still transcribed and analysed in full."
                : "The configured model cannot process images, so nothing is derived from image pixels. Written report text is still analysed."}
            </p>
          </div>
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="size-4 text-brand" aria-hidden="true" />
              <h2 className="text-sm font-semibold tracking-tight text-ink">Safety rules</h2>
            </div>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
              The deterministic rule set that runs before and independently of the AI. Ruleset
              version <span className="font-medium text-ink">{TRIAGE_RULESET_VERSION}</span>.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRulesOpen((open) => !open)}>
            {rulesOpen ? "Hide rules" : `Show ${ruleSet.length} rules`}
          </Button>
        </div>

        {rulesOpen ? (
          <ul className="mt-5 space-y-3">
            {ruleSet.map((rule) => (
              <li key={rule.id} className="rounded-xl border border-line bg-surface/50 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{rule.label}</p>
                  <Badge
                    tone={rule.urgency === "EMERGENCY" ? "critical" : rule.urgency === "URGENT" ? "caution" : "neutral"}
                    size="sm"
                  >
                    {rule.urgency.replace(/_/g, " ")}
                  </Badge>
                  {!rule.validated ? (
                    <Badge tone="neutral" size="sm">
                      Not clinically validated
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{rule.rationale}</p>
                <p className="mt-1 text-[0.6875rem] text-subtle">
                  rule id: <code className="font-mono">{rule.id}</code>
                </p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-caution/30 bg-caution-soft/40 p-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-ink">
            <strong className="font-semibold">These rules are not a clinical instrument.</strong> They
            are a conservative, illustrative baseline derived from publicly documented triage
            categories. They have not been validated against clinical data. False positives are
            expected and accepted, because an unnecessary escalation is far less costly than a
            missed one. Any real clinical deployment needs clinician review of every rule and
            threshold.
          </p>
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <div className="flex items-center gap-2">
          <Info className="size-4 text-brand" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight text-ink">Your data</h2>
        </div>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Delete your account to remove your profile, every assessment, every uploaded file and
          every generated report. This cannot be undone.
        </p>

        <Button variant="danger" className="mt-5" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Delete my account
        </Button>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently removes your profile, all assessments, all uploaded files and all
              reports, and signs you out everywhere. There is no undo and no recovery.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-2">
            <label htmlFor="delete-confirm" className="text-sm font-medium text-ink">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </label>
            <input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-line bg-surface/70 px-3.5 text-sm text-ink focus:border-critical focus:outline-none focus:ring-4 focus:ring-critical/12"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void deleteAccount()} loading={deleting}>
              Permanently delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
