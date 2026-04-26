import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import type { CampusProfileDoc } from "@/lib/campus-auth";
import { normalizeCampusRole } from "@/lib/campus-role";
import { createCampusLogger } from "@/lib/campus-logger";
import type { BulkStudentImportInputSchema } from "@/lib/bulkStudentImport";

export const CAMPUS_FUNCTIONS_REGION =
  process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() ||
  "asia-southeast1";

type ResolveSchoolIdLoginResponse = {
  email?: string | null;
  found?: boolean;
  source?: "auth" | "profile" | "fallback" | "missing";
};
type CampusProfileResponse = {
  profile?: CampusProfileDoc | null;
};
type FinalizeCampusProfileResponse = {
  finalized?: boolean;
  profile?: CampusProfileDoc | null;
};
export type CreateCampusEventPayload = {
  title: string;
  location?: string;
  date: string;
  scheduledTime: string;
  timeStart?: string;
  timeEnd: string;
  yearLevel?: string;
  course?: string;
  yearLevels?: string[];
  courses?: string[];
  targetStudent?: string;
  selectedStudentIds?: string[];
  selectedSchoolIds?: string[];
  details?: string;
  isPreReg?: boolean;
  withPayment?: boolean;
  paymentRequired?: boolean;
  waitlistEnabled?: boolean;
  registrationStartAt?: Date | string | number | null;
  registrationEndAt?: Date | string | number | null;
  cancellationDeadlineAt?: Date | string | number | null;
  preRegSlots?: number | null;
  paymentTitle?: string;
  paymentAmount?: number | string;
  paymentDueDate?: string;
  paymentDescription?: string;
  courseScope?: string | null;
};

export type CreateCampusEventResult = {
  eventId: string;
  linkedPaymentId: string | null;
};

export type UpdateCampusEventPayload = {
  eventId: string;
  title: string;
  location: string;
  date: string;
  scheduledTime: string;
  timeStart: string;
  timeEnd: string;
  yearLevel?: string;
  course?: string;
  yearLevels?: string[];
  courses?: string[];
  targetStudent?: string;
  selectedStudentIds?: string[];
  selectedSchoolIds?: string[];
  details?: string;
  isPreReg?: boolean;
  withPayment?: boolean;
  paymentRequired?: boolean;
  waitlistEnabled?: boolean;
  registrationStartAt?: Date | string | number | null;
  registrationEndAt?: Date | string | number | null;
  cancellationDeadlineAt?: Date | string | number | null;
  preRegSlots?: number | null;
  preRegCount?: number;
  waitlistCount?: number;
  paymentTitle?: string;
  paymentAmount?: number | string;
  paymentDueDate?: string;
  paymentDescription?: string;
  requiredPaymentId?: string;
  linkedPaymentId?: string | null;
  ownerType?: "ec" | "bod";
  createdBy?: string | null;
  createdByPosition?: string | null;
  createdByCourseScope?: string | null;
  courseScope?: string | null;
};

export type UpdateCampusEventResult = {
  eventId: string;
  updated: true;
  linkedPaymentId?: string | null;
};

export type CancelCampusEventPayload = {
  eventId: string;
  reason?: string;
};

export type CancelCampusEventResult = {
  eventId: string;
  cancelled: true;
  notifiedCount: number;
};

export type CreateCampusNotificationPayload = {
  title: string;
  message: string;
  date: string;
  scheduledTime: string;
  audienceMode?: "filtered" | "course" | "explicit";
  selectedYear?: string;
  selectedYearLevels?: string[];
  selectedCourses?: string[];
  targetStudentIds?: string[];
  targetSchoolIds?: string[];
  sendToFilteredAudience?: boolean;
  courseScope?: string | null;
  courseScopeSlug?: string | null;
};

export type CreateCampusNotificationResult = {
  dispatchId: string;
  recipientCount: number;
  batchCount: number;
  audienceMode: "filtered" | "course" | "explicit";
  recipientType: "all" | "course" | "year" | "student";
  selectedYear: string;
  course: string;
  yearLevel: string;
  targetStudent: string;
  selectedCourses: string[];
  courses: string[];
  yearLevels: string[];
  targetStudentIds: string[];
  targetSchoolIds: string[];
  sendToFilteredAudience: boolean;
  createdByRole: string;
  ownerType: "ec" | "bod";
  courseScope: string | null;
  courseScopeSlug: string | null;
  createdByCourseScope: string | null;
  resolvedRecipientUids?: string[];
  resolvedRecipientSchoolIds?: string[];
  recipientNotificationDocId?: string;
  legacyRecipientCleanupSkipped?: boolean;
  status: "scheduled" | "sent";
};

export type UpdateCampusNotificationPayload = {
  notificationId?: string;
  scheduledNotificationId?: string;
  title: string;
  message: string;
  date: string;
  scheduledTime: string;
  audienceMode?: "filtered" | "course" | "explicit";
  selectedYear?: string;
  selectedCourses?: string[];
  targetStudentIds?: string[];
  targetSchoolIds?: string[];
  sendToFilteredAudience?: boolean;
  courseScope?: string | null;
  courseScopeSlug?: string | null;
};

export type UpdateCampusNotificationResult = {
  updated: true;
  dispatchId: string;
  updatedRecipientCount: number;
  removedRecipientCount: number;
  batchCount: number;
  audienceMode: "filtered" | "course" | "explicit";
  recipientType: "all" | "course" | "year" | "student";
  selectedYear: string;
  course: string;
  yearLevel: string;
  targetStudent: string;
  selectedCourses: string[];
  courses: string[];
  yearLevels: string[];
  targetStudentIds: string[];
  targetSchoolIds: string[];
  sendToFilteredAudience: boolean;
  createdByRole: string;
  ownerType: "ec" | "bod";
  courseScope: string | null;
  courseScopeSlug: string | null;
  createdByCourseScope: string | null;
  resolvedRecipientUids?: string[];
  resolvedRecipientSchoolIds?: string[];
  recipientNotificationDocId?: string;
  legacyRecipientCleanupSkipped?: boolean;
  status: "scheduled" | "sent";
};

export type CreateCampusStudentPayload = {
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  email?: string | null;
};

export type CreateCampusStudentResult = {
  uid?: string;
};

export type EcListStudentsPayload = {
  limit?: number;
  includeEcMembers?: boolean;
};

export type EcListStudentItem = {
  uid?: string;
  role?: string;
  isStudent?: boolean;
  isBod?: boolean;
  schoolId?: string;
  studentId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  ecPosition?: string | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  status?: string;
  readyForClearance?: boolean;
  fingerprintStatus?: string;
  fingerprintTemplateId?: number | string | null;
  fingerprintDeviceId?: string | null;
  duplicateTemplate?: boolean;
  email?: string;
  createdAtMs?: number | null;
};

export type EcListStudentsResult = {
  students?: EcListStudentItem[];
};

export type UpdateCampusStudentProfilePayload = {
  uid: string;
  name: string;
  schoolId: string;
  course: string;
  yearLevel: string;
};

export type UpdateCampusStudentProfileResult = {
  uid: string;
  schoolId: string;
  name: string;
  course: string;
  yearLevel: string;
};

export type UpdateStudentAccountStatusPayload = {
  uid: string;
  status: "Active" | "Inactive";
};

export type UpdateStudentAccountStatusResult = {
  uid: string;
  status: "Active" | "Inactive";
  updated?: boolean;
  alreadyInStatus?: boolean;
  deletedRegistrationsCount?: number;
  cleanupFailed?: boolean;
  cleanupError?: string;
};

export type UpdateStudentClearanceStatusPayload = {
  uid: string;
  readyForClearance: boolean;
};

