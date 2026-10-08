"use client";

/**
 * Client-side data layer — the single source of truth for reads and writes.
 *
 * ## Why this exists
 *
 * The original design used the Firebase Admin SDK from Route Handlers, which
 * requires a service account (a private key). A Firebase *web* config cannot
 * authorise server-side writes, so with the web config alone the app could sign
 * users in and then store nothing at all. Since the web config is the credential
 * a web deployment can actually be given, persistence moved here.
 *
 * ## What this means for security
 *
 * Every read and write now goes through the browser SDK and is therefore
 * checked by Firestore and Storage Security Rules. Those rules are the access
 * boundary — they run inside Firebase and cannot be bypassed by a modified
 * client. See firestore.rules and storage.rules.
 *
 * Two honest consequences of the client writing its own data:
 *
 *  - A signed-in user can write their OWN assessment, analysis, upload and
 *    report records. They cannot read or touch anyone else's, because the rules
 *    scope every path to `auth.uid`.
 *  - The "clients cannot write AI results" guarantee no longer holds. A user
 *    could in principle tamper with the stored copy of their own analysis. The
 *    impact is self-misleading only — the server still validated and returned
 *    the result, and no other user's data is reachable. Every analysis record is
 *    stamped with the model and prompt version so tampering is at least visible.
 *
 * ## What stays server-side
 *
 * Only two things need a server: the OpenRouter API key and PDF/vision payloads.
 * Route Handlers under /api/ai/* therefore remain stateless — they receive
 * content in the request body and return validated JSON. They never touch
 * Storage, which is why no Admin credential is required for them either.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query as fsQuery,
  setDoc,
  startAfter,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
  type UploadTask,
} from "firebase/storage";

import { requireFirebase } from "@/lib/firebase/client";
import { buildStoragePath, isSafeIdSegment } from "@/lib/security/access";
import type { AssessmentSummary, ReportRecord, StoredAnalysis, UserProfile } from "@/types/assessment";
import type { AssessmentDoc, Paged, UploadRecord } from "@/types/firebase";
import type { DocumentKind } from "@/types/medical";

export const COLLECTIONS = {
  users: "users",
  assessments: "assessments",
  answers: "answers",
  uploads: "uploads",
  analysis: "analysis",
  reports: "reports",
  auditLogs: "auditLogs",
} as const;

export function nowIso(): string {
  return new Date().toISOString();
}

/** Firestore rejects `/` and empty ids; the app never generates either. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function assertSafeId(id: string, label: string): string {
  if (!isSafeIdSegment(id)) {
    throw new Error(`Refusing to use an unsafe ${label}.`);
  }
  return id;
}

/** Current signed-in uid. Throws rather than writing under an anonymous path. */
function requireUid(): string {
  const { auth } = requireFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error("You must be signed in to read or write your assessments.");
  }
  return assertSafeId(uid, "user id");
}

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS: UserProfile["settings"] = {
  theme: "system",
  reducedMotion: false,
  analyticsOptIn: false,
  disclaimerAcknowledgedAt: null,
};

/**
 * Creates the profile document on first sign-in.
 *
 * Runs from the browser after a successful sign-in so that ownership is proven
 * by the rules rather than assumed server-side.
 */
