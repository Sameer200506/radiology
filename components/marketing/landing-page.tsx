"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ClipboardList,
  FileSearch,
  GitBranch,
  HeartPulse,
  ImageIcon,
  Lock,
  MessagesSquare,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  {
    icon: MessagesSquare,
    title: "Describe what is happening",
    body: "Type your symptoms in your own words, or pick from a list. Age and sex are optional but make the result more useful.",
    accent: "from-brand/25 to-brand/5",
  },
  {
    icon: ClipboardList,
    title: "Answer a few targeted questions",
    body: "Between three and eight questions, chosen because the answer would actually change the picture — not a long questionnaire.",
    accent: "from-accent/25 to-accent/5",
  },
  {
    icon: FileSearch,
    title: "Upload reports and images",
    body: "PDFs are read for their text layer and transcribed value by value. Images can be viewed in detail; see the note on vision support below.",
    accent: "from-info/25 to-info/5",
  },
  {
    icon: Sparkles,
    title: "Get a structured summary",
    body: "Key findings, possible explanations, what was concerning, an urgency level, and what to ask a clinician next.",
    accent: "from-brand/25 to-accent/5",
  },
] as const;

const CAPABILITIES = [
  {
    icon: FileSearch,
    title: "Report text analysis",
    body: "Laboratory values, reference ranges and radiology impressions are transcribed exactly as printed. A value that is not in the document is never invented — it is reported as absent.",
  },
  {
    icon: GitBranch,
    title: "Ranked possible explanations",
    body: "Two to five candidate explanations, each with why it may fit the evidence you gave and what a clinician would do to confirm or exclude it. Always labelled as possibilities, never conclusions.",
  },
  {
    icon: ShieldCheck,
    title: "A real safety layer",
    body: "A deterministic rule engine inspects your words for time-critical warning signs before and independently of any AI, and will raise urgency even when the model suggests something lower.",
  },
  {
    icon: HeartPulse,
    title: "Honest about uncertainty",
    body: "No fake confidence scores, no fabricated measurements, no pretending an image was read when it was not. Limitations are stated on every result.",
  },
] as const;

const PRIVACY_POINTS = [
  {
    icon: Lock,
    title: "Private storage",
    body: "Files you upload are stored in Firebase Storage under your own account and are not made public. Only you can read them.",
  },
  {
    icon: ScanEye,
    title: "You control your data",
    body: "Delete any assessment, upload or report, or your whole account, from the settings page. Deletion removes the underlying files too.",
  },
  {
    icon: TriangleAlert,
    title: "Avoid unnecessary detail",
    body: "Please avoid uploading documents that carry your name, address or national identifier. A courtesy redaction pass runs first, but it is not a guarantee.",
  },
] as const;

const FAQ = [
  {
    q: "Will MedAssist AI tell me what disease I have?",
    a: "No. It never states a diagnosis. It lists possible explanations that may fit the information you provided, explains which parts of your information support each one, and states what a clinician would need to check. Only a qualified professional who has examined you can determine a diagnosis.",
  },
  {
    q: "Will it tell me which medication to take?",
    a: "No. MedAssist AI does not prescribe, recommend or dose any medication. Treatment decisions belong entirely with a qualified prescriber who has examined the person and reviewed their full history.",
  },
  {
    q: "Can it read my X-ray?",
    a: "That depends entirely on which model this deployment is configured to use. Most free text-only models cannot look at images at all, and when that is the case the application says so plainly and does not pretend to have analysed anything. If a vision-capable model is configured, it returns a description of what appeared to be visible, with uncertainty stated, and clearly labelled as unverified. No heatmaps or false confidence scores are produced.",
  },
  {
    q: "What happens to my uploaded PDFs?",
    a: "The server extracts the text layer, removes obvious identifiers, and sends only the relevant text to the AI provider for transcription. Values are reproduced exactly as printed. If a PDF is a scan with no text layer, the application tells you instead of guessing.",
  },
  {
    q: "What if my symptoms are an emergency?",
    a: "A deterministic rule set inspects your description before and separately from the AI. If it recognises wording that conventionally indicates an emergency, you get a prominent, non-dismissible banner telling you to contact emergency services — regardless of what the AI concludes.",
  },
  {
    q: "Is this HIPAA compliant?",
    a: "We make no such claim. Compliance depends on the whole deployment, including the hosting configuration, contracts with processors, and operational safeguards, none of which this codebase can guarantee on its own. Read the privacy page for exactly what is and is not covered.",
  },
  {
    q: "How much does it cost?",
    a: "The free tier is designed to work without paid services. AI analysis is routed through OpenRouter's free models, uploads are size-capped, and each assessment uses a small fixed number of model calls.",
  },
] as const;

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>
      <div className="max-w-2xl">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h2>
        {description ? (
          <p className="mt-4 text-pretty text-[0.9375rem] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      <div className="mt-10">{children}</div>
    </section>
  );
}