export type UpdateStudentClearanceStatusResult = {
  uid: string;
  readyForClearance: boolean;
  notificationSent?: boolean;
};

export type CreateCampusDocumentMetadataPayload = {
  docId?: string;
  name: string;
  type: string;
  category: string;
  sizeBytes: number;
  storagePath: string;
  downloadURL: string;
};

export type CreateCampusDocumentMetadataResult = {
  docId: string;
  ownerType: "ec" | "bod";
  courseScope: string | null;
};

export type CampusDocumentListItem = {
  id: string;
  name: string;
  fileName?: string;
  type: string;
  category: string;
  sizeBytes: number;
  downloadURL?: string;
  storagePath: string;
  ownerType: "ec" | "bod";
  course?: string | null;
  courseScope?: string | null;
  courseScopeSlug?: string | null;
  createdByCourseScope?: string | null;
  createdBy?: string;
  createdByUid?: string;
  ownerUid?: string;
  uploadedBy?: string;
  uploadedByUid?: string;
  createdAt?: number;
  uploadedAt?: number;
  updatedAt?: number;
  status?: "pending-upload" | "active";
};

export type ListCampusDocumentsResult = {
  documents?: CampusDocumentListItem[];
};

export type CreateCampusDocumentUploadTargetPayload = {
  name: string;
  type: string;
  category: string;
  sizeBytes: number;
  contentType?: string;
};

export type CreateCampusDocumentUploadTargetResult = {
  docId: string;
  fileName: string;
  storagePath: string;
  ownerType: "ec" | "bod";
  courseScope: string | null;
  courseScopeSlug: string | null;
  uploadUrl?: string | null;
  uploadMethod: "firebase-storage-sdk" | "PUT";
  contentType: string;
  verification: string;
  status: "pending-upload";
};

export type FinalizeCampusDocumentUploadPayload = {
  docId: string;
  name: string;
  type: string;
  category: string;
  sizeBytes: number;
  storagePath: string;
  contentType?: string;
  downloadURL?: string;
};

export type FinalizeCampusDocumentUploadResult = {
  docId: string;
  ownerType: "ec" | "bod";
  courseScope: string | null;
  storagePath: string;
  contentType?: string;
  status: "active";
};

export type CreateEventDocumentUploadTargetPayload = {
  eventId: string;
  fileName: string;
  contentType: string;
  size: number;
};

export type CreateEventDocumentUploadTargetResult = {
  eventId: string;
  docId: string;
  storagePath: string;
  fileName: string;
  status: "pending-upload";
};

export type FinalizeEventDocumentUploadPayload = {
  eventId: string;
  docId: string;
  size: number;
  contentType: string;
};

export type FinalizeEventDocumentUploadResult = {
  eventId: string;
  docId: string;
  storagePath: string;
  fileName: string;
  size: number;
  contentType: string;
  status: "active";
};

export type ListEventDocumentsPayload = {
  eventId: string;
};

export type EventDocumentListItem = {
  id: string;
  name: string;
  fileName: string;
  path: string;
  storagePath: string;
  downloadURL: string;
  type: string;
  contentType: string;
  size: number;
  uploadedByUid: string;
  status: "active";
  createdAtMs: number;
  updatedAtMs: number;
};

export type ListEventDocumentsResult = {
  documents: EventDocumentListItem[];
};

export type CleanupPendingEventDocumentUploadPayload = {
  eventId: string;
  docId: string;
};

export type CleanupPendingEventDocumentUploadResult = {
  eventId: string;
  docId: string;
  cleanupAllowed: boolean;
  cleanupPerformed: boolean;
  status: "pending-upload" | "active";
  storagePath: string;
};

export type CreateEventDocumentDownloadUrlPayload = {
  eventId: string;
  docId: string;
};

export type CreateEventDocumentDownloadUrlResult = {
  eventId: string;
  docId: string;
  name: string;
  fileName: string;
  url: string;
  expiresAt: number;
};

export type DeleteEventDocumentPayload = {
  eventId: string;
  docId: string;
};

export type DeleteEventDocumentResult = {
  eventId: string;
  docId: string;
  deleted: boolean;
};

export type DeleteCampusDocumentPayload = {
  docId: string;
};

export type DeleteCampusDocumentResult = {
  docId: string;
  deleted: boolean;
};

export type GetCampusDocumentDownloadUrlPayload = {
  docId: string;
};

export type GetCampusDocumentDownloadUrlResult = {
  docId: string;
  name: string;
  downloadUrl: string;
};

export type DeleteCampusEventPayload = {
  eventId: string;
};

export type DeleteCampusEventResult = {
  success: true;
  eventId: string;
  deleted: boolean;
  linkedPaymentDeleted?: boolean;
};

export type DeleteCampusPaymentPayload = {
  paymentId: string;
};

export type DeleteCampusPaymentResult = {
  paymentId: string;
  deleted: boolean;
  linkedEventUpdated?: boolean;
};

export type CreateCampusPaymentPayload = {
  title: string;
  amount: number | string;
  date: string;
  yearLevel?: string;
  course?: string;
  details?: string;
  selectedStudentIds?: string[];
  selectedSchoolIds?: string[];
  targetStudent?: string;
  targetCourses?: string[];
  targetYearLevels?: string[];
  courseScope?: string | null;
};

export type CreateCampusPaymentResult = {
  paymentId: string;
  ref: string;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
};

export type UpdateCampusPaymentPayload = {
  paymentId: string;
  title: string;
  amount: number | string;
  date: string;
  yearLevel?: string;
  course?: string;
  details?: string;
  selectedStudentIds?: string[];
  selectedSchoolIds?: string[];
  targetStudent?: string;
  targetCourses?: string[];
  targetYearLevels?: string[];
  courseScope?: string | null;
};

export type UpdateCampusPaymentResult = {
  paymentId: string;
  updated: true;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
};

export type RepairCampusPaymentAssignmentsPayload = {
  paymentId: string;
};

export type RepairCampusPaymentAssignmentsResult = {
  paymentId: string;
  repaired: true;
  targetCount: number;
  totalStudents: number;
  createdAssignmentCount: number;
  removedAssignmentCount: number;
  paidCount: number;
  unpaidCount: number;
};

export type ListCampusPaymentStudentsPayload = {
  paymentId: string;
};

