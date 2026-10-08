/**
 * MedAssist AI — deterministic triage / red-flag engine.
 *
 * ## Why this exists
 *
 * The language model is a second line of reasoning, never the first. This module
 * runs **before** any model output is shown and can only ever *raise* urgency,
 * never lower it. If a rule here fires, the user sees an emergency banner
 * regardless of what the model proposed.
 *
 * ## What this engine is NOT
 *
 * It is not a diagnostic system and it does not establish that a condition is
 * present. It recognises *language patterns* that are conventionally treated as
 * time-critical in triage protocols and escalates urgency so a human is
 * involved quickly. False positives are expected and acceptable — a needless
 * escalation costs far less than a missed one.
 *
 * ## Validation status — READ THIS
 *
 * The pattern set below is an **illustrative, conservative baseline** derived from
 * publicly documented, widely used triage categories (airway, breathing,
 * circulation, neurological, anaphylaxis, obstetric, and mental-health
 * emergencies). It has **not** been validated against a clinical dataset and is
 * not a substitute for a validated triage instrument such as NEWS2, qSOFA,
 * CTAS, or a local emergency-department protocol.
 *
 * Before any real-world clinical deployment, every rule in this file and every
 * threshold in THRESHOLDS must be reviewed and signed off by a qualified
 * clinician. The ruleset version is recorded on every assessment so a result
 * can always be traced back to the rule set that produced it.
 *
 * ## Extending the rule set
 *
 * Add a rule to RULES with a unique id, a plain-language `why`, a documented
 * `rationale`, and a severity. Tests in tests/triage.test.ts assert that every
 * rule id is unique and reachable, and that each severity maps to the intended
 * urgency level.
 */

import type { MedicalCase, UrgencyLevel } from "@/types/medical";
import { urgencyRank } from "@/types/medical";
import type { RedFlagFinding, TriageResult } from "@/types/assessment";

/** Bump when any rule or threshold changes. Persisted on every assessment. */
export const TRIAGE_RULESET_VERSION = "2026.06.01";

/**
 * Numeric thresholds.
 *
 * Values are intentionally conservative and round-numbered. They are expressed
 * in the unit a person would actually report. Each is documented in
 * THRESHOLD_NOTES and must be clinician-reviewed before clinical use.
 */
export const THRESHOLDS = {
  /** Hyperpyrexia, °C. High-fever-at-extreme threshold for same-day review. */
  urgentTemperatureC: 39.4,
  /** Hyperpyrexia, °F. */
  urgentTemperatureF: 103,
  /** Oxygen saturation below which same-day review is advised, %. */
  urgentSpo2: 92,
  /** Fever in an infant this young needs same-day review, months. */
  infantFeverAgeMonths: 3,
  /** Age at which new confusion is treated as urgent, years. */
  olderAdultAgeYears: 65,
  /** Symptoms lasting at least this long warrant a booked review, days. */
  prolongedSymptomDays: 21,
} as const;

export const THRESHOLD_NOTES: Record<keyof typeof THRESHOLDS, string> = {
  urgentTemperatureC:
    "Degree of temperature alone is a weak discriminator for serious illness and varies with age and measurement site. Used only to prompt same-day review, never to rule illness in or out.",
  urgentTemperatureF: "Fahrenheit equivalent of urgentTemperatureC.",
  urgentSpo2:
    "Consumer pulse oximeters are frequently inaccurate in poor perfusion, nail polish, cold hands and low ambient light. Used only to prompt same-day review.",
  infantFeverAgeMonths:
    "Fever in very young infants is conventionally treated as needing prompt medical review because early infection can progress quickly.",
  olderAdultAgeYears:
    "Acute confusion in older adults is frequently the first sign of serious illness, including dehydration, infection, medication effects or stroke.",
  prolongedSymptomDays:
    "Beyond roughly three weeks a persistent symptom conventionally warrants a booked clinical review rather than self-management.",
};

/* ------------------------------------------------------------------ *
 * Text normalisation helpers
 * ------------------------------------------------------------------ */

/**
 * Negation cues that suppress a pattern match.
 *
 * Kept deliberately small. "any" and "nothing" are NOT here: a question such as
 * "Any chest pain?" is a positive prompt, and treating it as a negation caused
 * real red flags to be missed. Every cue in this list must genuinely invert the
 * meaning of the phrase that follows it.
 */
