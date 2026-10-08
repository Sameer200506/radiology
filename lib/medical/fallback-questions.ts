/**
 * Deterministic fallback questions.
 *
 * If the model is unavailable, the wizard still needs to ask something useful.
 * These questions are chosen by keyword matching against the user's own words
 * and are always clinically uncontroversial — they ask about time course,
 * severity, associated symptoms and exposure. They never imply a condition.
 *
 * This is a genuine fallback, not a mock: the answers are stored and used by the
 * assessment exactly like model-generated questions would be.
 */

import type { MedicalQuestion } from "@/types/ai-primitives";
import { questionsPayloadSchema } from "@/lib/ai/schemas";

export type QuestionsPayloadOutput = ReturnType<typeof questionsPayloadSchema.parse>;

interface FallbackInput {
  symptoms: string[];
  freeText: string;
  age?: number;
  intake?: {
    symptoms: string[];
    duration: string;
    missingInformation: string[];
  };
}

const DURATION_Q: MedicalQuestion = {
  id: "overall_duration",
  question: "How long have you had these symptoms in total?",
  type: "duration",
  importance: "high",
  rationale: "How long symptoms have lasted changes how they are usually interpreted.",
  placeholder: "for example: 3 days, 2 weeks, since last month",
};

const SEVERITY_Q: MedicalQuestion = {
  id: "overall_severity",
  question: "How much are these symptoms affecting your day-to-day activities right now?",
  type: "single_choice",
  importance: "high",
  rationale: "The effect on normal activity is one of the most useful severity signals available without an examination.",
  options: [
    { value: "not_limiting", label: "They do not limit what I normally do" },
    { value: "some_limit", label: "They limit some of what I normally do" },
    { value: "most_limit", label: "They limit most of what I normally do" },
    { value: "bedbound", label: "I am in bed for most of the day" },
  ],
};

const TEMPERATURE_Q: MedicalQuestion = {
  id: "highest_temperature",
  question: "If you have measured a temperature, what was the highest reading?",
  type: "temperature",
  importance: "medium",
  rationale: "A measured temperature is more useful than a description of feeling hot or cold.",
  unit: "°C or °F",
  placeholder: "for example: 38.5",
};

const BREATHING_Q: MedicalQuestion = {
  id: "breathing_at_rest",
  question: "Are you short of breath while sitting or lying still?",
  type: "yes_no",
  importance: "high",
  rationale: "Breathing difficulty at rest is treated as a time-critical sign and is checked by the safety rules on this page.",
};

const CHEST_PAIN_Q: MedicalQuestion = {
  id: "chest_pain_present",
  question: "Do you have any pain, pressure or tightness in your chest?",
  type: "yes_no",
  importance: "high",
  rationale: "Chest symptoms are treated as time-critical and are checked by the safety rules on this page.",
};

const HEADACHE_RED_FLAG_Q: MedicalQuestion = {
  id: "headache_onset_speed",
  question: "If you have a headache, how quickly did it reach its worst intensity?",
  type: "single_choice",
  importance: "high",
  rationale: "How fast a headache peaks helps distinguish between common patterns and ones that need prompt review.",
  options: [
    { value: "gradual", label: "It built up gradually over hours or days" },
    { value: "over_minutes", label: "It reached its worst within a minute" },
    { value: "sudden_peak", label: "It came on suddenly at its worst right away" },
    { value: "no_headache", label: "I do not have a headache" },
  ],
};

const COUGH_PRODUCT_Q: MedicalQuestion = {
  id: "cough_character",
  question: "Is your cough dry, or are you bringing up mucus or phlegm?",
  type: "single_choice",
  importance: "high",
  rationale: "Dry versus productive is one of the strongest simple discriminators for a respiratory presentation.",
  options: [
    { value: "dry", label: "Dry — nothing comes up" },
    { value: "clear_phlegm", label: "Clear or white phlegm" },
    { value: "coloured_phlegm", label: "Coloured (yellow, green or brown) phlegm" },
    { value: "blood_streaks", label: "There are streaks of blood in it" },
    { value: "no_cough", label: "I do not have a cough" },
  ],
};

const GI_Q: MedicalQuestion = {
  id: "abdominal_pain_severity",
  question: "If you have abdominal pain, how severe is it at its worst out of ten?",
  type: "number",
  importance: "medium",
  rationale: "A peak pain score is a standard way to make severity comparable over time.",
  unit: "out of 10",
  placeholder: "0 = none, 10 = worst imaginable",
};

const RASH_Q: MedicalQuestion = {
  id: "rash_character",
  question: "If you have a rash, does it fade when you press a glass against it?",
  type: "yes_no",
  importance: "high",
  rationale: "Whether a rash fades under pressure is a recognised way to tell whether it needs urgent review.",
};

const EXPOSURE_Q: MedicalQuestion = {
  id: "recent_exposure",
  question: "In the past two weeks, have you travelled, or been in close contact with someone who was unwell?",
  type: "yes_no",
  importance: "medium",
  rationale: "Recent travel or exposure changes which explanations are worth considering.",
};