export async function ensureUserProfile(input: {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}): Promise<void> {
  const { db } = requireFirebase();
  assertSafeId(input.uid, "user id");

  const ref = doc(db, COLLECTIONS.users, input.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  await setDoc(
    ref,
    {
      uid: input.uid,
      email: input.email,
      displayName: input.displayName ?? input.email?.split("@")[0] ?? "MedAssist user",
      photoURL: input.photoURL,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      defaultAge: null,
      defaultSex: null,
      isDemo: false,
      settings: DEFAULT_SETTINGS,
    },
    { merge: true },
  );
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const { db } = requireFirebase();
  assertSafeId(uid, "user id");
  const snapshot = await getDoc(doc(db, COLLECTIONS.users, uid));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  const settings = (data.settings ?? {}) as Partial<UserProfile["settings"]>;

  return {
    displayName: String(data.displayName ?? ""),
    email: String(data.email ?? ""),
    photoURL: typeof data.photoURL === "string" ? data.photoURL : null,
    createdAt: String(data.createdAt ?? nowIso()),
    updatedAt: String(data.updatedAt ?? nowIso()),
    defaultAge: typeof data.defaultAge === "number" ? data.defaultAge : null,
    defaultSex: typeof data.defaultSex === "string" ? data.defaultSex : null,
    isDemo: data.isDemo === true,
    settings: {
      theme: settings.theme ?? "system",
      reducedMotion: settings.reducedMotion === true,
      analyticsOptIn: settings.analyticsOptIn === true,
      disclaimerAcknowledgedAt:
        typeof settings.disclaimerAcknowledgedAt === "string" ? settings.disclaimerAcknowledgedAt : null,
    },
  };
}

export async function updateUserProfile(
  patch: Partial<Pick<UserProfile, "displayName" | "defaultAge" | "defaultSex" | "settings">>,
): Promise<void> {
  const { db } = requireFirebase();
  const uid = requireUid();

  const payload: Record<string, unknown> = { ...patch, updatedAt: nowIso() };
  if (patch.settings) {
    const existing = await getUserProfile(uid);
    payload.settings = { ...(existing?.settings ?? DEFAULT_SETTINGS), ...patch.settings };
  }

  await setDoc(doc(db, COLLECTIONS.users, uid), payload, { merge: true });
}

export async function deleteUserAccount(): Promise<void> {
  const { db, auth, storage } = requireFirebase();
  const uid = requireUid();

  // 1. Uploaded files, so Storage does not keep orphans.
  const owned = await listAllAssessments(uid);
  for (const assessment of owned) {
    for (const upload of await listUploads(uid, assessment.id)) {
      await deleteObject(storageRef(storage, upload.storagePath)).catch(() => undefined);
    }
  }

  // 2. Every child collection of every assessment.
  for (const assessment of owned) {
    await deleteCollectionRecursive(db, `assessments/${assessment.id}/answers`);
    await deleteCollectionRecursive(db, `assessments/${assessment.id}/uploads`);
    await deleteCollectionRecursive(db, `assessments/${assessment.id}/analysis`);
    await deleteDoc(doc(db, COLLECTIONS.assessments, assessment.id));
  }

  // 3. Reports and audit records.
  //
  // Scoped by `userId`, not a bare collection read. The rules only permit
  // listing your own reports, so an unscoped query would be evaluated against
  // every report in the database and rejected outright — the cascade would fail
  // on the first batch and silently leave data behind.
  for (;;) {
    const snapshot = await getDocs(
      fsQuery(collection(db, COLLECTIONS.reports), where("userId", "==", uid), fsLimit(400)),
    );
    if (snapshot.empty) break;

    const batch = writeBatch(db);
    for (const item of snapshot.docs) batch.delete(item.ref);
    await batch.commit();
  }

  await deleteCollectionRecursive(db, `${COLLECTIONS.users}/${uid}/${COLLECTIONS.auditLogs}`);

  // 4. Profile, then the Auth account itself.
  await deleteDoc(doc(db, COLLECTIONS.users, uid)).catch(() => undefined);
  await auth.currentUser?.delete();
}

/** Batched deletion, because Firestore caps a batch at 500 writes. */
async function deleteCollectionRecursive(db: import("firebase/firestore").Firestore, path: string): Promise<void> {
  for (;;) {
    const snapshot = await getDocs(fsQuery(collection(db, path), fsLimit(400)));
    if (snapshot.empty) return;
    const batch = writeBatch(db);
    for (const item of snapshot.docs) batch.delete(item.ref);
    await batch.commit();
  }
}

/* ------------------------------------------------------------------ *
 * Assessments
 * ------------------------------------------------------------------ */

export interface CreateAssessmentInput {
  title: string;
  symptomSummary: string;
  isDemo: boolean;
  caseData: AssessmentDoc["caseData"];
}

export async function createAssessment(input: CreateAssessmentInput): Promise<AssessmentDoc> {
  const { db } = requireFirebase();
  const uid = requireUid();

  const id = newId();
  const now = nowIso();

  const record: AssessmentDoc = {
    id,
    userId: uid,
    title: input.title.slice(0, 160),
    symptomSummary: input.symptomSummary.slice(0, 200),
    status: "draft",
    stage: "information",
    urgency: null,
    fileCount: 0,
    isDemo: input.isDemo,
    createdAt: now,
    updatedAt: now,
    caseData: input.caseData,
  };

  await setDoc(doc(db, COLLECTIONS.assessments, id), record);
  return record;
}

export async function getAssessment(userId: string, assessmentId: string): Promise<AssessmentDoc | null> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");

  const snapshot = await getDoc(doc(db, COLLECTIONS.assessments, assessmentId));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as AssessmentDoc;
  // Defence in depth: the rules already scope this, but a stray document must
  // not be readable just because it happens to exist.
  if (data.userId !== userId) return null;
  return data;
}

