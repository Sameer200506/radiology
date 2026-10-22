import type { Metadata } from "next";
import { HelpCircle } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "What MedAssist AI does, what it deliberately does not do, and how your uploaded documents and images are handled.",
};

const FAQ = [
  {
    q: "Will MedAssist AI tell me what disease I have?",
    a: "No. It never states a diagnosis. It lists two to five possible explanations that may fit the information you gave, says which parts of your information support each one, and states what a clinician would need to check to confirm or exclude it. Only a qualified professional who has examined you can determine a diagnosis.",
  },
  {
    q: "Will it tell me which medication to take?",
    a: "No. MedAssist AI does not prescribe, recommend or dose any medication. Its recommended next steps cover things like contacting emergency services, booking an appointment, monitoring symptoms and gathering information. Treatment decisions belong entirely with a qualified prescriber.",
  },
  {
    q: "Can it read my X-ray?",
    a: "That depends on which model this deployment is configured to use. Most free text-only models cannot look at images at all, and in that case the application says so plainly and does not pretend to have analysed anything. Written radiology reports are transcribed and analysed in full either way. If a vision-capable model is configured, images produce a description of what appeared to be visible, with an uncertainty rating, clearly labelled as unverified. No heatmaps, saliency overlays or fake confidence scores are ever produced, because that would require a computer-vision model this application does not implement.",
  },
  {
    q: "What happens to my uploaded PDFs?",
    a: "The server extracts the PDF text layer, removes obvious identifiers such as emails and phone numbers, and sends only the text to the AI provider for transcription. Values are reproduced exactly as printed. If a PDF is a scan with no text layer, the application tells you rather than guessing, and offers to accept typed or pasted text instead.",
  },
  {
    q: "What happens to my images?",
    a: "Images are stored privately in Firebase Storage under your account. If a vision-capable model is configured, the image is sent to the AI provider for description. Otherwise it is stored and displayed only, and nothing is derived from its pixels. In both cases the file is never made publicly accessible.",
  },
  {
    q: "What if my symptoms are an emergency?",
    a: "A deterministic rule set inspects your description before and separately from the AI. If it recognises wording that conventionally indicates an emergency, you get a prominent banner that cannot be dismissed, telling you to contact emergency services. That happens regardless of what the AI concludes, and the rule set can only raise urgency, never lower it.",
  },
  {
    q: "Why does it use hedged language everywhere?",
    a: "Because the evidence does not support certainty. A language model working from a typed description and a PDF cannot examine you, take a history, or see the original image. Statements like 'may be consistent with' are accurate about what the system actually knows. Phrases like 'you have' would not be.",
  },
  {
    q: "Is this HIPAA compliant?",
    a: "We make no such claim, and neither should any deployment of this code. Compliance depends on the whole system  hosting configuration, contracts with processors such as the AI provider, access controls, audit procedures and operational safeguards. No amount of application code establishes it on its own. Read the privacy page for exactly what is stored and what leaves your browser.",
  },
  {
    q: "How much does it cost to run?",
    a: "The design targets free or near-free infrastructure. AI calls are routed through OpenRouter's free models, uploads are size-capped, and a single assessment uses a small fixed number of model calls with the results of earlier stages summarised rather than resent in full.",
  },
  {
    q: "Can I delete everything?",
    a: "Yes. You can delete an individual assessment, an individual upload, a report, or your entire account. Deleting an account removes your profile, every assessment, every uploaded file, every report and every audit record. See the settings page.",
  },
] as const;

export default function FaqPage() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <header className="glass relative overflow-hidden rounded-[2rem] p-6 sm:p-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-brand/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 size-56 rounded-full bg-accent/12 blur-3xl"
        />
        <span className="relative inline-flex size-10 items-center justify-center rounded-xl border border-white/50 bg-surface/60 text-brand shadow-sm backdrop-blur dark:border-white/10">
          <HelpCircle className="size-5" aria-hidden="true" />
        </span>
        <p className="relative mt-4 eyebrow">Support</p>
        <h1 className="relative mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Frequently asked questions
        </h1>
        <p className="relative mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          Straight answers about what this application does, what it refuses to do, and how your
          information is handled.
        </p>
      </header>

      <Accordion type="single" collapsible className="mt-8 space-y-3">
        {FAQ.map((item, index) => (
          <AccordionItem key={item.q} value={`faq-${index}`}>
            <AccordionTrigger>
              <span className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-px font-mono text-[0.6875rem] tabular-nums text-subtle"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                {item.q}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pl-9">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <p className="mt-10 text-center text-xs text-subtle">
        Still unsure? The disclaimer explains the limits of this tool in full.
      </p>
    </main>
  );
}