const NEGATION_CUES = [
  "no ",
  "not ",
  "never ",
  "none ",
  "without ",
  "denies ",
  "deny ",
  "denied ",
  "denying ",
  "free of ",
  "have not",
  "has not",
  "hasnt ",
  "does not",
  "doesnt ",
  "did not",
  "didnt ",
  "is not",
  "isnt ",
  "negative for",
];

/** How far back a negation cue may sit and still suppress the phrase after it. */
const NEGATION_WINDOW_CHARS = 32;

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s./+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the characters immediately before `index` negate the phrase.
 *
 * This is a deliberately simple guard that exists to suppress one realistic
 * false positive: a yes/no answer such as "No, I do not have chest pain".
 *
 * It is applied ONLY to rules that opt in via `negationAware`, because the
 * asymmetry matters: wrongly suppressing a red flag could cause a missed
 * emergency, whereas an unnecessary escalation merely costs an extra
 * assessment. Rules that describe distress, self-harm, overdose or seizures are
 * never negation-aware for that reason.
 */
export function isNegated(normalized: string, index: number): boolean {
  const window = normalized.slice(Math.max(0, index - NEGATION_WINDOW_CHARS), index);
  return NEGATION_CUES.some((cue) => window.includes(cue));
}

interface PhraseMatch {
  phrase: string;
  index: number;
}

