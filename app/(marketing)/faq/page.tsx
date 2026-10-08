import type { Metadata } from "next";

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
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <p className="eyebrow">Support</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Frequently asked questions
      </h1>
      <p className="mt-4 text-pretty text-base leading-relaxed text-muted">
        Straight answers about what this application does, what it refuses to do, and how your
        information is handled.
      </p>

      <div className="mt-10 space-y-3">
        {FAQ.map((item) => (
          <details key={item.q} className="glass group rounded-2xl p-5 [&_summary::-webkit-details-marker]:hidden">
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
    </main>
  );
}