export async function updateAssessment(
  userId: string,
  assessmentId: string,
  patch: Partial<AssessmentDoc>,
): Promise<void> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");

  const existing = await getAssessment(userId, assessmentId);
  if (!existing) throw new Error("Assessment not found.");

  await setDoc(doc(db, COLLECTIONS.assessments, assessmentId), { ...patch, updatedAt: nowIso() }, {
    merge: true,
  });
}

export async function deleteAssessment(userId: string, assessmentId: string): Promise<void> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");

  const existing = await getAssessment(userId, assessmentId);
  if (!existing) throw new Error("Assessment not found.");

  for (const child of [COLLECTIONS.answers, COLLECTIONS.uploads, COLLECTIONS.analysis]) {
    await deleteCollectionRecursive(db, `${COLLECTIONS.assessments}/${assessmentId}/${child}`);
  }
  await deleteDoc(doc(db, COLLECTIONS.assessments, assessmentId));
}

export interface ListAssessmentsOptions {
  limit?: number;
  cursor?: string | null;
  status?: string;
  urgency?: string;
}

export async function listAssessments(
  userId: string,
  options: ListAssessmentsOptions = {},
): Promise<Paged<AssessmentSummary>> {
  const { db } = requireFirebase();
  requireUid();

  const pageSize = Math.min(Math.max(options.limit ?? 10, 1), 50);

  const constraints: Array<ReturnType<typeof fsQuery> extends never ? never : unknown> = [];
  void constraints;

  let q = fsQuery(
    collection(db, COLLECTIONS.assessments),
    where("userId", "==", userId),
  );
  if (options.status) q = fsQuery(q, where("status", "==", options.status)) as typeof q;
  if (options.urgency) q = fsQuery(q, where("urgency", "==", options.urgency)) as typeof q;
  q = fsQuery(q, orderBy("updatedAt", "desc"), fsLimit(pageSize + 1)) as typeof q;

  if (options.cursor) {
    const cursorSnapshot = await getDoc(doc(db, COLLECTIONS.assessments, options.cursor));
    if (cursorSnapshot.exists()) {
      q = fsQuery(q, startAfter(cursorSnapshot)) as typeof q;
    }
  }

  const snapshot = await getDocs(q);
  const docs = snapshot.docs.slice(0, pageSize);

  const items: AssessmentSummary[] = docs.map((item) => {
    const data = item.data() as AssessmentDoc;
    return {
      id: data.id ?? item.id,
      title: data.title,
      symptomSummary: data.symptomSummary,
      status: data.status,
      urgency: data.urgency,
      fileCount: data.fileCount ?? 0,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      isDemo: data.isDemo === true,
    };
  });

  const last = docs[docs.length - 1];
  const hasMore = snapshot.docs.length > pageSize;

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? (last.data() as AssessmentDoc).id ?? last.id : null,
  };
}

/** Every assessment the user owns, following pagination. Used by account deletion. */
async function listAllAssessments(userId: string): Promise<AssessmentSummary[]> {
  const out: AssessmentSummary[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: Paged<AssessmentSummary> = await listAssessments(userId, { limit: 50, cursor });
    out.push(...page.items);
    if (!page.hasMore || !page.nextCursor) return out;
    cursor = page.nextCursor;
  }
}

/* ------------------------------------------------------------------ *
 * Answers
 * ------------------------------------------------------------------ */

export async function saveAnswers(
  userId: string,
  assessmentId: string,
  answers: Array<{ questionId: string; question: string; answer: string }>,
): Promise<number> {
  const { db } = requireFirebase();
  const uid = requireUid();
  assertSafeId(assessmentId, "assessment id");

  const existing = await getAssessment(userId, assessmentId);
  if (!existing) throw new Error("Assessment not found.");

  const batch = writeBatch(db);
  const now = nowIso();
  for (const answer of answers) {
    batch.set(
      doc(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.answers, answer.questionId),
      { ...answer, assessmentId, userId: uid, createdAt: now, updatedAt: now },
    );
  }
  await batch.commit();
  return answers.length;
}

/* ------------------------------------------------------------------ *
 * Uploads — Storage write + Firestore metadata
 * ------------------------------------------------------------------ */

export interface UploadResult {
  record: UploadRecord;
  previewUrl: string | null;
}

/**
 * Uploads bytes straight to Storage, then registers the metadata.
 *
 * The private cache-control header is required by storage.rules, which refuses
 * anything that could become publicly cacheable.
 */