export type CampusPaymentStudentListItem = {
  uid: string;
  schoolId: string;
  studentId: string;
  schoolIdKey: string;
  name: string;
  studentName: string;
  course: string;
  year: string;
  yearLevel: string;
  section: string;
  status: "Paid" | "Unpaid";
  paidDate?: number | null;
  referenceNumber?: string;
  remarks?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ListCampusPaymentStudentsResult = {
  students?: CampusPaymentStudentListItem[];
};

export type UpdateCampusPaymentStudentStatusPayload = {
  paymentId: string;
  studentUid: string;
  status: "Paid" | "Unpaid";
};

export type UpdateCampusPaymentStudentStatusResult = {
  paymentId: string;
  studentUid: string;
  status: "Paid" | "Unpaid";
  paidCount: number;
  unpaidCount: number;
  paidDateMs?: number | null;
  updatedAtMs: number;
};

export type CampusPaymentListItem = {
  id: string;
  title: string;
  ref: string;
  amount: number;
  date: string;
  yearLevel: string;
  course: string;
  targetStudent: string;
  targetCourses?: string[];
  details: string;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  linkedEventId?: string;
  linkedEventTitle?: string;
  source?: string;
  status?: string;
  ownerType?: "ec" | "bod";
  createdByUid?: string;
  createdByRole?: string;
  createdByCourseScope?: string | null;
  courseScope?: string | null;
  createdAt?: number;
};

export type ListCampusPaymentsResult = {
  payments?: CampusPaymentListItem[];
};

export type StudentPaymentListItem = {
  paymentId: string;
  title: string;
  ref: string;
  amount: number;
  date: string;
  details: string;
  status: "PAID" | "UNPAID";
  linkedEventId: string;
  source: "event" | "manual";
  createdAtMs: number;
  updatedAtMs: number;
};

export type ListStudentPaymentsResult = {
  payments?: StudentPaymentListItem[];
};

export type AdminUpdateUserProfilePayload = {
  targetUid: string;
  email: string;
  name: string;
  schoolId: string;
  role: string;
  course?: string;
  yearLevel?: string;
  ecPosition?: string | null;
  assignedCourse?: string | null;
};

export type AdminUpdateUserProfileResult = {
  uid: string;
  email: string;
  name: string;
  schoolId: string;
  role: string;
  course: string;
  yearLevel: string;
};

export type SchoolIdLoginResolution =
  | {
      status: "resolved";
      email: string;
      source: "auth" | "profile" | "fallback" | "missing" | "unknown";
    }
  | {
      status: "missing";
      message: string;
      source: "missing";
    }
  | {
      status: "failed";
      message: string;
      code?: string;
    };

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

export function getCampusFunctions() {
  return getFunctions(app, CAMPUS_FUNCTIONS_REGION);
}

const authLogger = createCampusLogger("CAMPUS auth");

function logAuthEvent(
  level: "info" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown>,
) {
  if (level === "error") {
    authLogger.error(message, payload);
    return;
  }

  if (level === "warn") {
    authLogger.warn(message, payload);
    return;
  }

  authLogger.info(message, payload);
}

function toResolverFailureMessage(code?: string) {
  if (
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded" ||
    code === "functions/internal" ||
    code === "functions/unknown"
  ) {
    return "CAMPUS login services are temporarily unavailable. Please try again in a moment.";
  }

  if (code === "functions/invalid-argument") {
    return "School ID is required.";
  }

  return "Unable to verify your School ID right now. Please try again.";
}

export async function resolveSchoolIdLoginForSchoolId(
  schoolId: string,
): Promise<SchoolIdLoginResolution> {
  const normalizedSchoolId = trimValue(schoolId);

  logAuthEvent("info", "Resolving School ID login", {
    region: CAMPUS_FUNCTIONS_REGION,
    hasSchoolId: Boolean(normalizedSchoolId),
  });

  try {
    const callable = httpsCallable<
      { schoolId: string },
      ResolveSchoolIdLoginResponse
    >(getCampusFunctions(), "resolveSchoolIdLogin");

    const result = await callable({ schoolId: normalizedSchoolId });
    const mappedEmail = trimValue(result.data?.email);
    const source = result.data?.source ?? (mappedEmail ? "unknown" : "missing");
    const found = result.data?.found === true || Boolean(mappedEmail);

    logAuthEvent("info", "resolveSchoolIdLogin completed", {
      found,
      source,
      hasEmail: Boolean(mappedEmail),
    });

    if (!found || !mappedEmail) {
      return {
        status: "missing",
        message: "No CAMPUS account was found for that School ID.",
        source: "missing",
      };
    }

    return {
      status: "resolved",
      email: mappedEmail,
      source,
    };
  } catch (error: unknown) {
    const functionError = error as {
      code?: string;
      message?: string;
      details?: unknown;
    };

    logAuthEvent("error", "resolveSchoolIdLogin failed", {
      region: CAMPUS_FUNCTIONS_REGION,
      code: functionError.code ?? "unknown",
      message: functionError.message ?? "Unknown resolver error",
      details: functionError.details ?? null,
    });

    return {
      status: "failed",
      code: functionError.code,
      message: toResolverFailureMessage(functionError.code),
    };
  }
}

export async function getCurrentCampusProfileForCurrentUser(): Promise<CampusProfileDoc | null> {
  logAuthEvent("info", "Loading current CAMPUS profile");
  const callable = httpsCallable<Record<string, never>, CampusProfileResponse>(
    getCampusFunctions(),
    "getCurrentCampusProfile",
  );

  const result = await callable({});
  const profile =
    result.data?.profile ?
      {
        ...result.data.profile,
        role: normalizeCampusRole(result.data.profile.role) || result.data.profile.role,
      } :
      null;

  logAuthEvent("info", "Loaded current CAMPUS profile", {
    hasProfile: Boolean(profile),
    role: profile?.role ?? "",
  });

  return profile;
}

export async function createCampusEvent(
  payload: CreateCampusEventPayload,
): Promise<CreateCampusEventResult> {
  logAuthEvent("info", "Creating CAMPUS event via callable", {
    withPayment: payload.withPayment === true || payload.paymentRequired === true,
    isPreReg: payload.isPreReg === true,
  });

  const callable = httpsCallable<
    CreateCampusEventPayload,
    CreateCampusEventResult
  >(getCampusFunctions(), "createCampusEvent");

  const result = await callable(payload);
  return result.data;
}

export async function updateCampusEvent(
  payload: UpdateCampusEventPayload,
): Promise<UpdateCampusEventResult> {
  logAuthEvent("info", "Updating CAMPUS event via callable", {
    eventId: payload.eventId,
    withPayment: payload.withPayment === true || payload.paymentRequired === true,
    isPreReg: payload.isPreReg === true,
  });

  const callable = httpsCallable<
    UpdateCampusEventPayload,
    UpdateCampusEventResult
  >(getCampusFunctions(), "updateCampusEvent");

  const result = await callable(payload);
  return result.data;
}

export async function cancelCampusEvent(
  payload: CancelCampusEventPayload,
): Promise<CancelCampusEventResult> {
  logAuthEvent("info", "Cancelling CAMPUS event via callable", {
    eventId: payload.eventId,
    hasReason: Boolean(payload.reason?.trim()),
  });

  const callable = httpsCallable<
    CancelCampusEventPayload,
    CancelCampusEventResult
  >(getCampusFunctions(), "cancelCampusEvent");

  const result = await callable(payload);
  return result.data;
}

export async function createCampusNotification(
  payload: CreateCampusNotificationPayload,
): Promise<CreateCampusNotificationResult> {
  logAuthEvent("info", "Creating campus notification via callable", {
    audienceMode: payload.audienceMode ?? "",
    selectedYear: payload.selectedYear ?? "",
    selectedCourses: payload.selectedCourses ?? [],
    explicitTargetCount: payload.targetStudentIds?.length ?? 0,
    sendToFilteredAudience: payload.sendToFilteredAudience === true,
  });

  const callable = httpsCallable<
    CreateCampusNotificationPayload,
    CreateCampusNotificationResult
  >(getCampusFunctions(), "createCampusNotification");

  const result = await callable(payload);
  return result.data;
}

export async function updateCampusNotification(
  payload: UpdateCampusNotificationPayload,
): Promise<UpdateCampusNotificationResult> {
  logAuthEvent("info", "Updating campus notification via callable", {
    notificationId: payload.notificationId ?? "",
    scheduledNotificationId: payload.scheduledNotificationId ?? "",
    audienceMode: payload.audienceMode ?? "",
    selectedYear: payload.selectedYear ?? "",
    selectedCourses: payload.selectedCourses ?? [],
    explicitTargetCount: payload.targetStudentIds?.length ?? 0,
    sendToFilteredAudience: payload.sendToFilteredAudience === true,
  });

  const callable = httpsCallable<
    UpdateCampusNotificationPayload,
    UpdateCampusNotificationResult
  >(getCampusFunctions(), "updateCampusNotification");

  const result = await callable(payload);
  return result.data;
}

export async function createCampusStudent(
  payload: CreateCampusStudentPayload,
): Promise<CreateCampusStudentResult> {
  logAuthEvent("info", "Creating CAMPUS student via callable", {
    schoolId: payload.schoolId,
  });

  const callable = httpsCallable<
    CreateCampusStudentPayload,
    CreateCampusStudentResult
  >(getCampusFunctions(), "createCampusStudent");

  const result = await callable(payload);
  return result.data;
}

export async function updateCampusStudentProfile(
  payload: UpdateCampusStudentProfilePayload,
): Promise<UpdateCampusStudentProfileResult> {
  logAuthEvent("info", "Updating CAMPUS student profile via callable", {
    uid: payload.uid,
  });

  const callable = httpsCallable<
    UpdateCampusStudentProfilePayload,
    UpdateCampusStudentProfileResult
  >(getCampusFunctions(), "updateCampusStudentProfile");

  const result = await callable(payload);
  return result.data;
}

export async function ecListStudents(
  payload: EcListStudentsPayload = {},
): Promise<EcListStudentItem[]> {
  logAuthEvent("info", "Listing CAMPUS students via callable", {
    limit: payload.limit ?? null,
    includeEcMembers: payload.includeEcMembers === true,
  });

  const callable = httpsCallable<EcListStudentsPayload, EcListStudentsResult>(
    getCampusFunctions(),
    "ecListStudents",
  );

  const result = await callable(payload);
  return result.data?.students ?? [];
}

export async function updateStudentAccountStatus(
  payload: UpdateStudentAccountStatusPayload,
): Promise<UpdateStudentAccountStatusResult> {
  logAuthEvent("info", "Updating student account status via callable", {
    uid: payload.uid,
    status: payload.status,
  });

  const callable = httpsCallable<
    UpdateStudentAccountStatusPayload,
    UpdateStudentAccountStatusResult
  >(getCampusFunctions(), "updateStudentAccountStatus");

  const result = await callable(payload);
  return result.data;
}

export async function updateStudentClearanceStatus(
  payload: UpdateStudentClearanceStatusPayload,
): Promise<UpdateStudentClearanceStatusResult> {
  logAuthEvent("info", "Updating student clearance status via callable", {
    uid: payload.uid,
    readyForClearance: payload.readyForClearance,
  });

  const callable = httpsCallable<
    UpdateStudentClearanceStatusPayload,
    UpdateStudentClearanceStatusResult
  >(getCampusFunctions(), "updateStudentClearanceStatus");

  const result = await callable(payload);
  return result.data;
}

export async function createCampusDocumentMetadata(
  payload: CreateCampusDocumentMetadataPayload,
): Promise<CreateCampusDocumentMetadataResult> {
  logAuthEvent("info", "Creating EC document metadata via callable", {
    docId: payload.docId ?? "",
    category: payload.category,
  });

  const callable = httpsCallable<
    CreateCampusDocumentMetadataPayload,
    CreateCampusDocumentMetadataResult
  >(getCampusFunctions(), "createCampusDocumentMetadata");

  const result = await callable(payload);
  return result.data;
}

export async function listCampusDocuments(): Promise<CampusDocumentListItem[]> {
  logAuthEvent("info", "Listing campus documents via callable");

  const callable = httpsCallable<Record<string, never>, ListCampusDocumentsResult>(
    getCampusFunctions(),
    "listCampusDocuments",
  );

  const result = await callable({});
  return result.data?.documents ?? [];
}

export async function createCampusDocumentUploadTarget(
  payload: CreateCampusDocumentUploadTargetPayload,
): Promise<CreateCampusDocumentUploadTargetResult> {
  logAuthEvent("info", "Creating document upload target via callable", {
    category: payload.category,
    sizeBytes: payload.sizeBytes,
  });

  const callable = httpsCallable<
    CreateCampusDocumentUploadTargetPayload,
    CreateCampusDocumentUploadTargetResult
  >(getCampusFunctions(), "createCampusDocumentUploadTarget");

  const result = await callable(payload);
  return result.data;
}

export async function finalizeCampusDocumentUpload(
  payload: FinalizeCampusDocumentUploadPayload,
): Promise<FinalizeCampusDocumentUploadResult> {
  logAuthEvent("info", "Finalizing campus document upload via callable", {
    docId: payload.docId,
    category: payload.category,
  });

  const callable = httpsCallable<
    FinalizeCampusDocumentUploadPayload,
    FinalizeCampusDocumentUploadResult
  >(getCampusFunctions(), "finalizeCampusDocumentUpload");

  const result = await callable(payload);
  return result.data;
}

export async function createEventDocumentUploadTarget(
  payload: CreateEventDocumentUploadTargetPayload,
): Promise<CreateEventDocumentUploadTargetResult> {
  logAuthEvent("info", "Creating event document upload target via callable", {
    eventId: payload.eventId,
    size: payload.size,
  });

  const callable = httpsCallable<
    CreateEventDocumentUploadTargetPayload,
    CreateEventDocumentUploadTargetResult
  >(getCampusFunctions(), "createEventDocumentUploadTarget");

  const result = await callable(payload);
  return result.data;
}

export async function finalizeEventDocumentUpload(
  payload: FinalizeEventDocumentUploadPayload,
): Promise<FinalizeEventDocumentUploadResult> {
  logAuthEvent("info", "Finalizing event document upload via callable", {
    eventId: payload.eventId,
    docId: payload.docId,
  });

  const callable = httpsCallable<
    FinalizeEventDocumentUploadPayload,
    FinalizeEventDocumentUploadResult
  >(getCampusFunctions(), "finalizeEventDocumentUpload");

  const result = await callable(payload);
  return result.data;
}

export async function listEventDocuments(
  payload: ListEventDocumentsPayload,
): Promise<ListEventDocumentsResult> {
  logAuthEvent("info", "Listing event documents via callable", {
    eventId: payload.eventId,
  });

  const callable = httpsCallable<
    ListEventDocumentsPayload,
    ListEventDocumentsResult
  >(getCampusFunctions(), "listEventDocuments");

  const result = await callable(payload);
  return result.data;
}

export async function cleanupPendingEventDocumentUpload(
  payload: CleanupPendingEventDocumentUploadPayload,
): Promise<CleanupPendingEventDocumentUploadResult> {
  logAuthEvent("info", "Cleaning up pending event document upload via callable", {
    eventId: payload.eventId,
    docId: payload.docId,
  });

  const callable = httpsCallable<
    CleanupPendingEventDocumentUploadPayload,
    CleanupPendingEventDocumentUploadResult
  >(getCampusFunctions(), "cleanupPendingEventDocumentUpload");

  const result = await callable(payload);
  return result.data;
}

export async function createEventDocumentDownloadUrl(
  payload: CreateEventDocumentDownloadUrlPayload,
): Promise<CreateEventDocumentDownloadUrlResult> {
  logAuthEvent("info", "Creating event document download URL via callable", {
    eventId: payload.eventId,
    docId: payload.docId,
  });

  const callable = httpsCallable<
    CreateEventDocumentDownloadUrlPayload,
    CreateEventDocumentDownloadUrlResult
  >(getCampusFunctions(), "createEventDocumentDownloadUrl");

  const result = await callable(payload);
  return result.data;
}

export async function deleteEventDocument(
  payload: DeleteEventDocumentPayload,
): Promise<DeleteEventDocumentResult> {
  logAuthEvent("info", "Deleting event document via callable", {
    eventId: payload.eventId,
    docId: payload.docId,
  });

  const callable = httpsCallable<
    DeleteEventDocumentPayload,
    DeleteEventDocumentResult
  >(getCampusFunctions(), "deleteEventDocument");

  const result = await callable(payload);
  return result.data;
}

export async function deleteCampusDocument(
  payload: DeleteCampusDocumentPayload,
): Promise<DeleteCampusDocumentResult> {
  logAuthEvent("info", "Deleting EC document via callable", {
    docId: payload.docId,
  });

  const callable = httpsCallable<
    DeleteCampusDocumentPayload,
    DeleteCampusDocumentResult
  >(getCampusFunctions(), "deleteCampusDocument");

  const result = await callable(payload);
  return result.data;
}

export async function getCampusDocumentDownloadUrl(
  payload: GetCampusDocumentDownloadUrlPayload,
): Promise<GetCampusDocumentDownloadUrlResult> {
  logAuthEvent("info", "Requesting EC document download URL", {
    docId: payload.docId,
  });

  const callable = httpsCallable<
    GetCampusDocumentDownloadUrlPayload,
    GetCampusDocumentDownloadUrlResult
  >(getCampusFunctions(), "getCampusDocumentDownloadUrl");

  const result = await callable(payload);
  return result.data;
}

export async function deleteCampusEvent(
  payload: DeleteCampusEventPayload,
): Promise<DeleteCampusEventResult> {
  logAuthEvent("info", "Deleting CAMPUS event via callable", {
    eventId: payload.eventId,
  });

  const callable = httpsCallable<
    DeleteCampusEventPayload,
    DeleteCampusEventResult
  >(getCampusFunctions(), "deleteCampusEvent");

  const result = await callable(payload);
  return result.data;
}

export async function deleteCampusPayment(
  payload: DeleteCampusPaymentPayload,
): Promise<DeleteCampusPaymentResult> {
  logAuthEvent("info", "Deleting CAMPUS payment via callable", {
    paymentId: payload.paymentId,
  });

  const callable = httpsCallable<
    DeleteCampusPaymentPayload,
    DeleteCampusPaymentResult
  >(getCampusFunctions(), "deleteCampusPayment");

  const result = await callable(payload);
  return result.data;
}

export async function createCampusPayment(
  payload: CreateCampusPaymentPayload,
): Promise<CreateCampusPaymentResult> {
  logAuthEvent("info", "Creating CAMPUS payment via callable", {
    date: payload.date,
    course: payload.course ?? "",
    yearLevel: payload.yearLevel ?? "",
    selectedStudentCount: payload.selectedStudentIds?.length ?? 0,
    selectedSchoolCount: payload.selectedSchoolIds?.length ?? 0,
  });

  const callable = httpsCallable<
    CreateCampusPaymentPayload,
    CreateCampusPaymentResult
  >(getCampusFunctions(), "createCampusPayment");

  const result = await callable(payload);
  return result.data;
}

export async function updateCampusPayment(
  payload: UpdateCampusPaymentPayload,
): Promise<UpdateCampusPaymentResult> {
  logAuthEvent("info", "Updating CAMPUS payment via callable", {
    paymentId: payload.paymentId,
    date: payload.date,
    course: payload.course ?? "",
    yearLevel: payload.yearLevel ?? "",
    selectedStudentCount: payload.selectedStudentIds?.length ?? 0,
    selectedSchoolCount: payload.selectedSchoolIds?.length ?? 0,
  });

  const callable = httpsCallable<
    UpdateCampusPaymentPayload,
    UpdateCampusPaymentResult
  >(getCampusFunctions(), "updateCampusPayment");

  const result = await callable(payload);
  return result.data;
}

export async function repairCampusPaymentAssignments(
  payload: RepairCampusPaymentAssignmentsPayload,
): Promise<RepairCampusPaymentAssignmentsResult> {
  logAuthEvent("info", "Repairing CAMPUS payment assignments via callable", {
    paymentId: payload.paymentId,
  });

  const callable = httpsCallable<
    RepairCampusPaymentAssignmentsPayload,
    RepairCampusPaymentAssignmentsResult
  >(getCampusFunctions(), "repairCampusPaymentAssignments");

  const result = await callable(payload);
  return result.data;
}

export async function listCampusPayments(): Promise<CampusPaymentListItem[]> {
  logAuthEvent("info", "Listing CAMPUS payments via callable");

  const callable = httpsCallable<Record<string, never>, ListCampusPaymentsResult>(
    getCampusFunctions(),
    "listCampusPayments",
  );

  const result = await callable({});
  return result.data?.payments ?? [];
}

export async function listCampusPaymentStudents(
  payload: ListCampusPaymentStudentsPayload,
): Promise<CampusPaymentStudentListItem[]> {
  logAuthEvent("info", "Listing CAMPUS payment students via callable", {
    paymentId: payload.paymentId,
  });

  const callable = httpsCallable<
    ListCampusPaymentStudentsPayload,
    ListCampusPaymentStudentsResult
  >(getCampusFunctions(), "listCampusPaymentStudents");

  const result = await callable(payload);
  return result.data?.students ?? [];
}

export async function updateCampusPaymentStudentStatus(
  payload: UpdateCampusPaymentStudentStatusPayload,
): Promise<UpdateCampusPaymentStudentStatusResult> {
  logAuthEvent("info", "Updating CAMPUS payment student status via callable", {
    paymentId: payload.paymentId,
    studentUid: payload.studentUid,
    status: payload.status,
  });

  const callable = httpsCallable<
    UpdateCampusPaymentStudentStatusPayload,
    UpdateCampusPaymentStudentStatusResult
  >(getCampusFunctions(), "updateCampusPaymentStudentStatus");

  const result = await callable(payload);
  return result.data;
}

export async function listStudentPayments(): Promise<StudentPaymentListItem[]> {
  logAuthEvent("info", "Listing student payments via callable");

  const callable = httpsCallable<Record<string, never>, ListStudentPaymentsResult>(
    getCampusFunctions(),
    "listStudentPayments",
  );

  const result = await callable({});
  return result.data?.payments ?? [];
}

export async function savePendingEmailVerificationForCurrentUser(
  pendingEmail: string,
): Promise<CampusProfileDoc | null> {
  const normalizedEmail = trimValue(pendingEmail).toLowerCase();
  logAuthEvent("info", "Saving pending verification email", {
    emailDomain: normalizedEmail.split("@")[1] ?? "",
  });

  const callable = httpsCallable<
    { pendingEmail: string },
    CampusProfileResponse
  >(getCampusFunctions(), "savePendingEmailVerification");

  const result = await callable({ pendingEmail: normalizedEmail });
  return result.data?.profile ?? null;
}

export type BulkStudentImportRowPayload = {
  nameSchema: BulkStudentImportInputSchema;
  rowIndex?: number;
  schoolId: string;
  lastName: string;
  firstName: string;
  fullName?: string;
  course: string;
  yearLevel: string;
  status: string;
};

export type BulkStudentImportResultRow = BulkStudentImportRowPayload & {
  success: boolean;
  skipped?: boolean;
  error?: string;
  errors?: string[];
  uid?: string;
};

export type BulkStudentImportResult = {
  inputSchema: BulkStudentImportInputSchema;
  totalRows: number;
  importedCount: number;
  failedCount: number;
  skippedCount: number;
  rowResults: BulkStudentImportResultRow[];
};

export type AdminDeactivateAllStudentsResult = {
  totalStudentCount: number;
  updatedCount: number;
};

export type DuplicateStudentSchoolIdEntry = {
  uid: string;
  name: string;
  email: string;
  status: string;
  role: string;
  source: "profile" | "student_projection";
  createdAtMs: number;
  isPrimary: boolean;
};

export type DuplicateStudentSchoolIdGroup = {
  schoolId: string;
  schoolIdKey: string;
  primaryUid: string;
  count: number;
  cleanupCandidateCount: number;
  entries: DuplicateStudentSchoolIdEntry[];
};

export type AdminDuplicateStudentSchoolIdReport = {
  duplicateGroupCount: number;
  duplicateEntryCount: number;
  cleanupCandidateCount: number;
  duplicates: DuplicateStudentSchoolIdGroup[];
};

export type AdminDeleteDuplicateStudentSchoolIdsResult = {
  duplicateGroupCount: number;
  keptCount: number;
  deletedCount: number;
  deletedAuthCount: number;
  failedCount: number;
  failureDetails: string[];
};
export type FingerprintCleanupMappingStatus =
  | "active"
  | "stale"
  | "needs_reenrollment"
  | "duplicate"
  | "deleted"
  | "missing_profile"
  | "missing_canonical";
export type FingerprintCleanupSource =
  | "fingerprint_template"
  | "profile"
  | "student_projection"
  | "enrollment_session";
export type FingerprintCleanupReportSummary = {
  total: number;
  active: number;
  stale: number;
  duplicate: number;
  needsReenrollment: number;
  studentsWithFingerprints: number;
  totalTemplateIdRows: number;
  canonicalMappings: number;
  enrollmentSessionOnlyMappings: number;
  missingCanonicalMappings: number;
  duplicateTemplateRows: number;
};
export type FingerprintCleanupReportSource =
  | "fingerprintTemplates"
  | "profiles_fallback"
  | "enrollment_sessions"
  | "mixed"
  | "empty";
export type FingerprintFullWipeCommandStatus =
  | "pending"
  | "completed"
  | "failed";
export type FingerprintFullWipeClearMode =
  | "full_sensor_and_firebase_after_ack"
  | "firebase_only_manual_sensor_clear";
export type FingerprintFullWipeCommandSummary = {
  commandId: string;
  commandType: "clear_as608_database";
  status: FingerprintFullWipeCommandStatus;
  clearMode: FingerprintFullWipeClearMode;
  targetDeviceId: string;
  reason: string;
  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;
  processedAtMs: number;
  completedAtMs: number;
  failedAtMs: number;
  error: string;
  markEnrollmentSessionRowsStale: boolean;
};
export type FingerprintCleanupReportMapping = {
  rowId: string;
  templateId: number;
  fingerprintDeviceId: string;
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  section: string;
  profileStatus: string;
  mappingStatus: FingerprintCleanupMappingStatus;
  fingerprintStatus: string;
  syncStatus: string;
  sessionId: string;
  sessionIds: string[];
  lastEnrolledAtMs: number;
  duplicateTemplateCount: number;
  duplicateSchoolIdCount: number;
  duplicateReasons: string[];
  sources: FingerprintCleanupSource[];
  hasCanonicalSource: boolean;
  enrollmentSessionOnly: boolean;
  missingCanonical: boolean;
  canRemoveStale: boolean;
  canRemoveMapping: boolean;
  canKeepTemplateOwner: boolean;
  needsReenrollment: boolean;
};
export type FingerprintCleanupReport = {
  generatedAtMs: number;
  summary: FingerprintCleanupReportSummary;
  totalMappings: number;
  activeMappings: number;
  staleMappings: number;
  duplicateMappings: number;
  needsReenrollment: number;
  studentsWithFingerprints: number;
  canonicalMappings: number;
  enrollmentSessionOnlyMappings: number;
  missingCanonicalMappings: number;
  duplicateTemplateRows: number;
  source: FingerprintCleanupReportSource;
  fallbackUsed: boolean;
  emptyMessage: string;
  mappings: FingerprintCleanupReportMapping[];
  fullWipeCommand: FingerprintFullWipeCommandSummary | null;
};
export type FingerprintCleanupAction =
  | "removeStaleMapping"
  | "removeMapping"
  | "markNeedsReenrollment"
  | "keepStudent";
export type FingerprintCleanupActionResult = {
  ok: boolean;
  action: FingerprintCleanupAction;
  updatedCount: number;
  queueCount: number;
  message: string;
};
export type FingerprintCleanupBuildMappingsResult = {
  ok: boolean;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  totalProfileMappings: number;
  message: string;
};
export type FingerprintFullWipeQueueResult = {
  ok: boolean;
  commandId: string;
  status: FingerprintFullWipeCommandStatus;
  targetDeviceId: string;
  message: string;
  alreadyPending?: boolean;
  markEnrollmentSessionRowsStale: boolean;
};
export type FingerprintFirebaseOnlyWipeResult = {
  ok: boolean;
  message: string;
  fingerprintTemplateDocsCleared: number;
  profilesCleared: number;
  studentsCleared: number;
  enrollmentSessionStudentsMarkedStale: number;
};

export async function finalizeVerifiedCampusProfileForCurrentUser(): Promise<{
  finalized: boolean;
  profile: CampusProfileDoc | null;
}> {
  logAuthEvent("info", "Finalizing verified CAMPUS profile");

  const callable = httpsCallable<Record<string, never>, FinalizeCampusProfileResponse>(
    getCampusFunctions(),
    "finalizeVerifiedCampusProfile",
  );

  const result = await callable({});
  return {
    finalized: result.data?.finalized === true,
    profile: result.data?.profile ?? null,
  };
}

export async function logPermissionDeniedAttemptForCurrentUser(
  payload: {
    action: string;
    targetType: string;
    targetId: string;
    reason?: string;
  },
): Promise<void> {
  const callable = httpsCallable<
    {
      action: string;
      targetType: string;
      targetId: string;
      reason?: string;
    },
    {ok?: boolean}
  >(getCampusFunctions(), "logPermissionDeniedAttempt");

  await callable(payload);
}

export async function adminBulkImportStudents(
  functions: ReturnType<typeof getCampusFunctions>,
  payload: {
    filename: string;
    inputSchema: BulkStudentImportInputSchema;
    rows: BulkStudentImportRowPayload[];
    previewOnly?: boolean;
  },
): Promise<BulkStudentImportResult> {
  logAuthEvent("info", "Starting bulk student import request", {
    fileName: payload.filename,
    rowCount: payload.rows.length,
  });

  const callable = httpsCallable<
    {
      filename: string;
      inputSchema: BulkStudentImportInputSchema;
      rows: BulkStudentImportRowPayload[];
      previewOnly?: boolean;
    },
    BulkStudentImportResult
  >(functions, "adminBulkImportStudents");

  const result = await callable(payload);
  return result.data;
}

export async function adminDeactivateAllStudents(
  functions: ReturnType<typeof getCampusFunctions>,
): Promise<AdminDeactivateAllStudentsResult> {
  logAuthEvent("info", "Starting admin deactivate-all-students request");

  const callable = httpsCallable<
    Record<string, never>,
    AdminDeactivateAllStudentsResult
  >(functions, "adminDeactivateAllStudents");

  const result = await callable({});
  return result.data;
}

export async function adminFindDuplicateStudentSchoolIds(
  functions: ReturnType<typeof getCampusFunctions>,
  limit = 50,
): Promise<AdminDuplicateStudentSchoolIdReport> {
  logAuthEvent("info", "Starting duplicate student school ID audit", {
    limit,
  });

  const callable = httpsCallable<
    { limit: number },
    AdminDuplicateStudentSchoolIdReport
  >(functions, "adminFindDuplicateStudentSchoolIds");

  const result = await callable({ limit });
  return result.data;
}

export async function adminDeleteDuplicateStudentSchoolIds(
  functions: ReturnType<typeof getCampusFunctions>,
): Promise<AdminDeleteDuplicateStudentSchoolIdsResult> {
  logAuthEvent("info", "Starting duplicate student school ID cleanup");

  const callable = httpsCallable<
    Record<string, never>,
    AdminDeleteDuplicateStudentSchoolIdsResult
  >(functions, "adminDeleteDuplicateStudentSchoolIds");

  const result = await callable({});
  return result.data;
}

export async function adminUpdateUserProfile(
  functions: ReturnType<typeof getCampusFunctions>,
  payload: AdminUpdateUserProfilePayload,
): Promise<AdminUpdateUserProfileResult> {
  logAuthEvent("info", "Starting admin profile update", {
    targetUid: trimValue(payload.targetUid),
    role: trimValue(payload.role),
  });

  const callable = httpsCallable<
    AdminUpdateUserProfilePayload,
    AdminUpdateUserProfileResult
  >(functions, "adminUpdateUserProfile");

  const result = await callable({
    ...payload,
    email: trimValue(payload.email).toLowerCase(),
  });
  return result.data;
}

function toFunctionsErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = (error as {code?: unknown}).code;
    if (typeof code === "string") {
      return code.replace(/^functions\//, "");
    }
  }

  return "";
}

function toFunctionsErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const message = (error as {message?: unknown}).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return "";
}

function fingerprintCleanupErrorMessage(
  error: unknown,
  action: "load" | "manage" | "build",
): string {
  const code = toFunctionsErrorCode(error);
  const rawMessage = toFunctionsErrorMessage(error);
  const loweredMessage = rawMessage.toLowerCase();

  if (code === "permission-denied") {
    return "permission-denied: Admin access is required for fingerprint cleanup.";
  }

  if (code === "unauthenticated") {
    return "unauthenticated: Sign in again as an admin to load fingerprint cleanup.";
  }

  if (code === "unimplemented" || code === "not-found") {
    return "function not deployed: Deploy the Firebase admin cleanup functions in asia-southeast1.";
  }

  if (code === "unavailable") {
    return "functions unavailable: The fingerprint cleanup service is temporarily unavailable.";
  }

  if (code === "invalid-response") {
    return "invalid response shape: The fingerprint cleanup function returned unexpected data.";
  }

  if (loweredMessage.includes("index")) {
    return `missing index: ${rawMessage}`;
  }

  if (loweredMessage.includes("permission-denied")) {
    return `permission-denied: ${rawMessage}`;
  }

  if (loweredMessage.includes("internal") || code === "internal") {
    return action === "load" ?
      "internal: The cleanup report failed on the server. Check Cloud Function logs." :
      action === "build" ?
        "internal: Building fingerprint mappings failed on the server. Check Cloud Function logs." :
        "internal: Fingerprint cleanup failed on the server. Check Cloud Function logs.";
  }

  if (rawMessage) {
    return code ? `${code}: ${rawMessage}` : rawMessage;
  }

  return action === "load" ?
    "Failed to load the fingerprint cleanup report." :
    action === "build" ?
      "Failed to build fingerprint mappings from profiles." :
      "Fingerprint cleanup failed.";
}