export function findPhrases(normalized: string, patterns: RegExp[]): PhraseMatch[] {
  const out: PhraseMatch[] = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match = re.exec(normalized);
    while (match !== null) {
      out.push({ phrase: match[0].trim(), index: match.index });
      if (match.index === re.lastIndex) {
        re.lastIndex += 1;
      }
      match = re.exec(normalized);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/* ------------------------------------------------------------------ *
 * Case introspection
 * ------------------------------------------------------------------ */

/** Everything the rules are allowed to look at, extracted once. */
export interface RuleContext {
  /** Statements only — free text, symptoms, answers, history, document findings. */
  text: string;
  rawText: string;
  /** Follow-up question text. Retained for diagnostics; never pattern-matched. */
  questionText: string;
  age: number | undefined;
  temperatureC: number | undefined;
  spo2: number | undefined;
  /** Duration-bearing statements, for the prolonged-symptom rule. */
  durationText: string;
}

const TEMP_C = /(?:^|\s)(\d{2}(?:\.\d)?)\s*(?:°|degrees?)?\s*c(?:elsius)?(?:\b|$)/g;
const TEMP_F = /(?:^|\s)(\d{2,3}(?:\.\d)?)\s*(?:°|degrees?)?\s*f(?:ahrenheit)?(?:\b|$)/g;
const SPO2 = /(?:spo2|spo 2|sat(?:uration)?|oxygen sat(?:uration)?)\D{0,12}(\d{2,3})\s*%?/g;
const DURATION_DAYS = /(\d{1,3})\s*(?:day|days)\b/g;
const DURATION_WEEKS = /(\d{1,2})\s*(?:week|weeks)\b/g;

function parseTemperatures(text: string): number | undefined {
  const values: number[] = [];

  const f = TEMP_F.exec(text);
  if (f) {
    for (const group of f) {
      const n = Number.parseFloat(group);
      if (Number.isFinite(n) && n >= 80 && n <= 115) values.push(n);
    }
  }

  const c = TEMP_C.exec(text);
  if (c) {
    for (const group of c) {
      const n = Number.parseFloat(group);
      if (Number.isFinite(n) && n >= 30 && n <= 45) values.push(n);
    }
  }

  if (values.length === 0) return undefined;
  // Standardise to Celsius.
  const celsius = values.map((v) => (v > 60 ? ((v - 32) * 5) / 9 : v));
  return celsius.length > 0 ? Math.max(...celsius) : undefined;
}

function parseSpo2(text: string): number | undefined {
  SPO2.lastIndex = 0;
  const match = SPO2.exec(text);
  if (!match?.[1]) return undefined;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 50 || n > 100) return undefined;
  return n;
}

function parseDurationDays(text: string): number | undefined {
  const weeks = DURATION_WEEKS.exec(text);
  if (weeks?.[1]) {
    const n = Number.parseInt(weeks[1], 10);
    if (Number.isFinite(n)) return n * 7;
  }
  const days = DURATION_DAYS.exec(text);
  if (days?.[1]) {
    const n = Number.parseInt(days[1], 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Builds the text the rules actually match against.
 *
 * ## Question text is not evidence
 *
 * A follow-up question such as "Do you have chest pain?" is a *prompt* written
 * by the application, not something the person said. Matching rule patterns
 * against question text produces two bad outcomes: it fires red flags for
 * symptoms nobody reported, and it makes negation detection unreliable because
 * the question and the answer appear side by side.
 *
 * So question text is excluded entirely — except when the answer is a clear
 * affirmative, in which case the question becomes evidence ("Yes" to "Do you
 * have chest pain?" *is* an assertion of chest pain). A clear negative answer
 * contributes nothing, which is the most reliable negative signal available.
 */
export function buildRuleContext(caseData: Partial<MedicalCase>): RuleContext {
  const statements: string[] = [];
  const questions: string[] = [];

  if (typeof caseData.freeText === "string") statements.push(caseData.freeText);

  if (Array.isArray(caseData.symptoms)) {
    for (const symptom of caseData.symptoms) {
      statements.push(symptom?.name ?? "");
      statements.push(symptom?.duration ?? "");
      statements.push(symptom?.severity ?? "");
    }
  }

  if (Array.isArray(caseData.answers)) {
    for (const answer of caseData.answers) {
      const question = (answer?.question ?? "").trim();
      const value = (answer?.answer ?? "").trim();

      if (value.length === 0) continue;

      if (isAffirmativeAnswer(value)) {
        // The person asserted the thing the question asks about.
        if (question.length > 0) statements.push(question);
        statements.push(value);
      } else if (isNegativeAnswer(value)) {
        // An explicit "no" is the strongest negative signal there is; contribute
        // nothing so a negation-aware rule can stay quiet.
        continue;
      } else {
        statements.push(value);
      }

      if (question.length > 0) questions.push(question);
    }
  }

  if (Array.isArray(caseData.medicalHistory)) {
    for (const entry of caseData.medicalHistory) statements.push(entry?.condition ?? "");
  }
  if (Array.isArray(caseData.medications)) statements.push(...caseData.medications);
  if (Array.isArray(caseData.allergies)) statements.push(...caseData.allergies);

  // Document findings count as evidence — a report can state the red flag.
  if (Array.isArray(caseData.documents)) {
    for (const document of caseData.documents) {
      const findings = document?.analysis?.findings;
      if (Array.isArray(findings)) {
        for (const finding of findings) {
          statements.push(finding?.test ?? "");
          statements.push(finding?.value ?? "");
          statements.push(finding?.unit ?? "");
          statements.push(finding?.note ?? "");
          statements.push(finding?.evidence ?? "");
        }
      }
      const impression = document?.analysis?.impression;
      if (typeof impression === "string") statements.push(impression);
      const observations = document?.imaging?.observations;
      if (Array.isArray(observations)) {
        for (const observation of observations) {
          statements.push(observation?.observation ?? "");
          statements.push(observation?.evidence ?? "");
        }
      }
    }
  }

  const rawText = statements.filter(Boolean).join(" . ");

  return {
    text: normalizeText(rawText),
    rawText,
    age: typeof caseData.demographics?.age === "number" ? caseData.demographics.age : undefined,
    temperatureC: parseTemperatures(normalizeText(rawText)),
    spo2: parseSpo2(normalizeText(rawText)),
    durationText: statements.filter(Boolean).join(" . "),
    /** Retained for diagnostics; never used for pattern matching. */
    questionText: normalizeText(questions.filter(Boolean).join(" . ")),
  };
}

const AFFIRMATIVE = /^(?:yes|yeah|yep|yup|sure|true|absolutely|definitely|of course|affirmative)\b/i;
const NEGATIVE = /^(?:no|nope|nay|none|never|not|negative|false|denied|neither)\b/i;

export function isAffirmativeAnswer(value: string): boolean {
  return AFFIRMATIVE.test(value.trim());
}

export function isNegativeAnswer(value: string): boolean {
  return NEGATIVE.test(value.trim());
}

/* ------------------------------------------------------------------ *
 * Rule definitions
 * ------------------------------------------------------------------ */

export interface TriageRule {
  /** Stable identifier recorded in the audit trail. */
  id: string;
  /** Short label shown in the UI. */
  label: string;
  severity: RedFlagFinding["severity"];
  /** Urgency this rule escalates to. */
  urgency: UrgencyLevel;
  /** Plain-language explanation for the user. */
  why: string;
  /** Why this pattern is treated as time-critical. For maintainers, not users. */
  rationale: string;
  /** Requires clinical sign-off before any clinical deployment. */
  validated: boolean;
  /**
   * When true, a match immediately preceded by a negation cue ("no chest pain")
   * is suppressed. Only enable this for symptoms a person is routinely asked
   * about as a yes/no checkbox — never for distress, self-harm, overdose or
   * seizure wording, where a stray cue must not silence an escalation.
   */
  negationAware?: boolean;
  patterns?: RegExp[];
  /** For rules that need more than a phrase match. */
  evaluate?: (ctx: RuleContext) => boolean;
}

const rx = (...alternatives: string[]): RegExp[] =>
  alternatives.map((a) => new RegExp(`\\b${a}\\b`, "i"));

export const RULES: TriageRule[] = [
  /* ---------------- EMERGENCY: airway, breathing, circulation ------ */
  {
    id: "airway_compromise",
    label: "Possible airway compromise",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Difficulty breathing or a closing throat can deteriorate within minutes.",
    rationale:
      "Airway and breathing complaints are the highest-acuity category in every mainstream triage system. Wording is broad to catch lay descriptions such as 'can't get enough air'.",    negationAware: true,
    validated: false,
    patterns: rx(
      "cannot breathe",
      "can not breathe",
      "cant breathe",
      "unable to breathe",
      "struggling to breathe",
      "struggling for breath",
      "struggling for air",
      "severe shortness of breath",
      "severe breathlessness",
      "cannot catch my breath",
      "can not catch my breath",
      "gasping",
      "suffocating",
      "choking",
      "throat closing",
      "throat is closing",
      "throat swelling",
      "swelling of tongue",
      "tongue swelling",
      "blue lips",
      "bluish lips",
      "blue grey lips",
      "gray lips",
      "lips turning blue",
      "lips are blue",
      "blue around the mouth"
    ),
  },
  {
    id: "loss_of_consciousness",
    label: "Reported loss of consciousness",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Unconsciousness can indicate a serious problem with the brain, heart or breathing.",
    rationale:
      "Sudden loss of consciousness requires immediate assessment for arrhythmia, hypoglycaemia, trauma or neurological causes.",
    validated: false,
    patterns: rx(
      "lost consciousness",
      "lose consciousness",
      "losing consciousness",
      "loss of consciousness",
      "passed out",
      "pass out",
      "passed away",
      "fainted",
      "fainting",
      "unconscious",
      "unresponsive",
      "not responding",
      "no response",
      "collapsed and not waking",
      "could not wake",
      "cannot wake",
      "in a coma"
    ),
  },
  {
    id: "stroke_features",
    label: "Possible stroke features",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Sudden one-sided weakness, facial droop or speech changes may be a stroke.",
    rationale:
      "Sudden focal neurological deficit is treated as a time-critical emergency because thrombolysis windows are narrow. The patterns mirror lay descriptions of FAST symptoms.",    negationAware: true,
    validated: false,
    patterns: rx(
      "one side weakness",
      "one sided weakness",
      "weakness on one side",
      "half my body",
      "half of my body",
      "face is drooping",
      "face drooping",
      "facial droop",
      "dropped face",
      "mouth is crooked",
      "slurred speech",
      "speech is slurred",
      "cannot speak properly",
      "can not speak properly",
      "cannot move my arm",
      "can not move my arm",
      "cannot lift my arm",
      "face numbness",
      "numbness on one side",
      "sudden numbness",
      "cannot walk suddenly",
      "paralysed",
      "paralyzed",
      "sudden blindness"
    ),
  },
  {
    id: "anaphylaxis",
    label: "Possible severe allergic reaction",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "A severe allergic reaction can be fatal within minutes without treatment.",
    rationale:
      "Anaphylaxis requires immediate adrenaline and airway support. Trigger words are matched when they appear together or near a breathing/rash descriptor.",
    validated: false,
    evaluate: (ctx) => {
      const trigger = findPhrases(
        ctx.text,
        rx("anaphylaxis", "anaphylactic", "severe allergic reaction", "anaphylactic shock", "epipen", "adrenaline injection")
      );
      if (trigger.length === 0) return false;
      const supports = findPhrases(
        ctx.text,
        rx("throat", "breathing", "breathless", "wheezing", "hives", "rash", "swelling", "swollen", "lips", "tongue", "dizzy", "collapse", "collapsed")
      );
      return supports.length > 0;
    },
  },
  {
    id: "uncontrolled_bleeding",
    label: "Severe or uncontrolled bleeding",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Heavy bleeding that will not stop can become life-threatening quickly.",
    rationale:
      "Uncontrolled external or internal bleeding is treated as an immediate threat to circulation.",
    validated: false,
    patterns: rx(
      "severe bleeding",
      "heavy bleeding",
      "uncontrolled bleeding",
      "bleeding heavily",
      "bleeding will not stop",
      "bleeding that will not stop",
      "cannot stop the bleeding",
      "can not stop the bleeding",
      "soaking through",
      "spurting blood",
      "blood everywhere",
      "bleeding out"
    ),
  },
  {
    id: "haematemesis_or_large_haemoptysis",
    label: "Vomiting blood or coughing up significant blood",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Vomiting blood or coughing up more than streaks of blood needs emergency assessment.",
    rationale:
      "Haematemesis and large-volume haemoptysis can indicate significant internal bleeding. Small streaks are deliberately not matched — the user is told to seek prompt review instead.",
    validated: false,
    patterns: rx(
      "vomiting blood",
      "vomited blood",
      "throwing up blood",
      "threw up blood",
      "blood in my vomit",
      "coughing up blood",
      "coughed up blood",
      "coughing large amounts of blood",
      "haemoptysis",
      "hemoptysis",
      "haematemesis",
      "hematemesis",
      "vomiting blood repeatedly",
      "bright red blood"
    ),
  },
  {
    id: "chest_pain",
    label: "Chest pain or pressure",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Chest pain or pressure may be a cardiac or vascular event.",
    rationale:
      "New chest pain or pressure is conventionally treated as an emergency because myocardial ischaemia and aortic dissection are time-critical. Deliberately broad: mild musculoskeletal pain is an accepted false positive.",    negationAware: true,
    validated: false,
    patterns: rx(
      "chest pain",
      "chest pains",
      "chest pressure",
      "pressure in my chest",
      "tightness in my chest",
      "crushing chest",
      "chest tightness",
      "pain in my chest",
      "pain radiating to my arm",
      "pain in my left arm",
      "pain in my jaw"
    ),
  },
  {
    id: "seizure",
    label: "Seizure activity",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "An ongoing or first seizure needs emergency assessment.",
    rationale:
      "Convulsions may represent epilepsy, hypoglycaemia, infection, intoxication or a structural brain lesion. Ongoing convulsions require immediate management.",
    validated: false,
    patterns: rx(
      "seizure",
      "seizures",
      "convulsion",
      "convulsions",
      "convulsing",
      "fitting",
      "fits",
      "status epilepticus",
      "epileptic fit",
      "jerking all over",
      "shaking uncontrollably"
    ),
  },
  {
    id: "suicidal_intent",
    label: "Statement about self-harm",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "Thoughts of harming yourself need immediate human support.",
    rationale:
      "Where a person describes intent or a plan to self-harm, the correct response is immediate human contact with emergency or crisis services, not software. Wording is matched conservatively to avoid trivialising the statement.",
    validated: false,
    patterns: rx(
      "kill myself",
      "killing myself",
      "end my life",
      "end my own life",
      "take my own life",
      "suicide",
      "suicidal",
      "harm myself",
      "hurting myself",
      "want to die",
      "wanna die",
      "better off dead",
      "self harm"
    ),
  },
  {
    id: "overdose_or_toxic_ingestion",
    label: "Overdose or toxic ingestion",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "An overdose or ingestion of a toxic substance can be life-threatening.",
    rationale:
      "Deliberate or accidental ingestion of a toxic quantity requires immediate assessment and, where relevant, decontamination.",
    validated: false,
    patterns: rx(
      "overdose",
      "overdosed",
      "took too many pills",
      "taken too many pills",
      "swallowed pills",
      "drank bleach",
      "drank poison",
      "ate something poisonous",
      "poisoned myself",
      "chemical burn on my skin",
      "inhaled chemicals"
    ),
  },
  {
    id: "sudden_severe_headache",
    label: "Sudden severe headache",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "A thunderclap headache can signal a bleed or other time-critical event.",
    rationale:
      "Headache reaching maximal intensity within seconds to a minute is conventionally separated from ordinary headache because of associations with subarachnoid and other intracranial events.",    negationAware: true,
    validated: false,
    patterns: rx(
      "worst headache of my life",
      "worst headache ever",
      "thunderclap headache",
      "sudden severe headache",
      "sudden worst headache",
      "exploding headache",
      "splitting headache"
    ),
  },
  {
    id: "meningeal_features",
    label: "Stiff neck with fever",
    severity: "escalate",
    urgency: "EMERGENCY",
    why: "A stiff neck alongside fever or rash needs urgent assessment for meningitis.",
    rationale:
      "Neck stiffness with fever or a non-blanching rash is a conventionally recognised emergency presentation. Both elements are required to reduce false positives.",
    validated: false,
    evaluate: (ctx) => {
      const neck = findPhrases(
        ctx.text,
        rx("stiff neck", "neck stiffness", "neck is stiff", "stiff neck and", "rigid neck", "cannot bend my neck", "can not bend my neck", "hurts to bend my neck")
      );
      if (neck.length === 0) return false;
      const fever = findPhrases(ctx.text, rx("fever", "feverish", "high temperature", "temperature of", "febrile"));
      const rash = findPhrases(ctx.text, rx("rash", "non blanching", "does not fade", "doesnt fade", "purple spots", "red spots that do not fade"));
      return fever.length > 0 || rash.length > 0;
    },
  },

  /* ---------------- URGENT: same-day review ---------------------- */
  {
    id: "acute_confusion",
    label: "New confusion or altered awareness",
    severity: "escalate",
    urgency: "URGENT",
    why: "New confusion can be an early sign of infection, dehydration, medication effects or stroke.",
    rationale:
      "Acute confusion is treated as a significant change in clinical state. Escalated to URGENT rather than EMERGENCY because the level depends on vital signs and examination findings that are not available here.",    negationAware: true,
    validated: false,
    patterns: rx(
      "confused",
      "confusion",
      "disoriented",
      "not making sense",
      "delirious",
      "delirium",
      "muddled thinking",
      "do not know where i am",
      "does not know where he is",
      "does not know where she is",
      "memory problems suddenly",
      "suddenly very sleepy",
      "hard to wake",
      "difficult to wake"
    ),
  },
  {
    id: "severe_abdominal_pain",
    label: "Severe abdominal pain",
    severity: "escalate",
    urgency: "URGENT",
    why: "Severe or persistent abdominal pain should be examined the same day.",
    rationale:
      "Severe abdominal pain has a wide differential including appendicitis, obstruction, perforation and pancreatitis, which are time-sensitive.",
    validated: false,
    evaluate: (ctx) => {
      const pain = findPhrases(ctx.text, rx("abdominal pain", "stomach pain", "belly pain", "tummy pain", "stomach ache", "tummy ache", "pain in my abdomen", "side pain"));
      if (pain.length === 0) return false;
      const severe = findPhrases(ctx.text, rx("severe", "worst", "excruciating", "unbearable", "worst pain", "10 out of 10", "10/10", "9 out of 10", "9/10", "cannot touch", "can not touch", "guarding", "double vision"));
      return severe.length > 0;
    },
  },
  {
    id: "hyperpyrexia",
    label: "Very high reported temperature",
    severity: "escalate",
    urgency: "URGENT",
    why: "A very high reported temperature merits same-day clinical advice.",
    rationale:
      "Temperature alone is a weak discriminator; it is used only to prompt human review. See THRESHOLDS.urgentTemperatureC.",
    validated: false,
    evaluate: (ctx) =>
      ctx.temperatureC !== undefined && ctx.temperatureC >= THRESHOLDS.urgentTemperatureC,
  },
  {
    id: "low_oxygen_saturation",
    label: "Low reported oxygen saturation",
    severity: "escalate",
    urgency: "URGENT",
    why: "A low home oxygen-saturation reading should be reviewed the same day.",
    rationale:
      "Consumer pulse oximeters are frequently inaccurate; this rule prompts review rather than asserting hypoxaemia. See THRESHOLDS.urgentSpo2.",
    validated: false,
    evaluate: (ctx) => ctx.spo2 !== undefined && ctx.spo2 < THRESHOLDS.urgentSpo2,
  },
  {
    id: "infant_with_fever",
    label: "Fever in a very young infant",
    severity: "escalate",
    urgency: "URGENT",
    why: "Fever in a very young baby needs same-day medical review.",
    rationale:
      "Young infants can deteriorate quickly with serious infection and are conventionally reviewed promptly. See THRESHOLDS.infantFeverAgeMonths.",
    validated: false,
    evaluate: (ctx) => {
      if (ctx.age === undefined || ctx.age >= THRESHOLDS.infantFeverAgeMonths) return false;
      return findPhrases(ctx.text, rx("fever", "feverish", "high temperature", "temperature of")).length > 0;
    },
  },
  {
    id: "older_adult_confusion",
    label: "New confusion in an older adult",
    severity: "escalate",
    urgency: "URGENT",
    why: "Sudden confusion in an older adult is treated as a significant change.",
    rationale:
      "Delirium in older adults is commonly the presenting sign of infection, dehydration or medication toxicity. See THRESHOLDS.olderAdultAgeYears.",
    validated: false,
    evaluate: (ctx) => {
      if (ctx.age === undefined || ctx.age < THRESHOLDS.olderAdultAgeYears) return false;
      return (
        findPhrases(ctx.text, rx("confused", "confusion", "disoriented", "delirious", "suddenly very sleepy", "not making sense")).length > 0
      );
    },
  },
  {
    id: "dehydration_signs",
    label: "Possible dehydration",
    severity: "urgent_review",
    urgency: "URGENT",
    why: "Not passing urine, marked dizziness or sunken eyes can indicate dehydration.",
    rationale:
      "Dehydration is common and treatable but can become serious, particularly in children and older adults. Requires more than one sign to fire.",
    validated: false,
    evaluate: (ctx) => {
      const signs = findPhrases(
        ctx.text,
        rx(
          "not passed urine",
          "not passed any urine",
          "not passing urine",
          "not passing any urine",
          "have not urinated",
          "no urine since",
          "not urinating",
          "no urine",
          "very little urine",
          "sunken eyes",
          "sunken fontanelle",
          "dry mouth",
          "no tears when crying",
          "dizzy when standing",
          "faint when standing",
          "lightheaded when standing"
        )
      );
      return signs.length >= 2;
    },
  },
  {
    id: "seizure_first_time_or_recent",
    label: "First or recent seizure",
    severity: "urgent_review",
    urgency: "URGENT",
    why: "A first seizure, or any seizure, needs medical review.",
    rationale:
      "Any convulsive episode warrants assessment. Overlaps with the seizure emergency rule but fires even when the wording is softer.",
    validated: false,
    patterns: rx("blackout", "blanked out", "went blank", "jerked", "jerking", "twitching", "whole body stiff"),
  },

  /* ---------------- MONITOR -------------------------------------- */
  {
    id: "fever_present",
    label: "Fever reported",
    severity: "monitor",
    urgency: "PROMPT_MEDICAL_REVIEW",
    why: "Fever is tracked so its duration and pattern can be reviewed.",
    rationale:
      "Fever on its own is usually self-limiting, so this rule only raises the floor to PROMPT_MEDICAL_REVIEW when it is combined with the rule set defaults for a symptomatic presentation.",
    validated: false,
    patterns: rx("fever", "feverish", "high temperature", "temperature of", "running a temperature", "febrile"),
  },
  {
    id: "prolonged_symptom",
    label: "Symptom persisting for an extended period",
    severity: "monitor",
    urgency: "PROMPT_MEDICAL_REVIEW",
    why: "A symptom lasting several weeks normally warrants a booked review.",
    rationale: "See THRESHOLDS.prolongedSymptomDays.",
    validated: false,
    evaluate: (ctx) => {
      const days = parseDurationDays(normalizeText(ctx.durationText));
      return days !== undefined && days >= THRESHOLDS.prolongedSymptomDays;
    },
  },
];

export const RULE_IDS: string[] = RULES.map((r) => r.id);

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

export interface EvaluateOptions {
  /**
   * Level suggested by the model. The deterministic layer can only raise it.
   * Defaults to the floor for a symptomatic presentation.
   */
  aiProposedLevel?: UrgencyLevel;
  /** When true, suppress the low-signal monitor rules (used for cheap pre-checks). */
  includeMonitorRules?: boolean;
}

const EMERGENCY_BANNER =
  "Based on what you have described, contact your local emergency number or go to the nearest emergency department now. " +
  "Do not wait for this application to finish analysing, and do not rely on it in place of emergency care.";

const CRISIS_BANNER =
  "If you are thinking about harming yourself, please contact your local emergency number or a crisis helpline now, " +
  "and stay with someone you trust. Support is available.";

function ruleMatches(rule: TriageRule, ctx: RuleContext): boolean {
  if (rule.patterns) {
    const matches = findPhrases(ctx.text, rule.patterns);
    const effective = rule.negationAware
      ? matches.filter((m) => !isNegated(ctx.text, m.index))
      : matches;
    if (effective.length > 0) return true;
  }
  if (rule.evaluate) {
    // Composite rules do their own matching. They are never negation-suppressed:
    // several of them encode an *absence* symptom ("not passed urine"), where a
    // negation cue is part of the finding rather than a contradiction of it.
    return rule.evaluate(ctx);
  }
  return false;
}

/**
 * Evaluate the deterministic rule set against a case.
 *
 * `escalated` is true whenever the rules produced a level above the supplied
 * baseline, which the results UI uses to state that the safety layer, not the
 * model, determined the urgency.
 */
export function evaluateRedFlags(
  caseData: Partial<MedicalCase>,
  options: EvaluateOptions = {},
): TriageResult {
  const ctx = buildRuleContext(caseData);
  const includeMonitor = options.includeMonitorRules ?? true;

  const fired: Array<{ rule: TriageRule; finding: RedFlagFinding }> = [];

  for (const rule of RULES) {
    if (!includeMonitor && rule.severity === "monitor") continue;
    if (!ruleMatches(rule, ctx)) continue;

    fired.push({
      rule,
      finding: {
        flag: rule.label,
        why: rule.why,
        source: "deterministic_rule",
        severity: rule.severity,
      },
    });
  }

  const baseline: UrgencyLevel = options.aiProposedLevel ?? "NON_URGENT";
  let level: UrgencyLevel = baseline;
  let escalated = false;

  for (const { rule } of fired) {
    if (urgencyRank(rule.urgency) > urgencyRank(level)) {
      level = rule.urgency;
      escalated = true;
    }
  }

  const redFlags = fired.map((f) => f.finding);
  const firedRuleIds = fired.map((f) => f.rule.id);

  const crisis = firedRuleIds.includes("suicidal_intent");
  const emergencyNotice =
    level === "EMERGENCY" ? (crisis ? CRISIS_BANNER : EMERGENCY_BANNER) : null;

  const notes: string[] = [];
  if (escalated) {
    notes.push(
      "Urgency was raised by the deterministic safety rules, independently of the language model.",
    );
  }
  if (fired.some((f) => f.rule.severity === "monitor")) {
    notes.push("Monitor-level observations are included for context and do not by themselves indicate an emergency.");
  }

  return {
    level,
    escalated,
    redFlags,
    emergencyNotice,
    firedRules: firedRuleIds,
    notes,
  };
}

/**
 * Fast pre-flight scan used before the user continues through the wizard.
 *
 * Returns only escalate/urgent_review rules so a trivial "fever" does not trip
 * a warning banner on step one.
 */
export function scanForUrgentRedFlags(input: {
  symptoms: string[];
  answers?: Array<{ question: string; answer: string }>;
  freeText?: string;
  age?: number;
}): TriageResult {
  const partial: Partial<MedicalCase> = {
    demographics: input.age === undefined ? {} : { age: input.age },
    symptoms: input.symptoms.map((name) => ({ name, source: "user_selected" })),
    answers: (input.answers ?? []).map((a) => ({ question: a.question, answer: a.answer })),
    freeText: input.freeText ?? "",
    medicalHistory: [],
    medications: [],
    allergies: [],
    documents: [],
  };
  return evaluateRedFlags(partial, { includeMonitorRules: false });
}

/** Public description of the rule set for the transparency panel in the UI. */
export function describeRuleSet(): Array<{
  id: string;
  label: string;
  urgency: UrgencyLevel;
  rationale: string;
  validated: boolean;
}> {
  return RULES.map((r) => ({
    id: r.id,
    label: r.label,
    urgency: r.urgency,
    rationale: r.rationale,
    validated: r.validated,
  }));
}