export async function uploadFile(
  userId: string,
  assessmentId: string,
  params: {
    fileName: string;
    displayName: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    kind: DocumentKind;
    file: Blob;
  },
): Promise<UploadResult> {
  const { db, storage } = requireFirebase();
  const uid = requireUid();
  assertSafeId(assessmentId, "assessment id");

  const assessment = await getAssessment(userId, assessmentId);
  if (!assessment) throw new Error("Assessment not found.");

  const id = newId();
  const extension = /\.[A-Za-z0-9]{1,10}$/.exec(params.fileName)?.[0].toLowerCase() ?? ".bin";
  const storagePath = buildStoragePath({
    userId: uid,
    assessmentId,
    fileId: id,
    extension,
  });

  const task: UploadTask = uploadBytesResumable(
    storageRef(storage, storagePath),
    params.file,
    {
      contentType: params.mimeType,
      // storage.rules rejects anything that is not explicitly private.
      customMetadata: { cacheControl: "private, max-age=0, no-store" },
    },
  );

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      () => undefined,
      (error) => reject(error),
      () => resolve(),
    );
  });

  const now = nowIso();
  const record: UploadRecord = {
    id,
    userId: uid,
    assessmentId,
    fileName: params.fileName,
    displayName: params.displayName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    contentHash: params.contentHash,
    kind: params.kind,
    storagePath,
    status: "uploaded",
    textExtracted: false,
    characterCount: 0,
    pageCount: 0,
    createdAt: now,
    updatedAt: now,
    errorCode: null,
  };

  await setDoc(doc(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.uploads, id), record);

  await updateAssessment(userId, assessmentId, {
    fileCount: (assessment.fileCount ?? 0) + 1,
    stage: "documents",
  });

  let previewUrl: string | null = null;
  if (params.mimeType.startsWith("image/")) {
    // The signed read rule allows this for the owner only.
    previewUrl = await getDownloadURL(storageRef(storage, storagePath)).catch(() => null);
  }

  return { record, previewUrl };
}

export async function updateUpload(
  userId: string,
  assessmentId: string,
  uploadId: string,
  patch: Partial<UploadRecord>,
): Promise<void> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");
  assertSafeId(uploadId, "upload id");

  await setDoc(
    doc(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.uploads, uploadId),
    { ...patch, updatedAt: nowIso() },
    { merge: true },
  );
}

export async function listUploads(userId: string, assessmentId: string): Promise<UploadRecord[]> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");

  const assessment = await getAssessment(userId, assessmentId);
  if (!assessment) return [];

  const snapshot = await getDocs(
    collection(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.uploads),
  );

  return snapshot.docs
    .map((item) => item.data() as UploadRecord)
    .filter((record) => record.userId === userId);
}

export async function deleteUpload(
  userId: string,
  assessmentId: string,
  uploadId: string,
): Promise<void> {
  const { db, storage } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");
  assertSafeId(uploadId, "upload id");

  const snapshot = await getDoc(
    doc(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.uploads, uploadId),
  );
  if (!snapshot.exists()) return;

  const record = snapshot.data() as UploadRecord;
  if (record.userId !== userId) return;

  await deleteObject(storageRef(storage, record.storagePath)).catch(() => undefined);
  await deleteDoc(doc(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.uploads, uploadId));

  const remaining = (await listUploads(userId, assessmentId)).length;
  await updateAssessment(userId, assessmentId, { fileCount: remaining });
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

export interface SaveAnalysisInput {
  userId: string;
  assessmentId: string;
  triage: StoredAnalysis["triage"];
  result: StoredAnalysis["result"];
  caseData: StoredAnalysis["caseData"];
  audit: StoredAnalysis["audit"];
}

export async function saveAnalysis(input: SaveAnalysisInput): Promise<StoredAnalysis> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(input.assessmentId, "assessment id");

  const existing = await getAssessment(input.userId, input.assessmentId);
  if (!existing) throw new Error("Assessment not found.");

  const id = newId();
  const record: StoredAnalysis = {
    id,
    assessmentId: input.assessmentId,
    createdAt: nowIso(),
    triage: input.triage,
    result: input.result,
    caseData: input.caseData,
    audit: input.audit,
  };

  await setDoc(
    doc(db, COLLECTIONS.assessments, input.assessmentId, COLLECTIONS.analysis, id),
    record,
  );
  return record;
}