export function LandingPage() {
  return (
    <main id="main-content">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <Badge tone="brand" size="md" className="gap-2">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-brand" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
                  </span>
                  Educational decision support — not a diagnosis
                </Badge>

                <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]">
                  Understand Your Health Information With{" "}
                  <span className="text-gradient">AI-Assisted Analysis</span>
                </h1>

                <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
                  Upload your reports, describe your symptoms, and receive a structured,
                  carefully-hedged health assessment — what your results may mean, what is
                  worth flagging, how urgent it might be, and what to ask a healthcare
                  professional next.
                </p>

                <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button asChild size="lg" className="group">
                    <Link href="/assessment/new">
                      Start Assessment
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="secondary">
                    <Link href="#how-it-works">See How It Works</Link>
                  </Button>
                </div>

                <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-subtle">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-caution" aria-hidden="true" />
                  <span>
                    In an emergency, contact your local emergency number. Do not wait for an
                    assessment here.
                  </span>
                </p>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 0.12 }}
              className="relative"
            >
              <div
                className="animate-float glass-strong relative rounded-3xl p-6 sm:p-7"
                style={{ animationDuration: "11s" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="eyebrow">Assessment preview</p>
                  <Badge tone="caution" size="sm">
                    Illustrative only
                  </Badge>
                </div>

                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-caution/30 bg-caution-soft/40 p-4">
                    <div className="flex items-center gap-2">
                      <TriangleAlert className="size-4 text-caution" aria-hidden="true" />
                      <p className="text-sm font-semibold text-ink">PROMPT MEDICAL REVIEW</p>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      Symptoms lasting 9 days with a reported temperature of 39.1 °C warrant
                      same-day clinical advice. Determined by the safety rules, not by the model.
                    </p>
                  </div>

                  {[
                    { label: "Extracted from your document", value: "C-reactive protein 24 mg/L (ref < 5)" },
                    { label: "You told us", value: "Fever, 9 days, 39.1 °C recorded" },
                    { label: "AI interpretation", value: "May be consistent with an active infection process" },
                  ].map((row) => (
                    <div key={row.label} className="rounded-2xl border border-line bg-surface/50 p-4">
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-subtle">
                        {row.label}
                      </p>
                      <p className="mt-1.5 text-sm text-ink">{row.value}</p>
                    </div>
                  ))}
                </div>

                <p className="mt-5 border-t border-line pt-4 text-[0.6875rem] leading-relaxed text-subtle">
                  Every category is tagged so you always know whether a statement came from you,
                  from your document, or from the model.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- How it works */}
      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="Four steps, one small number of model calls"
        description="Built to be cheap to run and honest about what it did at each stage."
        className="py-8"
      >
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.4, delay: index * 0.06 }}
                  className="glass h-full rounded-3xl p-5"
                >
                  <div
                    className={cn(
                      "flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br",
                      step.accent,
                    )}
                  >
                    <Icon className="size-5 text-ink" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-xs font-semibold tabular-nums text-brand">
                    Step {index + 1}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold tracking-tight text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
                </motion.div>
              </li>
            );
          })}
        </ol>
      </Section>

      {/* ------------------------------------------------------- Capabilities */}
      <Section
        eyebrow="What it actually does"
        title="Careful about the boundaries"
        description="The interesting part of medical software is not what it claims to do, but what it refuses to claim."
        className="py-16"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {CAPABILITIES.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="glass rounded-3xl p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <Icon className="size-[1.15rem]" aria-hidden="true" />
                  </span>
                  <h3 className="text-sm font-semibold tracking-tight text-ink">{item.title}</h3>
                </div>
                <p className="mt-3.5 text-sm leading-relaxed text-muted">{item.body}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="glass rounded-3xl border-info/25 bg-info/5 p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-info/12 text-info">
                <ImageIcon className="size-[1.15rem]" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold tracking-tight text-ink">
                Image analysis vs report analysis
              </h3>
            </div>
            <p className="mt-3.5 text-sm leading-relaxed text-muted">
              These are different things and the application never blurs them. A written radiology
              report is transcribed text and is fully analysed. A raw image is only looked at if the
              configured model supports vision — otherwise you are told plainly that image analysis
              is unavailable. No heatmaps, no fake confidence numbers, no pretending.
            </p>
          </div>

          <div className="glass rounded-3xl border-brand/25 bg-brand/5 p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand/12 text-brand">
                <Stethoscope className="size-[1.15rem]" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold tracking-tight text-ink">
                Designed for the appointment
              </h3>
            </div>
            <p className="mt-3.5 text-sm leading-relaxed text-muted">
              Every assessment produces a printable report with a summary, the evidence behind it,
              possible explanations, and a list of questions to ask. The aim is a more useful
              conversation with a clinician, not a faster answer.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------ Privacy */}
      <Section
        id="privacy"
        eyebrow="Privacy"
        title="Private by default, and honest about the limits"
        className="py-8"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {PRIVACY_POINTS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="glass rounded-3xl p-5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Icon className="size-[1.15rem]" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold tracking-tight text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-sm text-subtle">
          Read the{" "}
          <Link href="/privacy" className="font-medium text-brand underline underline-offset-4">
            full privacy notes
          </Link>{" "}
          for exactly what is stored, where, and what is sent to a third-party AI provider.
        </p>
      </Section>

      {/* --------------------------------------------------------------- FAQ */}
      <Section id="faq" eyebrow="FAQ" title="Questions people actually ask" className="py-16">
        <div className="grid gap-3 lg:grid-cols-2">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="glass group rounded-2xl p-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-medium text-ink">
                {item.q}
                <span
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-lg leading-none text-brand transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* -------------------------------------------------------- Disclaimer */}
      <Section id="disclaimer" eyebrow="Medical disclaimer" title="Not a diagnosis, and not a doctor" className="pb-4">
        <MedicalDisclaimer variant="card" />
      </Section>

      {/* --------------------------------------------------------- Final CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="glass-strong relative overflow-hidden rounded-[2rem] p-8 text-center sm:p-12">
          <div
            className="animate-gradient pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(60% 60% at 20% 20%, hsl(var(--brand)/0.28), transparent 70%), radial-gradient(60% 60% at 80% 80%, hsl(var(--accent)/0.28), transparent 70%)",
            }}
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Bring your results to the appointment, not the confusion
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-[0.9375rem] leading-relaxed text-muted">
              Try the full workflow with a synthetic demo patient first — no real documents needed.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="group">
                <Link href="/assessment/new">
                  Start Assessment
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/dashboard">Open the dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}