function normalizeFingerprintFullWipeCommandStatus(
  value: unknown,
): FingerprintFullWipeCommandStatus {
  if (value === "completed") {
    return "completed";
  }
  if (value === "failed") {
    return "failed";
  }
  return "pending";
}

function normalizeFingerprintFullWipeClearMode(
  value: unknown,
): FingerprintFullWipeClearMode {
  return value === "firebase_only_manual_sensor_clear" ?
    "firebase_only_manual_sensor_clear" :
    "full_sensor_and_firebase_after_ack";
}

function normalizeFingerprintCleanupReport(
  payload: unknown,
): FingerprintCleanupReport {
  if (typeof payload !== "object" || payload === null) {
    const error = new Error(
      "invalid response shape: missing fingerprint cleanup payload.",
    ) as Error & {code?: string};
    error.code = "invalid-response";
    throw error;
  }

  const data = payload as Record<string, unknown>;
  if (!Array.isArray(data.mappings)) {
    const error = new Error(
      "invalid response shape: mappings must be an array.",
    ) as Error & {code?: string};
    error.code = "invalid-response";
    throw error;
  }

  const mappings = data.mappings;
  const summary =
    typeof data.summary === "object" && data.summary !== null ?
      (data.summary as Record<string, unknown>) :
      {};

  return {
    generatedAtMs: Number(data.generatedAtMs ?? Date.now()) || Date.now(),
    summary: {
      total: Number(summary.total ?? data.totalMappings ?? mappings.length) || 0,
      active: Number(summary.active ?? data.activeMappings ?? 0) || 0,
      stale: Number(summary.stale ?? data.staleMappings ?? 0) || 0,
      duplicate: Number(summary.duplicate ?? data.duplicateMappings ?? 0) || 0,
      needsReenrollment:
        Number(summary.needsReenrollment ?? data.needsReenrollment ?? 0) || 0,
      studentsWithFingerprints:
        Number(
          summary.studentsWithFingerprints ?? data.studentsWithFingerprints ?? 0,
        ) || 0,
      totalTemplateIdRows:
        Number(summary.totalTemplateIdRows ?? data.totalMappings ?? mappings.length) || 0,
      canonicalMappings:
        Number(summary.canonicalMappings ?? data.canonicalMappings ?? 0) || 0,
      enrollmentSessionOnlyMappings:
        Number(
          summary.enrollmentSessionOnlyMappings ??
            data.enrollmentSessionOnlyMappings ??
            0,
        ) || 0,
      missingCanonicalMappings:
        Number(
          summary.missingCanonicalMappings ??
            data.missingCanonicalMappings ??
            0,
        ) || 0,
      duplicateTemplateRows:
        Number(summary.duplicateTemplateRows ?? data.duplicateTemplateRows ?? 0) || 0,
    },
    totalMappings: Number(data.totalMappings ?? summary.total ?? mappings.length) || 0,
    activeMappings: Number(data.activeMappings ?? summary.active ?? 0) || 0,
    staleMappings: Number(data.staleMappings ?? summary.stale ?? 0) || 0,
    duplicateMappings: Number(data.duplicateMappings ?? summary.duplicate ?? 0) || 0,
    needsReenrollment:
      Number(data.needsReenrollment ?? summary.needsReenrollment ?? 0) || 0,
    studentsWithFingerprints:
      Number(data.studentsWithFingerprints ?? summary.studentsWithFingerprints ?? 0) || 0,
    canonicalMappings:
      Number(data.canonicalMappings ?? summary.canonicalMappings ?? 0) || 0,
    enrollmentSessionOnlyMappings:
      Number(
        data.enrollmentSessionOnlyMappings ??
          summary.enrollmentSessionOnlyMappings ??
          0,
      ) || 0,
    missingCanonicalMappings:
      Number(
        data.missingCanonicalMappings ?? summary.missingCanonicalMappings ?? 0,
      ) || 0,
    duplicateTemplateRows:
      Number(data.duplicateTemplateRows ?? summary.duplicateTemplateRows ?? 0) || 0,
    source:
      (typeof data.source === "string" ? data.source : "empty") as FingerprintCleanupReportSource,
    fallbackUsed: data.fallbackUsed === true,
    emptyMessage: typeof data.emptyMessage === "string" ? data.emptyMessage : "",
    fullWipeCommand:
      typeof data.fullWipeCommand === "object" && data.fullWipeCommand !== null ?
        {
          commandId:
            typeof (data.fullWipeCommand as Record<string, unknown>).commandId === "string" ?
              String((data.fullWipeCommand as Record<string, unknown>).commandId) :
              "",
          commandType: "clear_as608_database",
          status: normalizeFingerprintFullWipeCommandStatus(
            (data.fullWipeCommand as Record<string, unknown>).status,
          ),
          clearMode: normalizeFingerprintFullWipeClearMode(
            (data.fullWipeCommand as Record<string, unknown>).clearMode,
          ),
          targetDeviceId:
            typeof (data.fullWipeCommand as Record<string, unknown>).targetDeviceId === "string" ?
              String((data.fullWipeCommand as Record<string, unknown>).targetDeviceId) :
              "",
          reason:
            typeof (data.fullWipeCommand as Record<string, unknown>).reason === "string" ?
              String((data.fullWipeCommand as Record<string, unknown>).reason) :
              "",
          createdByUid:
            typeof (data.fullWipeCommand as Record<string, unknown>).createdByUid === "string" ?
              String((data.fullWipeCommand as Record<string, unknown>).createdByUid) :
              "",
          createdAtMs:
            Number((data.fullWipeCommand as Record<string, unknown>).createdAtMs ?? 0) || 0,
          updatedAtMs:
            Number((data.fullWipeCommand as Record<string, unknown>).updatedAtMs ?? 0) || 0,
          processedAtMs:
            Number((data.fullWipeCommand as Record<string, unknown>).processedAtMs ?? 0) || 0,
          completedAtMs:
            Number((data.fullWipeCommand as Record<string, unknown>).completedAtMs ?? 0) || 0,
          failedAtMs:
            Number((data.fullWipeCommand as Record<string, unknown>).failedAtMs ?? 0) || 0,
          error:
            typeof (data.fullWipeCommand as Record<string, unknown>).error === "string" ?
              String((data.fullWipeCommand as Record<string, unknown>).error) :
              "",
          markEnrollmentSessionRowsStale:
            (data.fullWipeCommand as Record<string, unknown>).markEnrollmentSessionRowsStale === true,
        } :
        null,
    mappings: mappings.map((mapping) => {
      const row =
        typeof mapping === "object" && mapping !== null ?
          (mapping as Record<string, unknown>) :
          {};
      return {
        ...(row as FingerprintCleanupReportMapping),
        fingerprintDeviceId:
          typeof row.fingerprintDeviceId === "string" ? row.fingerprintDeviceId : "",
        section: typeof row.section === "string" ? row.section : "-",
        syncStatus: typeof row.syncStatus === "string" ? row.syncStatus : "",
        sessionId: typeof row.sessionId === "string" ? row.sessionId : "",
        sessionIds:
          Array.isArray(row.sessionIds) ?
            row.sessionIds.filter((value): value is string => typeof value === "string") :
            [],
        sources:
          Array.isArray(row.sources) ?
            row.sources.filter((value): value is FingerprintCleanupSource => typeof value === "string") :
            [],
        hasCanonicalSource: row.hasCanonicalSource === true,
        enrollmentSessionOnly: row.enrollmentSessionOnly === true,
        missingCanonical: row.missingCanonical === true,
      };
    }),
  };
}