export async function getLatestAnalysis(
  userId: string,
  assessmentId: string,
): Promise<StoredAnalysis | null> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(assessmentId, "assessment id");

  const assessment = await getAssessment(userId, assessmentId);
  if (!assessment) return null;

  const snapshot = await getDocs(
    fsQuery(
      collection(db, COLLECTIONS.assessments, assessmentId, COLLECTIONS.analysis),
      orderBy("createdAt", "desc"),
      fsLimit(1),
    ),
  );

  const item = snapshot.docs[0] as QueryDocumentSnapshot<DocumentData> | undefined;
  return item ? (item.data() as StoredAnalysis) : null;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export async function saveReport(userId: string, assessmentId: string, title: string): Promise<ReportRecord> {
  const { db } = requireFirebase();
  const uid = requireUid();
  assertSafeId(assessmentId, "assessment id");

  const id = newId();
  const record: ReportRecord = {
    id,
    assessmentId,
    title,
    createdAt: nowIso(),
    shareId: null,
    shareEnabled: false,
  };

  await setDoc(doc(db, COLLECTIONS.reports, id), { ...record, userId: uid });
  return record;
}

export async function listReports(limit = 25): Promise<ReportRecord[]> {
  const { db } = requireFirebase();
  const uid = requireUid();

  const snapshot = await getDocs(
    fsQuery(
      collection(db, COLLECTIONS.reports),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      fsLimit(Math.min(Math.max(limit, 1), 50)),
    ),
  );

  return snapshot.docs.map((item) => {
    const data = item.data() as ReportRecord & { id?: string };
    return { ...data, id: data.id ?? item.id };
  });
}

export async function setReportSharing(reportId: string, enabled: boolean): Promise<ReportRecord | null> {
  const { db } = requireFirebase();
  const uid = requireUid();
  assertSafeId(reportId, "report id");

  const snapshot = await getDoc(doc(db, COLLECTIONS.reports, reportId));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as ReportRecord & { userId?: string };
  if (data.userId !== uid) return null;

  const shareId = enabled ? reportId : null;

  // The share token IS the document id, so the rules can authorise a read with a
  // single `get` and no query. The id is a random 128-bit-ish value that is never
  // derived from anything guessable, so it is a bearer token by construction.
  // The rules pin `shareId == reportId`, which stops a client from pointing
  // sharing at some other record.

  // The analysis is copied onto the report document because the shared reader is
  // signed out and the rules deliberately keep `assessments/**/analysis` owner-only.
  // This snapshot is the thing being shared, so the copy is frozen at the moment
  // sharing is enabled rather than tracking later edits.
  let sharedAnalysis: StoredAnalysis | null = null;
  if (enabled) {
    const assessment = await getAssessment(uid, data.assessmentId);
    if (assessment) sharedAnalysis = await getLatestAnalysis(uid, assessment.id);
  }

  await setDoc(
    doc(db, COLLECTIONS.reports, reportId),
    // Disabling sharing must also remove the snapshot, not merely hide it.
    { shareEnabled: enabled, shareId, sharedAnalysis: sharedAnalysis ?? null },
    { merge: true },
  );

  return { ...data, shareEnabled: enabled, shareId };
}

/**
 * Reads a report through a share token.
 *
 * No authentication is required: the rules allow a single `get` on a document
 * whose `shareEnabled` is true and whose `shareId` matches its own id. The
 * snapshot is returned even if the caller is signed out, which is the point.
 */
export async function getSharedReport(shareId: string): Promise<ReportRecord | null> {
  const { db } = requireFirebase();
  assertSafeId(shareId, "share id");

  const snapshot = await getDoc(doc(db, COLLECTIONS.reports, shareId));
  if (!snapshot.exists()) return null;

  const data = snapshot.data() as ReportRecord & {
    userId?: string;
    shareEnabled?: boolean;
    sharedAnalysis?: StoredAnalysis | null;
  };
  if (data.shareEnabled !== true || data.shareId !== shareId) return null;

  return { ...data, id: shareId };
}

export async function deleteReport(reportId: string): Promise<void> {
  const { db } = requireFirebase();
  requireUid();
  assertSafeId(reportId, "report id");
  await deleteDoc(doc(db, COLLECTIONS.reports, reportId));
}

/* ------------------------------------------------------------------ *
 * Audit log
 * ------------------------------------------------------------------ */

export interface AuditEvent {
  action: string;
  resourceType: "assessment" | "upload" | "report" | "auth" | "session";
  resourceId: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Append-only audit trail.
 *
 * Stored under the user document so the rules can scope writes to the owner.
 * Deliberately carries no clinical content and no raw prompts.
 */
export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    const { db } = requireFirebase();
    const uid = requireUid();

    await addDoc(collection(db, COLLECTIONS.users, uid, COLLECTIONS.auditLogs), {
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      at: nowIso(),
      metadata: event.metadata ?? {},
    });
  } catch {
    // Audit logging must never break the user's request.
  }
}