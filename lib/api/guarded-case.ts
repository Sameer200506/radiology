/**
 * Shared case-snapshot validation for stateless AI routes.
 *
 * The browser sends the case because the route has no database of its own. That
 * makes the request body untrusted input into a route whose output is rendered
 * as clinical content, so it is validated with exactly the same schema the
 * original server-side pipeline used.
 *
 * No trust is placed in anything the client asserts about urgency: the
 * deterministic triage layer is re-run server-side from this snapshot.
 */

import { caseSnapshotSchema } from "@/lib/ai/schemas";
import type { MedicalCase } from "@/types/medical";

export const guardedCaseSchema = caseSnapshotSchema;

export type GuardedCase = MedicalCase;