function throwNormalizedFingerprintCleanupError(
  error: unknown,
  action: "load" | "manage" | "build",
): never {
  const code = toFunctionsErrorCode(error);
  const message = fingerprintCleanupErrorMessage(error, action);

  logAuthEvent("error", "Fingerprint cleanup callable failed", {
    action,
    region: CAMPUS_FUNCTIONS_REGION,
    code: code || "unknown",
    message,
    rawMessage: toFunctionsErrorMessage(error),
    details:
      typeof error === "object" && error !== null ?
        (error as {details?: unknown}).details :
        null,
  });

  const normalizedError = new Error(message) as Error & {code?: string};
  normalizedError.code = code || undefined;
  throw normalizedError;
}

export async function adminListFingerprintCleanupMappings(
  functions: ReturnType<typeof getCampusFunctions>,
): Promise<FingerprintCleanupReport> {
  logAuthEvent("info", "Loading fingerprint cleanup mappings");

  const callable = httpsCallable<Record<string, never>, FingerprintCleanupReport>(
    functions,
    "adminListFingerprintCleanupMappings",
  );

  try {
    const result = await callable({});
    return normalizeFingerprintCleanupReport(result.data);
  } catch (error: unknown) {
    throwNormalizedFingerprintCleanupError(error, "load");
  }
}