const MEDICATION_Q: MedicalQuestion = {
  id: "recent_medication_change",
  question: "Have you started, stopped or changed any medication in the last month?",
  type: "yes_no",
  importance: "medium",
  rationale: "Recent medication changes are a common and easily missed trigger for new symptoms.",
};

const ONGOING_Q: MedicalQuestion = {
  id: "is_improving",
  question: "Compared with when this started, are your symptoms getting better, staying the same, or getting worse?",
  type: "single_choice",
  importance: "high",
  rationale: "The trend over time is often more informative than the current severity.",
  options: [
    { value: "improving", label: "Getting better" },
    { value: "unchanged", label: "About the same" },
    { value: "worsening", label: "Getting worse" },
    { value: "fluctuating", label: "Coming and going" },
  ],
};

const RED_FLAG_CHECK_Q: MedicalQuestion = {
  id: "red_flag_review",
  question: "Have you had any of the following at any point during this illness: fainting, chest pain, severe breathlessness, blood in your vomit or sputum, or a seizure?",
  type: "yes_no",
  importance: "high",
  rationale: "These are the symptoms that change the assessment most. Answering yes will show you safety information straight away.",
};

interface KeywordRule {
  terms: string[];
  question: MedicalQuestion;
}

const RULES: KeywordRule[] = [
  { terms: ["breath", "breathless", "breathing", "wheez", "short of breath", "dyspnoea", "dyspnea", "suffocat"], question: BREATHING_Q },
  { terms: ["chest", "chest pain", "angina", "palpitation"], question: CHEST_PAIN_Q },
  { terms: ["cough", "catarrh", "phlegm", "sputum", "congest", "cold", "influenza", "flu", "throat", "sore throat", "runny nose"], question: COUGH_PRODUCT_Q },
  { terms: ["fever", "temperature", "hot", "chills", "shivering", "pyrexia"], question: TEMPERATURE_Q },
  { terms: ["headache", "head pain", "migraine", "head"], question: HEADACHE_RED_FLAG_Q },
  { terms: ["stomach", "abdominal", "belly", "tummy", "gut", "bowel", "nausea", "vomit", "diarrh", "constipat"], question: GI_Q },
  { terms: ["rash", "skin", "itch", "hive", "spot", "lesion", "bruise"], question: RASH_Q },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ");
}

function textOf(input: FallbackInput): string {
  return normalize(
    [input.freeText, ...input.symptoms, ...(input.intake?.symptoms ?? [])].filter(Boolean).join(" . "),
  );
}

/**
 * Builds 3–8 questions from a fixed pool.
 *
 * Always included: duration, severity trend, and the red-flag review. Keyword
 * matches then fill the remaining slots in pool order, up to the 8-question cap.
 */
export function fallbackQuestions(input: FallbackInput): QuestionsPayloadOutput {
  const haystack = textOf(input);
  const chosen: MedicalQuestion[] = [DURATION_Q, SEVERITY_Q, ONGOING_Q];

  for (const rule of RULES) {
    if (chosen.length >= 7) break;
    if (chosen.some((q) => q.id === rule.question.id)) continue;
    if (rule.terms.some((term) => haystack.includes(term))) {
      chosen.push(rule.question);
    }
  }

  if (chosen.length < 6) {
    for (const filler of [RED_FLAG_CHECK_Q, EXPOSURE_Q, MEDICATION_Q]) {
      if (chosen.length >= 7) break;
      if (chosen.some((q) => q.id === filler.id)) continue;
      chosen.push(filler);
    }
  }

  // Fever is a threshold the deterministic rules care about; make sure a
  // temperature is asked whenever fever is mentioned but no temp was recorded.
  const mentionsFever = /fever|temperature|chills|shivering/.test(haystack);
  const mentionsTempInput = /\b\d{2,3}(\.\d)?\s*(°|degrees?)?\s*[cf]\b/.test(haystack);
  if (mentionsFever && !mentionsTempInput && !chosen.some((q) => q.type === "temperature")) {
    chosen.splice(3, 0, TEMPERATURE_Q);
  }

  // An infant or older adult with fever is escalated by the rules, so make sure
  // a measured temperature is available whenever fever is mentioned at all.
  if (mentionsFever && !chosen.some((q) => q.type === "temperature")) {
    chosen.splice(Math.min(3, chosen.length), 0, TEMPERATURE_Q);
  }

  chosen.push(RED_FLAG_CHECK_Q);

  const unique = dedupe(chosen).slice(0, 8);

  return {
    questions: unique,
    rationale:
      "These questions cover how long the problem has lasted, how it is trending, and the specific features that most change how a clinician would interpret it.",
  };
}

function dedupe(questions: MedicalQuestion[]): MedicalQuestion[] {
  const seen = new Set<string>();
  const out: MedicalQuestion[] = [];
  for (const question of questions) {
    if (seen.has(question.id)) continue;
    seen.add(question.id);
    out.push(question);
  }
  return out;
}