"use client";

import * as React from "react";
import { Save, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/components/auth/auth-provider";
import { errorMessage } from "@/lib/api/client";
import { ensureUserProfile, getUserProfile, updateUserProfile } from "@/lib/data";

interface Profile {
  displayName: string;
  email: string;
  photoURL: string | null;
  createdAt: string;
  defaultAge: number | null;
  defaultSex: string | null;
  isDemo: boolean;
  settings: {
    theme: "system" | "light" | "dark";
    reducedMotion: boolean;
    analyticsOptIn: boolean;
    disclaimerAcknowledgedAt: string | null;
  };
}

export function ProfileView() {  const { user, ready } = useAuth();
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [displayName, setDisplayName] = React.useState("");
  const [defaultAge, setDefaultAge] = React.useState("");
  const [defaultSex, setDefaultSex] = React.useState("");
  const [, setLoading] = React.useState(true);  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        if (!user) return;

        // Provision on first read so a profile always exists, then read it.
        await ensureUserProfile({
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          photoURL: user.photoURL ?? null,
        });
        const stored = await getUserProfile(user.uid);
        if (!active) return;

        const profile: Profile = {
          displayName: stored?.displayName ?? user.displayName ?? "",
          email: stored?.email ?? user.email ?? "",
          photoURL: stored?.photoURL ?? user.photoURL ?? null,
          createdAt: stored?.createdAt ?? new Date().toISOString(),
          defaultAge: stored?.defaultAge ?? null,
          defaultSex: stored?.defaultSex ?? null,
          isDemo: stored?.isDemo ?? false,
          settings: stored?.settings ?? {
            theme: "system",
            reducedMotion: false,
            analyticsOptIn: false,
            disclaimerAcknowledgedAt: null,
          },
        };

        setProfile(profile);
        setDisplayName(profile.displayName);
        setDefaultAge(profile.defaultAge?.toString() ?? "");
        setDefaultSex(profile.defaultSex ?? "");
      } catch (loadError) {
        if (active) setError(errorMessage(loadError, "Your profile could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    };

    if (!ready || !user) return;

    void load();
    return () => {
      active = false;
    };
  }, [user, ready]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const parsedAge = defaultAge.trim() === "" ? null : Number.parseInt(defaultAge, 10);
    if (parsedAge !== null && (!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 130)) {
      setError("Enter an age between 0 and 130, or leave it blank.");
      setSaving(false);
      return;
    }

    try {
      await updateUserProfile({
        displayName: displayName.trim(),
        defaultAge: parsedAge,
        defaultSex: defaultSex === "" ? null : defaultSex,
      });

      setProfile((current) =>
        current
          ? {
              ...current,
              displayName: displayName.trim(),
              defaultAge: parsedAge,
              defaultSex: defaultSex === "" ? null : defaultSex,
            }
          : current,
      );
      toast.success("Profile saved");
    } catch (saveError) {
      setError(errorMessage(saveError, "Your profile could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Profile</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          The values below pre-fill new assessments as a convenience. They are never used to decide
          anything, and you can leave them blank.
        </p>
      </header>

      <Card variant="glass" padding="md" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-40 bg-[radial-gradient(60%_100%_at_30%_100%,hsl(var(--brand)/0.18),transparent_70%)]"
        />
        <div className="relative flex flex-wrap items-center gap-4">
          <Avatar className="size-14 rounded-2xl">
            <AvatarImage src={profile?.photoURL ?? user?.photoURL ?? undefined} alt="" />
            <AvatarFallback className="rounded-2xl text-base">
              {profile?.displayName ? (
                initials(profile.displayName)
              ) : (
                <User className="size-6" aria-hidden="true" />
              )}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-base font-medium text-ink">{profile?.displayName ?? "MedAssist user"}</p>
            <p className="text-sm text-muted">{profile?.email ?? user?.email ?? ""}</p>
            {profile?.createdAt ? (
              <p className="mt-1 text-xs text-subtle">
                Account created{" "}
                {new Date(profile.createdAt).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>
          {profile?.isDemo ? (
            <Badge tone="accent" className="ml-auto">
              Has demo data
            </Badge>
          ) : null}
        </div>
      </Card>

      <Card variant="glass" padding="md">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Preferences</h2>

        <form onSubmit={save} className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              autoComplete="name"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="defaultAge">Default age</Label>
              <Input
                id="defaultAge"
                type="number"
                min={0}
                max={130}
                value={defaultAge}
                onChange={(event) => setDefaultAge(event.target.value)}
                placeholder="Optional"
                hint="Pre-fills step 1. Never used for clinical decisions."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="defaultSex">Default sex</Label>
              <Select
                value={defaultSex || "none"}
                onValueChange={(value) => setDefaultSex(value === "none" ? "" : value)}
              >
                <SelectTrigger id="defaultSex" aria-label="Default sex">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="intersex">Intersex</SelectItem>
                  <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-critical/30 bg-critical/8 px-3.5 py-2.5 text-sm text-critical"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={saving}>
            <Save className="size-4" aria-hidden="true" />
            Save changes
          </Button>
        </form>
      </Card>

      <Card variant="glass-subtle" padding="md">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-subtle">
            Your email address is used only to sign in. It is never included in an assessment, sent
            to the AI provider, or written into a generated report.
          </p>
        </div>
      </Card>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}