export async function adminManageFingerprintCleanup(
  functions: ReturnType<typeof getCampusFunctions>,
  payload: {
    action: FingerprintCleanupAction;
    templateId: number;
    fingerprintDeviceId?: string;
    uid?: string;
    keepUid?: string;
    reason?: string;
  },
): Promise<FingerprintCleanupActionResult> {
  logAuthEvent("info", "Submitting fingerprint cleanup action", {
    action: payload.action,
    templateId: payload.templateId,
    fingerprintDeviceId: payload.fingerprintDeviceId ?? null,
    hasUid: Boolean(payload.uid),
    hasKeepUid: Boolean(payload.keepUid),
  });

  const callable = httpsCallable<
    {
      action: FingerprintCleanupAction;
      templateId: number;
      fingerprintDeviceId?: string;
      uid?: string;
      keepUid?: string;
      reason?: string;
    },
    FingerprintCleanupActionResult
  >(functions, "adminManageFingerprintCleanup");

  try {
    const result = await callable(payload);
    return result.data;
  } catch (error: unknown) {
    throwNormalizedFingerprintCleanupError(error, "manage");
  }
}

export async function adminBuildFingerprintMappingsFromProfiles(
  functions: ReturnType<typeof getCampusFunctions>,
): Promise<FingerprintCleanupBuildMappingsResult> {
  logAuthEvent("info", "Building fingerprint mappings from profiles", {
    region: CAMPUS_FUNCTIONS_REGION,
  });

  const callable = httpsCallable<
    Record<string, never>,
    FingerprintCleanupBuildMappingsResult
  >(functions, "adminBuildFingerprintMappingsFromProfiles");

  try {
    const result = await callable({});
    return result.data;
  } catch (error: unknown) {
    throwNormalizedFingerprintCleanupError(error, "build");
  }
}

