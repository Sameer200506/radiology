"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
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
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MedicalDisclaimer } from "@/components/medical/disclaimer";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  {
    icon: MessagesSquare,
    title: "Describe what is happening",
    body: "Type your symptoms in your own words, or pick from a list. Age and sex are optional but make the result more useful.",
    accent: "from-brand/30 to-brand/5",
    ring: "border-brand/20",
  },
  {
    icon: ClipboardList,
    title: "Answer a few targeted questions",
    body: "Between three and eight questions, chosen because the answer would actually change the picture — not a long questionnaire.",
    accent: "from-accent/30 to-accent/5",
    ring: "border-accent/20",
  },
  {
    icon: FileSearch,
    title: "Upload reports and images",
    body: "PDFs are read for their text layer and transcribed value by value. Images can be viewed in detail; see the note on vision support below.",
    accent: "from-info/30 to-info/5",
    ring: "border-info/20",
  },
  {
    icon: Sparkles,
    title: "Get a structured summary",
    body: "Key findings, possible explanations, what was concerning, an urgency level, and what to ask a clinician next.",
    accent: "from-brand/30 to-accent/5",
    ring: "border-brand/20",
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
        <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-[2rem]">
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
        <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pb-28 sm:pt-20">
          <div className="grid items-center gap-14 lg:grid-cols-[1.04fr_0.96fr]">
            <div>
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                <Badge tone="brand" size="md" className="gap-2 px-3.5 py-1.5">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-brand" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
                  </span>
                  Educational decision support — not a diagnosis
                </Badge>

                <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-ink sm:text-5xl lg:text-[3.65rem]">
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

                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2.5">
                  {["No diagnosis", "No medication advice", "You control your data"].map(
                    (item) => (
                      <span key={item} className="inline-flex items-center gap-1.5 text-xs text-subtle">
                        <span className="flex size-4 items-center justify-center rounded-full border border-brand/25 bg-brand/10">
                          <Check className="size-2.5 text-brand" strokeWidth={3} aria-hidden="true" />
                        </span>
                        {item}
                      </span>
                    ),
                  )}
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
              transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(55%_55%_at_50%_50%,hsl(var(--brand)/0.22),transparent_72%)] blur-2xl"
              />

              <div
                className="animate-float glass-strong glass-rule relative rounded-[2rem] p-6 sm:p-7"
                style={{ animationDuration: "11s" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-xl bg-brand/12 text-brand">
                      <Sparkles className="size-4" aria-hidden="true" />
                    </span>
                    <p className="eyebrow">Assessment preview</p>
                  </div>
                  <Badge tone="caution" size="sm">
                    Illustrative only
                  </Badge>
                </div>

                <div className="mt-5 space-y-3.5">
                  <div className="rounded-2xl border border-caution/30 bg-caution-soft/40 p-4 backdrop-blur-sm">
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
                    { label: "Extracted from your document", value: "C-reactive protein 24 mg/L (ref < 5)", tone: "text-brand" },
                    { label: "You told us", value: "Fever, 9 days, 39.1 °C recorded", tone: "text-info" },
                    { label: "AI interpretation", value: "May be consistent with an active infection process", tone: "text-accent" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="rounded-2xl border border-line/70 bg-surface/45 p-4 backdrop-blur-sm"
                    >
                      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-subtle">
                        {row.label}
                      </p>
                      <p className={cn("mt-1.5 text-sm text-ink", row.tone)}>{row.value}</p>
                    </div>
                  ))}
                </div>

                <p className="mt-5 border-t border-line/60 pt-4 text-[0.6875rem] leading-relaxed text-subtle">
                  Every category is tagged so you always know whether a statement came from you,
                  from your document, or from the model.
                </p>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.5 }}
                className="glass absolute -bottom-6 -left-4 hidden w-48 rounded-2xl p-3.5 sm:block"
              >
                <p className="text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-subtle">
                  Safety layer
                </p>
                <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
                  <ShieldCheck className="size-4 text-good" aria-hidden="true" />
                  Runs before AI
                </p>
                <p className="mt-1 text-[0.6875rem] leading-relaxed text-subtle">
                  Deterministic rules can only raise urgency.
                </p>
              </motion.div>
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
                  className="h-full"
                >
                  <Card
                    variant="glass"
                    hover="lift"
                    className={cn("group relative h-full overflow-hidden border", step.ring)}
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-1 -top-3 text-[4.5rem] font-semibold leading-none tracking-tighter text-ink/[0.04] dark:text-white/[0.04]"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div
                      className={cn(
                        "flex size-11 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35)]",
                        step.accent,
                      )}
                    >
                      <Icon className="size-5 text-ink" aria-hidden="true" />
                    </div>
                    <p className="mt-4 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-brand">
                      Step {index + 1}
                    </p>
                    <h3 className="mt-1.5 text-sm font-semibold tracking-tight text-ink">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
                  </Card>
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
              <Card key={item.title} variant="glass" hover="lift" padding="lg" className="group">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/15 to-brand/5 text-brand shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35)] transition-transform duration-300 group-hover:scale-105">
                    <Icon className="size-[1.15rem]" aria-hidden="true" />
                  </span>
                  <h3 className="text-sm font-semibold tracking-tight text-ink">{item.title}</h3>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted">{item.body}</p>
              </Card>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card
            variant="glass"
            padding="lg"
            className="border-info/25 bg-info/[0.06] hover:border-info/35"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl border border-info/20 bg-info/12 text-info">
                <ImageIcon className="size-[1.15rem]" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold tracking-tight text-ink">
                Image analysis vs report analysis
              </h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              These are different things and the application never blurs them. A written radiology
              report is transcribed text and is fully analysed. A raw image is only looked at if the
              configured model supports vision — otherwise you are told plainly that image analysis
              is unavailable. No heatmaps, no fake confidence numbers, no pretending.
            </p>
          </Card>

          <Card
            variant="glass"
            padding="lg"
            className="border-brand/25 bg-brand/[0.06] hover:border-brand/35"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl border border-brand/20 bg-brand/12 text-brand">
                <Stethoscope className="size-[1.15rem]" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold tracking-tight text-ink">
                Designed for the appointment
              </h3>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Every assessment produces a printable report with a summary, the evidence behind it,
              possible explanations, and a list of questions to ask. The aim is a more useful
              conversation with a clinician, not a faster answer.
            </p>
          </Card>
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
              <Card key={item.title} variant="glass" hover="lift">
                <span className="flex size-11 items-center justify-center rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/15 to-brand/5 text-brand">
                  <Icon className="size-[1.15rem]" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold tracking-tight text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </Card>
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
          <Accordion type="single" collapsible className="space-y-3">
            {FAQ.slice(0, 4).map((item, index) => (
              <AccordionItem key={item.q} value={`faq-${index}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <Accordion type="single" collapsible className="space-y-3">
            {FAQ.slice(4).map((item, index) => (
              <AccordionItem key={item.q} value={`faq-b-${index}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Section>

      {/* -------------------------------------------------------- Disclaimer */}
      <Section
        id="disclaimer"
        eyebrow="Medical disclaimer"
        title="Not a diagnosis, and not a doctor"
        className="pb-4"
      >
        <MedicalDisclaimer variant="card" />
      </Section>

      {/* --------------------------------------------------------- Final CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="glass-strong glass-rule relative overflow-hidden rounded-[2.25rem] p-8 text-center sm:p-14">
          <div
            className="animate-gradient pointer-events-none absolute inset-0 opacity-50"
            style={{
              background:
                "radial-gradient(55% 60% at 15% 15%, hsl(var(--brand)/0.28), transparent 70%), radial-gradient(55% 60% at 85% 85%, hsl(var(--accent)/0.28), transparent 70%), radial-gradient(45% 45% at 60% 20%, hsl(var(--cyan)/0.16), transparent 75%)",
              backgroundSize: "200% 200%",
            }}
            aria-hidden="true"
          />
          <div className="relative">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-brand to-accent text-white shadow-[0_12px_30px_-12px_hsl(var(--brand)/0.9)]">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-6 text-balance text-2xl font-semibold tracking-tight text-ink sm:text-[2rem]">
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