export async function adminQueueFullFingerprintWipe(
  functions: ReturnType<typeof getCampusFunctions>,
  payload?: {
    deviceId?: string;
    reason?: string;
    markEnrollmentSessionRowsStale?: boolean;
  },
): Promise<FingerprintFullWipeQueueResult> {
  logAuthEvent("info", "Queueing full AS608 fingerprint wipe", {
    targetDeviceId: payload?.deviceId ?? "campus-portable-01",
    markEnrollmentSessionRowsStale:
      payload?.markEnrollmentSessionRowsStale === true,
  });

  const callable = httpsCallable<
    {
      deviceId?: string;
      reason?: string;
      markEnrollmentSessionRowsStale?: boolean;
    },
    FingerprintFullWipeQueueResult
  >(functions, "adminQueueFullFingerprintWipe");

  try {
    const result = await callable(payload ?? {});
    return result.data;
  } catch (error: unknown) {
    throwNormalizedFingerprintCleanupError(error, "manage");
  }
}

export async function adminClearFirebaseFingerprintMappingsOnly(
  functions: ReturnType<typeof getCampusFunctions>,
  payload?: {
    deviceId?: string;
    reason?: string;
    markEnrollmentSessionRowsStale?: boolean;
  },
): Promise<FingerprintFirebaseOnlyWipeResult> {
  logAuthEvent("info", "Clearing Firebase fingerprint mappings only", {
    targetDeviceId: payload?.deviceId ?? "campus-portable-01",
    markEnrollmentSessionRowsStale:
      payload?.markEnrollmentSessionRowsStale === true,
  });

  const callable = httpsCallable<
    {
      deviceId?: string;
      reason?: string;
      markEnrollmentSessionRowsStale?: boolean;
    },
    FingerprintFirebaseOnlyWipeResult
  >(functions, "adminClearFirebaseFingerprintMappingsOnly");

  try {
    const result = await callable(payload ?? {});
    return result.data;
  } catch (error: unknown) {
    throwNormalizedFingerprintCleanupError(error, "manage");
  }
}

export function logCampusAuthEvent(
  level: "info" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown>,
) {
  logAuthEvent(level, message, payload);
}
