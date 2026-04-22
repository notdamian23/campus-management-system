import * as admin from "firebase-admin";
import * as functionsLogger from "firebase-functions/logger";
import {HttpsError, onCall, onRequest, type CallableRequest} from "firebase-functions/v2/https";
import {
  onDocumentCreatedWithAuthContext,
  onDocumentDeletedWithAuthContext,
  onDocumentUpdatedWithAuthContext,
} from "firebase-functions/v2/firestore";
import {createCampusLogger} from "./campusLogger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-southeast1";
const STUDENT_SCHOOL_ID_INDEX_COLLECTION = "studentSchoolIds";
const STUDENT_SCHOOL_ID_RESERVATION_TTL_MS = 10 * 60 * 1000;

type BulkImportContext = {
  data: Record<string, unknown>;
  auth: {
    uid: string;
    token: admin.auth.DecodedIdToken;
    rawToken: string;
  };
};

type BulkStudentImportInputSchema = "split" | "legacy";
type StudentSchoolIdReservationSource =
  | "admin_create_student"
  | "ec_create_student"
  | "bulk_student_import";
type StudentSchoolIdDuplicateSource =
  | "index"
  | "profile"
  | "student"
  | "reservation";
type DuplicateStudentSchoolIdEntrySource = "profile" | "student_projection";
type DuplicateStudentSchoolIdEntry = {
  uid: string;
  name: string;
  email: string;
  status: string;
  role: string;
  source: DuplicateStudentSchoolIdEntrySource;
  createdAtMs: number;
  isPrimary: boolean;
};
type DuplicateStudentSchoolIdGroup = {
  schoolId: string;
  schoolIdKey: string;
  primaryUid: string;
  count: number;
  cleanupCandidateCount: number;
  entries: DuplicateStudentSchoolIdEntry[];
};
type DuplicateStudentSchoolIdReport = {
  duplicateGroupCount: number;
  duplicateEntryCount: number;
  cleanupCandidateCount: number;
  duplicates: DuplicateStudentSchoolIdGroup[];
};
type FingerprintCleanupMappingStatus =
  | "active"
  | "stale"
  | "needs_reenrollment"
  | "duplicate"
  | "deleted"
  | "missing_profile";
type FingerprintCleanupReportSummary = {
  total: number;
  active: number;
  stale: number;
  duplicate: number;
  needsReenrollment: number;
};
type FingerprintCleanupReportSource =
  | "fingerprintTemplates"
  | "profiles_fallback"
  | "mixed"
  | "empty";
type FingerprintCleanupQueueType =
  | "removeMapping"
  | "deleteTemplateIfUnused"
  | "markNeedsReenrollment";
type FingerprintCleanupReportMapping = {
  rowId: string;
  templateId: number;
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  profileStatus: string;
  mappingStatus: FingerprintCleanupMappingStatus;
  fingerprintStatus: string;
  lastEnrolledAtMs: number;
  duplicateTemplateCount: number;
  duplicateSchoolIdCount: number;
  duplicateReasons: string[];
  sources: string[];
  canRemoveStale: boolean;
  canRemoveMapping: boolean;
  canKeepTemplateOwner: boolean;
  needsReenrollment: boolean;
};
type FingerprintCleanupReport = {
  generatedAtMs: number;
  summary: FingerprintCleanupReportSummary;
  totalMappings: number;
  activeMappings: number;
  staleMappings: number;
  duplicateMappings: number;
  needsReenrollment: number;
  source: FingerprintCleanupReportSource;
  fallbackUsed: boolean;
  emptyMessage: string;
  mappings: FingerprintCleanupReportMapping[];
};
type MutableFingerprintCleanupMapping = {
  rowId: string;
  templateId: number;
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  profileStatus: string;
  profileRole: string;
  fingerprintStatus: string;
  lastEnrolledAtMs: number;
  duplicateTemplateCount: number;
  duplicateSchoolIdCount: number;
  duplicateReasons: string[];
  hasProfile: boolean;
  hasStudentProjection: boolean;
  hasTemplateDoc: boolean;
  templateDocActive: boolean;
  templateDocStatus: string;
  sourceSet: Set<string>;
};
type FingerprintCleanupActionResponse = {
  ok: boolean;
  action: string;
  updatedCount: number;
  queueCount: number;
  message: string;
};
type FingerprintCleanupBuildMappingsResponse = {
  ok: boolean;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  totalProfileMappings: number;
  message: string;
};

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://campusportal.site",
  "https://campus-27dd9.web.app",
  "https://campus-27dd9.firebaseapp.com"
];

function setCorsHeaders(res: any, origin: string) {
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');
  }
}

const authLogger = createCampusLogger("CAMPUS auth");
type CallableAuthContext = {
  auth?: CallableRequest<Record<string, unknown>>["auth"];
};
type CampusProfilePayload = {
  role?: string;
  schoolId?: string;
  email?: string;
  pendingEmail?: string | null;
  mustChangePassword?: boolean;
  emailVerified?: boolean;
  emailVerificationPending?: boolean;
  firstLoginCompleted?: boolean;
  status?: string;
  teacherName?: string;
  studentName?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  course?: string;
  ecScope?: "all" | "course" | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  courseScopeLabel?: string | null;
  year?: string;
  yearLevel?: string;
  readyForClearance?: boolean;
  ecPosition?: string;
  isBod?: boolean;
  isStudent?: boolean;
};

const STUDENT_ONLY_LOOKUP_PROFILE_ROLES = ["student"] as const;
const STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES = [
  "student",
  "bod",
  "ec",
  "ecmember",
] as const;

const VALID_COURSES = [
  "Computer Engineering",
  "Industrial Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Electronics Engineering",
] as const;
const COURSE_ALIASES: Record<string, typeof VALID_COURSES[number]> = {
  bscpe: "Computer Engineering",
  bsie: "Industrial Engineering",
  bsee: "Electrical Engineering",
  bsme: "Mechanical Engineering",
  bsece: "Electronics Engineering",
  computerengineering: "Computer Engineering",
  computer: "Computer Engineering",
  industrialengineering: "Industrial Engineering",
  industrial: "Industrial Engineering",
  electricalengineering: "Electrical Engineering",
  electrical: "Electrical Engineering",
  mechanicalengineering: "Mechanical Engineering",
  mechanical: "Mechanical Engineering",
  electronicsengineering: "Electronics Engineering",
  electronicsandcommunicationsengineering: "Electronics Engineering",
  electronics: "Electronics Engineering",
  cpe: "Computer Engineering",
  ie: "Industrial Engineering",
  ee: "Electrical Engineering",
  me: "Mechanical Engineering",
  ece: "Electronics Engineering",
};
const COURSE_CODE_TO_SCOPE: Record<string, typeof VALID_COURSES[number]> = {
  CPE: "Computer Engineering",
  IE: "Industrial Engineering",
  EE: "Electrical Engineering",
  ME: "Mechanical Engineering",
  ECE: "Electronics Engineering",
};
const COURSE_SCOPE_TO_CODE = Object.entries(COURSE_CODE_TO_SCOPE).reduce<
  Record<string, string>
>((lookup, [code, course]) => {
  lookup[course] = code;
  return lookup;
}, {});
const BOD_POSITION_TO_COURSE_SCOPE: Record<string, typeof VALID_COURSES[number]> = {
  "B.O.D. (ME)": "Mechanical Engineering",
  "B.O.D. (EE)": "Electrical Engineering",
  "B.O.D. (IE)": "Industrial Engineering",
  "B.O.D. (CPE)": "Computer Engineering",
  "B.O.D. (ECE)": "Electronics Engineering",
};
const ALL_SCOPE_EC_POSITIONS = new Set<string>([
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "P.I.O.",
  "H.A.S.",
]);

function isValidCourse(value: string): boolean {
  return VALID_COURSES.includes(value as typeof VALID_COURSES[number]);
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function isEcRole(role?: unknown): boolean {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "ec" || normalized === "ecmember";
}

function isStudentOnlyRole(value: unknown): boolean {
  return normalizeCampusRoleValue(value) === "student";
}

function isBodRole(value: unknown): boolean {
  return normalizeCampusRoleValue(value) === "bod";
}

function isRegularEcRole(value: unknown): boolean {
  return isEcRole(value) || normalizeCampusRoleValue(value) === "ecmember";
}

function isEcWorkspaceRoleValue(value: unknown): boolean {
  return isRegularEcRole(value) || isBodRole(value);
}

function shouldTrackStudentProjection(
  role: unknown,
  data?: FirebaseFirestore.DocumentData,
): boolean {
  return normalizeCampusRoleValue(role) === "student" ||
    normalizeCampusRoleValue(role) === "bod" ||
    data?.isStudent === true ||
    isBodProfileData(data ?? {});
}

function normalizeSchoolIdKey(value: unknown): string {
  return normalizeLower(value);
}

function optionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function toPositiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeNamePart(value: unknown): string {
  // Preserve Unicode student names such as Peña, Niño, and Muñoz while still
  // trimming pasted/imported whitespace.
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
}

function buildStudentFullName(firstName: unknown, lastName: unknown): string {
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);
  return [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");
}

function resolveBulkImportFullName(row: Record<string, unknown>): string {
  return (
    normalizeNamePart(row.fullName) ||
    normalizeNamePart(row.name) ||
    normalizeNamePart(row.studentName) ||
    buildStudentFullName(row.firstName, row.lastName)
  );
}

function normalizeBulkStudentImportInputSchema(
  value: unknown,
): BulkStudentImportInputSchema | "" {
  const normalized = normalizeLower(value);
  if (normalized === "legacy") return "legacy";
  if (normalized === "split") return "split";
  return "";
}

function resolveBulkStudentImportInputSchema(
  row: Record<string, unknown>,
  fallbackSchema?: BulkStudentImportInputSchema,
): BulkStudentImportInputSchema {
  const explicitSchema = normalizeBulkStudentImportInputSchema(row.nameSchema);
  if (explicitSchema) {
    return explicitSchema;
  }

  if (fallbackSchema) {
    return fallbackSchema;
  }

  if ("lastName" in row || "firstName" in row) {
    return "split";
  }

  return "legacy";
}

function normalizeCourseLabel(value: unknown): string {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (isValidCourse(normalized)) {
    return normalized;
  }

  const aliasKey = normalized.toLowerCase().replace(/[\s.-]+/g, "");
  return COURSE_ALIASES[aliasKey] ?? "";
}

function normalizeAssignedCourseCode(value: unknown): string {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized && COURSE_CODE_TO_SCOPE[normalized]) {
    return normalized;
  }

  const normalizedCourse = normalizeCourseLabel(value);
  return normalizedCourse ? (COURSE_SCOPE_TO_CODE[normalizedCourse] ?? "") : "";
}

function normalizeCampusRoleValue(
  value: unknown
): "admin" | "ecmember" | "bod" | "teacher" | "student" | "" {
  const normalized = normalizeLower(value);
  if (!normalized) {
    return "";
  }

  const compact = normalized.replace(/[^a-z]/g, "");
  if (compact === "admin") return "admin";
  if (compact === "bod") return "bod";
  if (compact === "teacher") return "teacher";
  if (compact === "student") return "student";
  if (isEcRole(compact) || compact === "ecmemberprofile") {
    return "ecmember";
  }

  return "";
}

function isECMemberRole(value: unknown): boolean {
  return isEcWorkspaceRoleValue(value);
}

function normalizeECPosition(value: unknown): string {
  const position = normalizeText(value);
  if (!position) {
    return "";
  }

  const exact = Object.keys(BOD_POSITION_TO_COURSE_SCOPE).find(
    (item) => normalizeLower(item) === normalizeLower(position),
  );
  return exact ?? position;
}

function inferCourseScopeFromPosition(value: unknown): string {
  const normalizedPosition = normalizeECPosition(value);
  return BOD_POSITION_TO_COURSE_SCOPE[normalizedPosition] ?? "";
}

function isAllScopeECPosition(value: unknown): boolean {
  return ALL_SCOPE_EC_POSITIONS.has(normalizeECPosition(value));
}

function isBodPosition(value: unknown): boolean {
  const normalizedPosition = normalizeECPosition(value);
  return normalizedPosition === "B.O.D." ||
    normalizedPosition.startsWith("B.O.D. (");
}

function extractAssignedCourseFromPosition(value: unknown): string {
  const match = normalizeText(value).match(/^B\.O\.D\.\s*\(([A-Za-z]+)\)$/i);
  if (!match) {
    return "";
  }

  return normalizeAssignedCourseCode(match[1]);
}

function normalizeEcScope(value: unknown): "all" | "course" | "" {
  const normalized = normalizeLower(value);
  if (normalized === "all") return "all";
  if (normalized === "course") return "course";
  return "";
}

function resolveExplicitProfileCourseScope(
  data: FirebaseFirestore.DocumentData,
): string {
  return (
    normalizeCourseLabel(data.courseScopeLabel) ||
    normalizeCourseLabel(data.courseScope)
  );
}

function resolveAssignedCourseCode(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeAssignedCourseCode(data.assignedCourse) ||
    extractAssignedCourseFromPosition(data.ecPosition) ||
    normalizeAssignedCourseCode(data.courseScope) ||
    normalizeAssignedCourseCode(data.courseScopeLabel)
  );
}

function resolveProfileEcScope(
  data: FirebaseFirestore.DocumentData,
): "all" | "course" | "" {
  if (!isECMemberRole(data.role)) {
    return "";
  }

  if (isBodRole(data.role)) {
    return "course";
  }

  const explicitScope = normalizeEcScope(data.ecScope);
  if (explicitScope) {
    return explicitScope;
  }

  if (data.isBod === true) {
    return "course";
  }

  if (isBodPosition(data.ecPosition)) {
    return "course";
  }

  if (isAllScopeECPosition(data.ecPosition)) {
    return "all";
  }

  return resolveAssignedCourseCode(data) ||
      inferCourseScopeFromPosition(data.ecPosition) ||
      resolveExplicitProfileCourseScope(data) ?
    "course" :
    "all";
}

function resolveProfileCourseScope(data: FirebaseFirestore.DocumentData): string {
  const assignedCourseCode = resolveAssignedCourseCode(data);
  const explicitScope = normalizeEcScope(data.ecScope);
  const courseScopeLabel = normalizeCourseLabel(data.courseScopeLabel);
  const course = normalizeCourseLabel(data.course);
  const assignedCourseScope = COURSE_CODE_TO_SCOPE[assignedCourseCode] || "";
  const positionScope = inferCourseScopeFromPosition(data.ecPosition);
  const courseScope = normalizeCourseLabel(data.courseScope);

  if (!isECMemberRole(data.role)) {
    return "";
  }

  if (isBodProfileData(data)) {
    return (
      courseScopeLabel ||
      course ||
      assignedCourseScope ||
      positionScope ||
      courseScope
    );
  }

  if (explicitScope === "course") {
    return (
      courseScopeLabel ||
      course ||
      assignedCourseScope ||
      positionScope ||
      courseScope
    );
  }

  return "";
}

function isBodProfileData(data: FirebaseFirestore.DocumentData): boolean {
  if (isBodRole(data.role)) {
    return true;
  }

  if (!isECMemberRole(data.role)) {
    return false;
  }

  const explicitEcScope = normalizeEcScope(data.ecScope);
  if (explicitEcScope === "course") {
    return true;
  }
  if (explicitEcScope === "all") {
    return false;
  }

  if (data.isBod === true) {
    return true;
  }

  if (isBodPosition(data.ecPosition)) {
    return true;
  }

  if (isAllScopeECPosition(data.ecPosition)) {
    return false;
  }

  return Boolean(
    resolveAssignedCourseCode(data) ||
      inferCourseScopeFromPosition(data.ecPosition) ||
      resolveExplicitProfileCourseScope(data),
  );
}

function hasStudentIdentityData(
  data: FirebaseFirestore.DocumentData,
): boolean {
  return normalizeCampusRoleValue(data.role) === "student" ||
    normalizeCampusRoleValue(data.role) === "bod" ||
    data.isStudent === true ||
    isBodProfileData(data);
}

function isCampusLocalEmail(value: unknown): boolean {
  return normalizeLower(value).endsWith("@campus.local");
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function studentSchoolIdIndexRef(schoolIdKey: string) {
  return db.collection(STUDENT_SCHOOL_ID_INDEX_COLLECTION).doc(schoolIdKey);
}

function schoolIdAlreadyExistsError(message = "School ID already exists.") {
  return new HttpsError("already-exists", message);
}

function isHttpsErrorCode(error: unknown, code: string): boolean {
  if (error instanceof HttpsError) {
    return error.code === code;
  }

  return typeof error === "object" && error !== null &&
    (error as {code?: string}).code === code;
}

async function findExistingSchoolIdDocument(
  collectionName: "profiles" | "students",
  schoolId: string,
  schoolIdKey: string,
): Promise<{uid: string; schoolId: string; role: string} | null> {
  if (!schoolId || !schoolIdKey) {
    return null;
  }

  const collectionRef = db.collection(collectionName);
  const keyedSnapshot = await collectionRef
    .where("schoolIdKey", "==", schoolIdKey)
    .limit(1)
    .get();

  if (!keyedSnapshot.empty) {
    const keyedDoc = keyedSnapshot.docs[0];
    const keyedData = keyedDoc.data() ?? {};
    return {
      uid: keyedDoc.id,
      schoolId: normalizeText(keyedData.schoolId) || schoolId,
      role: normalizeText(keyedData.role),
    };
  }

  const exactSnapshot = await collectionRef
    .where("schoolId", "==", schoolId)
    .limit(1)
    .get();

  if (exactSnapshot.empty) {
    return null;
  }

  const exactDoc = exactSnapshot.docs[0];
  const exactData = exactDoc.data() ?? {};
  return {
    uid: exactDoc.id,
    schoolId: normalizeText(exactData.schoolId) || schoolId,
    role: normalizeText(exactData.role),
  };
}

async function syncStudentSchoolIdIndex(
  schoolId: string,
  schoolIdKey: string,
  uid: string,
  source: StudentSchoolIdDuplicateSource,
): Promise<void> {
  await studentSchoolIdIndexRef(schoolIdKey).set({
    schoolId,
    schoolIdKey,
    uid,
    role: "student",
    status: "active",
    source,
    updatedAt: serverTimestamp(),
    activatedAt: serverTimestamp(),
  }, {merge: true});
}

async function findExistingStudentSchoolId(
  schoolId: string,
): Promise<{
  schoolId: string;
  schoolIdKey: string;
  uid?: string;
  source: StudentSchoolIdDuplicateSource;
} | null> {
  const normalizedSchoolId = normalizeText(schoolId);
  const schoolIdKey = normalizeSchoolIdKey(normalizedSchoolId);

  if (!normalizedSchoolId || !schoolIdKey) {
    return null;
  }

  const indexRef = studentSchoolIdIndexRef(schoolIdKey);
  const [indexSnapshot, profileMatch, studentMatch] = await Promise.all([
    indexRef.get(),
    findExistingSchoolIdDocument("profiles", normalizedSchoolId, schoolIdKey),
    findExistingSchoolIdDocument("students", normalizedSchoolId, schoolIdKey),
  ]);

  if (profileMatch) {
    await syncStudentSchoolIdIndex(
      profileMatch.schoolId,
      schoolIdKey,
      profileMatch.uid,
      "profile",
    );
    return {
      schoolId: profileMatch.schoolId,
      schoolIdKey,
      uid: profileMatch.uid,
      source: "profile",
    };
  }

  if (studentMatch) {
    await syncStudentSchoolIdIndex(
      studentMatch.schoolId,
      schoolIdKey,
      studentMatch.uid,
      "student",
    );
    return {
      schoolId: studentMatch.schoolId,
      schoolIdKey,
      uid: studentMatch.uid,
      source: "student",
    };
  }

  if (!indexSnapshot.exists) {
    return null;
  }

  const indexData = indexSnapshot.data() ?? {};
  const indexedSchoolId = normalizeText(indexData.schoolId) || normalizedSchoolId;
  const indexedUid = normalizeText(indexData.uid);
  const indexedStatus = normalizeLower(indexData.status);
  const reservedAtMs = toPositiveNumber(indexData.reservedAtMs);

  if (indexedUid || indexedStatus === "active") {
    return {
      schoolId: indexedSchoolId,
      schoolIdKey,
      uid: indexedUid || undefined,
      source: "index",
    };
  }

  if (reservedAtMs && Date.now() - reservedAtMs <= STUDENT_SCHOOL_ID_RESERVATION_TTL_MS) {
    return {
      schoolId: indexedSchoolId,
      schoolIdKey,
      source: "reservation",
    };
  }

  await indexRef.delete().catch(() => undefined);
  return null;
}

async function reserveUniqueStudentSchoolId(
  schoolId: string,
  source: StudentSchoolIdReservationSource,
): Promise<{
  schoolId: string;
  schoolIdKey: string;
  activate: (uid: string) => Promise<void>;
  release: () => Promise<void>;
}> {
  const normalizedSchoolId = normalizeText(schoolId);
  const schoolIdKey = normalizeSchoolIdKey(normalizedSchoolId);

  if (!normalizedSchoolId || !schoolIdKey) {
    throw new HttpsError("invalid-argument", "School ID is required.");
  }

  const existingMatch = await findExistingStudentSchoolId(normalizedSchoolId);
  if (existingMatch) {
    const duplicateMessage =
      existingMatch.source === "reservation" ?
        "School ID is already being created. Please try again." :
        "School ID already exists.";
    throw schoolIdAlreadyExistsError(duplicateMessage);
  }

  const indexRef = studentSchoolIdIndexRef(schoolIdKey);
  const reservedAtMs = Date.now();

  await db.runTransaction(async (transaction) => {
    const reservationSnapshot = await transaction.get(indexRef);
    if (reservationSnapshot.exists) {
      const reservationData = reservationSnapshot.data() ?? {};
      const reservationUid = normalizeText(reservationData.uid);
      const reservationStatus = normalizeLower(reservationData.status);
      const previousReservedAtMs = toPositiveNumber(reservationData.reservedAtMs);
      const isStaleReservation =
        previousReservedAtMs > 0 &&
        Date.now() - previousReservedAtMs > STUDENT_SCHOOL_ID_RESERVATION_TTL_MS;

      if (reservationUid || reservationStatus === "active" || !isStaleReservation) {
        throw schoolIdAlreadyExistsError(
          reservationUid || reservationStatus === "active" ?
            "School ID already exists." :
            "School ID is already being created. Please try again.",
        );
      }
    }

    transaction.set(indexRef, {
      schoolId: normalizedSchoolId,
      schoolIdKey,
      role: "student",
      status: "reserved",
      source,
      reservedAtMs,
      reservedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });

  return {
    schoolId: normalizedSchoolId,
    schoolIdKey,
    activate: async (uid: string) => {
      await indexRef.set({
        schoolId: normalizedSchoolId,
        schoolIdKey,
        uid,
        role: "student",
        status: "active",
        source,
        updatedAt: serverTimestamp(),
        activatedAt: serverTimestamp(),
      }, {merge: true});
    },
    release: async () => {
      await indexRef.delete().catch(() => undefined);
    },
  };
}

async function fetchExistingStudentSchoolIds(schoolIds: string[]): Promise<Set<string>> {
  const normalizedIds = Array.from(
    new Set(schoolIds.map((value) => normalizeText(value)).filter(Boolean)),
  );
  const existing = new Set<string>();

  if (normalizedIds.length === 0) {
    return existing;
  }

  const indexedIdsByKey = new Map<string, string>();
  normalizedIds.forEach((schoolId) => {
    indexedIdsByKey.set(normalizeSchoolIdKey(schoolId), schoolId);
  });

  for (let i = 0; i < normalizedIds.length; i += 10) {
    const chunk = normalizedIds.slice(i, i + 10);
    const chunkKeys = chunk.map((schoolId) => normalizeSchoolIdKey(schoolId));
    const chunkLookup = new Map<string, string>();
    chunk.forEach((schoolId) => {
      chunkLookup.set(normalizeSchoolIdKey(schoolId), schoolId);
    });

    const indexSnapshots = await db.getAll(
      ...chunkKeys.map((schoolIdKey) => studentSchoolIdIndexRef(schoolIdKey)),
    );

    indexSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        return;
      }

      const data = snapshot.data() ?? {};
      const indexedUid = normalizeText(data.uid);
      const indexedStatus = normalizeLower(data.status);
      const reservedAtMs = toPositiveNumber(data.reservedAtMs);
      if (
        indexedUid ||
        indexedStatus === "active" ||
        (reservedAtMs &&
          Date.now() - reservedAtMs <= STUDENT_SCHOOL_ID_RESERVATION_TTL_MS)
      ) {
        existing.add(chunk[index]);
      }
    });

    const [
      profileSchoolIdSnapshot,
      profileKeySnapshot,
      studentSchoolIdSnapshot,
      studentKeySnapshot,
    ] = await Promise.all([
      db.collection("profiles").where("schoolId", "in", chunk).get(),
      db.collection("profiles").where("schoolIdKey", "in", chunkKeys).get(),
      db.collection("students").where("schoolId", "in", chunk).get(),
      db.collection("students").where("schoolIdKey", "in", chunkKeys).get(),
    ]);

    const snapshots = [
      profileSchoolIdSnapshot,
      profileKeySnapshot,
      studentSchoolIdSnapshot,
      studentKeySnapshot,
    ];

    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((doc) => {
        const data = doc.data() ?? {};
        const docSchoolId = normalizeText(data.schoolId);
        const docSchoolIdKey = normalizeSchoolIdKey(
          data.schoolIdKey || data.schoolId,
        );
        const matchedSchoolId =
          chunkLookup.get(docSchoolIdKey) ||
          indexedIdsByKey.get(docSchoolIdKey) ||
          docSchoolId;
        if (matchedSchoolId) {
          existing.add(matchedSchoolId);
        }
      });
    });
  }

  return existing;
}

function resolveDuplicateStudentRecordName(
  data: FirebaseFirestore.DocumentData,
): string {
  const firstName = normalizeNamePart(data.firstName);
  const lastName = normalizeNamePart(data.lastName);
  const combinedName = buildStudentFullName(firstName, lastName);
  return (
    combinedName ||
    normalizeNamePart(data.fullName) ||
    normalizeNamePart(data.studentName) ||
    normalizeNamePart(data.name)
  );
}

function sortDuplicateStudentRecords(
  left: {
    uid: string;
    hasProfile: boolean;
    hasStudentProjection: boolean;
    createdAtMs: number;
  },
  right: {
    uid: string;
    hasProfile: boolean;
    hasStudentProjection: boolean;
    createdAtMs: number;
  },
) {
  if (left.hasProfile !== right.hasProfile) {
    return left.hasProfile ? -1 : 1;
  }

  if (left.hasStudentProjection !== right.hasStudentProjection) {
    return left.hasStudentProjection ? -1 : 1;
  }

  const leftCreatedAt = left.createdAtMs > 0 ? left.createdAtMs : Number.MAX_SAFE_INTEGER;
  const rightCreatedAt = right.createdAtMs > 0 ? right.createdAtMs : Number.MAX_SAFE_INTEGER;
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return left.uid.localeCompare(right.uid);
}

function duplicateEntrySourceToIndexSource(
  source: DuplicateStudentSchoolIdEntrySource,
): StudentSchoolIdDuplicateSource {
  return source === "profile" ? "profile" : "student";
}

async function buildDuplicateStudentSchoolIdReport(
  limit = Number.MAX_SAFE_INTEGER,
): Promise<DuplicateStudentSchoolIdReport> {
  const [profileSnapshot, studentSnapshot] = await Promise.all([
    db.collection("profiles").where("role", "==", "student").get(),
    db.collection("students").get(),
  ]);

  const mergedRecords = new Map<string, {
    uid: string;
    schoolId: string;
    schoolIdKey: string;
    name: string;
    email: string;
    status: string;
    role: string;
    createdAtMs: number;
    hasProfile: boolean;
    hasStudentProjection: boolean;
  }>();

  profileSnapshot.docs.forEach((profileDoc) => {
    const profileData = profileDoc.data() ?? {};
    const schoolId = normalizeText(profileData.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(profileData.schoolIdKey || schoolId);
    if (!schoolId || !schoolIdKey) {
      return;
    }

    const currentRecord = mergedRecords.get(profileDoc.id) || {
      uid: profileDoc.id,
      schoolId,
      schoolIdKey,
      name: "",
      email: "",
      status: "",
      role: "student",
      createdAtMs: 0,
      hasProfile: false,
      hasStudentProjection: false,
    };

    currentRecord.schoolId = schoolId;
    currentRecord.schoolIdKey = schoolIdKey;
    currentRecord.name =
      resolveDuplicateStudentRecordName(profileData) || currentRecord.name;
    currentRecord.email = normalizeText(profileData.email) || currentRecord.email;
    currentRecord.status = normalizeText(profileData.status) || currentRecord.status;
    currentRecord.role = normalizeText(profileData.role) || currentRecord.role;
    currentRecord.createdAtMs = currentRecord.createdAtMs > 0 ?
      Math.min(currentRecord.createdAtMs, toMillis(profileData.createdAt)) :
      toMillis(profileData.createdAt);
    currentRecord.hasProfile = true;

    mergedRecords.set(profileDoc.id, currentRecord);
  });

  studentSnapshot.docs.forEach((studentDoc) => {
    const studentData = studentDoc.data() ?? {};
    const schoolId = normalizeText(studentData.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(studentData.schoolIdKey || schoolId);
    if (!schoolId || !schoolIdKey) {
      return;
    }

    const currentRecord = mergedRecords.get(studentDoc.id) || {
      uid: studentDoc.id,
      schoolId,
      schoolIdKey,
      name: "",
      email: "",
      status: "",
      role: "student",
      createdAtMs: 0,
      hasProfile: false,
      hasStudentProjection: false,
    };

    if (!currentRecord.schoolId) {
      currentRecord.schoolId = schoolId;
    }
    if (!currentRecord.schoolIdKey) {
      currentRecord.schoolIdKey = schoolIdKey;
    }
    currentRecord.name =
      currentRecord.name || resolveDuplicateStudentRecordName(studentData);
    currentRecord.status = currentRecord.status || normalizeText(studentData.status);
    const studentCreatedAtMs = toMillis(studentData.createdAt);
    currentRecord.createdAtMs = currentRecord.createdAtMs > 0 && studentCreatedAtMs > 0 ?
      Math.min(currentRecord.createdAtMs, studentCreatedAtMs) :
      currentRecord.createdAtMs || studentCreatedAtMs;
    currentRecord.hasStudentProjection = true;

    mergedRecords.set(studentDoc.id, currentRecord);
  });

  const groupedDuplicates = new Map<string, Array<{
    uid: string;
    schoolId: string;
    schoolIdKey: string;
    name: string;
    email: string;
    status: string;
    role: string;
    createdAtMs: number;
    hasProfile: boolean;
    hasStudentProjection: boolean;
  }>>();

  mergedRecords.forEach((record) => {
    if (!record.schoolId || !record.schoolIdKey) {
      return;
    }

    const currentGroup = groupedDuplicates.get(record.schoolIdKey) || [];
    currentGroup.push(record);
    groupedDuplicates.set(record.schoolIdKey, currentGroup);
  });

  const duplicates = Array.from(groupedDuplicates.values())
    .filter((group) => group.length > 1)
    .map((group) => {
      const sortedEntries = [...group].sort(sortDuplicateStudentRecords);
      const primaryEntry = sortedEntries[0];

      return {
        schoolId: primaryEntry.schoolId,
        schoolIdKey: primaryEntry.schoolIdKey,
        primaryUid: primaryEntry.uid,
        count: sortedEntries.length,
        cleanupCandidateCount: Math.max(0, sortedEntries.length - 1),
        entries: sortedEntries.map((entry, index) => ({
          uid: entry.uid,
          name: entry.name,
          email: entry.email,
          status: entry.status,
          role: entry.role,
          source: entry.hasProfile ? "profile" : "student_projection",
          createdAtMs: entry.createdAtMs,
          isPrimary: index === 0,
        })),
      } satisfies DuplicateStudentSchoolIdGroup;
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.schoolId.localeCompare(right.schoolId);
    });

  const duplicateEntryCount = duplicates.reduce(
    (total, group) => total + group.count,
    0,
  );
  const cleanupCandidateCount = duplicates.reduce(
    (total, group) => total + group.cleanupCandidateCount,
    0,
  );

  return {
    duplicateGroupCount: duplicates.length,
    duplicateEntryCount,
    cleanupCandidateCount,
    duplicates: duplicates.slice(0, limit),
  };
}

function extractFingerprintTemplateId(
  data: FirebaseFirestore.DocumentData | undefined,
): number {
  if (!data) {
    return 0;
  }

  const candidates = [
    data.fingerprintTemplateId,
    data.templateId,
    data.fingerprintId,
    asRecord(data.fingerprint).fingerprintTemplateId,
    asRecord(data.fingerprint).templateId,
    asRecord(data.fingerprint).fingerprintId,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate ?? 0);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

function extractFingerprintStatus(
  data: FirebaseFirestore.DocumentData | undefined,
): string {
  if (!data) {
    return "";
  }

  return (
    normalizeText(data.fingerprintStatus) ||
    normalizeText(asRecord(data.fingerprint).status) ||
    normalizeText(asRecord(data.fingerprint).fingerprintStatus)
  );
}

function extractFingerprintEnrolledAt(
  data: FirebaseFirestore.DocumentData | undefined,
): unknown {
  if (!data) {
    return null;
  }

  const fingerprintData = asRecord(data.fingerprint);
  return (
    data.fingerprintEnrolledAt ??
    data.enrolledAt ??
    fingerprintData.enrolledAt ??
    fingerprintData.fingerprintEnrolledAt ??
    data.updatedAt ??
    data.createdAt
  );
}

function emptyFingerprintCleanupReport(
  overrides?: Partial<FingerprintCleanupReport>,
): FingerprintCleanupReport {
  const summary: FingerprintCleanupReportSummary = {
    total: overrides?.summary?.total ?? 0,
    active: overrides?.summary?.active ?? 0,
    stale: overrides?.summary?.stale ?? 0,
    duplicate: overrides?.summary?.duplicate ?? 0,
    needsReenrollment: overrides?.summary?.needsReenrollment ?? 0,
  };

  return {
    generatedAtMs: overrides?.generatedAtMs ?? Date.now(),
    summary,
    totalMappings: overrides?.totalMappings ?? summary.total,
    activeMappings: overrides?.activeMappings ?? summary.active,
    staleMappings: overrides?.staleMappings ?? summary.stale,
    duplicateMappings: overrides?.duplicateMappings ?? summary.duplicate,
    needsReenrollment:
      overrides?.needsReenrollment ?? summary.needsReenrollment,
    source: overrides?.source ?? "empty",
    fallbackUsed: overrides?.fallbackUsed ?? false,
    emptyMessage:
      overrides?.emptyMessage ??
      "No fingerprint mappings found yet. Existing AS608 templates may still be on the device, but the web app has no mapping records. Run module sync or build mappings from profiles.",
    mappings: overrides?.mappings ?? [],
  };
}

function resolveFingerprintRecordName(
  data: FirebaseFirestore.DocumentData | undefined,
): string {
  if (!data) {
    return "";
  }

  return (
    resolveDuplicateStudentRecordName(data) ||
    normalizeNamePart(data.fullName) ||
    normalizeNamePart(data.displayName) ||
    normalizeNamePart(data.teacherName)
  );
}

function createFingerprintMappingRowId(templateId: number, uid: string): string {
  return `${templateId}:${uid || "unknown"}`;
}

function getOrCreateFingerprintCleanupMapping(
  mappings: Map<string, MutableFingerprintCleanupMapping>,
  templateId: number,
  uid: string,
  schoolId: string,
): MutableFingerprintCleanupMapping {
  const normalizedUid = uid || schoolId || `template-${templateId}`;
  const rowId = createFingerprintMappingRowId(templateId, normalizedUid);
  const existing = mappings.get(rowId);
  if (existing) {
    if (!existing.schoolId && schoolId) {
      existing.schoolId = schoolId;
    }
    return existing;
  }

  const created: MutableFingerprintCleanupMapping = {
    rowId,
    templateId,
    uid: normalizedUid,
    schoolId: schoolId || normalizedUid,
    studentName: "",
    course: "",
    yearLevel: "",
    profileStatus: "",
    profileRole: "",
    fingerprintStatus: "",
    lastEnrolledAtMs: 0,
    duplicateTemplateCount: 0,
    duplicateSchoolIdCount: 0,
    duplicateReasons: [],
    hasProfile: false,
    hasStudentProjection: false,
    hasTemplateDoc: false,
    templateDocActive: true,
    templateDocStatus: "",
    sourceSet: new Set<string>(),
  };

  mappings.set(rowId, created);
  return created;
}

function isFingerprintMappingPotentiallyActive(
  mapping: MutableFingerprintCleanupMapping,
): boolean {
  const profileStatus = normalizeLower(mapping.profileStatus);
  const profileRole = normalizeLower(mapping.profileRole);
  const fingerprintStatus = normalizeLower(
    mapping.fingerprintStatus || mapping.templateDocStatus,
  );

  if (mapping.templateId <= 0) {
    return false;
  }

  if (!mapping.hasProfile) {
    return false;
  }

  if (profileRole && profileRole !== "student") {
    return false;
  }

  if (profileStatus === "inactive" || profileStatus === "deleted") {
    return false;
  }

  if (
    fingerprintStatus === "needs_reenrollment" ||
    fingerprintStatus === "stale" ||
    fingerprintStatus === "inactive" ||
    fingerprintStatus === "deleted"
  ) {
    return false;
  }

  if (mapping.templateDocActive === false) {
    return false;
  }

  return true;
}

async function buildFingerprintCleanupReport(): Promise<FingerprintCleanupReport> {
  const [templateSnapshot, profileSnapshot, studentSnapshot] = await Promise.all([
    db.collection("fingerprintTemplates").get(),
    db.collection("profiles").get(),
    db.collection("students").get(),
  ]);

  const mappings = new Map<string, MutableFingerprintCleanupMapping>();
  let needsReenrollment = 0;

  profileSnapshot.docs.forEach((profileDoc) => {
    const profileData = profileDoc.data() ?? {};
    const templateId = extractFingerprintTemplateId(profileData);
    const fingerprintStatus = extractFingerprintStatus(profileData);
    if (templateId <= 0 && !fingerprintStatus) {
      return;
    }

    if (templateId <= 0 && normalizeLower(fingerprintStatus) === "needs_reenrollment") {
      needsReenrollment += 1;
      return;
    }

    const schoolId = normalizeText(profileData.schoolId) || profileDoc.id;
    const mapping = getOrCreateFingerprintCleanupMapping(
      mappings,
      templateId,
      profileDoc.id,
      schoolId,
    );
    mapping.hasProfile = true;
    mapping.profileStatus = normalizeText(profileData.status) || mapping.profileStatus;
    mapping.profileRole = normalizeText(profileData.role) || mapping.profileRole;
    mapping.studentName =
      resolveFingerprintRecordName(profileData) || mapping.studentName || schoolId;
    mapping.course = normalizeText(profileData.course) || mapping.course || "Unassigned";
    mapping.yearLevel =
      normalizeYear(profileData.yearLevel ?? profileData.year) ||
      mapping.yearLevel ||
      "Unassigned";
    mapping.fingerprintStatus = fingerprintStatus || mapping.fingerprintStatus;
    mapping.lastEnrolledAtMs = Math.max(
      mapping.lastEnrolledAtMs,
      toMillis(extractFingerprintEnrolledAt(profileData)),
    );
    mapping.sourceSet.add("profile");
  });

  studentSnapshot.docs.forEach((studentDoc) => {
    const studentData = studentDoc.data() ?? {};
    const templateId = extractFingerprintTemplateId(studentData);
    const fingerprintStatus = extractFingerprintStatus(studentData);
    if (templateId <= 0 && !fingerprintStatus) {
      return;
    }

    if (templateId <= 0 && normalizeLower(fingerprintStatus) === "needs_reenrollment") {
      needsReenrollment += 1;
      return;
    }

    const schoolId = normalizeText(studentData.schoolId) || studentDoc.id;
    const mapping = getOrCreateFingerprintCleanupMapping(
      mappings,
      templateId,
      studentDoc.id,
      schoolId,
    );
    mapping.hasStudentProjection = true;
    if (!mapping.studentName) {
      mapping.studentName =
        resolveFingerprintRecordName(studentData) || mapping.studentName || schoolId;
    }
    if (!mapping.course) {
      mapping.course = normalizeText(studentData.course) || "Unassigned";
    }
    if (!mapping.yearLevel) {
      mapping.yearLevel =
        normalizeYear(studentData.yearLevel ?? studentData.year) || "Unassigned";
    }
    if (!mapping.profileStatus) {
      mapping.profileStatus = normalizeText(studentData.status);
    }
    mapping.fingerprintStatus = fingerprintStatus || mapping.fingerprintStatus;
    mapping.lastEnrolledAtMs = Math.max(
      mapping.lastEnrolledAtMs,
      toMillis(extractFingerprintEnrolledAt(studentData)),
    );
    mapping.sourceSet.add("student_projection");
  });

  templateSnapshot.docs.forEach((templateDoc) => {
    const templateData = templateDoc.data() ?? {};
    const templateId =
      extractFingerprintTemplateId(templateData) ||
      toPositiveNumber(templateDoc.id);
    const uid =
      normalizeText(templateData.uid) ||
      normalizeText(templateData.studentUid) ||
      normalizeText(templateData.studentId);
    const schoolId = normalizeText(templateData.schoolId) || uid || templateDoc.id;
    if (templateId <= 0) {
      return;
    }

    const mapping = getOrCreateFingerprintCleanupMapping(
      mappings,
      templateId,
      uid,
      schoolId,
    );
    mapping.hasTemplateDoc = true;
    mapping.templateDocActive = templateData.active !== false;
    mapping.templateDocStatus = normalizeText(templateData.status);
    if (!mapping.studentName) {
      mapping.studentName =
        resolveFingerprintRecordName(templateData) || mapping.studentName || schoolId;
    }
    if (!mapping.course) {
      mapping.course = normalizeText(templateData.course) || "Unassigned";
    }
    if (!mapping.yearLevel) {
      mapping.yearLevel =
        normalizeYear(templateData.yearLevel ?? templateData.year) || "Unassigned";
    }
    if (!mapping.fingerprintStatus) {
      mapping.fingerprintStatus =
        extractFingerprintStatus(templateData) || mapping.templateDocStatus;
    }
    mapping.lastEnrolledAtMs = Math.max(
      mapping.lastEnrolledAtMs,
      toMillis(
        templateData.enrolledAt ??
          extractFingerprintEnrolledAt(templateData) ??
          templateData.updatedAt ??
          templateData.createdAt,
      ),
    );
    mapping.sourceSet.add("fingerprint_template");
  });

  const templateCounts = new Map<number, number>();
  const schoolTemplateSets = new Map<string, Set<number>>();

  mappings.forEach((mapping) => {
    if (mapping.templateId > 0) {
      templateCounts.set(
        mapping.templateId,
        (templateCounts.get(mapping.templateId) ?? 0) + 1,
      );
    }

    if (mapping.schoolId && isFingerprintMappingPotentiallyActive(mapping)) {
      const current = schoolTemplateSets.get(mapping.schoolId) || new Set<number>();
      current.add(mapping.templateId);
      schoolTemplateSets.set(mapping.schoolId, current);
    }
  });

  let activeMappings = 0;
  let staleMappings = 0;
  let duplicateMappings = 0;

  const resolvedMappings = Array.from(mappings.values())
    .filter((mapping) => mapping.templateId > 0)
    .map((mapping) => {
      const profileStatus = normalizeLower(mapping.profileStatus);
      const fingerprintStatus = normalizeLower(
        mapping.fingerprintStatus || mapping.templateDocStatus,
      );
      const duplicateTemplateCount = templateCounts.get(mapping.templateId) ?? 0;
      const duplicateSchoolIdCount =
        schoolTemplateSets.get(mapping.schoolId)?.size ?? 0;
      const duplicateReasons: string[] = [];

      if (duplicateTemplateCount > 1) {
        duplicateReasons.push("template_shared");
      }
      if (duplicateSchoolIdCount > 1) {
        duplicateReasons.push("multiple_templates_for_school");
      }

      const isDeleted =
        profileStatus === "deleted" || fingerprintStatus === "deleted";
      const isMissingProfile = !mapping.hasProfile;
      const needsReenrollmentStatus =
        fingerprintStatus === "needs_reenrollment";
      const isStale =
        !isDeleted &&
        !isMissingProfile &&
        (
          profileStatus === "inactive" ||
          profileStatus === "disabled" ||
          fingerprintStatus === "stale" ||
          fingerprintStatus === "inactive" ||
          mapping.templateDocActive === false ||
          !mapping.hasStudentProjection
        );
      const isDuplicate = duplicateReasons.length > 0;

      let mappingStatus: FingerprintCleanupMappingStatus = "active";
      if (isDeleted) {
        mappingStatus = "deleted";
      } else if (isMissingProfile) {
        mappingStatus = "missing_profile";
      } else if (isDuplicate) {
        mappingStatus = "duplicate";
      } else if (needsReenrollmentStatus) {
        mappingStatus = "needs_reenrollment";
      } else if (isStale) {
        mappingStatus = "stale";
      }

      if (mappingStatus === "active") {
        activeMappings += 1;
      }
      if (
        mappingStatus === "stale" ||
        mappingStatus === "deleted" ||
        mappingStatus === "missing_profile"
      ) {
        staleMappings += 1;
      }
      if (mappingStatus === "duplicate") {
        duplicateMappings += 1;
      }

      const requiresReenrollment =
        fingerprintStatus === "needs_reenrollment" ||
        mappingStatus === "stale" ||
        mappingStatus === "needs_reenrollment";
      if (requiresReenrollment) {
        needsReenrollment += 1;
      }

      return {
        rowId: mapping.rowId,
        templateId: mapping.templateId,
        uid: mapping.uid,
        schoolId: mapping.schoolId,
        studentName: mapping.studentName || mapping.schoolId || mapping.uid,
        course: mapping.course || "Unassigned",
        yearLevel: mapping.yearLevel || "Unassigned",
        profileStatus: mapping.profileStatus || (mapping.hasProfile ? "Active" : "Missing"),
        mappingStatus,
        fingerprintStatus:
          mapping.fingerprintStatus ||
          mapping.templateDocStatus ||
          (mapping.templateDocActive ? "active" : "stale"),
        lastEnrolledAtMs: mapping.lastEnrolledAtMs,
        duplicateTemplateCount,
        duplicateSchoolIdCount,
        duplicateReasons,
        sources: Array.from(mapping.sourceSet).sort(),
        canRemoveStale:
          mappingStatus === "stale" ||
          mappingStatus === "deleted" ||
          mappingStatus === "missing_profile",
        canRemoveMapping: true,
        canKeepTemplateOwner:
          duplicateTemplateCount > 1 &&
          isFingerprintMappingPotentiallyActive(mapping),
        needsReenrollment: requiresReenrollment,
      } satisfies FingerprintCleanupReportMapping;
    })
    .sort((left, right) => {
      if (left.templateId !== right.templateId) {
        return left.templateId - right.templateId;
      }
      return left.studentName.localeCompare(right.studentName);
    });

  const templateBackedCount = resolvedMappings.filter((mapping) =>
    mapping.sources.includes("fingerprint_template"),
  ).length;
  const fallbackBackedCount = resolvedMappings.filter((mapping) =>
    !mapping.sources.includes("fingerprint_template"),
  ).length;
  const source: FingerprintCleanupReportSource =
    resolvedMappings.length === 0 && needsReenrollment === 0 ?
      "empty" :
      templateBackedCount > 0 && fallbackBackedCount > 0 ?
        "mixed" :
        templateBackedCount > 0 ?
          "fingerprintTemplates" :
          "profiles_fallback";

  if (resolvedMappings.length === 0 && needsReenrollment === 0) {
    return emptyFingerprintCleanupReport({
      source,
      fallbackUsed: templateSnapshot.empty,
    });
  }

  return {
    generatedAtMs: Date.now(),
    summary: {
      total: resolvedMappings.length,
      active: activeMappings,
      stale: staleMappings,
      duplicate: duplicateMappings,
      needsReenrollment,
    },
    totalMappings: resolvedMappings.length,
    activeMappings,
    staleMappings,
    duplicateMappings,
    needsReenrollment,
    source,
    fallbackUsed: templateSnapshot.empty,
    emptyMessage: "",
    mappings: resolvedMappings,
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function buildCampusProfilePayload(
  data: FirebaseFirestore.DocumentData
): CampusProfilePayload {
  const resolvedCourseScope = resolveProfileCourseScope(data) || null;
  const storedCourseScope =
    data.courseScope === null ? null : optionalText(data.courseScope) || null;
  const storedCourseScopeLabel =
    data.courseScopeLabel === null ?
      null :
      (optionalText(data.courseScopeLabel) || resolvedCourseScope);
  return {
    role: normalizeCampusRoleValue(data.role) || optionalText(data.role),
    schoolId: optionalText(data.schoolId),
    email: optionalText(data.email),
    pendingEmail:
      data.pendingEmail === null ? null : normalizeText(data.pendingEmail) || null,
    mustChangePassword: optionalBoolean(data.mustChangePassword),
    emailVerified: optionalBoolean(data.emailVerified),
    emailVerificationPending: optionalBoolean(data.emailVerificationPending),
    firstLoginCompleted: optionalBoolean(data.firstLoginCompleted),
    status: optionalText(data.status),
    teacherName: optionalText(data.teacherName),
    studentName: optionalText(data.studentName),
    name: optionalText(data.name),
    fullName: optionalText(data.fullName),
    displayName: optionalText(data.displayName),
    firstName: optionalText(data.firstName),
    lastName: optionalText(data.lastName),
    course: optionalText(data.course),
    ecScope:
      data.ecScope === null ?
        null :
        (resolveProfileEcScope(data) || null),
    assignedCourse:
      data.assignedCourse === null ?
        null :
        (resolveProfileEcScope(data) === "course" ?
          (resolveAssignedCourseCode(data) || null) :
          null),
    courseScope: storedCourseScope,
    courseScopeLabel: storedCourseScopeLabel,
    year: optionalText(data.year) || optionalText(data.yearLevel),
    yearLevel: optionalText(data.yearLevel) || optionalText(data.year),
    readyForClearance: optionalBoolean(data.readyForClearance),
    ecPosition: optionalText(data.ecPosition),
    isBod: optionalBoolean(data.isBod),
    isStudent:
      optionalBoolean(data.isStudent) ??
      hasStudentIdentityData(data),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ?
    (value as Record<string, unknown>) :
    {};
}

function toMillis(value: unknown): number {
  if (value && typeof (value as {toMillis?: unknown}).toMillis === "function") {
    return (value as {toMillis: () => number}).toMillis();
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as {seconds?: unknown}).seconds === "number"
  ) {
    return Number((value as {seconds: number}).seconds) * 1000;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeYear(raw: unknown): string {
  const value = normalizeText(raw);
  const lowered = value.toLowerCase();

  if (!value) return "Unassigned";
  if (value === "1" || lowered === "1st year") return "1st Year";
  if (value === "2" || lowered === "2nd year") return "2nd Year";
  if (value === "3" || lowered === "3rd year") return "3rd Year";
  if (value === "4" || lowered === "4th year") return "4th Year";
  if (value === "5" || lowered === "5th year") return "5th Year";

  return value;
}

function toTargetList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  const raw = normalizeText(value);
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesTargetList(
  targetValue: unknown,
  studentValue: string,
  allLabel: string
): boolean {
  const targets = toTargetList(targetValue);
  if (targets.length === 0) return true;

  if (
    targets.some((item) => normalizeLower(item) === normalizeLower(allLabel))
  ) {
    return true;
  }

  return targets.some(
    (item) => normalizeLower(item) === normalizeLower(studentValue)
  );
}

function matchesSpecificStudentTarget(
  targetValue: unknown,
  schoolId: string,
  studentName: string
): boolean {
  const rawTarget = normalizeText(targetValue);
  if (!rawTarget) return true;

  const normalizedSchoolId = normalizeLower(schoolId);
  const normalizedStudentName = normalizeLower(studentName);
  if (!normalizedSchoolId && !normalizedStudentName) return false;

  const parts = rawTarget
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.length ? parts : [rawTarget]) {
    const normalized = normalizeLower(part);
    const withoutParens = normalizeLower(part.replace(/\([^)]*\)/g, " ").trim());
    const parenMatch = part.match(/\(([^)]+)\)/);
    const insideParen = normalizeLower(parenMatch?.[1] ?? "");

    if (normalized === normalizedSchoolId || normalized === normalizedStudentName) {
      return true;
    }

    if (insideParen && insideParen === normalizedSchoolId) {
      return true;
    }

    if (
      withoutParens &&
      (
        withoutParens === normalizedStudentName ||
        normalizedStudentName.includes(withoutParens) ||
        withoutParens.includes(normalizedStudentName)
      )
    ) {
      return true;
    }

    if (normalizedSchoolId && normalized.includes(normalizedSchoolId)) {
      return true;
    }

    if (normalizedStudentName && normalized.includes(normalizedStudentName)) {
      return true;
    }
  }

  return false;
}

function normalizeIdentifierList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function hasExplicitSelectedAudience(
  event: {
    selectedStudentIds?: unknown;
    selectedSchoolIds?: unknown;
  }
): boolean {
  return normalizeIdentifierList(event.selectedStudentIds).length > 0 ||
    normalizeIdentifierList(event.selectedSchoolIds).length > 0;
}

function matchesSelectedAudience(
  event: {
    selectedStudentIds?: unknown;
    selectedSchoolIds?: unknown;
  },
  studentId: string,
  schoolId: string
): boolean {
  if (!hasExplicitSelectedAudience(event)) {
    return true;
  }

  const selectedStudentIds = normalizeIdentifierList(event.selectedStudentIds);
  const selectedSchoolIds = normalizeIdentifierList(event.selectedSchoolIds);
  const normalizedStudentId = normalizeLower(studentId);
  const normalizedSchoolId = normalizeLower(schoolId);

  return selectedStudentIds.some((value) => normalizeLower(value) === normalizedStudentId) ||
    selectedSchoolIds.some((value) => normalizeLower(value) === normalizedSchoolId);
}

function parseRegistrationStatus(raw: unknown): "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED" {
  const normalized = normalizeLower(raw);
  if (normalized === "waitlisted") return "WAITLISTED";
  if (normalized === "cancelled") return "CANCELLED";
  return "PRE_REGISTERED";
}

function parseEventWindowMs(value: unknown): number {
  return toMillis(value);
}

function resolveEventStartMs(data: FirebaseFirestore.DocumentData): number {
  const date = normalizeText(data.date);
  const scheduledTime =
    normalizeText(data.scheduledTime) ||
    normalizeText(data.scheduledTimeStart) ||
    normalizeText(data.timeStart);

  return parseEventStartMs(date, scheduledTime);
}

function resolveRegistrationStartMs(
  data: FirebaseFirestore.DocumentData
): number {
  return parseEventWindowMs(data.registrationStartAt);
}

function resolveRegistrationEndMs(
  data: FirebaseFirestore.DocumentData
): number {
  const explicit = parseEventWindowMs(data.registrationEndAt);
  if (explicit > 0) return explicit;

  return resolveEventStartMs(data);
}

function resolveCancellationDeadlineMs(
  data: FirebaseFirestore.DocumentData
): number {
  const explicit = parseEventWindowMs(data.cancellationDeadlineAt);
  if (explicit > 0) return explicit;

  return resolveRegistrationEndMs(data);
}

function makeStudentNotificationId(eventId: string): string {
  return `preregister-${eventId}`;
}

function parseEventStartMs(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Number.MAX_SAFE_INTEGER;
  }

  let hours = 0;
  let minutes = 0;
  const twelveHourMatch = time.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  const twentyFourHourMatch = time.match(/^(\d{1,2}):(\d{2})$/);

  if (twelveHourMatch) {
    hours = Number.parseInt(twelveHourMatch[1], 10) % 12;
    minutes = Number.parseInt(twelveHourMatch[2], 10);
    if (twelveHourMatch[3].toUpperCase() === "PM") {
      hours += 12;
    }
  } else if (twentyFourHourMatch) {
    hours = Number.parseInt(twentyFourHourMatch[1], 10);
    minutes = Number.parseInt(twentyFourHourMatch[2], 10);
  }

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const parsed = Date.parse(`${date}T${hh}:${mm}:00+08:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

async function callerRole(
  context: CallableAuthContext
): Promise<string> {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
  return callerProfileSnap.exists ?
    String(callerProfileSnap.data()?.role ?? "") :
    "";
}

async function callerProfileData(
  context: CallableAuthContext
): Promise<FirebaseFirestore.DocumentData> {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
  return callerProfileSnap.exists ? (callerProfileSnap.data() ?? {}) : {};
}

async function requireAdmin(
  context: CallableAuthContext
): Promise<void> {
  const role = await callerRole(context);
  if (role !== "admin") {
    throw new HttpsError(
      "permission-denied",
      "Admin only."
    );
  }
}

async function requireAdminOrEC(
  context: CallableAuthContext
): Promise<void> {
  const role = await callerRole(context);
  if (role !== "admin" && !isECMemberRole(role)) {
    throw new HttpsError(
      "permission-denied",
      "EC/Admin only."
    );
  }
}

function ensureBodCourseScopeAccess(
  actorProfile: FirebaseFirestore.DocumentData,
  targetCourse: unknown,
  message: string,
): void {
  if (!isBodProfileData(actorProfile)) {
    return;
  }

  const actorCourseScope = resolveProfileCourseScope(actorProfile);
  const normalizedTargetCourse = normalizeCourseLabel(targetCourse);
  if (!actorCourseScope || actorCourseScope !== normalizedTargetCourse) {
    throw new HttpsError("permission-denied", message);
  }
}

function resolveProfileDisplayName(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeText(data.name) ||
    normalizeText(data.fullName) ||
    normalizeText(data.studentName) ||
    normalizeText(data.teacherName) ||
    buildStudentFullName(data.firstName, data.lastName) ||
    normalizeText(data.schoolId) ||
    "Unknown User"
  );
}

function resolveActorPosition(data: FirebaseFirestore.DocumentData): string {
  if (isBodProfileData(data)) {
    return normalizeECPosition(data.ecPosition) || "B.O.D.";
  }

  if (isRegularEcRole(data.role)) {
    return normalizeECPosition(data.ecPosition) || "EC Member";
  }

  const normalizedRole = normalizeText(data.role);
  if (!normalizedRole) {
    return "";
  }

  return normalizedRole[0].toUpperCase() + normalizedRole.slice(1);
}

async function writeStructuredAuditLog(input: {
  actorUid?: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const actorUid = normalizeText(input.actorUid);
  const actorProfile = actorUid ?
    ((await db.doc(`profiles/${actorUid}`).get()).data() ?? {}) :
    {};

  await db.collection("logs").add({
    actorUid: actorUid || null,
    actorName: resolveProfileDisplayName(actorProfile),
    actorPosition: resolveActorPosition(actorProfile),
    actorCourseScope: resolveProfileCourseScope(actorProfile) || null,
    targetType: input.targetType,
    targetId: input.targetId,
    action: input.action,
    metadata: input.metadata ?? {},
    createdAt: serverTimestamp(),
  });
}

function shouldSkipAuthContextAudit(event: {
  authType?: string;
  authId?: string;
}): boolean {
  if (!normalizeText(event.authId)) {
    return true;
  }

  const authType = normalizeLower(event.authType);
  return authType === "service_account" ||
    authType === "system" ||
    authType === "unauthenticated";
}

export const adminCreateUser = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const role = normalizeCampusRoleValue(body.role);
    const emailRaw = normalizeText(body.email);
    const name =
      normalizeText(body.name) ||
      normalizeText(body.teacherName) ||
      normalizeText(body.studentName);
    const requestedEcPosition = normalizeECPosition(body.ecPosition);
    const requestedEcScope = normalizeEcScope(body.ecScope);
    const requestedAssignedCourse = normalizeAssignedCourseCode(body.assignedCourse);
    const inferredCourseScope = inferCourseScopeFromPosition(requestedEcPosition);
    const inferredAssignedCourse = extractAssignedCourseFromPosition(
      requestedEcPosition,
    );
    const requestedProfileCourseScope =
      normalizeCourseLabel(body.courseScope) ||
      normalizeCourseLabel(body.courseScopeLabel);
    const bodAssignedCourse = requestedAssignedCourse || inferredAssignedCourse;
    const isLegacyBod = role === "ecmember" &&
      requestedEcScope !== "all" &&
      (
        requestedEcScope === "course" ||
        isBodPosition(requestedEcPosition) ||
        (
          !isAllScopeECPosition(requestedEcPosition) &&
          (
            Boolean(inferredCourseScope) ||
            Boolean(bodAssignedCourse) ||
            Boolean(requestedProfileCourseScope)
          )
        )
      );
    const isBod = role === "bod" || isLegacyBod;
    const storedRole = isBod ? "bod" : role;
    const ecPosition = !isEcWorkspaceRoleValue(storedRole) ?
      "" :
      isBod ?
        (bodAssignedCourse ? `B.O.D. (${bodAssignedCourse})` : "B.O.D.") :
        requestedEcPosition;
    const ecScope = !isEcWorkspaceRoleValue(storedRole) ?
      "" :
      isBod ?
        "course" :
        "all";
    const courseScopeLabel = isBod && bodAssignedCourse ?
      (COURSE_CODE_TO_SCOPE[bodAssignedCourse] ?? "") :
      "";
    const courseScope = isBod ? courseScopeSlugFromValue(courseScopeLabel) : "";
    const courseScopeSlug = courseScope;
    const tracksStudentProjection = shouldTrackStudentProjection(storedRole, {isBod});
    const requestedCourse = normalizeCourseLabel(body.course) || normalizeText(body.course);
    const course = isBod ? courseScopeLabel : requestedCourse;
    const yearSource = body.yearLevel ?? body.year;
    const yearRaw = normalizeText(yearSource);
    const year = normalizeYear(yearSource);

    if (emailRaw && !isValidEmailAddress(emailRaw)) {
      throw new HttpsError(
        "invalid-argument",
        "Please provide a valid email address."
      );
    }

    if (!schoolId) {
      throw new HttpsError(
        "invalid-argument",
        "School ID is required."
      );
    }

    if (!["admin", "ecmember", "bod", "teacher", "student"].includes(role)) {
      throw new HttpsError(
        "invalid-argument",
        "Invalid role."
      );
    }

    if (role === "teacher" && !name) {
      throw new HttpsError(
        "invalid-argument",
        "name is required for teacher role."
      );
    }

    if (role === "student" && !name) {
      throw new HttpsError(
        "invalid-argument",
        "name is required for student role."
      );
    }

    if (role === "ecmember" && !name) {
      throw new HttpsError(
        "invalid-argument",
        "name is required for ec role."
      );
    }

    if (role === "bod" && !name) {
      throw new HttpsError(
        "invalid-argument",
        "name is required for bod role.",
      );
    }

    if ((role === "student" || role === "ecmember" || role === "bod") && !course) {
      throw new HttpsError(
        "invalid-argument",
        "course is required for student and EC workspace roles."
      );
    }

    if ((role === "student" || role === "ecmember" || role === "bod") && !yearRaw) {
      throw new HttpsError(
        "invalid-argument",
        "yearLevel is required for student and EC workspace roles."
      );
    }

    if (role === "ecmember" && !ecPosition) {
      throw new HttpsError(
        "invalid-argument",
        "ecPosition is required for EC member accounts."
      );
    }

    if (isBod && !bodAssignedCourse) {
      throw new HttpsError(
        "invalid-argument",
        "assignedCourse is required for B.O.D. accounts."
      );
    }

    // School ID login still resolves through Firebase Auth email, so we can
    // safely use a real contact email here when one is provided.
    const email = emailRaw || `${schoolId}@campus.local`;
    const timestamp = serverTimestamp();
    const requiresStudentSchoolIdGuard = tracksStudentProjection;
    let schoolIdReservation:
      | Awaited<ReturnType<typeof reserveUniqueStudentSchoolId>>
      | null = null;
    let createdUid: string | null = null;

    authLogger.debug("adminCreateUser request validated", {
      role,
      schoolId,
      hasName: Boolean(name),
      hasCourse: Boolean(course),
      hasYearLevel: Boolean(year),
      hasCustomEmail: Boolean(emailRaw),
    });

    try {
      if (requiresStudentSchoolIdGuard) {
        // Reserve the normalized School ID before Auth creation so duplicate
        // student requests or double-submits cannot mint a second UID.
        schoolIdReservation = await reserveUniqueStudentSchoolId(
          schoolId,
          "admin_create_student",
        );
      }

      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;
      createdUid = uid;

      if (schoolIdReservation) {
        await schoolIdReservation.activate(uid);
      }

      const profilePayload: FirebaseFirestore.DocumentData = {
        name,
        schoolId,
        schoolIdKey,
        email,
        role: storedRole,
        ecPosition: isEcWorkspaceRoleValue(storedRole) ? ecPosition : "",
        ecScope: isEcWorkspaceRoleValue(storedRole) ? ecScope : null,
        assignedCourse: isBod ? (bodAssignedCourse || null) : null,
        courseScope: isBod ? (courseScope || null) : null,
        courseScopeSlug: isBod ? (courseScopeSlug || null) : null,
        courseScopeLabel: isBod ? (courseScopeLabel || null) : null,
        isBod,
        isStudent: tracksStudentProjection,
        course: course || "",
        year: year || "",
        yearLevel: year || "",
        mustChangePassword: true,
        emailVerified: false,
        emailVerificationPending: false,
        pendingEmail: null,
        firstLoginCompleted: false,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      if (tracksStudentProjection) {
        profilePayload.readyForClearance = false;
      }

      authLogger.debug("adminCreateUser writing profile", {
        uid,
        role,
        schoolId,
        hasName: Boolean(profilePayload.name),
        hasCourse: Boolean(profilePayload.course),
        hasYearLevel: Boolean(profilePayload.yearLevel),
      });

      if (tracksStudentProjection) {
        const studentBatch = db.batch();
        studentBatch.set(
          db.doc(`profiles/${uid}`),
          profilePayload,
          {merge: true},
        );
        studentBatch.set(
          db.doc(`students/${uid}`),
          {
            schoolId,
            schoolIdKey,
            role: storedRole,
            isStudent: true,
            studentName: name,
            name,
            course,
            year,
            yearLevel: year,
            readyForClearance: false,
            status: "active",
            updatedAt: timestamp,
            createdAt: timestamp,
          },
          {merge: true},
        );
        await studentBatch.commit();
      } else {
        await db.doc(`profiles/${uid}`).set(
          profilePayload,
          {merge: true},
        );
      }

      authLogger.debug("adminCreateUser profile write complete", {
        uid,
        role: storedRole,
        schoolId,
      });

      authLogger.info("adminCreateUser created account", {
        uid,
        role: storedRole,
        schoolId,
      });

      if (tracksStudentProjection) {
        authLogger.debug("adminCreateUser student projection write complete", {
          uid,
          schoolId,
        });
      }

      await db.collection("logs").add({
        action: "admin_create_user",
        actorUid: normalizeText(request.auth?.uid),
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: timestamp,
      }).catch((logError) => {
        authLogger.warn("adminCreateUser log write failed", {
          uid,
          role,
          schoolId,
          error: logError,
        });
      });

      return {uid};
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};
      if (createdUid) {
        await admin.auth().deleteUser(createdUid).catch(() => undefined);
      }
      if (schoolIdReservation) {
        await schoolIdReservation.release();
      }
      authLogger.warn("adminCreateUser failed", {
        role,
        schoolId,
        code: authError.code ?? "unknown",
        message: authError.message ?? "Unknown account creation failure",
      });
      if (isHttpsErrorCode(error, "already-exists")) {
        throw schoolIdAlreadyExistsError(
          authError.message || "School ID already exists.",
        );
      }
      if (authError.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Account already exists."
        );
      }

      throw new HttpsError(
        "internal",
        authError.message || "Failed to create user."
      );
    }
  });

export const adminUpdateUserProfile = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const actorUid = normalizeText(request.auth?.uid);
    const body = asRecord(request.data);
    const targetUid = normalizeText(body.targetUid || body.uid);
    const email = normalizeLower(body.email);
    const schoolId = normalizeText(body.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const role = normalizeCampusRoleValue(body.role);
    const name = normalizeNamePart(body.name);
    const yearLevelRaw = normalizeText(body.yearLevel ?? body.year);
    const yearLevel = yearLevelRaw ? normalizeYear(body.yearLevel ?? body.year) : "";
    const requestedEcPosition = normalizeECPosition(body.ecPosition);
    const requestedEcScope = normalizeEcScope(body.ecScope);
    const requestedAssignedCourse = normalizeAssignedCourseCode(body.assignedCourse);
    const inferredCourseScope = inferCourseScopeFromPosition(requestedEcPosition);
    const inferredAssignedCourse = extractAssignedCourseFromPosition(
      requestedEcPosition,
    );
    const requestedProfileCourseScope =
      normalizeCourseLabel(body.courseScope) ||
      normalizeCourseLabel(body.courseScopeLabel);
    const bodAssignedCourse = requestedAssignedCourse || inferredAssignedCourse;
    const isLegacyBod = role === "ecmember" &&
      requestedEcScope !== "all" &&
      (
        requestedEcScope === "course" ||
        isBodPosition(requestedEcPosition) ||
        (
          !isAllScopeECPosition(requestedEcPosition) &&
          (
            Boolean(inferredCourseScope) ||
            Boolean(bodAssignedCourse) ||
            Boolean(requestedProfileCourseScope)
          )
        )
      );
    const isBod = role === "bod" || isLegacyBod;
    const storedRole = isBod ? "bod" : role;
    const ecPosition = !isEcWorkspaceRoleValue(storedRole) ?
      "" :
      isBod ?
        (bodAssignedCourse ? `B.O.D. (${bodAssignedCourse})` : "B.O.D.") :
        requestedEcPosition;
    const ecScope = !isEcWorkspaceRoleValue(storedRole) ?
      null :
      isBod ?
        "course" :
        "all";
    const courseScopeLabel = isBod && bodAssignedCourse ?
      (COURSE_CODE_TO_SCOPE[bodAssignedCourse] ?? "") :
      "";
    const courseScope = isBod ? courseScopeSlugFromValue(courseScopeLabel) : "";
    const courseScopeSlug = courseScope;
    const requestedCourse = normalizeCourseLabel(body.course) || normalizeText(body.course);
    const course = isBod ? courseScopeLabel : requestedCourse;
    const requiresAcademicFields =
      storedRole === "student" || storedRole === "ecmember" || storedRole === "bod";

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid is required.");
    }

    if (!email) {
      throw new HttpsError("invalid-argument", "Email address is required.");
    }

    if (!isValidEmailAddress(email)) {
      throw new HttpsError(
        "invalid-argument",
        "Please provide a valid email address.",
      );
    }

    if (!name) {
      throw new HttpsError("invalid-argument", "Name is required.");
    }

    if (!schoolId) {
      throw new HttpsError("invalid-argument", "School ID is required.");
    }

    if (!["admin", "ecmember", "bod", "teacher", "student"].includes(role)) {
      throw new HttpsError("invalid-argument", "Invalid role.");
    }

    if (requiresAcademicFields && !course) {
      throw new HttpsError(
        "invalid-argument",
        "Course is required for student and EC workspace accounts.",
      );
    }

    if (requiresAcademicFields && !yearLevelRaw) {
      throw new HttpsError(
        "invalid-argument",
        "Year level is required for student and EC workspace accounts.",
      );
    }

    if (role === "ecmember" && !ecPosition) {
      throw new HttpsError(
        "invalid-argument",
        "EC position is required for EC member accounts.",
      );
    }

    if (isBod && !bodAssignedCourse) {
      throw new HttpsError(
        "invalid-argument",
        "assignedCourse is required for B.O.D. accounts.",
      );
    }

    let authUpdated = false;
    let previousAuthEmail = "";
    let previousDisplayName = "";

    try {
      const [profileSnap, studentSnap, authUser] = await Promise.all([
        db.doc(`profiles/${targetUid}`).get(),
        db.doc(`students/${targetUid}`).get(),
        admin.auth().getUser(targetUid),
      ]);

      if (!profileSnap.exists) {
        throw new HttpsError("not-found", "User profile not found.");
      }

      const profileData = profileSnap.data() ?? {};
      const studentData = studentSnap.data() ?? {};
      const previousRole = normalizeCampusRoleValue(
        profileData.role || studentData.role,
      );
      const previousSchoolId = resolveStudentSchoolId(
        targetUid,
        profileData,
        studentData,
      );
      const previousSchoolIdKey = normalizeSchoolIdKey(previousSchoolId);
      const previousEmail =
        normalizeLower(authUser.email) || normalizeLower(profileData.email);
      const previousPendingEmail = normalizeLower(profileData.pendingEmail);
      previousAuthEmail = normalizeText(authUser.email);
      previousDisplayName = normalizeText(authUser.displayName);

      const existingProfileMatch = await findExistingSchoolIdDocument(
        "profiles",
        schoolId,
        schoolIdKey,
      );
      if (existingProfileMatch && normalizeText(existingProfileMatch.uid) !== targetUid) {
        throw schoolIdAlreadyExistsError("School ID already exists.");
      }

      const tracksStudentProjection =
        shouldTrackStudentProjection(storedRole, {isBod}) ||
        shouldTrackStudentProjection(previousRole, profileData) ||
        shouldTrackStudentProjection(previousRole, studentData);
      if (tracksStudentProjection) {
        const existingStudentMatch = await findExistingStudentSchoolId(schoolId);
        if (
          existingStudentMatch &&
          normalizeText(existingStudentMatch.uid) &&
          normalizeText(existingStudentMatch.uid) !== targetUid
        ) {
          throw schoolIdAlreadyExistsError("School ID already exists.");
        }
      }

      const authUpdatePayload: admin.auth.UpdateRequest = {
        email,
        displayName: name,
      };
      const updatedAuthUser = await admin.auth().updateUser(
        targetUid,
        authUpdatePayload,
      );
      authUpdated = true;
      const normalizedUpdatedEmail = normalizeLower(updatedAuthUser.email) || email;
      const emailChanged = normalizedUpdatedEmail !== previousEmail;
      const stalePendingEmail =
        Boolean(previousPendingEmail) &&
        (
          previousPendingEmail !== normalizedUpdatedEmail ||
          (
            normalizeLower(profileData.email) &&
            previousPendingEmail !== normalizeLower(profileData.email)
          )
        );

      const currentCourse = normalizeText(profileData.course || studentData.course);
      const currentYear = normalizeText(
        profileData.yearLevel ||
          profileData.year ||
          studentData.yearLevel ||
          studentData.year,
      );
      const timestamp = serverTimestamp();
      const profilePatch: FirebaseFirestore.DocumentData = {
        email: normalizedUpdatedEmail,
        schoolId,
        schoolIdKey,
        role: storedRole,
        name,
        fullName: name,
        course,
        year: yearLevel,
        yearLevel,
        ecPosition: isEcWorkspaceRoleValue(storedRole) ? ecPosition : null,
        ecScope: isEcWorkspaceRoleValue(storedRole) ? ecScope : null,
        assignedCourse: isBod ? (bodAssignedCourse || null) : null,
        courseScope: isBod ? (courseScope || null) : null,
        courseScopeSlug: isBod ? (courseScopeSlug || null) : null,
        courseScopeLabel: isBod ? (courseScopeLabel || null) : null,
        isBod,
        isStudent: shouldTrackStudentProjection(storedRole, {isBod}),
        updatedAt: timestamp,
        updatedBy: actorUid,
      };

      if (emailChanged) {
        profilePatch.pendingEmail = null;
        profilePatch.emailVerified = false;
        profilePatch.emailVerificationPending = true;
      } else if (stalePendingEmail) {
        profilePatch.pendingEmail = null;
      }

      if (role === "teacher") {
        profilePatch.teacherName = name;
      } else {
        profilePatch.studentName = name;
      }

      const changedFields: string[] = [];
      const appendChangedField = (
        field: string,
        previousValue: unknown,
        nextValue: unknown,
      ) => {
        const previousToken = typeof previousValue === "boolean" ?
          String(previousValue) :
          normalizeText(previousValue);
        const nextToken = typeof nextValue === "boolean" ?
          String(nextValue) :
          normalizeText(nextValue);
        if (previousToken !== nextToken) {
          changedFields.push(field);
        }
      };

      appendChangedField("email", previousEmail, profilePatch.email);
      if (
        Object.prototype.hasOwnProperty.call(profilePatch, "pendingEmail")
      ) {
        appendChangedField(
          "pendingEmail",
          previousPendingEmail,
          profilePatch.pendingEmail,
        );
      }
      if (emailChanged) {
        appendChangedField("emailVerified", profileData.emailVerified === true, false);
        appendChangedField(
          "emailVerificationPending",
          profileData.emailVerificationPending === true,
          true,
        );
      }
      appendChangedField(
        "name",
        profileData.name ||
          profileData.fullName ||
          profileData.studentName ||
          profileData.teacherName,
        name,
      );
      appendChangedField("schoolId", previousSchoolId, schoolId);
      appendChangedField("role", previousRole || profileData.role, storedRole);
      appendChangedField("course", currentCourse, course);
      appendChangedField("yearLevel", currentYear, yearLevel);
      appendChangedField("ecPosition", normalizeECPosition(profileData.ecPosition), ecPosition);
      appendChangedField("ecScope", resolveProfileEcScope(profileData), ecScope || "");
      appendChangedField(
        "assignedCourse",
        resolveAssignedCourseCode(profileData),
        bodAssignedCourse,
      );
      appendChangedField(
        "courseScope",
        optionalText(profileData.courseScope),
        courseScope,
      );
      appendChangedField(
        "courseScopeLabel",
        optionalText(profileData.courseScopeLabel) || resolveProfileCourseScope(profileData),
        courseScopeLabel,
      );
      appendChangedField(
        "courseScopeSlug",
        optionalText(profileData.courseScopeSlug),
        courseScopeSlug,
      );
      appendChangedField("isBod", profileData.isBod === true, isBod);
      appendChangedField(
        "isStudent",
        profileData.isStudent === true,
        shouldTrackStudentProjection(storedRole, {isBod}),
      );

      const updateBatch = db.batch();
      updateBatch.set(db.doc(`profiles/${targetUid}`), profilePatch, {merge: true});

      if (shouldTrackStudentProjection(storedRole, {isBod})) {
        updateBatch.set(
          db.doc(`students/${targetUid}`),
          {
            uid: targetUid,
            studentId: targetUid,
            schoolId,
            schoolIdKey,
            role: storedRole,
            isStudent: true,
            name,
            fullName: name,
            studentName: name,
            course,
            year: yearLevel,
            yearLevel,
            status:
              normalizeText(studentData.status) ||
              normalizeText(profileData.status) ||
              "Active",
            readyForClearance:
              studentData.readyForClearance === true ||
              profileData.readyForClearance === true,
            updatedAt: timestamp,
          },
          {merge: true},
        );
      }

      await updateBatch.commit();

      if (shouldTrackStudentProjection(storedRole, {isBod})) {
        await syncStudentSchoolIdIndex(schoolId, schoolIdKey, targetUid, "profile").catch(
          (indexError) => {
            authLogger.warn("adminUpdateUserProfile school ID index sync failed", {
              actorUid,
              targetUid,
              schoolId,
              error: indexError,
            });
          },
        );
      }

      if (
        previousSchoolIdKey &&
        previousSchoolIdKey !== schoolIdKey &&
        (
          shouldTrackStudentProjection(previousRole, profileData) ||
          shouldTrackStudentProjection(previousRole, studentData)
        )
      ) {
        await studentSchoolIdIndexRef(previousSchoolIdKey).get().then(async (snapshot) => {
          const indexedUid = normalizeText(snapshot.data()?.uid);
          if (snapshot.exists && indexedUid === targetUid) {
            await studentSchoolIdIndexRef(previousSchoolIdKey)
              .delete()
              .catch((indexError) => {
                authLogger.warn("adminUpdateUserProfile previous school ID cleanup failed", {
                  actorUid,
                  targetUid,
                  previousSchoolId,
                  error: indexError,
                });
              });
          }
        }).catch((indexError) => {
          authLogger.warn("adminUpdateUserProfile previous school ID lookup failed", {
            actorUid,
            targetUid,
            previousSchoolId,
            error: indexError,
          });
        });
      }

      await db.collection("logs").add({
        action: "admin_update_user_profile",
        actorUid,
        targetUid,
        targetSchoolId: schoolId,
        changedFields,
        createdAt: timestamp,
      }).catch((logError) => {
        authLogger.warn("adminUpdateUserProfile log write failed", {
          actorUid,
          targetUid,
          schoolId,
          error: logError,
        });
      });

      authLogger.info("adminUpdateUserProfile updated account", {
        actorUid,
        targetUid,
        role: storedRole,
        schoolId,
        changedFields,
      });

      return {
        uid: targetUid,
        email: profilePatch.email,
        name,
        schoolId,
        role: storedRole,
        course,
        yearLevel,
      };
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};

      if (authUpdated && previousAuthEmail) {
        const rollbackRequest: admin.auth.UpdateRequest = {
          email: previousAuthEmail,
          displayName: previousDisplayName || null,
        };
        await admin.auth().updateUser(targetUid, rollbackRequest).catch((rollbackError) => {
          authLogger.error("adminUpdateUserProfile auth rollback failed", {
            actorUid,
            targetUid,
            error: rollbackError,
          });
        });
      }

      authLogger.error("adminUpdateUserProfile failed", {
        actorUid,
        targetUid,
        code: authError.code ?? "unknown",
        message: authError.message ?? "Unknown profile update failure",
        error,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      if (authError.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Email address is already in use.",
        );
      }

      if (authError.code === "auth/invalid-email") {
        throw new HttpsError(
          "invalid-argument",
          "Please provide a valid email address.",
        );
      }

      if (authError.code === "auth/user-not-found") {
        throw new HttpsError("not-found", "User account not found.");
      }

      throw new HttpsError(
        "internal",
        authError.message || "Failed to update user profile.",
      );
    }
  });

function normalizeBulkStudentStatus(raw: unknown): string {
  const normalized = normalizeText(raw).toLowerCase();
  if (!normalized || normalized === "active") return "active";
  if (normalized === "inactive") return "inactive";
  if (normalized === "pending") return "pending";
  return "";
}

function isValidBulkSchoolId(value: string): boolean {
  return Boolean(value) && /^[A-Za-z0-9]{4,}$/.test(value);
}

async function adminBulkImportStudentsLogic(context: BulkImportContext) {
    await requireAdmin({ auth: context.auth });

    const body = asRecord(context.data);
    const filename = normalizeText(body.filename) || "student-import.csv";
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const requestInputSchema =
      normalizeBulkStudentImportInputSchema(body.inputSchema) || undefined;
    const previewOnly = body.previewOnly === true;
    const actorUid = context.auth.uid;
    const callerProfileSnap = await db.doc(`profiles/${actorUid}`).get();
    const actorSchoolId = normalizeText(callerProfileSnap.data()?.schoolId);
    const timestamp = serverTimestamp();

    const validatedRows = rows.map((rawRow, index) => {
      const row = asRecord(rawRow);
      const nameSchema = resolveBulkStudentImportInputSchema(
        row,
        requestInputSchema,
      );
      const schoolId = normalizeText(row.schoolId);
      const lastName = normalizeNamePart(row.lastName);
      const firstName = normalizeNamePart(row.firstName);
      const legacyFullName = resolveBulkImportFullName(row);
      const course = normalizeCourseLabel(row.course);
      const yearLevelRaw = normalizeText(row.yearLevel);
      const status = normalizeBulkStudentStatus(row.status);
      const normalizedYear = normalizeYear(yearLevelRaw);
      const errors: string[] = [];

      if (!schoolId) {
        errors.push("SchoolId is required.");
      } else if (!isValidBulkSchoolId(schoolId)) {
        errors.push("SchoolId must be alphanumeric and at least 4 characters.");
      }
      if (nameSchema === "legacy") {
        if (!legacyFullName) {
          errors.push("FullName is required.");
        }
      } else {
        if (!lastName) errors.push("LastName is required.");
        if (!firstName) errors.push("FirstName is required.");
      }
      if (!course) {
        errors.push("Course is required.");
      } else if (!isValidCourse(course)) {
        errors.push("Invalid course. Use a CAMPUS course label such as Computer Engineering or BSCpE.");
      }
      if (!yearLevelRaw) {
        errors.push("YearLevel is required.");
      } else if (!normalizedYear) {
        errors.push("YearLevel is invalid.");
      }
      if (!status) {
        errors.push("Status is invalid. Use active, inactive, or pending.");
      }

      return {
        rowIndex: index + 1,
        nameSchema,
        schoolId,
        lastName,
        firstName,
        fullName: legacyFullName,
        course,
        yearLevel: normalizedYear,
        status: status || "active",
        errors,
        success: false,
        skipped: false,
      } as Record<string, unknown>;
    });

    const schoolIdCounts = new Map<string, number>();
    validatedRows.forEach((row) => {
      const schoolId = String(row.schoolId || "");
      if (schoolId) {
        schoolIdCounts.set(schoolId, (schoolIdCounts.get(schoolId) ?? 0) + 1);
      }
    });

    const uniqueSchoolIds = Array.from(schoolIdCounts.keys());
    const existingSchoolIds = await fetchExistingStudentSchoolIds(uniqueSchoolIds);

    const finalResults = validatedRows.map((row) => ({ ...row })) as Array<{
      rowIndex: number;
      nameSchema: BulkStudentImportInputSchema;
      schoolId: string;
      lastName: string;
      firstName: string;
      fullName: string;
      course: string;
      yearLevel: string;
      status: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
      errors?: string[];
      uid?: string;
    }>;

    finalResults.forEach((row) => {
      const errors = Array.isArray(row.errors) ? [...row.errors] : [];
      if (row.schoolId && schoolIdCounts.get(row.schoolId)! > 1) {
        errors.push("Duplicate schoolId in CSV.");
      }
      if (row.schoolId && existingSchoolIds.has(row.schoolId)) {
        errors.push("Existing schoolId already exists in CAMPUS.");
      }
      row.errors = errors;
      if (errors.length > 0) {
        row.skipped = true;
        row.error = errors.join(" ");
      }
    });

    let importedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    if (previewOnly) {
      skippedCount = finalResults.filter((row) => row.skipped || row.error).length;

      return {
        inputSchema:
          requestInputSchema ||
          finalResults[0]?.nameSchema ||
          "split",
        totalRows: finalResults.length,
        importedCount: 0,
        failedCount: 0,
        skippedCount,
        rowResults: finalResults,
      };
    }

    for (const resultRow of finalResults) {
      if (resultRow.skipped || resultRow.error) {
        skippedCount += 1;
        continue;
      }

      const email = `${resultRow.schoolId}@campus.local`;
      let createdUid: string | null = null;
      let schoolIdReservation:
        | Awaited<ReturnType<typeof reserveUniqueStudentSchoolId>>
        | null = null;
      try {
        // Import uses the same reservation/index as manual creation so a row
        // previewed as valid cannot create a duplicate UID during final submit.
        schoolIdReservation = await reserveUniqueStudentSchoolId(
          resultRow.schoolId,
          "bulk_student_import",
        );

        const userRecord = await admin.auth().createUser({
          email,
          password: resultRow.schoolId,
          disabled: false,
        });
        const uid = userRecord.uid;
        createdUid = uid;
        await schoolIdReservation.activate(uid);
        const fullName = resultRow.fullName ||
          buildStudentFullName(resultRow.firstName, resultRow.lastName);
        const schoolIdKey = schoolIdReservation.schoolIdKey;

        const profilePayload: FirebaseFirestore.DocumentData = {
          firstName: resultRow.firstName,
          lastName: resultRow.lastName,
          name: fullName,
          fullName,
          studentName: fullName,
          schoolId: resultRow.schoolId,
          schoolIdKey,
          email: "",
          role: "student",
          course: resultRow.course,
          year: resultRow.yearLevel,
          yearLevel: resultRow.yearLevel,
          mustChangePassword: true,
          emailVerified: false,
          emailVerificationPending: false,
          pendingEmail: null,
          firstLoginCompleted: false,
          status: resultRow.status || "active",
          createdAt: timestamp,
          updatedAt: timestamp,
          readyForClearance: false,
        };

        const studentBatch = db.batch();
        studentBatch.set(db.doc(`profiles/${uid}`), profilePayload, {merge: true});
        studentBatch.set(
          db.doc(`students/${uid}`),
          {
            schoolId: resultRow.schoolId,
            schoolIdKey,
            firstName: resultRow.firstName,
            lastName: resultRow.lastName,
            fullName,
            studentName: fullName,
            name: fullName,
            course: resultRow.course,
            year: resultRow.yearLevel,
            yearLevel: resultRow.yearLevel,
            status: resultRow.status || "active",
            readyForClearance: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          {merge: true},
        );
        await studentBatch.commit();

        resultRow.success = true;
        resultRow.uid = uid;
        importedCount += 1;
      } catch (error: unknown) {
        const authError = error as {code?: string; message?: string};
        if (createdUid) {
          await admin.auth().deleteUser(createdUid).catch(() => undefined);
        }
        if (schoolIdReservation) {
          await schoolIdReservation.release();
        }
        if (isHttpsErrorCode(error, "already-exists")) {
          resultRow.success = false;
          resultRow.skipped = true;
          resultRow.error = "Existing schoolId already exists in CAMPUS.";
          resultRow.errors = [
            ...(Array.isArray(resultRow.errors) ? resultRow.errors : []),
            "Existing schoolId already exists in CAMPUS.",
          ];
          skippedCount += 1;
          continue;
        }
        resultRow.success = false;
        resultRow.error = authError.message || "Unable to create student account.";
        if (authError.code === "auth/email-already-exists") {
          resultRow.error = "Account already exists for this School ID.";
        }
        failedCount += 1;
      }
    }

    await db.collection("logs").add({
      action: "bulk_student_import",
      actorUid,
      actorSchoolId,
      importedCount,
      failedCount,
      skippedCount,
      totalRows: finalResults.length,
      fileName: filename,
      createdAt: timestamp,
    });

    return {
      inputSchema:
        requestInputSchema ||
        finalResults[0]?.nameSchema ||
        "split",
      totalRows: finalResults.length,
      importedCount,
      failedCount,
      skippedCount,
      rowResults: finalResults,
    };
  }

export const adminBulkImportStudents = onRequest({region: REGION}, async (req, res) => {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({error: {status: 'PERMISSION_DENIED', message: 'Origin not allowed'}});
    return;
  }

  setCorsHeaders(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({error: {status: 'FAILED_PRECONDITION', message: 'Method not allowed'}});
    return;
  }

  const body = req.body;

  if (!body || typeof body !== 'object' || !('data' in body)) {
    res.status(400).json({error: {status: 'FAILED_PRECONDITION', message: 'Bad request'}});
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: {status: 'UNAUTHENTICATED', message: 'Unauthorized'}});
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  let decodedToken;

  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch {
    res.status(401).json({error: {status: 'UNAUTHENTICATED', message: 'Unauthorized'}});
    return;
  }

  const context: BulkImportContext = {
    data: body.data,
    auth: { uid: decodedToken.uid, token: decodedToken, rawToken: idToken }
  };

  try {
    const result = await adminBulkImportStudentsLogic(context);
    res.json({result});
  } catch (error) {
    if (error instanceof HttpsError) {
      res.status(400).json({error: {status: error.code, message: error.message}});
    } else {
      res.status(500).json({error: {status: 'INTERNAL', message: 'Internal error'}});
    }
  }
});

export const adminDeleteUser = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);

    if (!uid) {
      throw new HttpsError(
        "invalid-argument",
        "uid required"
      );
    }

    if (uid === normalizeText(request.auth?.uid)) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot delete yourself."
      );
    }

    const profileSnap = await db.doc(`profiles/${uid}`).get();
    const profileData = profileSnap.data() ?? {};
    const schoolId = normalizeText(profileData.schoolId);
    const role = normalizeText(profileData.role);
    const schoolIdKey = normalizeSchoolIdKey(profileData.schoolIdKey || schoolId);

    await admin.auth().deleteUser(uid);
    await db.doc(`profiles/${uid}`).delete().catch(() => undefined);
    await db.doc(`students/${uid}`).delete().catch(() => undefined);
    if (role === "student" && schoolIdKey) {
      await studentSchoolIdIndexRef(schoolIdKey).delete().catch(() => undefined);
      if (schoolId) {
        await findExistingStudentSchoolId(schoolId).catch(() => undefined);
      }
    }

    await db.collection("logs").add({
      action: "DELETE_USER",
      actorUid: normalizeText(request.auth?.uid),
      targetUid: uid,
      targetSchoolId: schoolId || null,
      createdAt: serverTimestamp(),
    });

    return {success: true};
  });

export const adminDeactivateAllStudents = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const profileSnapshot = await db
      .collection("profiles")
      .where("role", "==", "student")
      .get();

    const profileDocs = profileSnapshot.docs;
    if (profileDocs.length === 0) {
      return {
        totalStudentCount: 0,
        updatedCount: 0,
      };
    }

    const studentByUid = new Map<string, FirebaseFirestore.DocumentData>();
    const studentRefs = profileDocs.map((profileDoc) => db.doc(`students/${profileDoc.id}`));

    for (let index = 0; index < studentRefs.length; index += 300) {
      const refsChunk = studentRefs.slice(index, index + 300);
      const studentSnapshots = refsChunk.length > 0 ?
        await db.getAll(...refsChunk) :
        [];

      studentSnapshots.forEach((studentSnap) => {
        if (!studentSnap.exists) return;
        studentByUid.set(studentSnap.id, studentSnap.data() ?? {});
      });
    }

    let updatedCount = 0;

    // Update profile and student projections together so admin tables and
    // student-facing account checks stay consistent after the bulk action.
    for (let index = 0; index < profileDocs.length; index += 200) {
      const docsChunk = profileDocs.slice(index, index + 200);
      const batch = db.batch();

      docsChunk.forEach((profileDoc) => {
        const uid = profileDoc.id;
        const profileData = profileDoc.data() ?? {};
        const studentData = studentByUid.get(uid) ?? {};
        const profileStatus = normalizeLower(profileData.status);
        const studentStatus = normalizeLower(studentData.status);

        if (profileStatus !== "inactive" || studentStatus !== "inactive") {
          updatedCount += 1;
        }

        batch.set(profileDoc.ref, {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, {merge: true});
        batch.set(db.doc(`students/${uid}`), {
          status: "inactive",
          updatedAt: serverTimestamp(),
        }, {merge: true});
      });

      await batch.commit();
    }

    await db.collection("logs").add({
      action: "ADMIN_DEACTIVATE_ALL_STUDENTS",
      actorUid: normalizeText(request.auth?.uid),
      targetSchoolId: "all_students",
      totalStudentCount: profileDocs.length,
      updatedCount,
      createdAt: serverTimestamp(),
    });

    return {
      totalStudentCount: profileDocs.length,
      updatedCount,
    };
  });

export const adminFindDuplicateStudentSchoolIds = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const body = asRecord(request.data);
    const requestedLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ?
      Math.min(requestedLimit, 5000) :
      50;
    const report = await buildDuplicateStudentSchoolIdReport(limit);

    await db.collection("logs").add({
      action: "ADMIN_FIND_DUPLICATE_STUDENT_SCHOOL_IDS",
      actorUid: normalizeText(request.auth?.uid),
      duplicateGroupCount: report.duplicateGroupCount,
      duplicateEntryCount: report.duplicateEntryCount,
      cleanupCandidateCount: report.cleanupCandidateCount,
      returnedCount: report.duplicates.length,
      sampleSchoolIds: report.duplicates.slice(0, 10).map((group) => group.schoolId),
      createdAt: serverTimestamp(),
    }).catch((logError) => {
      authLogger.warn("adminFindDuplicateStudentSchoolIds log write failed", {
        error: logError,
      });
    });

    return report;
  });

export const adminDeleteDuplicateStudentSchoolIds = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const actorUid = normalizeText(request.auth?.uid);
    const report = await buildDuplicateStudentSchoolIdReport();

    if (report.duplicateGroupCount === 0) {
      return {
        duplicateGroupCount: 0,
        keptCount: 0,
        deletedCount: 0,
        deletedAuthCount: 0,
        failedCount: 0,
        failureDetails: [] as string[],
      };
    }

    let deletedCount = 0;
    let deletedAuthCount = 0;
    let failedCount = 0;
    const failureDetails: string[] = [];

    for (const group of report.duplicates) {
      const primaryEntry =
        group.entries.find((entry) => entry.isPrimary) || group.entries[0];

      for (const duplicateEntry of group.entries.filter((entry) => !entry.isPrimary)) {
        let deletedAuthUser = false;

        try {
          try {
            await admin.auth().deleteUser(duplicateEntry.uid);
            deletedAuthUser = true;
            deletedAuthCount += 1;
          } catch (error: unknown) {
            const authError = error as {code?: string; message?: string};
            if (authError.code !== "auth/user-not-found") {
              throw new Error(authError.message || "Failed to delete duplicate auth user.");
            }
          }

          const deleteBatch = db.batch();
          deleteBatch.delete(db.doc(`profiles/${duplicateEntry.uid}`));
          deleteBatch.delete(db.doc(`students/${duplicateEntry.uid}`));
          await deleteBatch.commit();
          deletedCount += 1;

          await db.collection("logs").add({
            action: "ADMIN_DELETE_DUPLICATE_STUDENT_SCHOOL_ID",
            actorUid,
            targetUid: duplicateEntry.uid,
            targetSchoolId: group.schoolId,
            primaryUid: primaryEntry.uid,
            deletedAuthUser,
            duplicateSource: duplicateEntry.source,
            createdAt: serverTimestamp(),
          }).catch((logError) => {
            authLogger.warn("adminDeleteDuplicateStudentSchoolIds per-entry log failed", {
              schoolId: group.schoolId,
              targetUid: duplicateEntry.uid,
              error: logError,
            });
          });
        } catch (error: unknown) {
          failedCount += 1;
          const failureMessage = `${group.schoolId} (${duplicateEntry.uid}): ${
            error instanceof Error ? error.message : "Cleanup failed."
          }`;
          if (failureDetails.length < 25) {
            failureDetails.push(failureMessage);
          }
          authLogger.warn("adminDeleteDuplicateStudentSchoolIds failed for entry", {
            schoolId: group.schoolId,
            primaryUid: primaryEntry.uid,
            duplicateUid: duplicateEntry.uid,
            error,
          });
        }
      }

      await syncStudentSchoolIdIndex(
        group.schoolId,
        group.schoolIdKey,
        primaryEntry.uid,
        duplicateEntrySourceToIndexSource(primaryEntry.source),
      ).catch((error) => {
        authLogger.warn("adminDeleteDuplicateStudentSchoolIds index sync failed", {
          schoolId: group.schoolId,
          primaryUid: primaryEntry.uid,
          error,
        });
      });
    }

    await db.collection("logs").add({
      action: "ADMIN_DELETE_DUPLICATE_STUDENT_SCHOOL_IDS",
      actorUid,
      duplicateGroupCount: report.duplicateGroupCount,
      cleanupCandidateCount: report.cleanupCandidateCount,
      keptCount: report.duplicateGroupCount,
      deletedCount,
      deletedAuthCount,
      failedCount,
      createdAt: serverTimestamp(),
    }).catch((logError) => {
      authLogger.warn("adminDeleteDuplicateStudentSchoolIds summary log failed", {
        error: logError,
      });
    });

    return {
      duplicateGroupCount: report.duplicateGroupCount,
      keptCount: report.duplicateGroupCount,
      deletedCount,
      deletedAuthCount,
      failedCount,
      failureDetails,
    };
  });

function isValidFingerprintCleanupOwner(
  mapping: FingerprintCleanupReportMapping,
): boolean {
  const profileStatus = normalizeLower(mapping.profileStatus);
  const fingerprintStatus = normalizeLower(mapping.fingerprintStatus);

  return mapping.templateId > 0 &&
    mapping.mappingStatus !== "deleted" &&
    mapping.mappingStatus !== "missing_profile" &&
    mapping.mappingStatus !== "needs_reenrollment" &&
    profileStatus !== "inactive" &&
    profileStatus !== "disabled" &&
    fingerprintStatus !== "needs_reenrollment" &&
    fingerprintStatus !== "stale";
}

function fingerprintTemplateRef(templateId: number) {
  return db.collection("fingerprintTemplates").doc(String(templateId));
}

function buildQueuePayload(
  type: FingerprintCleanupQueueType,
  templateId: number,
  uid: string,
  schoolId: string,
  reason: string,
  actorUid: string,
): Record<string, unknown> {
  return {
    type,
    templateId,
    uid,
    schoolId,
    reason,
    createdBy: actorUid,
    createdAt: serverTimestamp(),
    processed: false,
    processedAt: null,
  };
}

async function queueFingerprintCleanupInstruction(
  batch: FirebaseFirestore.WriteBatch,
  type: FingerprintCleanupQueueType,
  templateId: number,
  uid: string,
  schoolId: string,
  reason: string,
  actorUid: string,
): Promise<void> {
  const cleanupRef = db.collection("moduleCleanupQueue").doc();
  batch.set(
    cleanupRef,
    buildQueuePayload(type, templateId, uid, schoolId, reason, actorUid),
  );
}

async function updateFingerprintTemplateDocument(
  batch: FirebaseFirestore.WriteBatch,
  templateId: number,
  keepMapping: FingerprintCleanupReportMapping | null,
  fallback: {
    uid: string;
    schoolId: string;
    studentName: string;
    course: string;
    yearLevel: string;
  },
): Promise<void> {
  const templateRef = fingerprintTemplateRef(templateId);
  if (keepMapping) {
    batch.set(
      templateRef,
      {
        templateId,
        uid: keepMapping.uid,
        schoolId: keepMapping.schoolId,
        name: keepMapping.studentName,
        course: keepMapping.course,
        yearLevel: keepMapping.yearLevel,
        active: true,
        status: "active",
        updatedAt: serverTimestamp(),
      },
      {merge: true},
    );
    return;
  }

  batch.set(
    templateRef,
    {
      templateId,
      uid: fallback.uid,
      schoolId: fallback.schoolId,
      name: fallback.studentName,
      course: fallback.course,
      yearLevel: fallback.yearLevel,
      active: false,
      status: "needs_reenrollment",
      updatedAt: serverTimestamp(),
    },
    {merge: true},
  );
}

async function clearFingerprintMappingForUid(
  batch: FirebaseFirestore.WriteBatch,
  uid: string,
  nextStatus: "needs_reenrollment" | "stale",
): Promise<number> {
  if (!uid) {
    return 0;
  }

  const [profileSnap, studentSnap] = await Promise.all([
    db.doc(`profiles/${uid}`).get(),
    db.doc(`students/${uid}`).get(),
  ]);

  let updatedCount = 0;
  const clearPatch = {
    hasFingerprint: false,
    fingerprintTemplateId: admin.firestore.FieldValue.delete(),
    templateId: admin.firestore.FieldValue.delete(),
    fingerprintDeviceId: admin.firestore.FieldValue.delete(),
    fingerprintEnrolledAt: admin.firestore.FieldValue.delete(),
    latestEnrollmentSessionId: admin.firestore.FieldValue.delete(),
    fingerprintStatus: nextStatus,
    updatedAt: serverTimestamp(),
  };

  if (profileSnap.exists) {
    batch.set(profileSnap.ref, clearPatch, {merge: true});
    updatedCount += 1;
  }

  if (studentSnap.exists) {
    batch.set(studentSnap.ref, clearPatch, {merge: true});
    updatedCount += 1;
  }

  return updatedCount;
}

async function activateFingerprintMappingForUid(
  batch: FirebaseFirestore.WriteBatch,
  uid: string,
  templateId: number,
): Promise<void> {
  if (!uid || templateId <= 0) {
    return;
  }

  const [profileSnap, studentSnap] = await Promise.all([
    db.doc(`profiles/${uid}`).get(),
    db.doc(`students/${uid}`).get(),
  ]);

  const activationPatch = {
    hasFingerprint: true,
    fingerprintTemplateId: templateId,
    templateId,
    fingerprintStatus: "enrolled",
    updatedAt: serverTimestamp(),
  };

  if (profileSnap.exists) {
    batch.set(profileSnap.ref, activationPatch, {merge: true});
  }

  if (studentSnap.exists) {
    batch.set(studentSnap.ref, activationPatch, {merge: true});
  }
}

function sortFingerprintCleanupOwnerCandidates(
  left: FingerprintCleanupReportMapping,
  right: FingerprintCleanupReportMapping,
): number {
  const leftValid = isValidFingerprintCleanupOwner(left);
  const rightValid = isValidFingerprintCleanupOwner(right);
  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }

  const leftNeeds = left.needsReenrollment;
  const rightNeeds = right.needsReenrollment;
  if (leftNeeds !== rightNeeds) {
    return leftNeeds ? 1 : -1;
  }

  const leftProfile = normalizeLower(left.profileStatus);
  const rightProfile = normalizeLower(right.profileStatus);
  const leftActiveProfile = leftProfile === "active" || !leftProfile;
  const rightActiveProfile = rightProfile === "active" || !rightProfile;
  if (leftActiveProfile !== rightActiveProfile) {
    return leftActiveProfile ? -1 : 1;
  }

  if (left.lastEnrolledAtMs !== right.lastEnrolledAtMs) {
    return right.lastEnrolledAtMs - left.lastEnrolledAtMs;
  }

  return left.studentName.localeCompare(right.studentName);
}

function buildFingerprintTemplateMigrationPayload(
  mapping: FingerprintCleanupReportMapping,
): Record<string, unknown> {
  const normalizedStatus = normalizeLower(mapping.fingerprintStatus);
  const isActiveOwner = isValidFingerprintCleanupOwner(mapping);
  const status =
    mapping.mappingStatus === "deleted" ||
    mapping.mappingStatus === "missing_profile" ||
    mapping.mappingStatus === "stale" ?
      "stale" :
    mapping.mappingStatus === "needs_reenrollment" ||
    normalizedStatus === "needs_reenrollment" ?
      "needs_reenrollment" :
      "active";

  return {
    templateId: mapping.templateId,
    uid: mapping.uid,
    schoolId: mapping.schoolId,
    name: mapping.studentName,
    course: mapping.course,
    yearLevel: mapping.yearLevel,
    active: isActiveOwner,
    status,
    fingerprintStatus: mapping.fingerprintStatus || (isActiveOwner ? "enrolled" : status),
    updatedAt: serverTimestamp(),
    migratedAt: serverTimestamp(),
  };
}

export const adminListFingerprintCleanupMappings = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const actorUid = normalizeText(request.auth?.uid);

    try {
      const actorProfileSnap = actorUid ? await db.doc(`profiles/${actorUid}`).get() : null;
      authLogger.info("adminListFingerprintCleanupMappings started", {
        actorUid,
        actorRole: normalizeText(actorProfileSnap?.data()?.role),
        collection: "fingerprintTemplates",
      });

      const report = await buildFingerprintCleanupReport();
      authLogger.info("adminListFingerprintCleanupMappings completed", {
        actorUid,
        loadedMappings: report.totalMappings,
        fallbackUsed: report.fallbackUsed,
        source: report.source,
      });

      await db.collection("logs").add({
        action: "ADMIN_LIST_FINGERPRINT_CLEANUP_MAPPINGS",
        actorUid,
        totalMappings: report.totalMappings,
        duplicateMappings: report.duplicateMappings,
        staleMappings: report.staleMappings,
        source: report.source,
        fallbackUsed: report.fallbackUsed,
        createdAt: serverTimestamp(),
      }).catch((logError) => {
        authLogger.warn("adminListFingerprintCleanupMappings log write failed", {
          error: logError,
        });
      });

      return report;
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const unexpectedError = error as {code?: string; message?: string};
      authLogger.error("adminListFingerprintCleanupMappings failed", {
        actorUid,
        code: unexpectedError.code ?? "unknown",
        message: unexpectedError.message ?? "Unknown fingerprint cleanup error",
        error,
      });

      throw new HttpsError(
        "internal",
        "Unable to load fingerprint mappings. Check Cloud Function logs for the exact error.",
      );
    }
  });

export const adminBuildFingerprintMappingsFromProfiles = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const actorUid = normalizeText(request.auth?.uid);

    try {
      const report = await buildFingerprintCleanupReport();
      const groupedByTemplate = new Map<number, FingerprintCleanupReportMapping[]>();

      report.mappings
        .filter((mapping) =>
          mapping.templateId > 0 &&
          (mapping.sources.includes("profile") || mapping.sources.includes("student_projection")),
        )
        .forEach((mapping) => {
          const current = groupedByTemplate.get(mapping.templateId) ?? [];
          current.push(mapping);
          groupedByTemplate.set(mapping.templateId, current);
        });

      if (groupedByTemplate.size === 0) {
        return {
          ok: true,
          createdCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          totalProfileMappings: 0,
          message: "No profile fingerprint mappings were found to migrate.",
        } satisfies FingerprintCleanupBuildMappingsResponse;
      }

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let operationsInBatch = 0;
      let batch = db.batch();

      for (const [templateId, mappings] of groupedByTemplate.entries()) {
        const preferred = [...mappings].sort(sortFingerprintCleanupOwnerCandidates)[0];
        const payload = buildFingerprintTemplateMigrationPayload(preferred);
        const templateRef = fingerprintTemplateRef(templateId);
        const templateSnap = await templateRef.get();
        const existingData = templateSnap.data() ?? {};
        const existingUid = normalizeText(existingData.uid);
        const existingSchoolId = normalizeText(existingData.schoolId);
        const existingStatus = normalizeLower(existingData.status);
        const existingActive = existingData.active !== false;
        const nextStatus = normalizeLower(payload.status);
        const nextUid = normalizeText(payload.uid);
        const nextSchoolId = normalizeText(payload.schoolId);
        const nextActive = payload.active === true;

        if (
          templateSnap.exists &&
          existingUid === nextUid &&
          existingSchoolId === nextSchoolId &&
          existingStatus === nextStatus &&
          existingActive === nextActive
        ) {
          skippedCount += 1;
          continue;
        }

        batch.set(templateRef, payload, {merge: true});
        operationsInBatch += 1;
        if (templateSnap.exists) {
          updatedCount += 1;
        } else {
          createdCount += 1;
        }

        if (operationsInBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          operationsInBatch = 0;
        }
      }

      if (operationsInBatch > 0) {
        await batch.commit();
      }

      await db.collection("logs").add({
        action: "ADMIN_BUILD_FINGERPRINT_MAPPINGS_FROM_PROFILES",
        actorUid,
        createdCount,
        updatedCount,
        skippedCount,
        totalProfileMappings: groupedByTemplate.size,
        createdAt: serverTimestamp(),
      }).catch((logError) => {
        authLogger.warn("adminBuildFingerprintMappingsFromProfiles log write failed", {
          error: logError,
        });
      });

      return {
        ok: true,
        createdCount,
        updatedCount,
        skippedCount,
        totalProfileMappings: groupedByTemplate.size,
        message:
          createdCount > 0 || updatedCount > 0 ?
            `Fingerprint mappings built from profiles. Created ${createdCount}, updated ${updatedCount}, skipped ${skippedCount}.` :
            "Fingerprint mappings are already up to date.",
      } satisfies FingerprintCleanupBuildMappingsResponse;
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      const unexpectedError = error as {code?: string; message?: string};
      authLogger.error("adminBuildFingerprintMappingsFromProfiles failed", {
        actorUid,
        code: unexpectedError.code ?? "unknown",
        message: unexpectedError.message ?? "Unknown fingerprint migration error",
        error,
      });

      throw new HttpsError(
        "internal",
        "Unable to build fingerprint mappings from profiles. Check Cloud Function logs for the exact error.",
      );
    }
  });

export const adminManageFingerprintCleanup = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const body = asRecord(request.data);
    const action = normalizeText(body.action);
    const actorUid = normalizeText(request.auth?.uid);
    const actorProfileSnap = await db.doc(`profiles/${actorUid}`).get();
    const actorSchoolId = actorProfileSnap.exists ?
      normalizeText(actorProfileSnap.data()?.schoolId) :
      "";
    const templateId = toPositiveNumber(body.templateId);
    const reason = normalizeText(body.reason) || "Admin fingerprint cleanup";

    if (!action) {
      throw new HttpsError("invalid-argument", "action is required.");
    }

    if (templateId <= 0) {
      throw new HttpsError(
        "invalid-argument",
        "templateId must be a positive integer.",
      );
    }

    const report = await buildFingerprintCleanupReport();
    const templateMappings = report.mappings.filter(
      (mapping) => mapping.templateId === templateId,
    );

    if (templateMappings.length === 0) {
      throw new HttpsError("not-found", "Fingerprint mapping not found.");
    }

    const batch = db.batch();
    let updatedCount = 0;
    let queueCount = 0;
    let logAction = "";
    let logTargetUid = "";
    let logTargetSchoolId = "";
    let message = "";

    if (action === "keepStudent") {
      const keepUid = normalizeText(body.keepUid);
      const keepMapping = templateMappings.find((mapping) => mapping.uid === keepUid);
      if (!keepUid || !keepMapping) {
        throw new HttpsError("invalid-argument", "keepUid is required.");
      }

      if (!keepMapping.canKeepTemplateOwner) {
        throw new HttpsError(
          "failed-precondition",
          "Selected student cannot keep this fingerprint template.",
        );
      }

      await activateFingerprintMappingForUid(batch, keepUid, templateId);
      const removedMappings = templateMappings.filter((mapping) => mapping.uid !== keepUid);
      for (const mapping of removedMappings) {
        updatedCount += await clearFingerprintMappingForUid(
          batch,
          mapping.uid,
          "needs_reenrollment",
        );
        await queueFingerprintCleanupInstruction(
          batch,
          "removeMapping",
          templateId,
          mapping.uid,
          mapping.schoolId,
          reason,
          actorUid,
        );
        queueCount += 1;
      }

      await updateFingerprintTemplateDocument(batch, templateId, keepMapping, {
        uid: keepMapping.uid,
        schoolId: keepMapping.schoolId,
        studentName: keepMapping.studentName,
        course: keepMapping.course,
        yearLevel: keepMapping.yearLevel,
      });

      logAction = "ADMIN_KEEP_FINGERPRINT_TEMPLATE_OWNER";
      logTargetUid = keepMapping.uid;
      logTargetSchoolId = keepMapping.schoolId;
      message = `Template ${templateId} kept for ${keepMapping.studentName}.`;
    } else {
      const uid = normalizeText(body.uid);
      const targetMapping = templateMappings.find((mapping) => mapping.uid === uid);
      if (!uid || !targetMapping) {
        throw new HttpsError("invalid-argument", "uid is required.");
      }

      const nextStatus =
        action === "removeStaleMapping" && targetMapping.mappingStatus === "stale" ?
          "stale" :
          "needs_reenrollment";

      if (action === "removeStaleMapping" && !targetMapping.canRemoveStale) {
        throw new HttpsError(
          "failed-precondition",
          "Only stale, deleted, or missing-profile mappings can use removeStaleMapping.",
        );
      }

      updatedCount += await clearFingerprintMappingForUid(batch, uid, nextStatus);
      const queueType: FingerprintCleanupQueueType =
        action === "markNeedsReenrollment" ?
          "markNeedsReenrollment" :
          "removeMapping";
      await queueFingerprintCleanupInstruction(
        batch,
        queueType,
        templateId,
        targetMapping.uid,
        targetMapping.schoolId,
        reason,
        actorUid,
      );
      queueCount += 1;

      const remainingOwner = templateMappings
        .filter((mapping) => mapping.uid !== uid)
        .find((mapping) => isValidFingerprintCleanupOwner(mapping)) || null;

      await updateFingerprintTemplateDocument(batch, templateId, remainingOwner, {
        uid: targetMapping.uid,
        schoolId: targetMapping.schoolId,
        studentName: targetMapping.studentName,
        course: targetMapping.course,
        yearLevel: targetMapping.yearLevel,
      });

      if (!remainingOwner) {
        await queueFingerprintCleanupInstruction(
          batch,
          "deleteTemplateIfUnused",
          templateId,
          targetMapping.uid,
          targetMapping.schoolId,
          reason,
          actorUid,
        );
        queueCount += 1;
      }

      logAction =
        action === "removeStaleMapping" ?
          "ADMIN_REMOVE_STALE_FINGERPRINT_MAPPING" :
          action === "markNeedsReenrollment" ?
            "ADMIN_MARK_FINGERPRINT_NEEDS_REENROLLMENT" :
            "ADMIN_REMOVE_FINGERPRINT_MAPPING";
      logTargetUid = targetMapping.uid;
      logTargetSchoolId = targetMapping.schoolId;
      message =
        action === "markNeedsReenrollment" ?
          `${targetMapping.studentName} now needs re-enrollment.` :
          `Fingerprint mapping removed for ${targetMapping.studentName}.`;
    }

    await db.collection("logs").add({
      action: logAction,
      actorUid,
      actorSchoolId,
      targetUid: logTargetUid,
      targetSchoolId: logTargetSchoolId,
      templateId,
      reason,
      createdAt: serverTimestamp(),
      metadata: {
        queueCount,
        updatedCount,
      },
    });

    await batch.commit();

    return {
      ok: true,
      action,
      updatedCount,
      queueCount,
      message,
    } satisfies FingerprintCleanupActionResponse;
  });

export const ecListStudents = onCall({region: REGION}, async (request) => {
    await requireAdminOrEC(request);
    const actorProfile = await callerProfileData(request);
    const actorCourseScope = resolveProfileCourseScope(actorProfile);
    const actorIsBod = isBodProfileData(actorProfile);

    const body = asRecord(request.data);
    const includeEcMembers = body.includeEcMembers === true;
    const rawLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(rawLimit) ?
      Math.min(Math.max(rawLimit, 1), 5000) :
      2000;
    const lookupRoles = includeEcMembers ?
      [...STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES] :
      [...STUDENT_ONLY_LOOKUP_PROFILE_ROLES];

    const profileSnapshot = await db
      .collection("profiles")
      .where("role", "in", lookupRoles)
      .limit(limit)
      .get();

    const studentRefs = profileSnapshot.docs.map((profileDoc) =>
      db.doc(`students/${profileDoc.id}`)
    );
    const studentSnapshots = studentRefs.length > 0 ?
      await db.getAll(...studentRefs) :
      [];
    const studentByUid = new Map<string, FirebaseFirestore.DocumentData>();

    studentSnapshots.forEach((studentSnap) => {
      if (!studentSnap.exists) return;
      studentByUid.set(studentSnap.id, studentSnap.data() ?? {});
    });

    const students = profileSnapshot.docs
      .map((profileDoc) => {
        const profileData = profileDoc.data() ?? {};
        const studentData = studentByUid.get(profileDoc.id) ?? {};
        if (!isStudentAudienceProfile(profileData, studentData)) {
          return null;
        }

        const firstName =
          normalizeNamePart(profileData.firstName) ||
          normalizeNamePart(studentData.firstName);
        const lastName =
          normalizeNamePart(profileData.lastName) ||
          normalizeNamePart(studentData.lastName);
        const combinedFullName = buildStudentFullName(firstName, lastName);
        const schoolId =
          normalizeText(profileData.schoolId) ||
          normalizeText(studentData.schoolId) ||
          normalizeText(profileData.studentId) ||
          normalizeText(studentData.studentId);
        const studentId =
          normalizeText(profileData.studentId) ||
          normalizeText(studentData.studentId) ||
          schoolId;
        const course =
          resolveStudentCourse(profileData, studentData) ||
          normalizeText(profileData.course) ||
          normalizeText(studentData.course);
        const yearLevel = resolveStudentYearLevel(profileData, studentData);

        return {
          uid: profileDoc.id,
          role: normalizeText(profileData.role || studentData.role),
          schoolId,
          studentId,
          firstName,
          lastName,
          fullName:
            normalizeText(profileData.fullName) ||
            normalizeText(studentData.fullName) ||
            combinedFullName,
          studentName:
            normalizeText(profileData.studentName) ||
            normalizeText(studentData.studentName) ||
            normalizeText(profileData.name) ||
            normalizeText(studentData.name) ||
            combinedFullName,
          name:
            normalizeText(profileData.name) ||
            normalizeText(profileData.fullName) ||
            normalizeText(studentData.name) ||
            normalizeText(studentData.fullName) ||
            normalizeText(profileData.studentName) ||
            normalizeText(studentData.studentName) ||
            combinedFullName,
          course,
          yearLevel,
          year: yearLevel,
          readyForClearance:
            studentData.readyForClearance === true ||
            profileData.readyForClearance === true,
          status:
            normalizeText(studentData.status) ||
            normalizeText(profileData.status) ||
            "Active",
          email: normalizeText(profileData.email),
          createdAtMs: toMillis(profileData.createdAt ?? studentData.createdAt),
          ecPosition: normalizeECPosition(profileData.ecPosition),
          courseScope: resolveProfileCourseScope(profileData) || null,
          isBod: isBodProfileData(profileData),
        };
      })
      .filter((student): student is NonNullable<typeof student> => Boolean(student))
      .filter((student) => {
        if (!actorIsBod) {
          return true;
        }

        return Boolean(
          actorCourseScope &&
          isStudentOnlyRole(student.role) &&
          normalizeCourseLabel(student.course) === actorCourseScope,
        );
      });

    return {students};
  });

export const ecCreateStudent = onCall({region: REGION}, async (request) => {
    await requireAdminOrEC(request);
    const actorProfile = await callerProfileData(request);

    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const studentName = normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);
    const emailRaw = normalizeText(body.email);

    if (emailRaw && !isValidEmailAddress(emailRaw)) {
      throw new HttpsError(
        "invalid-argument",
        "Please provide a valid email address."
      );
    }

    const email = emailRaw || `${schoolId}@campus.local`;

    if (!schoolId) {
      throw new HttpsError(
        "invalid-argument",
        "School ID is required."
      );
    }

    if (!studentName) {
      throw new HttpsError(
        "invalid-argument",
        "Student name is required."
      );
    }

    if (!course) {
      throw new HttpsError(
        "invalid-argument",
        "Course is required."
      );
    }

    ensureBodCourseScopeAccess(
      actorProfile,
      course,
      "B.O.D. members can only create students inside their own course scope.",
    );

    if (!yearRaw) {
      throw new HttpsError(
        "invalid-argument",
        "Year is required."
      );
    }

    let schoolIdReservation:
      | Awaited<ReturnType<typeof reserveUniqueStudentSchoolId>>
      | null = null;
    let createdUid: string | null = null;

    try {
      schoolIdReservation = await reserveUniqueStudentSchoolId(
        schoolId,
        "ec_create_student",
      );

      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;
      createdUid = uid;
      const timestamp = serverTimestamp();
      await schoolIdReservation.activate(uid);

      const studentBatch = db.batch();
      studentBatch.set(
        db.doc(`profiles/${uid}`),
          {
            schoolId,
            schoolIdKey,
            email,
            role: "student",
            isStudent: true,
            studentName,
            name: studentName,
            course,
            year,
            yearLevel: year,
            readyForClearance: false,
            mustChangePassword: true,
            emailVerified: false,
            emailVerificationPending: false,
          pendingEmail: null,
          firstLoginCompleted: false,
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: true}
      );

      studentBatch.set(
        db.doc(`students/${uid}`),
          {
            uid,
            studentId: uid,
            schoolId,
            schoolIdKey,
            role: "student",
            isStudent: true,
            studentName,
            name: studentName,
            course,
            year,
            yearLevel: year,
            readyForClearance: false,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
        },
        {merge: true}
      );
      await studentBatch.commit();

      await db.collection("logs").add({
        action: "ec_create_student",
        actorUid: normalizeText(request.auth?.uid),
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: timestamp,
      }).catch((logError) => {
        authLogger.warn("ecCreateStudent log write failed", {
          uid,
          schoolId,
          error: logError,
        });
      });

      return {uid};
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};
      if (createdUid) {
        await admin.auth().deleteUser(createdUid).catch(() => undefined);
      }
      if (schoolIdReservation) {
        await schoolIdReservation.release();
      }
      if (isHttpsErrorCode(error, "already-exists")) {
        throw schoolIdAlreadyExistsError(
          authError.message || "School ID already exists.",
        );
      }
      if (authError.code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "Account already exists."
        );
      }

      throw new HttpsError(
        "internal",
        authError.message || "Failed to create student account."
      );
    }
  });

type EnrollmentSessionStatus =
  | "pending"
  | "paired"
  | "downloading"
  | "enrolling"
  | "completed"
  | "partially-completed"
  | "closed";

type EnrollmentStudentStatus =
  | "pending"
  | "downloaded"
  | "enrolled"
  | "synced"
  | "failed";

type EnrollmentSyncStatus = "pending" | "synced" | "failed";
const ENROLLMENT_SESSION_QUEUE_HOLD_DEVICE_ID = "__session_only__";

type EcActorContext = {
  uid: string;
  profile: FirebaseFirestore.DocumentData;
  isAdmin: boolean;
  isRegularEc: boolean;
  isBod: boolean;
  courseScope: string;
};

type CampusNotificationAudienceMode = "filtered" | "course" | "explicit";
type CampusNotificationRecipientType = "all" | "course" | "year" | "student";
type CampusNotificationStatus = "scheduled" | "sent";
type CampusNotificationRecipient = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  status: string;
  role: "student";
};

type CampusDocumentType = "PDF" | "Images" | "Word Files" | "Spreadsheets";
type CampusDocumentCategory = "Events" | "Payments" | "Clearance" | "General";
type CampusDocumentStatus = "pending-upload" | "active";
type CampusDocumentUploadMethod = "firebase-storage-sdk" | "PUT";

const CAMPUS_DOCUMENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const CAMPUS_DOCUMENT_ALLOWED_TYPES = new Set<CampusDocumentType>([
  "PDF",
  "Images",
  "Word Files",
  "Spreadsheets",
]);
const CAMPUS_DOCUMENT_ALLOWED_CATEGORIES = new Set<CampusDocumentCategory>([
  "Events",
  "Payments",
  "Clearance",
  "General",
]);
const CAMPUS_DOCUMENT_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);
const CAMPUS_DOCUMENT_PDF_EXTENSIONS = new Set(["pdf"]);
const CAMPUS_DOCUMENT_WORD_EXTENSIONS = new Set(["doc", "docx"]);
const CAMPUS_DOCUMENT_SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const CAMPUS_DOCUMENT_WORD_CONTENT_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const CAMPUS_DOCUMENT_SPREADSHEET_CONTENT_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);
const CAMPUS_DOCUMENT_SIGNED_UPLOAD_TTL_MS = 10 * 60 * 1000;

function normalizeEnrollmentSessionStatus(value: unknown): EnrollmentSessionStatus {
  const normalized = normalizeLower(value);
  if (normalized === "paired") return "paired";
  if (normalized === "downloading") return "downloading";
  if (normalized === "enrolling") return "enrolling";
  if (normalized === "completed") return "completed";
  if (normalized === "partially completed" || normalized === "partially-completed") {
    return "partially-completed";
  }
  if (normalized === "closed") return "closed";
  return "pending";
}

function normalizeEnrollmentStudentStatus(value: unknown): EnrollmentStudentStatus {
  const normalized = normalizeLower(value);
  if (normalized === "downloaded") return "downloaded";
  if (normalized === "enrolled") return "enrolled";
  if (normalized === "synced") return "synced";
  if (normalized === "failed") return "failed";
  return "pending";
}

function normalizeEnrollmentSyncStatus(value: unknown): EnrollmentSyncStatus {
  const normalized = normalizeLower(value);
  if (normalized === "synced") return "synced";
  if (normalized === "failed") return "failed";
  return "pending";
}

function sanitizeCourseScopeForStoragePath(value: string): string {
  return normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function courseScopeSlugFromValue(value: unknown): string {
  const normalizedCourseScope = normalizeCourseLabel(value);
  return normalizedCourseScope ?
    sanitizeCourseScopeForStoragePath(normalizedCourseScope) :
    "";
}

function allowedDocumentStoragePrefixesForActor(
  actor: EcActorContext,
): string[] {
  if (actor.isBod && actor.courseScope) {
    const scopeSlug = sanitizeCourseScopeForStoragePath(actor.courseScope);
    return [
      `documents/course/${scopeSlug}/`,
      `ec-documents/course/${scopeSlug}/`,
    ];
  }

  return [
    "documents/shared/",
    "ec-documents/shared/",
  ];
}

function sanitizeCampusDocumentFileName(value: unknown): string {
  return normalizeText(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/[<>:"|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

function getCampusDocumentExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? normalizeLower(fileName.slice(lastDot + 1)) : "";
}

function inferCampusDocumentTypeFromFileName(fileName: string): CampusDocumentType | "" {
  const extension = getCampusDocumentExtension(fileName);
  if (CAMPUS_DOCUMENT_IMAGE_EXTENSIONS.has(extension)) return "Images";
  if (CAMPUS_DOCUMENT_PDF_EXTENSIONS.has(extension)) return "PDF";
  if (CAMPUS_DOCUMENT_WORD_EXTENSIONS.has(extension)) return "Word Files";
  if (CAMPUS_DOCUMENT_SPREADSHEET_EXTENSIONS.has(extension)) return "Spreadsheets";
  return "";
}

function normalizeCampusDocumentType(
  value: unknown,
  fileName?: string,
): CampusDocumentType | "" {
  const normalized = normalizeText(value) as CampusDocumentType;
  if (CAMPUS_DOCUMENT_ALLOWED_TYPES.has(normalized)) {
    return normalized;
  }

  return fileName ? inferCampusDocumentTypeFromFileName(fileName) : "";
}

function normalizeCampusDocumentCategory(value: unknown): CampusDocumentCategory | "" {
  const normalized = normalizeText(value) as CampusDocumentCategory;
  return CAMPUS_DOCUMENT_ALLOWED_CATEGORIES.has(normalized) ? normalized : "";
}

function normalizeCampusDocumentStatus(value: unknown): CampusDocumentStatus {
  return normalizeLower(value) === "pending-upload" ? "pending-upload" : "active";
}

function inferCampusDocumentContentTypeFromFileName(fileName: string): string {
  const extension = getCampusDocumentExtension(fileName);
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "pdf") return "application/pdf";
  if (extension === "doc") return "application/msword";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === "xls") return "application/vnd.ms-excel";
  if (extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === "csv") return "text/csv";
  return "";
}

function isAllowedCampusDocumentContentType(
  contentType: string,
  type: CampusDocumentType,
): boolean {
  if (!contentType) {
    return false;
  }

  if (type === "Images") {
    return contentType.startsWith("image/");
  }
  if (type === "PDF") {
    return contentType === "application/pdf";
  }
  if (type === "Word Files") {
    return CAMPUS_DOCUMENT_WORD_CONTENT_TYPES.has(contentType);
  }
  return CAMPUS_DOCUMENT_SPREADSHEET_CONTENT_TYPES.has(contentType);
}

function normalizeCampusDocumentContentType(
  value: unknown,
  fileName: string,
  type: CampusDocumentType,
): string {
  const normalized = normalizeLower(value);
  if (isAllowedCampusDocumentContentType(normalized, type)) {
    return normalized;
  }

  return inferCampusDocumentContentTypeFromFileName(fileName) || "application/octet-stream";
}

function validateCampusDocumentUploadInput(body: Record<string, unknown>): {
  displayName: string;
  fileName: string;
  type: CampusDocumentType;
  category: CampusDocumentCategory;
  sizeBytes: number;
  contentType: string;
} {
  const displayName = normalizeText(body.name);
  const fileName = sanitizeCampusDocumentFileName(displayName);
  const category = normalizeCampusDocumentCategory(body.category) || "General";
  const sizeBytes = Number(body.sizeBytes);
  const type =
    normalizeCampusDocumentType(body.type, fileName) ||
    inferCampusDocumentTypeFromFileName(fileName);
  const contentType = type ?
    normalizeCampusDocumentContentType(body.contentType, fileName, type) :
    "";

  if (!displayName || !fileName) {
    throw new HttpsError("invalid-argument", "A valid file name is required.");
  }
  if (!type) {
    throw new HttpsError(
      "invalid-argument",
      "Only image, PDF, Excel, and Word documents are allowed.",
    );
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError("invalid-argument", "sizeBytes must be a positive number.");
  }
  if (sizeBytes > CAMPUS_DOCUMENT_MAX_FILE_SIZE_BYTES) {
    throw new HttpsError(
      "invalid-argument",
      "Files larger than 10 MB are not allowed.",
    );
  }

  return {
    displayName,
    fileName,
    type,
    category,
    sizeBytes,
    contentType,
  };
}

function campusDocumentStoragePathForActor(
  actor: EcActorContext,
  docId: string,
  fileName: string,
): {
  ownerType: "ec" | "bod";
  storagePath: string;
  courseScope: string | null;
  courseScopeSlug: string | null;
  createdByCourseScope: string | null;
  course: string | null;
  courses: string[];
} {
  if (actor.isBod) {
    const courseScopeSlug = courseScopeSlugFromValue(actor.courseScope);
    if (!courseScopeSlug) {
      throw new HttpsError(
        "failed-precondition",
        "B.O.D. profile is missing a valid course scope slug.",
      );
    }

    return {
      ownerType: "bod",
      storagePath: `documents/course/${courseScopeSlug}/${docId}/${fileName}`,
      courseScope: actor.courseScope,
      courseScopeSlug,
      createdByCourseScope: actor.courseScope,
      course: actor.courseScope,
      courses: [actor.courseScope],
    };
  }

  return {
    ownerType: "ec",
    storagePath: `ec-documents/shared/${docId}/${fileName}`,
    courseScope: null,
    courseScopeSlug: null,
    createdByCourseScope: null,
    course: null,
    courses: [],
  };
}

function enrollmentSessionCourseScope(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeCourseLabel(data.courseScope) ||
    normalizeCourseLabel(data.createdByCourseScope)
  );
}

function ecDocumentOwnerType(data: FirebaseFirestore.DocumentData): "ec" | "bod" {
  return normalizeLower(data.ownerType) === "bod" ? "bod" : "ec";
}

function ecDocumentCourseScope(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeCourseLabel(data.courseScope) ||
    normalizeCourseLabel(data.courseScopeSlug) ||
    normalizeCourseLabel(data.createdByCourseScope) ||
    normalizeCourseLabel(data.course)
  );
}

function ecDocumentStrictCourseScope(data: FirebaseFirestore.DocumentData): string {
  return ecDocumentCourseScope(data);
}

function ecDocumentOwnedByUid(
  data: FirebaseFirestore.DocumentData,
  uid: string,
): boolean {
  const normalizedUid = normalizeText(uid);
  if (!normalizedUid) {
    return false;
  }

  return [
    data.createdBy,
    data.createdByUid,
    data.uploadedByUid,
    data.ownerUid,
    data.uploadedBy,
  ].some((value) => normalizeText(value) === normalizedUid);
}

function ecDocumentStoragePath(data: FirebaseFirestore.DocumentData): string {
  return normalizeText(data.storagePath);
}

function ecDocumentMatchesStoragePath(
  data: FirebaseFirestore.DocumentData,
  storagePath: string,
): boolean {
  return ecDocumentStoragePath(data) === normalizeText(storagePath);
}

function isPendingCampusDocument(data: FirebaseFirestore.DocumentData): boolean {
  return normalizeCampusDocumentStatus(data.status) === "pending-upload";
}

function canEcActorAccessDocument(
  actor: EcActorContext,
  data: FirebaseFirestore.DocumentData,
): boolean {
  if (actor.isAdmin || actor.isRegularEc) {
    return true;
  }

  if (!actor.isBod || !actor.courseScope) {
    return false;
  }

  return (
    ecDocumentOwnerType(data) === "bod" &&
    ecDocumentStrictCourseScope(data) === actor.courseScope &&
    ecDocumentOwnedByUid(data, actor.uid)
  );
}

function canEcActorViewActiveDocument(
  actor: EcActorContext,
  data: FirebaseFirestore.DocumentData,
): boolean {
  return !isPendingCampusDocument(data) && canEcActorAccessDocument(actor, data);
}

function toCampusDocumentListItem(
  documentId: string,
  data: FirebaseFirestore.DocumentData,
) {
  const fileName = normalizeText(data.fileName);
  const displayName = normalizeText(data.name) || fileName || "Untitled";
  const type =
    normalizeCampusDocumentType(data.type, fileName || displayName) || "PDF";
  const category = normalizeCampusDocumentCategory(data.category) || "General";

  return {
    id: documentId,
    name: displayName,
    fileName: fileName || displayName,
    type,
    category,
    sizeBytes: Number(data.sizeBytes ?? 0),
    downloadURL: normalizeText(data.downloadURL),
    storagePath: ecDocumentStoragePath(data),
    ownerType: ecDocumentOwnerType(data),
    course: ecDocumentCourseScope(data) || null,
    courseScope: ecDocumentCourseScope(data) || null,
    courseScopeSlug:
      courseScopeSlugFromValue(ecDocumentCourseScope(data)) ||
      normalizeText(data.courseScopeSlug) ||
      null,
    createdByCourseScope:
      normalizeCourseLabel(data.createdByCourseScope) || null,
    createdBy: normalizeText(data.createdBy),
    createdByUid: normalizeText(data.createdByUid),
    ownerUid: normalizeText(data.ownerUid),
    uploadedBy: normalizeText(data.uploadedBy),
    uploadedByUid: normalizeText(data.uploadedByUid),
    createdAt: toMillis(data.createdAt),
    uploadedAt: toMillis(data.uploadedAt),
    updatedAt: toMillis(data.updatedAt),
    status: normalizeCampusDocumentStatus(data.status),
  };
}

function eventOwnerType(data: FirebaseFirestore.DocumentData): "ec" | "bod" {
  return normalizeLower(data.ownerType) === "bod" ? "bod" : "ec";
}

function eventCourseScope(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeCourseLabel(data.courseScope) ||
    normalizeCourseLabel(data.createdByCourseScope) ||
    normalizeCourseLabel(data.course)
  );
}

function eventCreatedByUid(data: FirebaseFirestore.DocumentData): string {
  return normalizeText(data.createdBy || data.createdByUid);
}

function paymentOwnerType(data: FirebaseFirestore.DocumentData): "ec" | "bod" {
  return normalizeLower(data.ownerType) === "bod" ? "bod" : "ec";
}

function paymentCourseScope(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeCourseLabel(data.courseScope) ||
    normalizeCourseLabel(data.createdByCourseScope) ||
    normalizeCourseLabel(data.course)
  );
}

function paymentCourseValue(data: FirebaseFirestore.DocumentData): string {
  return normalizeCourseLabel(data.course);
}

function paymentTargetCourses(data: FirebaseFirestore.DocumentData): string[] {
  if (!Array.isArray(data.targetCourses)) {
    return [];
  }

  return data.targetCourses
    .map((value) => normalizeCourseLabel(value))
    .filter(Boolean);
}

function paymentCreatedByCourseScope(data: FirebaseFirestore.DocumentData): string {
  return normalizeCourseLabel(data.createdByCourseScope);
}

function paymentCreatedByUid(data: FirebaseFirestore.DocumentData): string {
  return normalizeText(data.createdByUid || data.createdBy);
}

function hasStudentPortalIdentityFields(
  data: FirebaseFirestore.DocumentData,
): boolean {
  return Boolean(
    normalizeText(data.schoolId) ||
      normalizeText(data.schoolIdKey) ||
      normalizeText(data.studentId),
  );
}

type StudentPortalActorContext = {
  uid: string;
  profileData: FirebaseFirestore.DocumentData;
  studentData: FirebaseFirestore.DocumentData;
  role: string;
  course: string;
  yearLevel: string;
  schoolId: string;
  schoolIdKey: string;
  studentName: string;
  isStudent: boolean;
  isBod: boolean;
};

async function resolveStudentPortalActorContext(
  context: CallableAuthContext,
): Promise<StudentPortalActorContext> {
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const uid = normalizeText(context.auth.uid);
  const {profileData, studentData, profileExists} = await readStudentSources(uid);
  if (!profileExists) {
    throw new HttpsError("not-found", "Student profile not found.");
  }

  const mergedData = {
    ...studentData,
    ...profileData,
  };
  const role = normalizeCampusRoleValue(mergedData.role);
  const isStudent =
    role === "student" ||
    mergedData.isStudent === true ||
    hasStudentPortalIdentityFields(mergedData);

  if (!isStudent) {
    throw new HttpsError(
      "permission-denied",
      "Student access is not enabled for this account.",
    );
  }

  return {
    uid,
    profileData,
    studentData,
    role,
    course:
      resolveStudentCourse(profileData, studentData) ||
      normalizeCourseLabel(mergedData.course) ||
      normalizeText(mergedData.course),
    yearLevel:
      resolveStudentYearLevel(profileData, studentData) ||
      normalizeYear(mergedData.yearLevel || mergedData.year),
    schoolId:
      normalizeText(mergedData.schoolId) ||
      normalizeText(mergedData.schoolIdKey) ||
      normalizeText(mergedData.studentId),
    schoolIdKey: normalizeSchoolIdKey(
      normalizeText(mergedData.schoolIdKey) ||
      normalizeText(mergedData.schoolId) ||
      normalizeText(mergedData.studentId),
    ),
    studentName: resolveStudentName(uid, profileData, studentData),
    isStudent,
    isBod: role === "bod" || isBodProfileData(mergedData),
  };
}

type StudentPaymentAssignmentCandidate = {
  paymentId: string;
  docId: string;
  data: FirebaseFirestore.DocumentData;
  source: string;
};

type StudentPaymentListRow = {
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

function assignmentBelongsToCaller(
  assignment: FirebaseFirestore.DocumentData,
  docId: string,
  caller: Pick<StudentPortalActorContext, "uid" | "schoolId" | "schoolIdKey">,
): boolean {
  const normalizedUid = normalizeText(caller.uid);
  const normalizedSchoolId = normalizeText(caller.schoolId);
  const normalizedSchoolIdKey = normalizeSchoolIdKey(caller.schoolIdKey);

  return (
    normalizeText(docId) === normalizedUid ||
    normalizeText(assignment.uid) === normalizedUid ||
    normalizeText(assignment.studentUid) === normalizedUid ||
    (Boolean(normalizedSchoolId) &&
      normalizeText(assignment.schoolId) === normalizedSchoolId) ||
    (Boolean(normalizedSchoolIdKey) &&
      normalizeSchoolIdKey(assignment.schoolIdKey) === normalizedSchoolIdKey) ||
    (Boolean(normalizedSchoolId) &&
      normalizeText(assignment.studentId) === normalizedSchoolId)
  );
}

function assignmentCandidateScore(
  assignment: FirebaseFirestore.DocumentData,
  docId: string,
  caller: Pick<StudentPortalActorContext, "uid" | "schoolId" | "schoolIdKey">,
): number {
  const normalizedUid = normalizeText(caller.uid);
  const normalizedSchoolId = normalizeText(caller.schoolId);
  const normalizedSchoolIdKey = normalizeSchoolIdKey(caller.schoolIdKey);

  if (normalizeText(docId) === normalizedUid) return 6;
  if (normalizeText(assignment.uid) === normalizedUid) return 5;
  if (normalizeText(assignment.studentUid) === normalizedUid) return 4;
  if (
    Boolean(normalizedSchoolIdKey) &&
    normalizeSchoolIdKey(assignment.schoolIdKey) === normalizedSchoolIdKey
  ) {
    return 3;
  }
  if (
    Boolean(normalizedSchoolId) &&
    normalizeText(assignment.schoolId) === normalizedSchoolId
  ) {
    return 2;
  }
  if (
    Boolean(normalizedSchoolId) &&
    normalizeText(assignment.studentId) === normalizedSchoolId
  ) {
    return 1;
  }

  return 0;
}

function normalizeStudentPaymentStatus(
  value: unknown,
): "PAID" | "UNPAID" {
  return normalizeLower(value) === "paid" ? "PAID" : "UNPAID";
}

function studentCanViewEventPaymentFallback(
  actor: StudentPortalActorContext,
  eventData: FirebaseFirestore.DocumentData,
): boolean {
  const matchesExplicitAudience = matchesSelectedAudience(
    eventData,
    actor.uid,
    actor.schoolId,
  );
  if (!matchesExplicitAudience) {
    return false;
  }

  const studentTargetMatch = matchesSpecificStudentTarget(
    eventData.targetStudent,
    actor.schoolId,
    actor.studentName,
  );
  if (!studentTargetMatch) {
    return false;
  }

  if (hasExplicitSelectedAudience(eventData)) {
    return true;
  }

  const courseTargets = toTargetList(eventData.courses);
  const yearTargets = toTargetList(eventData.yearLevels);

  return (
    matchesTargetList(
      courseTargets.length > 0 ? courseTargets : eventData.course,
      actor.course,
      "All Courses",
    ) &&
    matchesTargetList(
      yearTargets.length > 0 ? yearTargets : eventData.yearLevel,
      actor.yearLevel,
      "All Years",
    )
  );
}

function paymentTargetYearLevels(data: FirebaseFirestore.DocumentData): string[] {
  if (!Array.isArray(data.targetYearLevels)) {
    return [];
  }

  return data.targetYearLevels
    .map((value) => normalizeYear(value))
    .filter(
      (value) =>
        Boolean(value) &&
        value !== "Unassigned" &&
        normalizeLower(value) !== "all years",
    );
}

function paymentLinkedEventId(data: FirebaseFirestore.DocumentData): string {
  return normalizeText(data.linkedEventId || data.eventId);
}

type CampusPaymentTarget = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
};

type CampusPaymentAssignmentRecord = CampusPaymentTarget & {
  status: "Paid" | "Unpaid";
};

type CampusPaymentAudienceResolution = {
  targets: CampusPaymentTarget[];
  targetStudent: string;
  course: string;
  yearLevel: string;
  targetCourses: string[];
  targetYearLevels: string[];
  courseScope: string | null;
  selectedCourse: string;
  selectedYear: string;
  selectedStudentIds: string[];
  selectedSchoolIds: string[];
  hasExplicitTargets: boolean;
};

function buildCampusPaymentExplicitTargetLabel(
  targets: CampusPaymentTarget[],
): string {
  return targets
    .map((target) => `${target.studentName} (${target.schoolId})`)
    .join("; ");
}

async function resolveCampusPaymentAudience(
  actor: EcActorContext,
  body: Record<string, unknown>,
): Promise<CampusPaymentAudienceResolution> {
  const selectedStudentIds = toUniqueIdentifierList(body.selectedStudentIds);
  const selectedSchoolIds = toUniqueIdentifierList(body.selectedSchoolIds);
  const hasExplicitTargets =
    selectedStudentIds.length > 0 || selectedSchoolIds.length > 0;
  const requestedTargetStudent = normalizeText(body.targetStudent);
  const requestedYear = normalizeYear(body.yearLevel);
  const requestedCourse = normalizeCourseLabel(body.course);
  const requestedCourseScope = normalizeCourseLabel(body.courseScope);
  const hasYearFilter =
    Boolean(requestedYear) &&
    requestedYear !== "Unassigned" &&
    normalizeLower(requestedYear) !== "all years";
  const hasCourseFilter =
    Boolean(requestedCourse) &&
    normalizeLower(requestedCourse) !== "all courses";

  if (
    actor.isBod &&
    requestedCourseScope &&
    requestedCourseScope !== actor.courseScope
  ) {
    throw new HttpsError(
      "permission-denied",
      `B.O.D accounts can only target ${actor.courseScope} students.`,
    );
  }

  if (
    actor.isBod &&
    requestedCourse &&
    requestedCourse !== actor.courseScope &&
    normalizeLower(requestedCourse) !== "all courses"
  ) {
    throw new HttpsError(
      "permission-denied",
      `B.O.D accounts can only target ${actor.courseScope} students.`,
    );
  }

  const candidates = await listCampusNotificationRecipientCandidates(actor);
  const explicitRecipients = hasExplicitTargets ?
    candidates.filter((recipient) =>
      selectedStudentIds.includes(recipient.uid) ||
      selectedSchoolIds.includes(recipient.schoolId),
    ) :
    [];

  if (hasExplicitTargets) {
    const explicitUidSet = new Set(
      explicitRecipients.map((recipient) => recipient.uid),
    );
    const explicitSchoolIdSet = new Set(
      explicitRecipients.map((recipient) => recipient.schoolId),
    );
    const hasMissingExplicitTargets =
      selectedStudentIds.some((uid) => !explicitUidSet.has(uid)) ||
      selectedSchoolIds.some((schoolId) => !explicitSchoolIdSet.has(schoolId));

    if (hasMissingExplicitTargets) {
      throw new HttpsError(
        "permission-denied",
        actor.isBod ?
          `Selected recipients must be active ${actor.courseScope} students.` :
          "Selected recipients must be active student accounts.",
      );
    }
  }

  const filteredRecipients = candidates.filter((recipient) => {
    const matchesYear =
      !hasYearFilter ||
      normalizeLower(normalizeYear(recipient.yearLevel)) ===
        normalizeLower(requestedYear);
    const matchesCourse =
      !hasCourseFilter ||
      normalizeCourseLabel(recipient.course) === requestedCourse;

    return matchesYear && matchesCourse;
  });

  const eligibleExplicitRecipients = hasExplicitTargets ?
    explicitRecipients.filter((recipient) =>
      filteredRecipients.some((filteredRecipient) => filteredRecipient.uid === recipient.uid),
    ) :
    [];

  if (
    hasExplicitTargets &&
    (hasYearFilter || hasCourseFilter) &&
    eligibleExplicitRecipients.length !== explicitRecipients.length
  ) {
    throw new HttpsError(
      "permission-denied",
      actor.isBod ?
        `Selected recipients must match the chosen ${actor.courseScope} payment audience.` :
        "Selected recipients must match the chosen payment audience.",
    );
  }

  const targets = (hasExplicitTargets ? eligibleExplicitRecipients : filteredRecipients)
    .map((recipient) => ({
      uid: recipient.uid,
      schoolId: recipient.schoolId,
      studentName: recipient.studentName,
      course: recipient.course,
      yearLevel: recipient.yearLevel,
    }))
    .sort((left, right) => {
    const bySchoolId = left.schoolId.localeCompare(right.schoolId);
    if (bySchoolId !== 0) {
      return bySchoolId;
    }
    return left.studentName.localeCompare(right.studentName);
    });

  if (targets.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      actor.isBod && actor.courseScope ?
        `No active ${actor.courseScope} students matched this payment audience.` :
        "No active students matched this payment audience.",
    );
  }

  const targetCourses = actor.isBod ?
    [actor.courseScope] :
    Array.from(new Set(
      targets
        .map((target) => normalizeCourseLabel(target.course))
        .filter(Boolean),
    ));
  const targetYearLevels = Array.from(new Set(
    targets
      .map((target) => normalizeYear(target.yearLevel))
      .filter(
        (value) =>
          Boolean(value) &&
          value !== "Unassigned" &&
          normalizeLower(value) !== "all years",
      ),
  ));
  const targetStudent = requestedTargetStudent ||
    (hasExplicitTargets ? buildCampusPaymentExplicitTargetLabel(explicitRecipients.map((recipient) => ({
      uid: recipient.uid,
      schoolId: recipient.schoolId,
      studentName: recipient.studentName,
      course: recipient.course,
      yearLevel: recipient.yearLevel,
    }))) : "");
  const course = actor.isBod ?
    actor.courseScope :
    hasCourseFilter ?
      requestedCourse :
      hasExplicitTargets ?
        "" :
        "All Courses";
  const yearLevel = hasYearFilter ?
    requestedYear :
    hasExplicitTargets ?
      "" :
      "All Years";
  const courseScope = actor.isBod ?
    actor.courseScope :
    hasCourseFilter ?
      requestedCourse :
      null;

  return {
    targets,
    targetStudent,
    course,
    yearLevel,
    targetCourses,
    targetYearLevels,
    courseScope,
    selectedCourse: course,
    selectedYear: yearLevel,
    selectedStudentIds,
    selectedSchoolIds,
    hasExplicitTargets,
  };
}

async function loadCampusPaymentAssignments(
  paymentRef: FirebaseFirestore.DocumentReference,
): Promise<Map<string, CampusPaymentAssignmentRecord>> {
  const assignmentSnapshot = await paymentRef.collection("students").get();
  const assignments = new Map<string, CampusPaymentAssignmentRecord>();

  assignmentSnapshot.docs.forEach((assignmentDoc) => {
    const assignmentData = assignmentDoc.data() ?? {};
    const uid = normalizeText(assignmentData.uid) || assignmentDoc.id;
    const schoolId =
      normalizeText(assignmentData.schoolId) ||
      normalizeText(assignmentData.studentId) ||
      uid;
    const studentName =
      normalizeText(
        assignmentData.name ||
        assignmentData.studentName ||
        assignmentData.fullName,
      ) ||
      schoolId;
    const course =
      normalizeCourseLabel(assignmentData.course) ||
      normalizeText(assignmentData.course) ||
      "Unassigned";
    const yearLevel =
      normalizeYear(assignmentData.yearLevel || assignmentData.year) ||
      "Unassigned";
    const status =
      normalizeLower(assignmentData.status) === "paid" ? "Paid" : "Unpaid";

    assignments.set(uid, {
      uid,
      schoolId,
      studentName,
      course,
      yearLevel,
      status,
    });
  });

  return assignments;
}

async function syncCampusPaymentAssignments(
  paymentId: string,
  targets: CampusPaymentTarget[],
  existingAssignments: Map<string, CampusPaymentAssignmentRecord>,
): Promise<{
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  removedAssignmentCount: number;
  batchCount: number;
}> {
  const writesPerBatch = 450;
  const nextTargetIds = new Set(targets.map((target) => target.uid));
  let paidCount = 0;
  let batchCount = 0;

  const upsertRows = targets.map((target) => {
    const existingStatus = existingAssignments.get(target.uid)?.status ?? "Unpaid";
    if (existingStatus === "Paid") {
      paidCount += 1;
    }

    return {
      target,
      status: existingStatus,
      isExisting: existingAssignments.has(target.uid),
    };
  });

  for (let index = 0; index < upsertRows.length; index += writesPerBatch) {
    const batch = db.batch();
    const chunk = upsertRows.slice(index, index + writesPerBatch);

    chunk.forEach(({target, status, isExisting}) => {
      batch.set(
        db.doc(`payments/${paymentId}/students/${target.uid}`),
        {
          uid: target.uid,
          schoolId: target.schoolId,
          name: target.studentName,
          studentName: target.studentName,
          year: target.yearLevel || "-",
          yearLevel: target.yearLevel || "-",
          section: "-",
          course: target.course || "-",
          status,
          updatedAt: serverTimestamp(),
          ...(isExisting ? {} : {createdAt: serverTimestamp()}),
        },
        {merge: true},
      );
    });

    await batch.commit();
    batchCount += 1;
  }

  const removedAssignmentIds = Array.from(existingAssignments.keys()).filter(
    (uid) => !nextTargetIds.has(uid),
  );

  for (let index = 0; index < removedAssignmentIds.length; index += writesPerBatch) {
    const batch = db.batch();
    removedAssignmentIds
      .slice(index, index + writesPerBatch)
      .forEach((uid) => {
        batch.delete(db.doc(`payments/${paymentId}/students/${uid}`));
      });
    await batch.commit();
    batchCount += 1;
  }

  return {
    totalStudents: targets.length,
    paidCount,
    unpaidCount: Math.max(0, targets.length - paidCount),
    removedAssignmentCount: removedAssignmentIds.length,
    batchCount,
  };
}

function paymentMatchesCourseScope(
  data: FirebaseFirestore.DocumentData,
  courseScope: string,
): boolean {
  if (!courseScope) {
    return false;
  }

  return paymentCourseScope(data) === courseScope ||
    paymentCreatedByCourseScope(data) === courseScope ||
    paymentCourseValue(data) === courseScope ||
    paymentTargetCourses(data).includes(courseScope);
}

function courseScopeQueryValues(courseScope: string): string[] {
  const normalizedCourseScope = normalizeCourseLabel(courseScope);
  if (!normalizedCourseScope) {
    return [];
  }

  const assignedCourseCode = COURSE_SCOPE_TO_CODE[normalizedCourseScope] || "";
  const storageSlug = courseScopeSlugFromValue(normalizedCourseScope);

  return Array.from(new Set(
    [
      normalizedCourseScope,
      normalizeLower(normalizedCourseScope),
      storageSlug,
      assignedCourseCode,
      normalizeLower(assignedCourseCode),
      assignedCourseCode ? `BS${assignedCourseCode}` : "",
      assignedCourseCode ? `bs${normalizeLower(assignedCourseCode)}` : "",
    ].map((value) => normalizeText(value)).filter(Boolean),
  )).slice(0, 10);
}

async function paymentStudentCourseMatchExists(
  paymentId: string,
  courseScopeValues: string[],
): Promise<boolean> {
  if (!paymentId || courseScopeValues.length === 0) {
    return false;
  }

  const paymentStudentsSnapshot = await db
    .collection("payments")
    .doc(paymentId)
    .collection("students")
    .where("course", "in", courseScopeValues)
    .limit(1)
    .get();

  return !paymentStudentsSnapshot.empty;
}

async function deleteSnapshotDocumentsInBatches(
  snapshot: FirebaseFirestore.QuerySnapshot,
  batchSize = 350,
): Promise<void> {
  if (snapshot.empty) {
    return;
  }

  for (let index = 0; index < snapshot.docs.length; index += batchSize) {
    const batch = db.batch();
    snapshot.docs
      .slice(index, index + batchSize)
      .forEach((documentSnapshot) => batch.delete(documentSnapshot.ref));
    await batch.commit();
  }
}

async function deleteStoragePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  await Promise.all(
    paths.map(async (rawPath) => {
      const path = normalizeText(rawPath);
      if (!path) {
        return;
      }

      try {
        await admin.storage().bucket().file(path).delete({ignoreNotFound: true});
      } catch (error: unknown) {
        const storageErrorCode = Number((error as {code?: unknown}).code);
        if (storageErrorCode !== 404) {
          throw error;
        }
      }
    }),
  );
}

async function resolveEcActorContext(
  context: CallableAuthContext,
): Promise<EcActorContext> {
  await requireAdminOrEC(context);

  const actorProfile = await callerProfileData(context);
  const actorUid = normalizeText(context.auth?.uid);
  const actorRole = normalizeCampusRoleValue(actorProfile.role);
  const actorIsAdmin = actorRole === "admin";
  const actorIsEcMember = isECMemberRole(actorProfile.role);
  const actorIsBod = actorIsEcMember && isBodProfileData(actorProfile);
  const actorIsRegularEc =
    actorIsEcMember &&
    !actorIsBod &&
    resolveProfileEcScope(actorProfile) === "all";

  if (!actorIsAdmin && !actorIsRegularEc && !actorIsBod) {
    throw new HttpsError(
      "permission-denied",
      "Only admin, regular EC, or B.O.D. users can perform this action.",
    );
  }

  const actorCourseScope = resolveProfileCourseScope(actorProfile);
  if (actorIsBod && !actorCourseScope) {
    throw new HttpsError(
      "failed-precondition",
      "B.O.D. profile is missing a valid course scope.",
    );
  }

  return {
    uid: actorUid,
    profile: actorProfile,
    isAdmin: actorIsAdmin,
    isRegularEc: actorIsRegularEc,
    isBod: actorIsBod,
    courseScope: actorCourseScope,
  };
}

async function readStudentSources(uid: string): Promise<{
  profileData: FirebaseFirestore.DocumentData;
  studentData: FirebaseFirestore.DocumentData;
  profileExists: boolean;
  studentExists: boolean;
}> {
  const [profileSnap, studentSnap] = await Promise.all([
    db.doc(`profiles/${uid}`).get(),
    db.doc(`students/${uid}`).get(),
  ]);

  return {
    profileData: profileSnap.exists ? (profileSnap.data() ?? {}) : {},
    studentData: studentSnap.exists ? (studentSnap.data() ?? {}) : {},
    profileExists: profileSnap.exists,
    studentExists: studentSnap.exists,
  };
}

function resolveStudentCourse(
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData,
): string {
  return (
    normalizeCourseLabel(profileData.course) ||
    normalizeCourseLabel(studentData.course)
  );
}

function resolveStudentYearLevel(
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData,
): string {
  const rawYear =
    normalizeText(profileData.yearLevel) ||
    normalizeText(profileData.year) ||
    normalizeText(studentData.yearLevel) ||
    normalizeText(studentData.year);

  return rawYear ? normalizeYear(rawYear) : "";
}

const INVALID_STUDENT_AUDIENCE_VALUES = new Set([
  "-",
  "all courses",
  "all years",
  "unassigned",
  "unknown user",
]);

function hasMeaningfulStudentAudienceValue(value: unknown): boolean {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return !INVALID_STUDENT_AUDIENCE_VALUES.has(normalized.toLowerCase());
}

function resolveStudentAudienceIdentityName(
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData,
): string {
  const firstName =
    normalizeNamePart(profileData.firstName) ||
    normalizeNamePart(studentData.firstName);
  const lastName =
    normalizeNamePart(profileData.lastName) ||
    normalizeNamePart(studentData.lastName);
  const combinedName = buildStudentFullName(firstName, lastName);

  return (
    normalizeText(profileData.name) ||
    normalizeText(profileData.fullName) ||
    normalizeText(profileData.studentName) ||
    normalizeText(profileData.displayName) ||
    normalizeText(studentData.name) ||
    normalizeText(studentData.fullName) ||
    normalizeText(studentData.studentName) ||
    combinedName
  );
}

function isStudentAudienceProfile(
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData = {},
): boolean {
  const mergedData = {
    ...studentData,
    ...profileData,
  };

  if (!hasStudentIdentityData(mergedData)) {
    return false;
  }

  const studentIdentifier =
    normalizeText(mergedData.schoolId) ||
    normalizeText(mergedData.studentId);
  const studentCourse =
    resolveStudentCourse(profileData, studentData) ||
    normalizeText(mergedData.course);
  const studentYear =
    resolveStudentYearLevel(profileData, studentData) ||
    normalizeText(mergedData.yearLevel) ||
    normalizeText(mergedData.year);
  const studentName = resolveStudentAudienceIdentityName(
    profileData,
    studentData,
  );

  return (
    hasMeaningfulStudentAudienceValue(studentIdentifier) &&
    hasMeaningfulStudentAudienceValue(studentCourse) &&
    hasMeaningfulStudentAudienceValue(studentYear) &&
    hasMeaningfulStudentAudienceValue(studentName)
  );
}

async function findStudentAudienceProfilesByIdentifier(
  identifier: unknown,
  limit = 25,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const normalizedIdentifier = normalizeText(identifier);
  if (!normalizedIdentifier) {
    return [];
  }

  const [schoolIdSnapshot, studentIdSnapshot] = await Promise.all([
    db
      .collection("profiles")
      .where("schoolId", "==", normalizedIdentifier)
      .limit(limit)
      .get(),
    db
      .collection("profiles")
      .where("studentId", "==", normalizedIdentifier)
      .limit(limit)
      .get(),
  ]);

  const matches = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  schoolIdSnapshot.docs.forEach((profileDoc) => {
    matches.set(profileDoc.id, profileDoc);
  });
  studentIdSnapshot.docs.forEach((profileDoc) => {
    matches.set(profileDoc.id, profileDoc);
  });

  return Array.from(matches.values());
}

function isActiveCampusStudentStatus(value: unknown): boolean {
  const normalizedStatus = normalizeLower(value);
  return normalizedStatus === "" || normalizedStatus === "active";
}

function normalizeNotificationYearSelections(
  body: Record<string, unknown>,
): string[] {
  const yearLevelsFromArray = normalizeIdentifierList(body.selectedYearLevels)
    .map((value) => normalizeYear(value))
    .filter((value) => normalizeLower(value) !== "all years");

  if (yearLevelsFromArray.length > 0) {
    return Array.from(new Set(yearLevelsFromArray));
  }

  const selectedYear = normalizeText(body.selectedYear);
  if (!selectedYear || normalizeLower(selectedYear) === "all years") {
    return [];
  }

  const normalizedYear = normalizeYear(selectedYear);
  return normalizedYear && normalizeLower(normalizedYear) !== "all years" ?
    [normalizedYear] :
    [];
}

function normalizeNotificationCourseSelections(
  body: Record<string, unknown>,
): string[] {
  return Array.from(
    new Set(
      normalizeIdentifierList(body.selectedCourses)
        .map((value) => normalizeCourseLabel(value))
        .filter(Boolean),
    ),
  );
}

function normalizeNotificationAudienceMode(
  value: unknown,
  actor: Pick<EcActorContext, "isBod">,
  hasExplicitTargets: boolean,
): CampusNotificationAudienceMode {
  const normalizedValue = normalizeLower(value);
  if (normalizedValue === "explicit") {
    return "explicit";
  }
  if (normalizedValue === "course") {
    return actor.isBod ? "course" : "filtered";
  }
  if (normalizedValue === "filtered") {
    return actor.isBod ? "course" : "filtered";
  }

  return hasExplicitTargets ? "explicit" : actor.isBod ? "course" : "filtered";
}

function computeCampusNotificationStatus(
  date: string,
  scheduledTime: string,
): CampusNotificationStatus {
  const startsAtMs = parseEventStartMs(date, scheduledTime);
  if (
    !Number.isFinite(startsAtMs) ||
    startsAtMs <= 0 ||
    startsAtMs === Number.MAX_SAFE_INTEGER
  ) {
    return "sent";
  }

  return startsAtMs > Date.now() ? "scheduled" : "sent";
}

function buildCampusNotificationTargetLabel(
  recipients: CampusNotificationRecipient[],
  hasExplicitTargets: boolean,
  courseLabel: string,
  yearLevelLabel: string,
): string {
  if (recipients.length === 0) {
    return "";
  }

  if (hasExplicitTargets) {
    return recipients
      .map((recipient) => `${recipient.studentName} (${recipient.schoolId})`)
      .join("; ");
  }

  if (courseLabel && courseLabel !== "All Courses") {
    if (!yearLevelLabel || yearLevelLabel === "All Years") {
      return `All ${courseLabel} students`;
    }

    return `${recipients.length} ${courseLabel} students selected`;
  }

  if (yearLevelLabel && yearLevelLabel !== "All Years") {
    return `${recipients.length} ${yearLevelLabel} students selected`;
  }

  return `All active students`;
}

async function listCampusNotificationRecipientCandidates(
  actor: EcActorContext,
): Promise<CampusNotificationRecipient[]> {
  const profileSnapshot = await db
    .collection("profiles")
    .where("role", "==", "student")
    .get();

  const studentRefs = profileSnapshot.docs.map((profileDoc) =>
    db.doc(`students/${profileDoc.id}`)
  );
  const studentSnapshots = studentRefs.length > 0 ?
    await db.getAll(...studentRefs) :
    [];
  const studentByUid = new Map<string, FirebaseFirestore.DocumentData>();

  studentSnapshots.forEach((studentSnap) => {
    if (!studentSnap.exists) {
      return;
    }

    studentByUid.set(studentSnap.id, studentSnap.data() ?? {});
  });

  return profileSnapshot.docs
    .map((profileDoc) => {
      const profileData = profileDoc.data() ?? {};
      const studentData = studentByUid.get(profileDoc.id) ?? {};
      if (!isStudentAudienceProfile(profileData, studentData)) {
        return null;
      }

      const role = normalizeCampusRoleValue(profileData.role || studentData.role);
      if (role !== "student") {
        return null;
      }

      const course = resolveStudentCourse(profileData, studentData);
      const yearLevel = resolveStudentYearLevel(profileData, studentData);
      const schoolId = resolveStudentSchoolId(profileDoc.id, profileData, studentData);
      const studentName = resolveStudentName(profileDoc.id, profileData, studentData);
      const status =
        normalizeText(studentData.status) ||
        normalizeText(profileData.status) ||
        "Active";

      if (
        !course ||
        !yearLevel ||
        !schoolId ||
        !studentName ||
        !isActiveCampusStudentStatus(status)
      ) {
        return null;
      }

      return {
        uid: profileDoc.id,
        schoolId,
        studentName,
        course,
        yearLevel,
        status,
        role,
      } satisfies CampusNotificationRecipient;
    })
    .filter(
      (recipient): recipient is CampusNotificationRecipient => Boolean(recipient),
    )
    .filter((recipient) => {
      if (!actor.isBod) {
        return true;
      }

      return Boolean(
        actor.courseScope &&
        normalizeCourseLabel(recipient.course) === actor.courseScope,
      );
    });
}

function resolveStudentSchoolId(
  uid: string,
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData,
): string {
  return (
    normalizeText(profileData.schoolId) ||
    normalizeText(profileData.studentId) ||
    normalizeText(studentData.schoolId) ||
    normalizeText(studentData.studentId) ||
    uid
  );
}

function resolveStudentName(
  uid: string,
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData,
): string {
  const merged = {
    ...studentData,
    ...profileData,
  };
  return resolveProfileDisplayName(merged) || uid;
}

function studentHasFingerprint(
  profileData: FirebaseFirestore.DocumentData,
  studentData: FirebaseFirestore.DocumentData,
): boolean {
  const fingerprintStatus =
    normalizeLower(profileData.fingerprintStatus) ||
    normalizeLower(studentData.fingerprintStatus);
  const fingerprintTemplateId = toPositiveNumber(
    profileData.fingerprintTemplateId ??
      profileData.templateId ??
      studentData.fingerprintTemplateId ??
      studentData.templateId,
  );

  return (
    fingerprintTemplateId > 0 ||
    fingerprintStatus === "enrolled" ||
    fingerprintStatus === "active"
  );
}

function enrollmentSessionPayloadFromSnapshot(
  snap: FirebaseFirestore.DocumentSnapshot,
) {
  const data = snap.data() ?? {};
  return {
    sessionId: snap.id,
    createdBy: normalizeText(data.createdBy),
    createdByName: normalizeText(data.createdByName),
    createdBySchoolId: normalizeText(data.createdBySchoolId),
    status: normalizeEnrollmentSessionStatus(data.status),
    pairedDeviceId: normalizeText(data.pairedDeviceId),
    targetDeviceId: normalizeText(data.targetDeviceId),
    totalStudents: toPositiveNumber(data.totalStudents),
    pendingCount: toPositiveNumber(data.pendingCount),
    downloadedCount: toPositiveNumber(data.downloadedCount),
    enrolledCount: toPositiveNumber(data.enrolledCount),
    syncedCount: toPositiveNumber(data.syncedCount),
    failedCount: toPositiveNumber(data.failedCount),
    selectedStudentIds: normalizeIdentifierList(data.selectedStudentIds),
    createdAtMs: toMillis(data.createdAt),
    updatedAtMs: toMillis(data.updatedAt),
  };
}

function enrollmentSessionStudentPayloadFromSnapshot(
  snap: FirebaseFirestore.DocumentSnapshot,
) {
  const data = snap.data() ?? {};
  const studentId = normalizeText(data.studentId) || snap.id;
  return {
    studentId,
    studentUid: normalizeText(data.studentUid) || studentId,
    schoolId: normalizeText(data.schoolId) || studentId,
    fullName:
      normalizeText(data.fullName) ||
      normalizeText(data.studentName) ||
      normalizeText(data.name) ||
      studentId,
    course: normalizeText(data.course) || "Unassigned",
    yearLevel: normalizeYear(data.yearLevel ?? data.year),
    status: normalizeEnrollmentStudentStatus(data.status),
    syncStatus: normalizeEnrollmentSyncStatus(data.syncStatus),
    fingerprintTemplateId: toPositiveNumber(
      data.fingerprintTemplateId ?? data.templateId,
    ),
    enrolledByDevice: normalizeText(data.enrolledByDevice),
    assignedDeviceId: normalizeText(data.assignedDeviceId),
    remarks: normalizeText(data.remarks),
  };
}

function canActorAccessEnrollmentSession(
  actor: EcActorContext,
  data: FirebaseFirestore.DocumentData,
): boolean {
  if (actor.isAdmin || actor.isRegularEc) {
    return true;
  }

  if (!actor.isBod || !actor.courseScope) {
    return false;
  }

  return enrollmentSessionCourseScope(data) === actor.courseScope;
}

async function assertNoActiveEnrollmentSessionConflicts(
  studentIds: string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(studentIds.map((id) => normalizeText(id)).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return;
  }

  for (let index = 0; index < uniqueIds.length; index += 10) {
    const chunk = uniqueIds.slice(index, index + 10);
    const sessionSnapshot = await db
      .collection("enrollmentSessions")
      .where("selectedStudentIds", "array-contains-any", chunk)
      .get();

    for (const docSnapshot of sessionSnapshot.docs) {
      const sessionData = docSnapshot.data() ?? {};
      const sessionStatus = normalizeEnrollmentSessionStatus(sessionData.status);
      if (sessionStatus === "completed" || sessionStatus === "closed") {
        continue;
      }

      const selectedStudentIds = normalizeIdentifierList(sessionData.selectedStudentIds);
      const hasOverlap = selectedStudentIds.some((studentId) => chunk.includes(studentId));
      if (hasOverlap) {
        throw new HttpsError(
          "already-exists",
          "One or more students are already included in an active fingerprint enrollment session.",
        );
      }
    }
  }
}

export const createCampusStudent = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);

    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const studentName = normalizeNamePart(body.studentName);
    const requestedCourse = normalizeCourseLabel(body.course) || normalizeText(body.course);
    const requestedYearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);
    const emailRaw = normalizeText(body.email);

    if (emailRaw && !isValidEmailAddress(emailRaw)) {
      throw new HttpsError(
        "invalid-argument",
        "Please provide a valid email address.",
      );
    }

    if (!schoolId) {
      throw new HttpsError("invalid-argument", "School ID is required.");
    }

    if (!studentName) {
      throw new HttpsError("invalid-argument", "Student name is required.");
    }

    if (!requestedCourse) {
      throw new HttpsError("invalid-argument", "Course is required.");
    }

    if (!requestedYearRaw) {
      throw new HttpsError("invalid-argument", "Year is required.");
    }

    if (actor.isBod) {
      ensureBodCourseScopeAccess(
        actor.profile,
        requestedCourse,
        "B.O.D. members can only manage students from their assigned course.",
      );
    }

    const course = actor.isBod ? actor.courseScope : requestedCourse;
    const email = emailRaw || `${schoolId}@campus.local`;

    let schoolIdReservation:
      | Awaited<ReturnType<typeof reserveUniqueStudentSchoolId>>
      | null = null;
    let createdUid: string | null = null;

    try {
      schoolIdReservation = await reserveUniqueStudentSchoolId(
        schoolId,
        "ec_create_student",
      );

      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;
      createdUid = uid;
      await schoolIdReservation.activate(uid);

      const timestamp = serverTimestamp();
      const createBatch = db.batch();
      createBatch.set(
        db.doc(`profiles/${uid}`),
        {
          schoolId,
          schoolIdKey,
          email,
          role: "student",
          studentName,
          name: studentName,
          fullName: studentName,
          course,
          year,
          yearLevel: year,
          readyForClearance: false,
          mustChangePassword: true,
          emailVerified: false,
          emailVerificationPending: false,
          pendingEmail: null,
          firstLoginCompleted: false,
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: true},
      );
      createBatch.set(
        db.doc(`students/${uid}`),
        {
          uid,
          studentId: uid,
          schoolId,
          schoolIdKey,
          studentName,
          name: studentName,
          fullName: studentName,
          course,
          year,
          yearLevel: year,
          readyForClearance: false,
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: true},
      );
      await createBatch.commit();

      await db.collection("logs").add({
        action: "create_campus_student",
        actorUid: actor.uid,
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: timestamp,
      }).catch((logError) => {
        authLogger.warn("createCampusStudent log write failed", {
          uid,
          schoolId,
          error: logError,
        });
      });

      return {uid};
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};
      if (createdUid) {
        await admin.auth().deleteUser(createdUid).catch(() => undefined);
      }
      if (schoolIdReservation) {
        await schoolIdReservation.release();
      }

      if (isHttpsErrorCode(error, "already-exists")) {
        throw schoolIdAlreadyExistsError(
          authError.message || "School ID already exists.",
        );
      }
      if (authError.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "Account already exists.");
      }

      throw new HttpsError(
        "internal",
        authError.message || "Failed to create student account.",
      );
    }
  });

export const updateCampusStudentProfile = onCall({region: REGION}, async (request) => {
    let actorUid = normalizeText(request.auth?.uid);
    let actorCourseScope = "";
    let targetUid = "";

    try {
      const actor = await resolveEcActorContext(request);
      actorUid = actor.uid || actorUid;
      actorCourseScope = actor.courseScope;

      const body = asRecord(request.data);
      const uid = normalizeText(body.uid);
      targetUid = uid;
      const submittedName = normalizeNamePart(body.name);
      const schoolId = normalizeText(body.schoolId);
      const requestedCourse =
        normalizeCourseLabel(body.course) || normalizeText(body.course);
      const requestedYear = normalizeText(body.yearLevel);

      if (!uid) {
        throw new HttpsError("invalid-argument", "uid is required.");
      }
      if (!submittedName) {
        throw new HttpsError("invalid-argument", "name is required.");
      }
      if (!schoolId) {
        throw new HttpsError("invalid-argument", "schoolId is required.");
      }

      const {profileData, studentData, profileExists, studentExists} =
        await readStudentSources(uid);
      if (!profileExists && !studentExists) {
        throw new HttpsError("not-found", "Student profile not found.");
      }

      const targetRole = normalizeText(profileData.role || studentData.role || "student");
      const targetHasStudentIdentity = hasStudentIdentityData({
        ...studentData,
        ...profileData,
      });
      if (!targetHasStudentIdentity) {
        throw new HttpsError(
          "permission-denied",
          "Only student and EC-member records can be updated here.",
        );
      }
      if (actor.isBod && !isStudentOnlyRole(targetRole)) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only update student records from their assigned course.",
        );
      }

      const currentCourse = resolveStudentCourse(profileData, studentData);
      if (actor.isBod) {
        if (!currentCourse || currentCourse !== actor.courseScope) {
          throw new HttpsError(
            "permission-denied",
            "B.O.D. members can only manage students from their assigned course.",
          );
        }

        if (requestedCourse && requestedCourse !== actor.courseScope) {
          throw new HttpsError(
            "permission-denied",
            "B.O.D. members can only manage students from their assigned course.",
          );
        }
      }

      const effectiveCourse = actor.isBod ?
        actor.courseScope :
        (requestedCourse || currentCourse);
      if (!effectiveCourse) {
        throw new HttpsError("invalid-argument", "Course is required.");
      }

      const currentYear = resolveStudentYearLevel(profileData, studentData);
      const effectiveYear = requestedYear ? normalizeYear(requestedYear) : currentYear;
      if (!effectiveYear || effectiveYear === "Unassigned") {
        throw new HttpsError("invalid-argument", "Year level is required.");
      }

      const previousSchoolId = resolveStudentSchoolId(uid, profileData, studentData);
      const previousSchoolIdKey = normalizeSchoolIdKey(previousSchoolId);
      const schoolIdKey = normalizeSchoolIdKey(schoolId);
      const timestamp = serverTimestamp();

      if (schoolIdKey !== previousSchoolIdKey) {
        const existingSchoolIdMatch = await findExistingStudentSchoolId(schoolId);
        if (
          existingSchoolIdMatch &&
          normalizeText(existingSchoolIdMatch.uid) !== uid
        ) {
          throw schoolIdAlreadyExistsError("School ID already exists.");
        }
      }

      const profilePatch: Record<string, unknown> = {
        schoolId,
        schoolIdKey,
        name: submittedName,
        fullName: submittedName,
        studentName: submittedName,
        isStudent: true,
        course: effectiveCourse,
        year: effectiveYear,
        yearLevel: effectiveYear,
        updatedAt: timestamp,
      };

      const studentPatch: Record<string, unknown> = {
        uid,
        studentId: uid,
        schoolId,
        schoolIdKey,
        role: targetRole,
        isStudent: true,
        name: submittedName,
        fullName: submittedName,
        studentName: submittedName,
        course: effectiveCourse,
        year: effectiveYear,
        yearLevel: effectiveYear,
        status:
          normalizeText(studentData.status) ||
          normalizeText(profileData.status) ||
          "Active",
        readyForClearance:
          studentData.readyForClearance === true ||
          profileData.readyForClearance === true,
        updatedAt: timestamp,
      };

      const updateBatch = db.batch();
      updateBatch.set(db.doc(`profiles/${uid}`), profilePatch, {merge: true});
      updateBatch.set(db.doc(`students/${uid}`), studentPatch, {merge: true});
      await updateBatch.commit();

      await syncStudentSchoolIdIndex(schoolId, schoolIdKey, uid, "profile").catch(
        (error) => {
          authLogger.warn("updateCampusStudentProfile school ID index sync failed", {
            actorUid,
            targetUid: uid,
            schoolId,
            error,
          });
        },
      );

      if (
        previousSchoolIdKey &&
        previousSchoolIdKey !== schoolIdKey
      ) {
        const previousIndexRef = studentSchoolIdIndexRef(previousSchoolIdKey);
        await previousIndexRef.get().then(async (snapshot) => {
          const indexedUid = normalizeText(snapshot.data()?.uid);
          if (snapshot.exists && indexedUid === uid) {
            await previousIndexRef.delete().catch((error) => {
              authLogger.warn("updateCampusStudentProfile previous school ID cleanup failed", {
                actorUid,
                targetUid: uid,
                previousSchoolId,
                error,
              });
            });
          }
        }).catch((error) => {
          authLogger.warn("updateCampusStudentProfile previous school ID lookup failed", {
            actorUid,
            targetUid: uid,
            previousSchoolId,
            error,
          });
        });
      }

      return {
        uid,
        schoolId,
        name: submittedName,
        course: effectiveCourse,
        yearLevel: effectiveYear,
      };
    } catch (error: unknown) {
      authLogger.error("updateCampusStudentProfile failed", {
        actorUid,
        actorCourseScope,
        targetUid,
        error,
      });

      const authError = error as {code?: string; message?: string};
      const errorCode = normalizeLower(authError.code);
      const errorMessage = authError.message || "Failed to update student profile.";

      if (error instanceof HttpsError) {
        throw error;
      }
      if (isHttpsErrorCode(error, "already-exists")) {
        throw schoolIdAlreadyExistsError(
          authError.message || "School ID already exists.",
        );
      }
      if (
        errorCode.includes("permission-denied") ||
        normalizeLower(errorMessage).includes("insufficient permissions")
      ) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only manage students from their assigned course.",
        );
      }

      throw new HttpsError("internal", errorMessage);
    }
  });

export const updateStudentAccountStatus = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);
    const statusRaw = normalizeLower(body.status);
    const nextStatus =
      statusRaw === "inactive" ? "Inactive" :
      statusRaw === "active" ? "Active" :
      "";

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid is required.");
    }
    if (!nextStatus) {
      throw new HttpsError("invalid-argument", "status must be Active or Inactive.");
    }

    const {profileData, studentData, profileExists, studentExists} = await readStudentSources(uid);
    if (!profileExists && !studentExists) {
      throw new HttpsError("not-found", "Student profile not found.");
    }

    const targetRole = normalizeText(profileData.role || studentData.role || "student");
    if (!hasStudentIdentityData({...studentData, ...profileData})) {
      throw new HttpsError(
        "permission-denied",
        "Only student and EC-member records can be updated here.",
      );
    }
    if (actor.isBod && !isStudentOnlyRole(targetRole)) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only update student records from their assigned course.",
      );
    }

    const targetCourse = resolveStudentCourse(profileData, studentData);
    if (actor.isBod && targetCourse !== actor.courseScope) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only manage students from their assigned course.",
      );
    }

    const schoolId = resolveStudentSchoolId(uid, profileData, studentData);
    const studentName = resolveStudentName(uid, profileData, studentData);
    const yearLevel = resolveStudentYearLevel(profileData, studentData) || "Unassigned";
    const timestamp = serverTimestamp();

    const updateBatch = db.batch();
    updateBatch.set(
      db.doc(`profiles/${uid}`),
      {
        status: nextStatus,
        isStudent: true,
        updatedAt: timestamp,
      },
      {merge: true},
    );
    updateBatch.set(
      db.doc(`students/${uid}`),
      {
        uid,
        studentId: uid,
        schoolId,
        role: targetRole,
        isStudent: true,
        studentName,
        name: studentName,
        fullName: studentName,
        course: targetCourse || normalizeText(profileData.course) || normalizeText(studentData.course) || "Unassigned",
        year: yearLevel,
        yearLevel,
        status: nextStatus,
        updatedAt: timestamp,
      },
      {merge: true},
    );
    await updateBatch.commit();

    let deletedRegistrationsCount = 0;
    if (nextStatus === "Inactive") {
      const registrationsSnapshot = await db
        .collectionGroup("registrations")
        .where("uid", "==", uid)
        .get();

      deletedRegistrationsCount = registrationsSnapshot.size;
      await Promise.all(
        registrationsSnapshot.docs.map((registrationDoc) => registrationDoc.ref.delete()),
      );
    }

    return {
      uid,
      status: nextStatus,
      deletedRegistrationsCount,
    };
  });

export const updateStudentClearanceStatus = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);
    const readyForClearance = body.readyForClearance === true;

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid is required.");
    }

    const {profileData, studentData, profileExists, studentExists} = await readStudentSources(uid);
    if (!profileExists && !studentExists) {
      throw new HttpsError("not-found", "Student profile not found.");
    }

    const targetRole = normalizeText(profileData.role || studentData.role || "student");
    if (!hasStudentIdentityData({...studentData, ...profileData})) {
      throw new HttpsError(
        "permission-denied",
        "Only student and EC-member records can be updated here.",
      );
    }
    if (actor.isBod && !isStudentOnlyRole(targetRole)) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only update student records from their assigned course.",
      );
    }

    const targetCourse = resolveStudentCourse(profileData, studentData);
    if (actor.isBod && targetCourse !== actor.courseScope) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only manage students from their assigned course.",
      );
    }

    const schoolId = resolveStudentSchoolId(uid, profileData, studentData);
    const studentName = resolveStudentName(uid, profileData, studentData);
    const yearLevel = resolveStudentYearLevel(profileData, studentData) || "Unassigned";
    const timestamp = serverTimestamp();

    const updateBatch = db.batch();
    updateBatch.set(
      db.doc(`profiles/${uid}`),
      {
        readyForClearance,
        isStudent: true,
        updatedAt: timestamp,
      },
      {merge: true},
    );
    updateBatch.set(
      db.doc(`students/${uid}`),
      {
        uid,
        studentId: uid,
        schoolId,
        role: targetRole,
        isStudent: true,
        studentName,
        name: studentName,
        fullName: studentName,
        course: targetCourse || normalizeText(profileData.course) || normalizeText(studentData.course) || "Unassigned",
        year: yearLevel,
        yearLevel,
        readyForClearance,
        updatedAt: timestamp,
      },
      {merge: true},
    );
    await updateBatch.commit();

    let notificationSent = false;
    if (readyForClearance) {
      await db
        .doc(`profiles/${uid}/notifications/clearance-ready-status`)
        .set(
          {
            title: "Clearance Ready",
            message: "You are now ready for clearance signing.",
            type: "announcement",
            createdAt: timestamp,
            date: "",
            scheduledTime: "",
            read: false,
            targetUid: uid,
          },
          {merge: true},
        );
      notificationSent = true;
    }

    return {
      uid,
      readyForClearance,
      notificationSent,
    };
  });

type CampusNotificationSummaryRecord = {
  dispatchId: string;
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
};

type CampusNotificationAudienceResolution = {
  audienceMode: CampusNotificationAudienceMode;
  sendToFilteredAudience: boolean;
  selectedYearLevels: string[];
  selectedYear: string;
  yearLevelLabel: string;
  selectedCourses: string[];
  targetStudentIds: string[];
  targetSchoolIds: string[];
  hasExplicitTargets: boolean;
  recipients: CampusNotificationRecipient[];
  recipientType: CampusNotificationRecipientType;
  courseValue: string;
  courseScope: string | null;
  courseScopeSlug: string | null;
  storedSelectedCourses: string[];
  storedTargetStudentIds: string[];
  storedTargetSchoolIds: string[];
  targetStudent: string;
};

function normalizeCampusNotificationDispatchIdValue(value: unknown): string {
  const rawValue = normalizeText(value);
  if (!rawValue) {
    return "";
  }

  const leafValue = rawValue.includes("/") ?
    rawValue.slice(rawValue.lastIndexOf("/") + 1) :
    rawValue;
  return leafValue.startsWith("dispatch_") ?
    normalizeText(leafValue.slice("dispatch_".length)) :
    leafValue;
}

function campusNotificationDocId(dispatchId: string): string {
  return dispatchId.startsWith("dispatch_") ? dispatchId : `dispatch_${dispatchId}`;
}

function campusNotificationSummaryDocId(dispatchId: string): string {
  return campusNotificationDocId(dispatchId);
}

function campusNotificationRecipientDocRef(
  uid: string,
  dispatchId: string,
): FirebaseFirestore.DocumentReference {
  return db.doc(`profiles/${uid}/notifications/${campusNotificationDocId(dispatchId)}`);
}

function campusNotificationOwnerType(
  data: FirebaseFirestore.DocumentData,
): "ec" | "bod" {
  return normalizeLower(data.ownerType) === "bod" ? "bod" : "ec";
}

function campusNotificationCreatedByUid(
  data: FirebaseFirestore.DocumentData,
): string {
  return normalizeText(data.createdByUid || data.createdBy);
}

function campusNotificationCreatedByCourseScope(
  data: FirebaseFirestore.DocumentData,
): string {
  return (
    normalizeCourseLabel(data.createdByCourseScope) ||
    normalizeCourseLabel(data.courseScope) ||
    ""
  );
}

function campusNotificationCourseScope(
  data: FirebaseFirestore.DocumentData,
): string {
  const selectedCourses = normalizeIdentifierList(data.selectedCourses)
    .map((value) => normalizeCourseLabel(value))
    .filter(Boolean);
  const courses = normalizeIdentifierList(data.courses)
    .map((value) => normalizeCourseLabel(value))
    .filter(Boolean);
  return (
    normalizeCourseLabel(data.courseScope) ||
    normalizeCourseLabel(data.course) ||
    selectedCourses[0] ||
    courses[0] ||
    ""
  );
}

function campusNotificationResolvedRecipientUids(
  data: FirebaseFirestore.DocumentData,
): string[] {
  return Array.from(
    new Set(
      normalizeIdentifierList(data.resolvedRecipientUids)
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

function campusNotificationResolvedRecipientSchoolIds(
  data: FirebaseFirestore.DocumentData,
): string[] {
  return Array.from(
    new Set(
      normalizeIdentifierList(data.resolvedRecipientSchoolIds)
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

async function loadCampusNotificationSenderSummary(
  actor: EcActorContext,
  body: Record<string, unknown>,
): Promise<CampusNotificationSummaryRecord> {
  const dispatchId = normalizeCampusNotificationDispatchIdValue(
    body.scheduledNotificationId || body.notificationId,
  );
  if (!dispatchId) {
    throw new HttpsError(
      "invalid-argument",
      "notificationId or scheduledNotificationId is required.",
    );
  }

  const notificationCollection = db
    .collection("profiles")
    .doc(actor.uid)
    .collection("notifications");
  const summaryDocId = campusNotificationSummaryDocId(dispatchId);
  const directSummaryRef = notificationCollection.doc(summaryDocId);
  const directSummarySnap = await directSummaryRef.get();
  if (directSummarySnap.exists) {
    return {
      dispatchId: normalizeText(directSummarySnap.data()?.dispatchId) || dispatchId,
      ref: directSummaryRef,
      data: directSummarySnap.data() ?? {},
    };
  }

  throw new HttpsError("not-found", "Notification record not found.");
}

function assertCanUpdateCampusNotification(
  actor: EcActorContext,
  summaryData: FirebaseFirestore.DocumentData,
): void {
  const ownerType = campusNotificationOwnerType(summaryData);
  const createdByUid = campusNotificationCreatedByUid(summaryData);
  const scopedCourse = campusNotificationCourseScope(summaryData);
  const createdByScope =
    campusNotificationCreatedByCourseScope(summaryData) || scopedCourse;

  if (actor.isBod) {
    if (
      !actor.courseScope ||
      ownerType !== "bod" ||
      createdByUid !== actor.uid ||
      scopedCourse !== actor.courseScope ||
      createdByScope !== actor.courseScope
    ) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only update their own course-scoped notifications.",
      );
    }
    return;
  }

  if (!actor.isAdmin && createdByUid && createdByUid !== actor.uid) {
    throw new HttpsError(
      "permission-denied",
      "You can only update notifications that you created.",
    );
  }
}

async function resolveCampusNotificationAudience(
  actor: EcActorContext,
  body: Record<string, unknown>,
): Promise<CampusNotificationAudienceResolution> {
  const selectedYearLevels = normalizeNotificationYearSelections(body);
  const requestedSelectedCourses = normalizeNotificationCourseSelections(body);
  const targetStudentIds = Array.from(
    new Set(
      normalizeIdentifierList(body.targetStudentIds)
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
  const targetSchoolIds = Array.from(
    new Set(
      normalizeIdentifierList(body.targetSchoolIds)
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
  const hasExplicitTargets =
    targetStudentIds.length > 0 || targetSchoolIds.length > 0;
  const audienceMode = normalizeNotificationAudienceMode(
    body.audienceMode,
    actor,
    hasExplicitTargets,
  );
  const sendToFilteredAudience =
    body.sendToFilteredAudience === true || audienceMode !== "explicit";
  const selectedCourses = actor.isBod ?
    [actor.courseScope] :
    requestedSelectedCourses;
  const requestedCourseScope =
    normalizeCourseLabel(body.courseScopeLabel) ||
    normalizeCourseLabel(body.courseScope) ||
    null;

  if (actor.isBod && requestedSelectedCourses.some((value) => value !== actor.courseScope)) {
    throw new HttpsError(
      "permission-denied",
      `B.O.D accounts can only target ${actor.courseScope} students.`,
    );
  }
  if (
    actor.isBod &&
    requestedCourseScope &&
    requestedCourseScope !== actor.courseScope
  ) {
    throw new HttpsError(
      "permission-denied",
      `B.O.D accounts can only target ${actor.courseScope} students.`,
    );
  }
  if (!hasExplicitTargets && !sendToFilteredAudience) {
    throw new HttpsError(
      "invalid-argument",
      "Choose at least one notification recipient.",
    );
  }

  const candidates = await listCampusNotificationRecipientCandidates(actor);
  const yearLevelLabel =
    selectedYearLevels.length > 0 ? selectedYearLevels.join(", ") : "All Years";
  const selectedYearSet = new Set(
    selectedYearLevels
      .map((value) => normalizeLower(normalizeYear(value)))
      .filter(Boolean),
  );
  const selectedCourseSet = new Set(
    selectedCourses
      .map((value) => normalizeCourseLabel(value))
      .filter(Boolean),
  );
  const eligibleAudience = candidates.filter((recipient) => {
    const yearMatches =
      selectedYearSet.size === 0 ||
      selectedYearSet.has(normalizeLower(normalizeYear(recipient.yearLevel)));
    const courseMatches =
      selectedCourseSet.size === 0 ||
      selectedCourseSet.has(normalizeCourseLabel(recipient.course));

    return yearMatches && courseMatches;
  });

  const explicitRecipients = hasExplicitTargets ?
    candidates.filter((recipient) =>
      targetStudentIds.includes(recipient.uid) ||
        targetSchoolIds.includes(recipient.schoolId),
    ) :
    [];

  if (hasExplicitTargets) {
    const explicitUidSet = new Set(
      explicitRecipients.map((recipient) => recipient.uid),
    );
    const explicitSchoolIdSet = new Set(
      explicitRecipients.map((recipient) => recipient.schoolId),
    );
    const hasMissingExplicitTargets =
      targetStudentIds.some((targetUid) => !explicitUidSet.has(targetUid)) ||
      targetSchoolIds.some((schoolId) => !explicitSchoolIdSet.has(schoolId));

    if (hasMissingExplicitTargets) {
      throw new HttpsError(
        "permission-denied",
        actor.isBod ?
          `Selected recipients must be active ${actor.courseScope} students.` :
          "Selected recipients must be active student accounts.",
      );
    }
  }

  const eligibleRecipientUidSet = new Set(
    eligibleAudience.map((recipient) => recipient.uid),
  );
  const recipients = hasExplicitTargets ?
    explicitRecipients.filter((recipient) =>
      eligibleRecipientUidSet.has(recipient.uid),
    ) :
    eligibleAudience;

  if (hasExplicitTargets && recipients.length !== explicitRecipients.length) {
    throw new HttpsError(
      "permission-denied",
      actor.isBod ?
        `Selected recipients must be active ${actor.courseScope} students that match the chosen year filter.` :
        "Selected recipients must match the chosen notification audience.",
    );
  }

  if (recipients.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      actor.isBod && actor.courseScope ?
        `No active ${actor.courseScope} students matched this notification audience.` :
        "No active students matched this notification audience.",
    );
  }

  const recipientType: CampusNotificationRecipientType =
    hasExplicitTargets ?
      "student" :
      selectedCourseSet.size > 0 ?
        "course" :
        selectedYearSet.size > 0 ?
          "year" :
          "all";
  const courseValue = actor.isBod ?
    actor.courseScope :
    selectedCourses.length > 0 ?
      selectedCourses.join(", ") :
      "All Courses";
  const courseScope = actor.isBod ?
    actor.courseScope :
    selectedCourses.length === 1 ?
      selectedCourses[0] :
      null;
  const courseScopeSlug = courseScope ?
    courseScopeSlugFromValue(courseScope) :
    null;
  const storedSelectedCourses = actor.isBod ? [actor.courseScope] : selectedCourses;
  const storedTargetStudentIds = hasExplicitTargets ?
    recipients.map((recipient) => recipient.uid) :
    [];
  const storedTargetSchoolIds = hasExplicitTargets ?
    recipients.map((recipient) => recipient.schoolId).filter(Boolean) :
    [];
  const selectedYear = yearLevelLabel;
  const targetStudent = buildCampusNotificationTargetLabel(
    recipients,
    hasExplicitTargets,
    courseValue,
    yearLevelLabel,
  );

  return {
    audienceMode,
    sendToFilteredAudience,
    selectedYearLevels,
    selectedYear,
    yearLevelLabel,
    selectedCourses,
    targetStudentIds,
    targetSchoolIds,
    hasExplicitTargets,
    recipients,
    recipientType,
    courseValue,
    courseScope,
    courseScopeSlug,
    storedSelectedCourses,
    storedTargetStudentIds,
    storedTargetSchoolIds,
    targetStudent,
  };
}

export const createCampusNotification = onCall({region: REGION}, async (request) => {
    try {
      const actor = await resolveEcActorContext(request);
      const body = asRecord(request.data);
      const title = normalizeText(body.title);
      const message = normalizeText(body.message);
      const date = normalizeText(body.date);
      const scheduledTime = normalizeText(body.scheduledTime);

      if (!title) {
        throw new HttpsError("invalid-argument", "Notification title is required.");
      }
      if (!message) {
        throw new HttpsError("invalid-argument", "Notification message is required.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new HttpsError("invalid-argument", "Notification date is required.");
      }
      if (!scheduledTime || parseEventStartMs(date, scheduledTime) === Number.MAX_SAFE_INTEGER) {
        throw new HttpsError(
          "invalid-argument",
          "A valid notification scheduled time is required.",
        );
      }
      const audience = await resolveCampusNotificationAudience(actor, body);

      const dispatchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createdByRole = actor.isBod ?
        "bod" :
        normalizeCampusRoleValue(actor.profile.role) || "ecmember";
      const ownerType = actor.isBod ? "bod" : "ec";
      const createdByCourseScope =
        actor.courseScope ||
        audience.courseScope ||
        null;
      const notificationStatus = computeCampusNotificationStatus(date, scheduledTime);
      const recipientNotificationDocId = campusNotificationDocId(dispatchId);
      const resolvedRecipientUids = audience.recipients.map((recipient) => recipient.uid);
      const resolvedRecipientSchoolIds = Array.from(
        new Set(
          audience.recipients
            .map((recipient) => normalizeText(recipient.schoolId))
            .filter(Boolean),
        ),
      );
      const recipientCount = audience.recipients.length;
      const writesPerBatch = 450;
      let batchCount = 0;

      functionsLogger.info("createCampusNotification resolved audience", {
        uid: actor.uid,
        actorRole: createdByRole,
        resolvedCourse: actor.courseScope || null,
        audienceMode: audience.audienceMode,
        selectedYear: audience.yearLevelLabel,
        selectedCourses: audience.selectedCourses,
        sendToFilteredAudience: audience.sendToFilteredAudience,
        explicitTargetStudentCount: audience.targetStudentIds.length,
        explicitTargetSchoolCount: audience.targetSchoolIds.length,
        recipientCount: audience.recipients.length,
        sampleRecipientRoles:
          audience.recipients.slice(0, 5).map((recipient) => recipient.role),
        sampleRecipientCourses:
          audience.recipients.slice(0, 5).map((recipient) => recipient.course),
      });

      for (
        let index = 0;
        index < audience.recipients.length;
        index += writesPerBatch
      ) {
        const batch = db.batch();
        const chunk = audience.recipients.slice(index, index + writesPerBatch);

        chunk.forEach((recipient) => {
          const notificationRef = campusNotificationRecipientDocRef(
            recipient.uid,
            dispatchId,
          );

          batch.set(notificationRef, {
            title,
            message,
            date,
            scheduledTime,
            type: "announcement",
            dispatchId,
            audienceMode: audience.audienceMode,
            recipientType: audience.recipientType,
            selectedYear: audience.selectedYear,
            course: audience.courseValue,
            yearLevel: audience.yearLevelLabel,
            targetStudent: audience.targetStudent,
            targetStudentId: audience.hasExplicitTargets ? recipient.uid : null,
            targetStudentIds: audience.storedTargetStudentIds,
            targetSchoolId: audience.hasExplicitTargets ? recipient.schoolId : null,
            targetSchoolIds: audience.storedTargetSchoolIds,
            selectedCourses: audience.storedSelectedCourses,
            courses: audience.storedSelectedCourses,
            yearLevels: audience.selectedYearLevels,
            sendToFilteredAudience: audience.sendToFilteredAudience,
            recipientUid: recipient.uid,
            studentUid: recipient.uid,
            studentName: recipient.studentName,
            schoolId: recipient.schoolId,
            createdByUid: actor.uid,
            createdByRole,
            ownerType,
            courseScope: audience.courseScope,
            courseScopeSlug: audience.courseScopeSlug,
            createdByCourseScope,
            recipientCount,
            status: notificationStatus,
            read: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
        batchCount += 1;
      }

      await db.doc(`profiles/${actor.uid}/notifications/dispatch_${dispatchId}`).set(
        {
          title,
          message,
          date,
          scheduledTime,
          type: "announcement",
          dispatchId,
          audienceMode: audience.audienceMode,
          recipientType: audience.recipientType,
          selectedYear: audience.selectedYear,
          course: audience.courseValue,
          yearLevel: audience.yearLevelLabel,
          targetStudent: audience.targetStudent,
          targetStudentIds: audience.storedTargetStudentIds,
          targetSchoolIds: audience.storedTargetSchoolIds,
          selectedCourses: audience.storedSelectedCourses,
          courses: audience.storedSelectedCourses,
          yearLevels: audience.selectedYearLevels,
          sendToFilteredAudience: audience.sendToFilteredAudience,
          recipientCount,
          resolvedRecipientUids,
          resolvedRecipientSchoolIds,
          recipientNotificationDocId,
          createdByUid: actor.uid,
          createdByRole,
          ownerType,
          courseScope: audience.courseScope,
          courseScopeSlug: audience.courseScopeSlug,
          createdByCourseScope,
          legacyRecipientCleanupSkipped: false,
          status: notificationStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          read: true,
        },
        {merge: true},
      );

      functionsLogger.info("createCampusNotification success", {
        uid: actor.uid,
        actorRole: createdByRole,
        resolvedCourse: actor.courseScope || null,
        selectedYear: audience.yearLevelLabel,
        selectedCourses: audience.selectedCourses,
        recipientCount,
        batchCount,
      });

      return {
        dispatchId,
        recipientCount,
        batchCount,
        audienceMode: audience.audienceMode,
        recipientType: audience.recipientType,
        selectedYear: audience.selectedYear,
        course: audience.courseValue,
        yearLevel: audience.yearLevelLabel,
        targetStudent: audience.targetStudent,
        selectedCourses: audience.storedSelectedCourses,
        courses: audience.storedSelectedCourses,
        yearLevels: audience.selectedYearLevels,
        targetStudentIds: audience.storedTargetStudentIds,
        targetSchoolIds: audience.storedTargetSchoolIds,
        sendToFilteredAudience: audience.sendToFilteredAudience,
        createdByRole,
        ownerType,
        courseScope: audience.courseScope,
        courseScopeSlug: audience.courseScopeSlug,
        createdByCourseScope,
        resolvedRecipientUids,
        resolvedRecipientSchoolIds,
        recipientNotificationDocId,
        legacyRecipientCleanupSkipped: false,
        status: notificationStatus,
      };
    } catch (error: unknown) {
      functionsLogger.error("createCampusNotification failed", {
        code: error instanceof HttpsError ? error.code : "unknown",
        message: error instanceof Error ? error.message : String(error ?? ""),
      });
      throw error;
    }
  });

export const updateCampusNotification = onCall({region: REGION}, async (request) => {
    let logDispatchId = "";
    let logSummaryPath = "";
    let logActorRole = "";
    let logActorCourseScope: string | null = null;

    try {
      const actor = await resolveEcActorContext(request);
      logActorRole = actor.isBod ?
        "bod" :
        normalizeCampusRoleValue(actor.profile.role) || "ecmember";
      logActorCourseScope = actor.courseScope || null;

      const body = asRecord(request.data);
      const title = normalizeText(body.title);
      const message = normalizeText(body.message);
      const date = normalizeText(body.date);
      const scheduledTime = normalizeText(body.scheduledTime);

      if (!title) {
        throw new HttpsError("invalid-argument", "Notification title is required.");
      }
      if (!message) {
        throw new HttpsError("invalid-argument", "Notification message is required.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new HttpsError("invalid-argument", "Notification date is required.");
      }
      if (
        !scheduledTime ||
        parseEventStartMs(date, scheduledTime) === Number.MAX_SAFE_INTEGER
      ) {
        throw new HttpsError(
          "invalid-argument",
          "A valid notification scheduled time is required.",
        );
      }

      const summary = await loadCampusNotificationSenderSummary(actor, body);
      logDispatchId = summary.dispatchId;
      logSummaryPath = summary.ref.path;
      assertCanUpdateCampusNotification(actor, summary.data);

      const audience = await resolveCampusNotificationAudience(actor, body);
      const dispatchId = summary.dispatchId;
      const recipientNotificationDocId = campusNotificationDocId(dispatchId);
      const ownerType = actor.isBod ?
        "bod" :
        campusNotificationOwnerType(summary.data);
      const createdByUid =
        campusNotificationCreatedByUid(summary.data) || actor.uid;
      const createdByRole = actor.isBod ?
        "bod" :
        normalizeCampusRoleValue(summary.data.createdByRole) ||
          normalizeCampusRoleValue(actor.profile.role) ||
          "ecmember";
      const createdByCourseScope = actor.isBod ?
        actor.courseScope :
        campusNotificationCreatedByCourseScope(summary.data) ||
          audience.courseScope ||
          null;
      const notificationStatus = computeCampusNotificationStatus(date, scheduledTime);
      const writesPerBatch = 450;
      const recipientCount = audience.recipients.length;
      const nextRecipientUids = Array.from(
        new Set(audience.recipients.map((recipient) => recipient.uid)),
      );
      const nextRecipientUidSet = new Set(nextRecipientUids);
      const resolvedRecipientSchoolIds = Array.from(
        new Set(
          audience.recipients
            .map((recipient) => normalizeText(recipient.schoolId))
            .filter(Boolean),
        ),
      );
      const storedResolvedRecipientUids =
        campusNotificationResolvedRecipientUids(summary.data);
      const storedExplicitTargetStudentIds = Array.from(
        new Set(
          normalizeIdentifierList(summary.data.targetStudentIds)
            .map((value) => normalizeText(value))
            .filter(Boolean),
        ),
      );
      const previousRecipientUids = storedResolvedRecipientUids.length > 0 ?
        storedResolvedRecipientUids :
        storedExplicitTargetStudentIds;
      const removedRecipientUids = previousRecipientUids.filter(
        (uid) => !nextRecipientUidSet.has(uid),
      );
      const storedRecipientNotificationDocId = normalizeText(
        summary.data.recipientNotificationDocId,
      );
      const storedLegacyRecipientCleanupSkipped =
        summary.data.legacyRecipientCleanupSkipped === true;
      const hasStoredResolvedRecipients =
        storedResolvedRecipientUids.length > 0 ||
        campusNotificationResolvedRecipientSchoolIds(summary.data).length > 0;
      const legacyRecipientCleanupSkipped =
        storedLegacyRecipientCleanupSkipped ||
        storedRecipientNotificationDocId !== recipientNotificationDocId ||
        !hasStoredResolvedRecipients;

      const recipientRefs = audience.recipients.map((recipient) =>
        campusNotificationRecipientDocRef(recipient.uid, dispatchId),
      );
      const existingRecipientRefPaths = new Set<string>();

      for (
        let index = 0;
        index < recipientRefs.length;
        index += writesPerBatch
      ) {
        const snapshots = await db.getAll(
          ...recipientRefs.slice(index, index + writesPerBatch),
        );
        snapshots.forEach((snapshot) => {
          if (snapshot.exists) {
            existingRecipientRefPaths.add(snapshot.ref.path);
          }
        });
      }

      functionsLogger.info("updateCampusNotification recipient diff", {
        uid: actor.uid,
        dispatchId,
        summaryPath: summary.ref.path,
        previousRecipientCount: previousRecipientUids.length,
        nextRecipientCount: nextRecipientUids.length,
        removedRecipientCount: removedRecipientUids.length,
        actorRole: createdByRole,
        actorCourseScope: actor.courseScope || null,
        legacyRecipientCleanupSkipped,
      });

      const senderPayload = {
        title,
        message,
        date,
        scheduledTime,
        type: "announcement",
        dispatchId,
        audienceMode: audience.audienceMode,
        recipientType: audience.recipientType,
        selectedYear: audience.selectedYear,
        course: audience.courseValue,
        yearLevel: audience.yearLevelLabel,
        targetStudent: audience.targetStudent,
        targetStudentIds: audience.storedTargetStudentIds,
        targetSchoolIds: audience.storedTargetSchoolIds,
        selectedCourses: audience.storedSelectedCourses,
        courses: audience.storedSelectedCourses,
        yearLevels: audience.selectedYearLevels,
        sendToFilteredAudience: audience.sendToFilteredAudience,
        recipientCount,
        resolvedRecipientUids: nextRecipientUids,
        resolvedRecipientSchoolIds,
        recipientNotificationDocId,
        createdByUid,
        createdByRole,
        ownerType,
        courseScope: audience.courseScope,
        courseScopeSlug: audience.courseScopeSlug,
        createdByCourseScope,
        legacyRecipientCleanupSkipped,
        status: notificationStatus,
        read: true,
        updatedAt: serverTimestamp(),
      };

      const upsertOperations: Array<{
        ref: FirebaseFirestore.DocumentReference;
        data: FirebaseFirestore.DocumentData;
      }> = [
        {
          ref: summary.ref,
          data: senderPayload,
        },
      ];

      audience.recipients.forEach((recipient) => {
        const recipientRef = campusNotificationRecipientDocRef(
          recipient.uid,
          dispatchId,
        );
        const recipientPayload: FirebaseFirestore.DocumentData = {
          title,
          message,
          date,
          scheduledTime,
          type: "announcement",
          dispatchId,
          audienceMode: audience.audienceMode,
          recipientType: audience.recipientType,
          selectedYear: audience.selectedYear,
          course: audience.courseValue,
          yearLevel: audience.yearLevelLabel,
          targetStudent: audience.targetStudent,
          targetStudentId: audience.hasExplicitTargets ? recipient.uid : null,
          targetStudentIds: audience.storedTargetStudentIds,
          targetSchoolId: audience.hasExplicitTargets ? recipient.schoolId : null,
          targetSchoolIds: audience.storedTargetSchoolIds,
          selectedCourses: audience.storedSelectedCourses,
          courses: audience.storedSelectedCourses,
          yearLevels: audience.selectedYearLevels,
          sendToFilteredAudience: audience.sendToFilteredAudience,
          recipientUid: recipient.uid,
          studentUid: recipient.uid,
          studentName: recipient.studentName,
          schoolId: recipient.schoolId,
          createdByUid,
          createdByRole,
          ownerType,
          courseScope: audience.courseScope,
          courseScopeSlug: audience.courseScopeSlug,
          createdByCourseScope,
          recipientCount,
          status: notificationStatus,
          updatedAt: serverTimestamp(),
        };

        if (!existingRecipientRefPaths.has(recipientRef.path)) {
          recipientPayload.createdAt = serverTimestamp();
          recipientPayload.read = false;
        }

        upsertOperations.push({
          ref: recipientRef,
          data: recipientPayload,
        });
      });

      let batchCount = 0;

      for (
        let index = 0;
        index < upsertOperations.length;
        index += writesPerBatch
      ) {
        const batch = db.batch();
        upsertOperations
          .slice(index, index + writesPerBatch)
          .forEach((operation) => {
            batch.set(operation.ref, operation.data, {merge: true});
          });
        await batch.commit();
        batchCount += 1;
      }

      const docsToDelete = removedRecipientUids.map((uid) =>
        campusNotificationRecipientDocRef(uid, dispatchId),
      );
      for (let index = 0; index < docsToDelete.length; index += writesPerBatch) {
        const batch = db.batch();
        docsToDelete
          .slice(index, index + writesPerBatch)
          .forEach((documentRef) => batch.delete(documentRef));
        await batch.commit();
        batchCount += 1;
      }

      functionsLogger.info("updateCampusNotification success", {
        uid: actor.uid,
        dispatchId,
        summaryPath: summary.ref.path,
        actorRole: createdByRole,
        actorCourseScope: actor.courseScope || null,
        ownerType,
        audienceMode: audience.audienceMode,
        selectedYear: audience.yearLevelLabel,
        selectedCourses: audience.selectedCourses,
        previousRecipientCount: previousRecipientUids.length,
        nextRecipientCount: nextRecipientUids.length,
        removedRecipientCount: removedRecipientUids.length,
        batchCount,
        legacyRecipientCleanupSkipped,
      });

      return {
        updated: true,
        dispatchId,
        updatedRecipientCount: recipientCount,
        removedRecipientCount: removedRecipientUids.length,
        batchCount,
        audienceMode: audience.audienceMode,
        recipientType: audience.recipientType,
        selectedYear: audience.selectedYear,
        course: audience.courseValue,
        yearLevel: audience.yearLevelLabel,
        targetStudent: audience.targetStudent,
        selectedCourses: audience.storedSelectedCourses,
        courses: audience.storedSelectedCourses,
        yearLevels: audience.selectedYearLevels,
        targetStudentIds: audience.storedTargetStudentIds,
        targetSchoolIds: audience.storedTargetSchoolIds,
        sendToFilteredAudience: audience.sendToFilteredAudience,
        createdByRole,
        ownerType,
        courseScope: audience.courseScope,
        courseScopeSlug: audience.courseScopeSlug,
        createdByCourseScope,
        resolvedRecipientUids: nextRecipientUids,
        resolvedRecipientSchoolIds,
        recipientNotificationDocId,
        legacyRecipientCleanupSkipped,
        status: notificationStatus,
      };
    } catch (error: unknown) {
      functionsLogger.error("updateCampusNotification failed", {
        dispatchId: logDispatchId,
        summaryPath: logSummaryPath,
        actorRole: logActorRole,
        actorCourseScope: logActorCourseScope,
        code: error instanceof HttpsError ? error.code : "unknown",
        message: error instanceof Error ? error.message : String(error ?? ""),
      });
      throw error;
    }
  });

export const listCampusDocuments = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const documentSnapshot = await db
      .collection("ecDocuments")
      .orderBy("createdAt", "desc")
      .get();

    return {
      documents: documentSnapshot.docs
        .map((documentDoc) => ({id: documentDoc.id, data: documentDoc.data() ?? {}}))
        .filter(({data}) => canEcActorViewActiveDocument(actor, data))
        .map(({id, data}) => toCampusDocumentListItem(id, data)),
    };
  });

export const createCampusDocumentUploadTarget = onCall({region: REGION}, async (request) => {
    try {
      const actor = await resolveEcActorContext(request);
      const body = asRecord(request.data);
      const uploadInput = validateCampusDocumentUploadInput(body);
      const docId = db.collection("ecDocuments").doc().id;
      const uploadTarget = campusDocumentStoragePathForActor(
        actor,
        docId,
        uploadInput.fileName,
      );
      const timestamp = serverTimestamp();
      const documentRef = db.doc(`ecDocuments/${docId}`);
      const pendingMetadata = {
        name: uploadInput.fileName,
        originalName: uploadInput.displayName,
        fileName: uploadInput.fileName,
        type: uploadInput.type,
        category: uploadInput.category,
        contentType: uploadInput.contentType,
        sizeBytes: uploadInput.sizeBytes,
        downloadURL: "",
        status: "pending-upload",
        storagePath: uploadTarget.storagePath,
        uploadedBy: actor.uid,
        uploadedByUid: actor.uid,
        ownerUid: actor.uid,
        createdBy: actor.uid,
        createdByUid: actor.uid,
        createdByRole: normalizeCampusRoleValue(actor.profile.role) || null,
        createdByPosition: normalizeECPosition(actor.profile.ecPosition) || null,
        ecScope: resolveProfileEcScope(actor.profile) || null,
        ownerType: uploadTarget.ownerType,
        course: uploadTarget.course,
        courseScope: uploadTarget.courseScope,
        courseScopeSlug: uploadTarget.courseScopeSlug,
        createdByCourseScope: uploadTarget.createdByCourseScope,
        courses: uploadTarget.courses,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      functionsLogger.info("createCampusDocumentUploadTarget resolved actor", {
        callerUid: actor.uid,
        actorRole: normalizeCampusRoleValue(actor.profile.role),
        actorAssignedCourse: normalizeText(actor.profile.assignedCourse),
        actorCourse: normalizeText(actor.profile.course),
        actorCourseScope: normalizeText(actor.profile.courseScope),
        actorCourseScopeLabel: normalizeText(actor.profile.courseScopeLabel),
        resolvedCourseScope: actor.courseScope,
        resolvedCourseScopeSlug: uploadTarget.courseScopeSlug,
        generatedDocId: docId,
        generatedStoragePath: uploadTarget.storagePath,
      });

      functionsLogger.info("createCampusDocumentUploadTarget pending metadata payload", {
        callerUid: actor.uid,
        docId,
        pendingMetadata,
      });

      await documentRef.set(pendingMetadata);

      const verificationSnapshot = await documentRef.get();
      if (!verificationSnapshot.exists) {
        functionsLogger.error("createCampusDocumentUploadTarget pending metadata missing after write", {
          callerUid: actor.uid,
          docId,
          storagePath: uploadTarget.storagePath,
        });
        throw new HttpsError(
          "internal",
          "Upload target metadata was not created. Please try again.",
        );
      }

      functionsLogger.info("createCampusDocumentUploadTarget pending metadata write success", {
        callerUid: actor.uid,
        docId,
        storagePath: uploadTarget.storagePath,
        verifiedData: verificationSnapshot.data() ?? {},
      });

      let uploadUrl: string | null = null;
      let uploadMethod: CampusDocumentUploadMethod = "firebase-storage-sdk";
      let verification = "server-verified-pending-metadata";

      if (actor.isBod) {
        uploadMethod = "PUT";
        verification = "server-signed-upload-url";
        uploadUrl = (
          await admin
            .storage()
            .bucket()
            .file(uploadTarget.storagePath)
            .getSignedUrl({
              action: "write",
              contentType: uploadInput.contentType,
              expires: Date.now() + CAMPUS_DOCUMENT_SIGNED_UPLOAD_TTL_MS,
              version: "v4",
            })
        )[0];

        functionsLogger.info("createCampusDocumentUploadTarget signed upload URL created", {
          callerUid: actor.uid,
          docId,
          storagePath: uploadTarget.storagePath,
          contentType: uploadInput.contentType,
          uploadMethod,
          verification,
        });
      }

      return {
        docId,
        fileName: uploadInput.fileName,
        storagePath: uploadTarget.storagePath,
        ownerType: uploadTarget.ownerType,
        courseScope: uploadTarget.courseScope,
        courseScopeSlug: uploadTarget.courseScopeSlug,
        uploadUrl,
        uploadMethod,
        contentType: uploadInput.contentType,
        verification,
        status: "pending-upload",
      };
    } catch (error) {
      functionsLogger.error("createCampusDocumentUploadTarget failed", {
        error,
      });
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError(
        "internal",
        error instanceof Error ?
          error.message :
          "Failed to create a document upload target.",
      );
    }
  });

export const finalizeCampusDocumentUpload = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const docId = normalizeText(body.docId);
    const storagePath = normalizeText(body.storagePath);
    const uploadInput = validateCampusDocumentUploadInput(body);

    if (!docId) {
      throw new HttpsError("invalid-argument", "docId is required.");
    }
    if (!storagePath) {
      throw new HttpsError("invalid-argument", "storagePath is required.");
    }

    const documentRef = db.doc(`ecDocuments/${docId}`);
    const documentSnapshot = await documentRef.get();
    if (!documentSnapshot.exists) {
      throw new HttpsError("not-found", "Pending document metadata not found.");
    }

    const documentData = documentSnapshot.data() ?? {};
    if (!ecDocumentMatchesStoragePath(documentData, storagePath)) {
      throw new HttpsError(
        "permission-denied",
        "The upload target does not match this document metadata.",
      );
    }
    if (!ecDocumentOwnedByUid(documentData, actor.uid)) {
      throw new HttpsError(
        "permission-denied",
        "You can only finalize document uploads that you created.",
      );
    }
    if (actor.isBod && !canEcActorAccessDocument(actor, documentData)) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only finalize their own course documents.",
      );
    }
    if (!isPendingCampusDocument(documentData)) {
      throw new HttpsError(
        "failed-precondition",
        "This document upload is no longer pending.",
      );
    }

    const storageFile = admin.storage().bucket().file(storagePath);
    let storageMetadata: {size?: string | number; contentType?: string};
    try {
      [storageMetadata] = await storageFile.getMetadata();
    } catch (error) {
      authLogger.warn("finalizeCampusDocumentUpload storage lookup failed", {
        actorUid: actor.uid,
        docId,
        storagePath,
        error,
      });
      throw new HttpsError(
        "failed-precondition",
        "The uploaded file could not be found in Storage.",
      );
    }

    await documentRef.set(
      {
        name: uploadInput.displayName,
        fileName: uploadInput.fileName,
        type: uploadInput.type,
        category: uploadInput.category,
        contentType:
          normalizeText(storageMetadata.contentType) ||
          uploadInput.contentType,
        sizeBytes: Number(storageMetadata.size ?? uploadInput.sizeBytes),
        downloadURL: normalizeText(body.downloadURL),
        status: "active",
        storagePath,
        updatedAt: serverTimestamp(),
        uploadedAt: serverTimestamp(),
      },
      {merge: true},
    );

    const updatedSnapshot = await documentRef.get();
    const updatedData = updatedSnapshot.data() ?? {};

    return {
      docId,
      ownerType: ecDocumentOwnerType(updatedData),
      courseScope: ecDocumentCourseScope(updatedData) || null,
      storagePath: ecDocumentStoragePath(updatedData),
      status: normalizeCampusDocumentStatus(updatedData.status),
    };
  });

export const createCampusDocumentMetadata = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);

    const docId = normalizeText(body.docId) || db.collection("ecDocuments").doc().id;
    const name = normalizeText(body.name);
    const type = normalizeText(body.type) || "PDF";
    const category = normalizeText(body.category) || "General";
    const sizeBytes = Number(body.sizeBytes);
    const storagePath = normalizeText(body.storagePath);
    const downloadURL = normalizeText(body.downloadURL);

    if (!name) {
      throw new HttpsError("invalid-argument", "name is required.");
    }
    if (!storagePath) {
      throw new HttpsError("invalid-argument", "storagePath is required.");
    }
    if (!downloadURL) {
      throw new HttpsError("invalid-argument", "downloadURL is required.");
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new HttpsError("invalid-argument", "sizeBytes must be a positive number.");
    }
    if (
      !storagePath.startsWith("documents/") &&
      !storagePath.startsWith("ec-documents/")
    ) {
      throw new HttpsError(
        "invalid-argument",
        "storagePath must be under documents/ or ec-documents/.",
      );
    }

    const documentRef = db.doc(`ecDocuments/${docId}`);
    const documentSnapshot = await documentRef.get();
    if (documentSnapshot.exists) {
      throw new HttpsError(
        "already-exists",
        "Document metadata already exists for this file.",
      );
    }

    let ownerType: "ec" | "bod" = "ec";
    let courseScope: string | null = null;
    let courseScopeSlug: string | null = null;
    let createdByCourseScope: string | null = null;
    let courses: string[] = [];
    let course: string | null = null;
    const createdByPosition = normalizeECPosition(actor.profile.ecPosition) || null;
    const storagePathSegments = storagePath.split("/").filter(Boolean);
    const pathCourseSlug =
      storagePathSegments.length >= 3 &&
      (storagePathSegments[0] === "documents" || storagePathSegments[0] === "ec-documents") &&
      storagePathSegments[1] === "course" ?
        storagePathSegments[2] :
        "";
    const normalizedPathCourse = normalizeCourseLabel(pathCourseSlug);

    if (actor.isBod) {
      ownerType = "bod";
      courseScope = actor.courseScope;
      courseScopeSlug = courseScopeSlugFromValue(actor.courseScope) || null;
      createdByCourseScope = actor.courseScope;
      course = actor.courseScope;
      courses = [actor.courseScope];

      const allowedPrefixes = allowedDocumentStoragePrefixesForActor(actor);
      console.info("[DOCUMENT][BOD]", {
        uid: actor.uid,
        role: normalizeCampusRoleValue(actor.profile.role),
        profileCourseRaw: normalizeText(actor.profile.course),
        profileCourseScopeRaw: normalizeText(actor.profile.courseScope),
        profileAssignedCourseRaw: normalizeText(actor.profile.assignedCourse),
        bodScopeCanonical: actor.courseScope,
        category,
        storagePath,
        pathCourseSlug,
        normalizedPathCourse,
        allowedPrefixes,
        ownerType,
        metadataCourse: course,
        metadataCourseScope: courseScope,
      });
      if (!courseScopeSlug || pathCourseSlug !== courseScopeSlug) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only upload documents inside their assigned course scope.",
        );
      }
      if (!allowedPrefixes.some((prefix) => storagePath.startsWith(prefix))) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only upload documents inside their assigned course scope.",
        );
      }
    }

    await documentRef.set(
      {
        name,
        fileName: name,
        type,
        category,
        sizeBytes,
        downloadURL,
        storagePath,
        uploadedBy: actor.uid,
        uploadedByUid: actor.uid,
        ownerUid: actor.uid,
        createdBy: actor.uid,
        createdByUid: actor.uid,
        createdByRole: normalizeCampusRoleValue(actor.profile.role) || null,
        createdByPosition,
        ecScope: resolveProfileEcScope(actor.profile) || null,
        ownerType,
        course,
        courseScope,
        courseScopeSlug,
        createdByCourseScope,
        courses,
        createdAt: serverTimestamp(),
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );

    return {
      docId,
      ownerType,
      courseScope,
    };
  });

export const getCampusDocumentDownloadUrl = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const docId = normalizeText(body.docId);

    if (!docId) {
      throw new HttpsError("invalid-argument", "docId is required.");
    }

    const documentRef = db.doc(`ecDocuments/${docId}`);
    const documentSnapshot = await documentRef.get();
    if (!documentSnapshot.exists) {
      throw new HttpsError("not-found", "Document metadata not found.");
    }

    const documentData = documentSnapshot.data() ?? {};
    if (!canEcActorViewActiveDocument(actor, documentData)) {
      throw new HttpsError(
        "permission-denied",
        actor.isBod ?
          "B.O.D. members can only download their own course documents." :
          "You do not have permission to download this document.",
      );
    }

    const name = normalizeText(documentData.name) || "download";
    const storagePath = normalizeText(documentData.storagePath);
    const fallbackDownloadUrl = normalizeText(documentData.downloadURL);

    if (!storagePath && !fallbackDownloadUrl) {
      throw new HttpsError("not-found", "Document file not found.");
    }

    try {
      const downloadUrl = storagePath ?
        (
          await admin
            .storage()
            .bucket()
            .file(storagePath)
            .getSignedUrl({
              action: "read",
              expires: Date.now() + 5 * 60 * 1000,
              version: "v4",
            })
        )[0] :
        fallbackDownloadUrl;

      if (!downloadUrl) {
        throw new HttpsError("not-found", "Document file not found.");
      }

      return {
        docId,
        name,
        downloadUrl,
      };
    } catch (error) {
      authLogger.error("getCampusDocumentDownloadUrl failed", {
        docId,
        actorUid: actor.uid,
        storagePath,
        error,
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      if (fallbackDownloadUrl) {
        return {
          docId,
          name,
          downloadUrl: fallbackDownloadUrl,
        };
      }

      throw new HttpsError(
        "internal",
        "Failed to prepare the document download.",
      );
    }
  });

export const deleteCampusDocument = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const docId = normalizeText(body.docId);

    if (!docId) {
      throw new HttpsError("invalid-argument", "docId is required.");
    }

    const documentRef = db.doc(`ecDocuments/${docId}`);
    const documentSnapshot = await documentRef.get();
    if (!documentSnapshot.exists) {
      throw new HttpsError("not-found", "Document metadata not found.");
    }

    const documentData = documentSnapshot.data() ?? {};

    if (actor.isBod && !canEcActorAccessDocument(actor, documentData)) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only delete their own course documents.",
      );
    }

    const storagePath = normalizeText(documentData.storagePath);
    if (storagePath) {
      try {
        await admin.storage().bucket().file(storagePath).delete({ignoreNotFound: true});
      } catch (error: unknown) {
        const storageErrorCode = Number((error as {code?: unknown}).code);
        if (storageErrorCode !== 404) {
          throw new HttpsError(
            "internal",
            "Failed to delete the document file from storage.",
          );
        }
      }
    }

    await documentRef.delete();
    return {
      docId,
      deleted: true,
    };
  });

export const deleteCampusEvent = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const eventId = normalizeText(body.eventId);

    if (!eventId) {
      throw new HttpsError("invalid-argument", "eventId is required.");
    }

    const eventRef = db.doc(`events/${eventId}`);
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) {
      throw new HttpsError("not-found", "Event not found.");
    }

    const eventData = eventSnapshot.data() ?? {};
    const ownerType = eventOwnerType(eventData);
    const scopedCourse = eventCourseScope(eventData);
    const createdByUid = eventCreatedByUid(eventData);
    const createdByCourseScope =
      normalizeCourseLabel(eventData.createdByCourseScope) || scopedCourse;

    if (actor.isBod) {
      if (
        ownerType !== "bod" ||
        !actor.courseScope ||
        createdByUid !== actor.uid ||
        scopedCourse !== actor.courseScope ||
        createdByCourseScope !== actor.courseScope
      ) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only delete their own B.O.D.-created events.",
        );
      }
    }

    const [imagesSnapshot, docsSnapshot, attendanceSnapshot, registrationsSnapshot] =
      await Promise.all([
        eventRef.collection("images").get(),
        eventRef.collection("docs").get(),
        eventRef.collection("attendance").get(),
        eventRef.collection("registrations").get(),
      ]);

    const storagePaths = [...imagesSnapshot.docs, ...docsSnapshot.docs]
      .map((fileSnapshot) =>
        normalizeText(fileSnapshot.data()?.path || fileSnapshot.data()?.storagePath),
      )
      .filter(Boolean);

    let linkedPaymentDeleted = false;
    const linkedPaymentId =
      normalizeText(eventData.linkedPaymentId) ||
      normalizeText(eventData.requiredPaymentId);

    if (actor.isBod && actor.courseScope && linkedPaymentId) {
      const paymentRef = db.doc(`payments/${linkedPaymentId}`);
      const paymentSnapshot = await paymentRef.get();

      if (paymentSnapshot.exists) {
        const paymentData = paymentSnapshot.data() ?? {};
        const paymentOwner = paymentOwnerType(paymentData);
        const paymentScopedCourse = paymentCourseScope(paymentData);
        const paymentCourse = paymentCourseValue(paymentData);
        const paymentCreatedByScope =
          paymentCreatedByCourseScope(paymentData) || paymentScopedCourse;
        const paymentCreatedBy = paymentCreatedByUid(paymentData);
        const isLegacyBodPayment =
          paymentCreatedBy === actor.uid &&
          paymentScopedCourse === actor.courseScope &&
          paymentCreatedByScope === actor.courseScope &&
          paymentCourse === actor.courseScope;

        if (paymentOwner === "bod" || isLegacyBodPayment) {
          const paymentStudentsSnapshot = await paymentRef.collection("students").get();
          await deleteSnapshotDocumentsInBatches(paymentStudentsSnapshot);
          await paymentRef.delete();
          linkedPaymentDeleted = true;
        }
      }
    }

    await deleteStoragePaths(storagePaths);
    await deleteSnapshotDocumentsInBatches(imagesSnapshot);
    await deleteSnapshotDocumentsInBatches(docsSnapshot);
    await deleteSnapshotDocumentsInBatches(attendanceSnapshot);
    await deleteSnapshotDocumentsInBatches(registrationsSnapshot);
    await eventRef.delete();

    return {
      deleted: true,
      eventId,
      linkedPaymentDeleted,
    };
  });

export const createCampusPayment = onCall({region: REGION}, async (request) => {
    let logPaymentId = "";
    let logActorUid = "";
    let logActorRole = "";
    let logResolvedCourse: string | null = null;
    let logSelectedYear = "";
    let logSelectedCourse = "";
    let logTargetCount = 0;
    let logBatchCount = 0;

    try {
      const actor = await resolveEcActorContext(request);
      const body = asRecord(request.data);
      const title = normalizeText(body.title);
      const amount = Number(body.amount);
      const date = normalizeText(body.date);
      const details = normalizeText(body.details);

      logActorUid = actor.uid;
      logActorRole = actor.isBod ?
        "bod" :
        normalizeCampusRoleValue(actor.profile.role) || "ecmember";
      logResolvedCourse = actor.courseScope || null;

      if (!title) {
        throw new HttpsError("invalid-argument", "Payment title is required.");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpsError("invalid-argument", "Amount must be greater than 0.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new HttpsError("invalid-argument", "Payment date is required.");
      }

      const audience = await resolveCampusPaymentAudience(actor, body);
      const paymentRef = db.collection("payments").doc();
      const paymentId = paymentRef.id;
      const paymentRefCode = makePaymentRef(paymentId);
      const ownerType = actor.isBod ? "bod" : "ec";
      const createdByUid = actor.uid;
      const createdByRole = actor.isBod ?
        "bod" :
        normalizeCampusRoleValue(actor.profile.role) || "ecmember";
      const createdByCourseScope = actor.isBod ?
        actor.courseScope :
        audience.courseScope;
      const course = actor.isBod ? actor.courseScope : audience.course;
      const courseScope = actor.isBod ? actor.courseScope : audience.courseScope;
      const targetCourses = actor.isBod ?
        [actor.courseScope] :
        audience.targetCourses;

      logPaymentId = paymentId;
      logSelectedYear = audience.selectedYear;
      logSelectedCourse = audience.selectedCourse;
      logTargetCount = audience.targets.length;

      functionsLogger.info("createCampusPayment start", {
        callerUid: actor.uid,
        callerRole: createdByRole,
        resolvedCourse: actor.courseScope || null,
        paymentId,
        mode: "create",
        selectedYear: audience.selectedYear,
        selectedCourse: audience.selectedCourse,
        targetCount: audience.targets.length,
      });

      let assignmentSummary: Awaited<ReturnType<typeof syncCampusPaymentAssignments>>;
      try {
        assignmentSummary = await syncCampusPaymentAssignments(
          paymentId,
          audience.targets,
          new Map(),
        );
        logBatchCount = assignmentSummary.batchCount;

        await paymentRef.set(
          {
            title,
            ref: paymentRefCode,
            amount,
            date,
            yearLevel: audience.yearLevel,
            course,
            targetStudent: audience.targetStudent,
            targetCourses,
            targetYearLevels: audience.targetYearLevels,
            details,
            linkedEventId: null,
            linkedEventTitle: "",
            source: "manual",
            status: "active",
            ownerType,
            createdByUid,
            createdByRole,
            createdByPosition: normalizeECPosition(actor.profile.ecPosition) || null,
            createdByCourseScope,
            courseScope,
            totalStudents: assignmentSummary.totalStudents,
            paidCount: assignmentSummary.paidCount,
            unpaidCount: assignmentSummary.unpaidCount,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          {merge: true},
        );
      } catch (error: unknown) {
        try {
          const orphanAssignmentsSnapshot = await paymentRef.collection("students").get();
          await deleteSnapshotDocumentsInBatches(orphanAssignmentsSnapshot, 450);
          await paymentRef.delete();
        } catch (rollbackError: unknown) {
          functionsLogger.error("createCampusPayment rollback failed", {
            callerUid: actor.uid,
            paymentId,
            rollbackMessage:
              rollbackError instanceof Error ?
                rollbackError.message :
                String(rollbackError ?? ""),
          });
        }

        throw error;
      }

      functionsLogger.info("createCampusPayment success", {
        callerUid: actor.uid,
        callerRole: createdByRole,
        resolvedCourse: actor.courseScope || null,
        paymentId,
        mode: "create",
        selectedYear: audience.selectedYear,
        selectedCourse: audience.selectedCourse,
        targetCount: audience.targets.length,
        batchCount: assignmentSummary.batchCount,
        removedAssignmentCount: assignmentSummary.removedAssignmentCount,
      });

      return {
        paymentId,
        ref: paymentRefCode,
        totalStudents: assignmentSummary.totalStudents,
        paidCount: assignmentSummary.paidCount,
        unpaidCount: assignmentSummary.unpaidCount,
      };
    } catch (error: unknown) {
      functionsLogger.error("createCampusPayment failed", {
        callerUid: logActorUid,
        callerRole: logActorRole,
        resolvedCourse: logResolvedCourse,
        paymentId: logPaymentId,
        mode: "create",
        selectedYear: logSelectedYear,
        selectedCourse: logSelectedCourse,
        targetCount: logTargetCount,
        batchCount: logBatchCount,
        removedAssignmentCount: 0,
        code: error instanceof HttpsError ? error.code : "unknown",
        message: error instanceof Error ? error.message : String(error ?? ""),
      });
      throw error;
    }
  });

export const updateCampusPayment = onCall({region: REGION}, async (request) => {
    let logPaymentId = "";
    let logActorUid = "";
    let logActorRole = "";
    let logResolvedCourse: string | null = null;
    let logSelectedYear = "";
    let logSelectedCourse = "";
    let logTargetCount = 0;
    let logBatchCount = 0;
    let logRemovedAssignmentCount = 0;

    try {
      const actor = await resolveEcActorContext(request);
      const body = asRecord(request.data);
      const paymentId = normalizeText(body.paymentId);
      const title = normalizeText(body.title);
      const amount = Number(body.amount);
      const date = normalizeText(body.date);
      const details = normalizeText(body.details);

      logActorUid = actor.uid;
      logActorRole = actor.isBod ?
        "bod" :
        normalizeCampusRoleValue(actor.profile.role) || "ecmember";
      logResolvedCourse = actor.courseScope || null;
      logPaymentId = paymentId;

      if (!paymentId) {
        throw new HttpsError("invalid-argument", "paymentId is required.");
      }
      if (!title) {
        throw new HttpsError("invalid-argument", "Payment title is required.");
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpsError("invalid-argument", "Amount must be greater than 0.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new HttpsError("invalid-argument", "Payment date is required.");
      }

      const paymentRef = db.doc(`payments/${paymentId}`);
      const paymentSnapshot = await paymentRef.get();
      if (!paymentSnapshot.exists) {
        throw new HttpsError("not-found", "Payment not found.");
      }

      const paymentData = paymentSnapshot.data() ?? {};
      if (normalizeLower(paymentData.status) === "archived") {
        throw new HttpsError(
          "failed-precondition",
          "Archived payments can no longer be updated.",
        );
      }

      const ownerType = paymentOwnerType(paymentData);
      const scopedCourse = paymentCourseScope(paymentData);
      const paymentCourse = paymentCourseValue(paymentData);
      const createdByScope =
        paymentCreatedByCourseScope(paymentData) || scopedCourse;
      const createdByUid = paymentCreatedByUid(paymentData);

      if (actor.isBod) {
        if (
          ownerType !== "bod" ||
          !actor.courseScope ||
          createdByUid !== actor.uid ||
          scopedCourse !== actor.courseScope ||
          createdByScope !== actor.courseScope ||
          paymentCourse !== actor.courseScope
        ) {
          throw new HttpsError(
            "permission-denied",
            "B.O.D. members can only update their own course-scoped payments.",
          );
        }
      }

      const existingAssignments = await loadCampusPaymentAssignments(paymentRef);
      const linkedEventId = paymentLinkedEventId(paymentData);
      const requestedSelectedStudentIds = toUniqueIdentifierList(body.selectedStudentIds);
      const requestedSelectedSchoolIds = toUniqueIdentifierList(body.selectedSchoolIds);
      const preserveExistingAudience =
        Boolean(linkedEventId) &&
        requestedSelectedStudentIds.length === 0 &&
        requestedSelectedSchoolIds.length === 0;

      let audience: CampusPaymentAudienceResolution;
      if (preserveExistingAudience) {
        const targets = Array.from(existingAssignments.values())
          .map((assignment) => ({
            uid: assignment.uid,
            schoolId: assignment.schoolId,
            studentName: assignment.studentName,
            course: assignment.course,
            yearLevel: assignment.yearLevel,
          }))
          .sort((left, right) => {
            const bySchoolId = left.schoolId.localeCompare(right.schoolId);
            if (bySchoolId !== 0) {
              return bySchoolId;
            }
            return left.studentName.localeCompare(right.studentName);
          });

        if (targets.length === 0) {
          throw new HttpsError(
            "failed-precondition",
            "This linked payment no longer has any assigned students.",
          );
        }

        audience = {
          targets,
          targetStudent: normalizeText(paymentData.targetStudent),
          course: actor.isBod ?
            actor.courseScope :
            paymentCourseValue(paymentData) ||
              normalizeText(paymentData.course) ||
              "All Courses",
          yearLevel: normalizeText(paymentData.yearLevel) || "All Years",
          targetCourses: actor.isBod ?
            [actor.courseScope] :
            paymentTargetCourses(paymentData).length > 0 ?
              paymentTargetCourses(paymentData) :
              Array.from(new Set(
                targets
                  .map((target) => normalizeCourseLabel(target.course))
                  .filter(Boolean),
              )),
          targetYearLevels:
            paymentTargetYearLevels(paymentData).length > 0 ?
              paymentTargetYearLevels(paymentData) :
              Array.from(new Set(
                targets
                  .map((target) => normalizeYear(target.yearLevel))
                  .filter(
                    (value) =>
                      Boolean(value) &&
                      value !== "Unassigned" &&
                      normalizeLower(value) !== "all years",
                  ),
              )),
          courseScope: actor.isBod ?
            actor.courseScope :
            paymentCourseScope(paymentData) || null,
          selectedCourse: actor.isBod ?
            actor.courseScope :
            paymentCourseValue(paymentData) ||
              normalizeText(paymentData.course) ||
              "All Courses",
          selectedYear: normalizeText(paymentData.yearLevel) || "All Years",
          selectedStudentIds: [],
          selectedSchoolIds: [],
          hasExplicitTargets: false,
        };
      } else {
        audience = await resolveCampusPaymentAudience(actor, body);
      }

      const nextOwnerType = actor.isBod ? "bod" : ownerType;
      const nextCreatedByUid = actor.isBod ? actor.uid : createdByUid || actor.uid;
      const nextCreatedByRole = actor.isBod ?
        "bod" :
        normalizeText(paymentData.createdByRole) ||
          normalizeCampusRoleValue(actor.profile.role) ||
          "ecmember";
      const nextCreatedByCourseScope = actor.isBod ?
        actor.courseScope :
        paymentCreatedByCourseScope(paymentData) || audience.courseScope;
      const nextCourse = actor.isBod ? actor.courseScope : audience.course;
      const nextCourseScope = actor.isBod ? actor.courseScope : audience.courseScope;
      const nextTargetCourses = actor.isBod ?
        [actor.courseScope] :
        audience.targetCourses;

      logSelectedYear = audience.selectedYear;
      logSelectedCourse = audience.selectedCourse;
      logTargetCount = audience.targets.length;

      functionsLogger.info("updateCampusPayment start", {
        callerUid: actor.uid,
        callerRole: nextCreatedByRole,
        resolvedCourse: actor.courseScope || null,
        paymentId,
        mode: "update",
        selectedYear: audience.selectedYear,
        selectedCourse: audience.selectedCourse,
        targetCount: audience.targets.length,
        preserveExistingAudience,
      });

      const assignmentSummary = await syncCampusPaymentAssignments(
        paymentId,
        audience.targets,
        existingAssignments,
      );
      logBatchCount = assignmentSummary.batchCount;
      logRemovedAssignmentCount = assignmentSummary.removedAssignmentCount;

      await paymentRef.set(
        {
          title,
          ref: normalizeText(paymentData.ref) || makePaymentRef(paymentId),
          amount,
          date,
          yearLevel: preserveExistingAudience ?
            (normalizeText(paymentData.yearLevel) || audience.yearLevel) :
            (normalizeText(body.yearLevel) || audience.yearLevel),
          course: nextCourse,
          targetStudent: preserveExistingAudience ?
            normalizeText(paymentData.targetStudent) :
            audience.targetStudent,
          targetCourses: nextTargetCourses,
          targetYearLevels: audience.targetYearLevels,
          details,
          linkedEventId: paymentLinkedEventId(paymentData) || null,
          eventId: normalizeText(paymentData.eventId) || null,
          linkedEventTitle: normalizeText(paymentData.linkedEventTitle),
          source: normalizeText(paymentData.source) || "manual",
          status: normalizeText(paymentData.status) || "active",
          ownerType: nextOwnerType,
          createdByUid: nextCreatedByUid,
          createdByRole: nextCreatedByRole,
          createdByPosition:
            normalizeText(paymentData.createdByPosition) ||
            normalizeECPosition(actor.profile.ecPosition) ||
            null,
          createdByCourseScope: nextCreatedByCourseScope,
          courseScope: nextCourseScope,
          totalStudents: assignmentSummary.totalStudents,
          paidCount: assignmentSummary.paidCount,
          unpaidCount: assignmentSummary.unpaidCount,
          updatedAt: serverTimestamp(),
        },
        {merge: true},
      );

      functionsLogger.info("updateCampusPayment success", {
        callerUid: actor.uid,
        callerRole: nextCreatedByRole,
        resolvedCourse: actor.courseScope || null,
        paymentId,
        mode: "update",
        selectedYear: audience.selectedYear,
        selectedCourse: audience.selectedCourse,
        targetCount: audience.targets.length,
        batchCount: assignmentSummary.batchCount,
        removedAssignmentCount: assignmentSummary.removedAssignmentCount,
        preserveExistingAudience,
      });

      return {
        paymentId,
        updated: true,
        totalStudents: assignmentSummary.totalStudents,
        paidCount: assignmentSummary.paidCount,
        unpaidCount: assignmentSummary.unpaidCount,
      };
    } catch (error: unknown) {
      functionsLogger.error("updateCampusPayment failed", {
        callerUid: logActorUid,
        callerRole: logActorRole,
        resolvedCourse: logResolvedCourse,
        paymentId: logPaymentId,
        mode: "update",
        selectedYear: logSelectedYear,
        selectedCourse: logSelectedCourse,
        targetCount: logTargetCount,
        batchCount: logBatchCount,
        removedAssignmentCount: logRemovedAssignmentCount,
        code: error instanceof HttpsError ? error.code : "unknown",
        message: error instanceof Error ? error.message : String(error ?? ""),
      });
      throw error;
    }
  });

export const deleteCampusPayment = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const paymentId = normalizeText(body.paymentId);

    if (!paymentId) {
      throw new HttpsError("invalid-argument", "paymentId is required.");
    }

    const paymentRef = db.doc(`payments/${paymentId}`);
    const paymentSnapshot = await paymentRef.get();
    if (!paymentSnapshot.exists) {
      throw new HttpsError("not-found", "Payment not found.");
    }

    const paymentData = paymentSnapshot.data() ?? {};
    const ownerType = paymentOwnerType(paymentData);
    const scopedCourse = paymentCourseScope(paymentData);
    const paymentCourse = paymentCourseValue(paymentData);
    const createdByScope =
      paymentCreatedByCourseScope(paymentData) || scopedCourse;
    const createdByUid = paymentCreatedByUid(paymentData);

    if (actor.isBod) {
      const isLegacyBodPayment =
        createdByUid === actor.uid &&
        scopedCourse === actor.courseScope &&
        createdByScope === actor.courseScope &&
        paymentCourse === actor.courseScope;

      if (
        !actor.courseScope ||
        createdByUid !== actor.uid ||
        scopedCourse !== actor.courseScope ||
        createdByScope !== actor.courseScope ||
        paymentCourse !== actor.courseScope ||
        (ownerType !== "bod" && !isLegacyBodPayment)
      ) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only delete their own course-scoped payments.",
        );
      }
    }

    const linkedEventId =
      normalizeText(paymentData.linkedEventId) ||
      normalizeText(paymentData.eventId);
    let linkedEventUpdated = false;

    if (linkedEventId) {
      const eventRef = db.doc(`events/${linkedEventId}`);
      const eventSnapshot = await eventRef.get();

      if (eventSnapshot.exists) {
        const eventData = eventSnapshot.data() ?? {};
        const canUpdateLinkedEvent =
          actor.isAdmin ||
          actor.isRegularEc ||
          (
            actor.isBod &&
            Boolean(actor.courseScope) &&
            eventOwnerType(eventData) === "bod" &&
            eventCreatedByUid(eventData) === actor.uid &&
            eventCourseScope(eventData) === actor.courseScope &&
            (
              normalizeCourseLabel(eventData.createdByCourseScope) ||
              eventCourseScope(eventData)
            ) === actor.courseScope
          );

        if (canUpdateLinkedEvent) {
          await eventRef.set(
            {
              withPayment: false,
              paymentRequired: false,
              requiredPaymentId: "",
              linkedPaymentId: null,
              updatedAt: serverTimestamp(),
            },
            {merge: true},
          );
          linkedEventUpdated = true;
        }
      }
    }

    const paymentStudentsSnapshot = await paymentRef.collection("students").get();
    await deleteSnapshotDocumentsInBatches(paymentStudentsSnapshot);
    await paymentRef.delete();

    return {
      deleted: true,
      paymentId,
      linkedEventUpdated,
    };
  });

export const listCampusPayments = onCall({region: REGION}, async (request) => {
    try {
      const actor = await resolveEcActorContext(request);

      const toPaymentPayload = (
        paymentId: string,
        data: FirebaseFirestore.DocumentData,
        counts?: {
          total: number;
          paidCount: number;
          unpaidCount: number;
        } | null,
      ) => ({
        id: paymentId,
        title: normalizeText(data.title) || "Untitled Payment",
        ref: normalizeText(data.ref) || makePaymentRef(paymentId),
        amount: Number(data.amount ?? 0),
        date: normalizeText(data.date),
        yearLevel: normalizeText(data.yearLevel) || "All Years",
        course:
          paymentCourseValue(data) ||
          normalizeText(data.course) ||
          "All Courses",
        targetStudent: normalizeText(data.targetStudent),
        targetCourses: paymentTargetCourses(data),
        details: normalizeText(data.details),
        totalStudents: counts?.total ?? Number(data.totalStudents ?? 0),
        paidCount: counts?.paidCount ?? Number(data.paidCount ?? 0),
        unpaidCount: counts?.unpaidCount ?? Number(data.unpaidCount ?? 0),
        linkedEventId: normalizeText(data.linkedEventId || data.eventId),
        linkedEventTitle: normalizeText(data.linkedEventTitle),
        source: normalizeText(data.source),
        status: normalizeText(data.status),
        ownerType: paymentOwnerType(data),
        createdByUid: paymentCreatedByUid(data),
        createdByRole: normalizeText(data.createdByRole),
        createdByCourseScope: paymentCreatedByCourseScope(data) || null,
        courseScope: paymentCourseScope(data) || null,
        createdAt: toMillis(data.createdAt),
      });

      if (actor.isAdmin || actor.isRegularEc) {
        const paymentSnapshot = await db
          .collection("payments")
          .orderBy("createdAt", "desc")
          .get();

        return {
          payments: paymentSnapshot.docs
            .map((paymentDoc) => {
              const paymentData = paymentDoc.data() ?? {};
              if (normalizeLower(paymentData.status) === "archived") {
                return null;
              }

              return toPaymentPayload(paymentDoc.id, paymentData, null);
            })
            .filter(Boolean),
        };
      }

      const actorCourseScope = actor.courseScope;
      const actorCourseScopeValues = courseScopeQueryValues(actorCourseScope);
      const candidatePayments = new Map<
        string,
        FirebaseFirestore.DocumentData
      >();

      const addPaymentCandidates = (
        snapshot: FirebaseFirestore.QuerySnapshot,
      ) => {
        snapshot.docs.forEach((paymentDoc) => {
          candidatePayments.set(paymentDoc.id, paymentDoc.data() ?? {});
        });
      };

      const runScopedPaymentQuery = async (
        queryName: string,
        buildQuery: () => FirebaseFirestore.Query,
      ) => {
        try {
          console.info("[PAYMENT][BOD][QUERY][START]", {
            uid: actor.uid,
            actorCourseScope,
            actorCourseScopeValues,
            queryName,
          });
          const snapshot = await buildQuery().get();
          console.info("[PAYMENT][BOD][QUERY][OK]", {
            uid: actor.uid,
            actorCourseScope,
            actorCourseScopeValues,
            queryName,
            resultCount: snapshot.size,
          });
          addPaymentCandidates(snapshot);
        } catch (error: unknown) {
          console.error("[PAYMENT][BOD][QUERY][FAIL]", {
            uid: actor.uid,
            actorCourseScope,
            actorCourseScopeValues,
            queryName,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorCode:
              error instanceof HttpsError ?
                error.code :
                normalizeText((error as {code?: unknown})?.code),
          });

          if (error instanceof HttpsError) {
            throw error;
          }

          throw new HttpsError(
            "internal",
            `B.O.D payment query failed (${queryName}).`,
          );
        }
      };

      console.info("[PAYMENT][BOD]", {
        uid: actor.uid,
        role: normalizeCampusRoleValue(actor.profile.role),
        profileCourseRaw: normalizeText(actor.profile.course),
        profileCourseScopeRaw: normalizeText(actor.profile.courseScope),
        profileAssignedCourseRaw: normalizeText(actor.profile.assignedCourse),
        bodScopeCanonical: actorCourseScope,
        actorCourseScopeValues,
      });

      if (actor.uid) {
        await runScopedPaymentQuery("createdByUid == actor.uid", () =>
          db.collection("payments").where("createdByUid", "==", actor.uid),
        );
        await runScopedPaymentQuery("createdBy == actor.uid", () =>
          db.collection("payments").where("createdBy", "==", actor.uid),
        );
      }
      if (actorCourseScopeValues.length > 0) {
        await runScopedPaymentQuery("courseScope in actor scope variants", () =>
          db.collection("payments").where("courseScope", "in", actorCourseScopeValues),
        );
        await runScopedPaymentQuery("createdByCourseScope in actor scope variants", () =>
          db.collection("payments").where("createdByCourseScope", "in", actorCourseScopeValues),
        );
        await runScopedPaymentQuery("course in actor scope variants", () =>
          db.collection("payments").where("course", "in", actorCourseScopeValues),
        );
        await runScopedPaymentQuery("targetCourses array-contains-any actor scope variants", () =>
          db.collection("payments").where("targetCourses", "array-contains-any", actorCourseScopeValues),
        );
      }

      const payments = [] as ReturnType<typeof toPaymentPayload>[];

      for (const [paymentId, paymentData] of candidatePayments.entries()) {
        if (normalizeLower(paymentData.status) === "archived") {
          continue;
        }

        const ownerType = paymentOwnerType(paymentData);
        const createdByUid = paymentCreatedByUid(paymentData);
        const scopedCourse = paymentCourseScope(paymentData);
        const createdByScope =
          paymentCreatedByCourseScope(paymentData) || scopedCourse;
        const paymentCourse = paymentCourseValue(paymentData);
        const isOwnBodPayment =
          ownerType === "bod" &&
          createdByUid === actor.uid &&
          scopedCourse === actorCourseScope &&
          createdByScope === actorCourseScope &&
          paymentCourse === actorCourseScope;

        if (isOwnBodPayment) {
          payments.push(toPaymentPayload(paymentId, paymentData, null));
          continue;
        }

        if (ownerType === "bod") {
          continue;
        }

        let matchesActorScope = paymentMatchesCourseScope(
          paymentData,
          actorCourseScope,
        );
        if (!matchesActorScope && actorCourseScopeValues.length > 0) {
          try {
            matchesActorScope = await paymentStudentCourseMatchExists(
              paymentId,
              actorCourseScopeValues,
            );
          } catch (error: unknown) {
            console.error("[PAYMENT][BOD][QUERY][FAIL]", {
              uid: actor.uid,
              actorCourseScope,
              actorCourseScopeValues,
              queryName: `payments/${paymentId}/students course in actor scope variants`,
              errorMessage: error instanceof Error ? error.message : String(error),
              errorCode:
                error instanceof HttpsError ?
                  error.code :
                  normalizeText((error as {code?: unknown})?.code),
            });

            if (error instanceof HttpsError) {
              throw error;
            }

            throw new HttpsError(
              "internal",
              `B.O.D payment student-scope query failed (${paymentId}).`,
            );
          }
        }

        if (matchesActorScope) {
          payments.push(toPaymentPayload(paymentId, paymentData, null));
        }
      }

      payments.sort(
        (left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
      );

      return {payments};
    } catch (error: unknown) {
      console.error("[PAYMENT][LIST] failed", {
        uid: normalizeText(request.auth?.uid),
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode:
          error instanceof HttpsError ?
            error.code :
            normalizeText((error as {code?: unknown})?.code),
      });
      if (error instanceof HttpsError) {
        throw error;
      }

      const rawCode = normalizeLower((error as {code?: unknown})?.code);
      const rawMessage =
        normalizeText((error as {message?: unknown})?.message) ||
        "Failed to list payments.";
      if (
        rawCode.includes("failed-precondition") ||
        rawMessage.toLowerCase().includes("index")
      ) {
        throw new HttpsError("failed-precondition", rawMessage);
      }

      throw new HttpsError("internal", rawMessage);
    }
  });

export const listStudentPayments = onCall({region: REGION}, async (request) => {
    let currentStage = "resolve caller";
    let callerUid = normalizeText(request.auth?.uid);
    let callerRole = "";
    let callerSchoolId = "";
    let callerSchoolIdKey = "";
    let collectionGroupCandidateCount = 0;
    let linkedEventPaymentCount = 0;

    const logStageFailure = (
      stage: string,
      error: unknown,
      extra: Record<string, unknown> = {},
    ) => {
      functionsLogger.error("listStudentPayments stage failed", {
        stage,
        callerUid,
        callerSchoolId,
        callerSchoolIdKey,
        callerRole,
        errorMessage: error instanceof Error ? error.message : String(error ?? ""),
        errorStack: error instanceof Error ? error.stack : null,
        ...extra,
      });
    };

    try {
      const actor = await resolveStudentPortalActorContext(request);
      callerUid = actor.uid;
      callerRole = actor.role;
      callerSchoolId = actor.schoolId;
      callerSchoolIdKey = actor.schoolIdKey;

      functionsLogger.info("listStudentPayments resolved actor", {
        callerUid: actor.uid,
        callerRole: actor.role,
        callerCourse: actor.course,
        callerYearLevel: actor.yearLevel,
        callerSchoolId: actor.schoolId,
        callerSchoolIdKey: actor.schoolIdKey,
        callerIsBod: actor.isBod,
      });

      const assignmentByPaymentId = new Map<
        string,
        StudentPaymentAssignmentCandidate
      >();
      const candidatePaymentIds = new Set<string>();

      const registerAssignmentCandidate = (
        paymentId: string,
        docId: string,
        data: FirebaseFirestore.DocumentData,
        source: string,
      ) => {
        const normalizedPaymentId = normalizeText(paymentId);
        if (!normalizedPaymentId) {
          return;
        }

        if (!assignmentBelongsToCaller(data, docId, actor)) {
          return;
        }

        const nextCandidate = {
          paymentId: normalizedPaymentId,
          docId,
          data,
          source,
        } satisfies StudentPaymentAssignmentCandidate;
        const existingCandidate = assignmentByPaymentId.get(normalizedPaymentId);
        if (existingCandidate) {
          const existingScore = assignmentCandidateScore(
            existingCandidate.data,
            existingCandidate.docId,
            actor,
          );
          const nextScore = assignmentCandidateScore(data, docId, actor);
          if (existingScore >= nextScore) {
            candidatePaymentIds.add(normalizedPaymentId);
            return;
          }
        }

        assignmentByPaymentId.set(normalizedPaymentId, nextCandidate);
        candidatePaymentIds.add(normalizedPaymentId);
      };

      const runAssignmentQuery = async (
        queryName: string,
        fieldName: string,
        fieldValue: string,
      ) => {
        if (!fieldValue) {
          return;
        }

        try {
          currentStage = `collectionGroup query ${queryName}`;
          const assignmentSnapshot = await db
            .collectionGroup("students")
            .where(fieldName, "==", fieldValue)
            .get();

          collectionGroupCandidateCount += assignmentSnapshot.size;
          assignmentSnapshot.docs.forEach((assignmentDoc) => {
            const paymentRef = assignmentDoc.ref.parent.parent;
            if (!paymentRef || paymentRef.parent.id !== "payments") {
              return;
            }

            registerAssignmentCandidate(
              paymentRef.id,
              assignmentDoc.id,
              assignmentDoc.data() ?? {},
              queryName,
            );
          });
        } catch (error: unknown) {
          logStageFailure(`collectionGroup query ${queryName}`, error, {
            fieldName,
          });
        }
      };

      currentStage = "collectionGroup assignment queries";
      await runAssignmentQuery("uid == caller.uid", "uid", actor.uid);
      await runAssignmentQuery("studentUid == caller.uid", "studentUid", actor.uid);
      await runAssignmentQuery("schoolId == caller.schoolId", "schoolId", actor.schoolId);
      await runAssignmentQuery(
        "schoolIdKey == caller.schoolIdKey",
        "schoolIdKey",
        actor.schoolIdKey,
      );
      await runAssignmentQuery(
        "studentId == caller.schoolId",
        "studentId",
        actor.schoolId,
      );

      try {
        currentStage = "visible linked-payment fallback";
        const eventSnapshot = await db.collection("events").get();
        eventSnapshot.docs.forEach((eventDoc) => {
          const eventData = eventDoc.data() ?? {};
          if (!studentCanViewEventPaymentFallback(actor, eventData)) {
            return;
          }

          const linkedPaymentId =
            normalizeText(eventData.linkedPaymentId) ||
            normalizeText(eventData.requiredPaymentId);
          if (!linkedPaymentId) {
            return;
          }

          linkedEventPaymentCount += 1;
          candidatePaymentIds.add(linkedPaymentId);
        });
      } catch (error: unknown) {
        logStageFailure("visible linked-payment fallback", error);
      }

      const toPaymentDateMs = (date: string, fallbackMs: number) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const parsed = Date.parse(`${date}T00:00:00+08:00`);
          if (!Number.isNaN(parsed)) {
            return parsed;
          }
        }

        const parsed = Date.parse(date);
        return Number.isNaN(parsed) ? fallbackMs : parsed;
      };

      const loadAssignmentForPayment = async (
        paymentId: string,
      ): Promise<StudentPaymentAssignmentCandidate | null> => {
        const existingCandidate = assignmentByPaymentId.get(paymentId);
        if (existingCandidate) {
          return existingCandidate;
        }

        const paymentRef = db.doc(`payments/${paymentId}`);

        try {
          currentStage = `direct assignment doc ${paymentId}`;
          const directAssignmentSnapshot = await paymentRef
            .collection("students")
            .doc(actor.uid)
            .get();
          if (directAssignmentSnapshot.exists) {
            registerAssignmentCandidate(
              paymentId,
              directAssignmentSnapshot.id,
              directAssignmentSnapshot.data() ?? {},
              "payments/{paymentId}/students/{caller.uid}",
            );
          }
        } catch (error: unknown) {
          logStageFailure(`direct assignment doc ${paymentId}`, error, {
            paymentId,
          });
        }

        if (assignmentByPaymentId.has(paymentId)) {
          return assignmentByPaymentId.get(paymentId) ?? null;
        }

        const fallbackFieldQueries = [
          {
            queryName: "payment student schoolId == caller.schoolId",
            fieldName: "schoolId",
            fieldValue: actor.schoolId,
          },
          {
            queryName: "payment student schoolIdKey == caller.schoolIdKey",
            fieldName: "schoolIdKey",
            fieldValue: actor.schoolIdKey,
          },
          {
            queryName: "payment student studentId == caller.schoolId",
            fieldName: "studentId",
            fieldValue: actor.schoolId,
          },
        ];

        for (const fallbackQuery of fallbackFieldQueries) {
          if (!fallbackQuery.fieldValue) {
            continue;
          }

          try {
            currentStage = `${fallbackQuery.queryName} (${paymentId})`;
            const assignmentSnapshot = await paymentRef
              .collection("students")
              .where(fallbackQuery.fieldName, "==", fallbackQuery.fieldValue)
              .limit(5)
              .get();

            assignmentSnapshot.docs.forEach((assignmentDoc) => {
              registerAssignmentCandidate(
                paymentId,
                assignmentDoc.id,
                assignmentDoc.data() ?? {},
                fallbackQuery.queryName,
              );
            });
          } catch (error: unknown) {
            logStageFailure(`${fallbackQuery.queryName} (${paymentId})`, error, {
              paymentId,
              fieldName: fallbackQuery.fieldName,
            });
          }

          if (assignmentByPaymentId.has(paymentId)) {
            return assignmentByPaymentId.get(paymentId) ?? null;
          }
        }

        return assignmentByPaymentId.get(paymentId) ?? null;
      };

      if (candidatePaymentIds.size === 0) {
        functionsLogger.info("listStudentPayments completed", {
          callerUid: actor.uid,
          callerRole: actor.role,
          callerSchoolId: actor.schoolId,
          callerSchoolIdKey: actor.schoolIdKey,
          collectionGroupCandidateCount,
          linkedEventPaymentCount,
          matchedPaymentCount: 0,
        });
        return {payments: []};
      }

      currentStage = "build payment rows";
      const payments: StudentPaymentListRow[] = [];
      for (const paymentId of candidatePaymentIds) {
        try {
          const paymentSnapshot = await db.doc(`payments/${paymentId}`).get();
          if (!paymentSnapshot.exists) {
            continue;
          }

          const paymentData = paymentSnapshot.data() ?? {};
          if (normalizeLower(paymentData.status) === "archived") {
            continue;
          }

          const assignmentCandidate = await loadAssignmentForPayment(paymentId);
          if (!assignmentCandidate) {
            continue;
          }

          const assignmentData = assignmentCandidate.data ?? {};
          const createdAtMs =
            toMillis(assignmentData.createdAt) || toMillis(paymentData.createdAt);
          const updatedAtMs =
            toMillis(assignmentData.updatedAt) ||
            toMillis(paymentData.updatedAt) ||
            createdAtMs;

          payments.push({
            paymentId,
            title: normalizeText(paymentData.title) || "Untitled Payment",
            ref: normalizeText(paymentData.ref) || makePaymentRef(paymentId),
            amount: Number(paymentData.amount ?? 0),
            date: normalizeText(paymentData.date),
            details: normalizeText(paymentData.details),
            status: normalizeStudentPaymentStatus(assignmentData.status),
            linkedEventId: paymentLinkedEventId(paymentData),
            source:
              normalizeLower(paymentData.source) === "event" ? "event" : "manual",
            createdAtMs,
            updatedAtMs,
          });
        } catch (error: unknown) {
          logStageFailure(`build payment row ${paymentId}`, error, {paymentId});
        }
      }

      payments.sort((left, right) => {
        const leftDateMs = toPaymentDateMs(
          left.date,
          left.updatedAtMs || left.createdAtMs,
        );
        const rightDateMs = toPaymentDateMs(
          right.date,
          right.updatedAtMs || right.createdAtMs,
        );
        if (rightDateMs !== leftDateMs) {
          return rightDateMs - leftDateMs;
        }

        return (right.updatedAtMs || right.createdAtMs) -
          (left.updatedAtMs || left.createdAtMs);
      });

      functionsLogger.info("listStudentPayments completed", {
        callerUid: actor.uid,
        callerRole: actor.role,
        callerSchoolId: actor.schoolId,
        callerSchoolIdKey: actor.schoolIdKey,
        collectionGroupCandidateCount,
        linkedEventPaymentCount,
        matchedPaymentCount: payments.length,
      });

      return {payments};
    } catch (error: unknown) {
      logStageFailure(currentStage, error);
      if (error instanceof HttpsError) {
        throw error;
      }

      const rawMessage =
        error instanceof Error && error.message.trim() ?
          error.message :
          "Failed to list student payments.";
      throw new HttpsError("internal", rawMessage);
    }
  });

export const listFingerprintEnrollmentSessions = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const rawLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    const queryLimit = actor.isBod ? Math.min(limit * 5, 200) : limit;

    const sessionSnapshot = await db
      .collection("enrollmentSessions")
      .orderBy("createdAt", "desc")
      .limit(queryLimit)
      .get();

    const sessions = sessionSnapshot.docs
      .filter((sessionDoc) => canActorAccessEnrollmentSession(actor, sessionDoc.data() ?? {}))
      .map((sessionDoc) => enrollmentSessionPayloadFromSnapshot(sessionDoc))
      .slice(0, limit);

    return {sessions};
  });

export const getFingerprintEnrollmentSessionDetail = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const sessionId = normalizeText(body.sessionId);

    if (!sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.");
    }

    const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) {
      throw new HttpsError("not-found", "Enrollment session not found.");
    }

    const sessionData = sessionSnapshot.data() ?? {};
    if (!canActorAccessEnrollmentSession(actor, sessionData)) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only manage students from their assigned course.",
      );
    }

    const studentsSnapshot = await db
      .collection(`enrollmentSessions/${sessionId}/students`)
      .orderBy("fullName", "asc")
      .get();

    return {
      session: enrollmentSessionPayloadFromSnapshot(sessionSnapshot),
      students: studentsSnapshot.docs.map((studentDoc) =>
        enrollmentSessionStudentPayloadFromSnapshot(studentDoc),
      ),
    };
  });

export const createFingerprintEnrollmentSession = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const studentIds = Array.from(
      new Set(normalizeIdentifierList(body.studentIds).map((studentId) => normalizeText(studentId)).filter(Boolean)),
    );

    if (studentIds.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "studentIds must contain at least one student.",
      );
    }

    await assertNoActiveEnrollmentSessionConflicts(studentIds);

    const profileRefs = studentIds.map((studentId) => db.doc(`profiles/${studentId}`));
    const studentRefs = studentIds.map((studentId) => db.doc(`students/${studentId}`));
    const [profileSnapshots, studentSnapshots] = await Promise.all([
      profileRefs.length > 0 ? db.getAll(...profileRefs) : Promise.resolve([]),
      studentRefs.length > 0 ? db.getAll(...studentRefs) : Promise.resolve([]),
    ]);

    const profileByUid = new Map<string, FirebaseFirestore.DocumentData>();
    profileSnapshots.forEach((profileSnapshot) => {
      if (profileSnapshot.exists) {
        profileByUid.set(profileSnapshot.id, profileSnapshot.data() ?? {});
      }
    });
    const studentByUid = new Map<string, FirebaseFirestore.DocumentData>();
    studentSnapshots.forEach((studentSnapshot) => {
      if (studentSnapshot.exists) {
        studentByUid.set(studentSnapshot.id, studentSnapshot.data() ?? {});
      }
    });

    const studentRows = studentIds.map((studentId) => {
      const profileExists = profileByUid.has(studentId);
      const studentExists = studentByUid.has(studentId);
      const profileData = profileByUid.get(studentId) ?? {};
      const studentData = studentByUid.get(studentId) ?? {};
      if (!profileExists && !studentExists) {
        throw new HttpsError(
          "not-found",
          "One or more selected students no longer exist.",
        );
      }

      if (!isStudentAudienceProfile(profileData, studentData)) {
        throw new HttpsError(
          "permission-denied",
          "Only student and EC-member records can be included in fingerprint enrollment.",
        );
      }

      const course = resolveStudentCourse(profileData, studentData);
      if (actor.isBod && course !== actor.courseScope) {
        throw new HttpsError(
          "permission-denied",
          "B.O.D. members can only manage students from their assigned course.",
        );
      }

      if (studentHasFingerprint(profileData, studentData)) {
        const studentName = resolveStudentName(studentId, profileData, studentData);
        throw new HttpsError(
          "failed-precondition",
          `${studentName} already has a fingerprint record.`,
        );
      }

      const schoolId = resolveStudentSchoolId(studentId, profileData, studentData);
      const yearLevel = resolveStudentYearLevel(profileData, studentData) || "Unassigned";
      const fullName = resolveStudentName(studentId, profileData, studentData);

      return {
        studentId,
        studentUid: studentId,
        schoolId,
        fullName,
        course:
          course ||
          normalizeText(profileData.course) ||
          normalizeText(studentData.course) ||
          "Unassigned",
        yearLevel,
      };
    });

    const sessionRef = db.collection("enrollmentSessions").doc();
    const timestamp = serverTimestamp();
    const createdBySchoolId = normalizeText(actor.profile.schoolId) || actor.uid;
    const createdByName = resolveProfileDisplayName(actor.profile);

    const sessionCourseScope = actor.isBod ? actor.courseScope : null;
    let createBatch = db.batch();
    let writesInBatch = 0;
    const commitCurrentBatch = async () => {
      if (writesInBatch === 0) {
        return;
      }

      await createBatch.commit();
      createBatch = db.batch();
      writesInBatch = 0;
    };

    createBatch.set(sessionRef, {
      sessionId: sessionRef.id,
      createdBy: actor.uid,
      createdByName,
      createdBySchoolId,
      createdAt: timestamp,
      updatedAt: timestamp,
      ownerType: actor.isBod ? "bod" : "ec",
      courseScope: sessionCourseScope,
      createdByCourseScope: sessionCourseScope,
      status: "pending",
      pairedDeviceId: "",
      targetDeviceId: "",
      totalStudents: studentRows.length,
      pendingCount: studentRows.length,
      downloadedCount: 0,
      enrolledCount: 0,
      syncedCount: 0,
      failedCount: 0,
      selectedStudentIds: studentIds,
    });
    writesInBatch += 1;

    for (const studentRow of studentRows) {
      if (writesInBatch + 2 > 400) {
        await commitCurrentBatch();
      }

      createBatch.set(
        db.doc(`enrollmentSessions/${sessionRef.id}/students/${studentRow.studentId}`),
        {
          enrollmentSessionId: sessionRef.id,
          studentId: studentRow.studentId,
          studentUid: studentRow.studentUid,
          schoolId: studentRow.schoolId,
          fullName: studentRow.fullName,
          course: studentRow.course,
          yearLevel: studentRow.yearLevel,
          status: "pending" as EnrollmentStudentStatus,
          syncStatus: "pending" as EnrollmentSyncStatus,
          fingerprintTemplateId: null,
          enrolledByDevice: "",
          assignedDeviceId: "",
          remarks: "",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: true},
      );
      writesInBatch += 1;

      const queueId = `${sessionRef.id}_${studentRow.studentId}`;
      createBatch.set(
        db.doc(`enrollmentQueue/${queueId}`),
        {
          queueId,
          enrollmentSessionId: sessionRef.id,
          eventId: sessionRef.id,
          studentId: studentRow.studentId,
          studentUid: studentRow.studentUid,
          schoolId: studentRow.schoolId,
          studentName: studentRow.fullName,
          course: studentRow.course,
          yearLevel: studentRow.yearLevel,
          status: "pending",
          assignedDeviceId: ENROLLMENT_SESSION_QUEUE_HOLD_DEVICE_ID,
          ownerType: actor.isBod ? "bod" : "ec",
          createdBy: actor.uid,
          createdByName,
          createdBySchoolId,
          courseScope: sessionCourseScope,
          createdByCourseScope: sessionCourseScope,
          source: "enrollment-session",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {merge: true},
      );
      writesInBatch += 1;
    }

    await commitCurrentBatch();
    const createdSessionSnapshot = await sessionRef.get();

    return {
      session: enrollmentSessionPayloadFromSnapshot(createdSessionSnapshot),
    };
  });

export const closeFingerprintEnrollmentSession = onCall({region: REGION}, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const sessionId = normalizeText(body.sessionId);

    if (!sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.");
    }

    const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) {
      throw new HttpsError("not-found", "Enrollment session not found.");
    }

    const sessionData = sessionSnapshot.data() ?? {};
    if (!canActorAccessEnrollmentSession(actor, sessionData)) {
      throw new HttpsError(
        "permission-denied",
        "B.O.D. members can only manage students from their assigned course.",
      );
    }

    const queueSnapshot = await db
      .collection("enrollmentQueue")
      .where("enrollmentSessionId", "==", sessionId)
      .get();
    if (!queueSnapshot.empty) {
      const writesPerBatch = 350;
      for (let index = 0; index < queueSnapshot.docs.length; index += writesPerBatch) {
        const batch = db.batch();
        queueSnapshot.docs
          .slice(index, index + writesPerBatch)
          .forEach((queueDoc) => {
            batch.set(
              queueDoc.ref,
              {
                status: "closed",
                closedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              {merge: true},
            );
          });
        await batch.commit();
      }
    }

    await sessionRef.set(
      {
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true},
    );

    const updatedSessionSnapshot = await sessionRef.get();
    return {
      session: enrollmentSessionPayloadFromSnapshot(updatedSessionSnapshot),
    };
  });

function makePaymentRef(paymentId: string): string {
  return `PMT-${paymentId.slice(-6).toUpperCase()}`;
}

function toFirestoreDateOrNull(value: unknown): Date | null {
  const millis = toMillis(value);
  if (!Number.isFinite(millis) || millis <= 0) {
    return null;
  }

  return new Date(millis);
}

function toUniqueIdentifierList(value: unknown): string[] {
  return Array.from(new Set(normalizeIdentifierList(value)));
}

export const createCampusEvent = onCall({region: REGION}, async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    try {
      const actorUid = normalizeText(request.auth.uid);
      const actorProfile = await callerProfileData(request);
      const actorRole = normalizeCampusRoleValue(actorProfile.role);
      const actorIsAdmin = actorRole === "admin";
      const actorIsEcMember = isECMemberRole(actorProfile.role);
      const actorIsBod = actorIsEcMember && isBodProfileData(actorProfile);
      const actorIsRegularEc =
        actorIsEcMember &&
        !actorIsBod &&
        resolveProfileEcScope(actorProfile) === "all";

      if (!actorIsAdmin && !actorIsRegularEc && !actorIsBod) {
        throw new HttpsError(
          "permission-denied",
          "Only admin, regular EC, or B.O.D. users can create events.",
        );
      }

      const actorCourseScope = resolveProfileCourseScope(actorProfile);
      if (actorIsBod && !actorCourseScope) {
        throw new HttpsError(
          "failed-precondition",
          "B.O.D. profile is missing a valid course scope.",
        );
      }

      const body = asRecord(request.data);
      const title = normalizeText(body.title);
      const location = normalizeText(body.location);
      const date = normalizeText(body.date);
      const scheduledTime =
        normalizeText(body.scheduledTime) ||
        normalizeText(body.timeStart);
      const timeEnd = normalizeText(body.timeEnd);
      const details = normalizeText(body.details);
      const isPreReg = body.isPreReg === true;
      const withPayment = body.withPayment === true || body.paymentRequired === true;
      const waitlistEnabled = isPreReg ? body.waitlistEnabled === true : false;
      const parsedPreRegSlots = Number(body.preRegSlots);

      if (!title) {
        throw new HttpsError("invalid-argument", "Title is required.");
      }
      if (!date) {
        throw new HttpsError("invalid-argument", "Date is required.");
      }
      if (!scheduledTime) {
        throw new HttpsError("invalid-argument", "Scheduled time is required.");
      }
      if (!timeEnd) {
        throw new HttpsError("invalid-argument", "End time is required.");
      }
      const eventStartMs = parseEventStartMs(date, scheduledTime);
      const eventEndMs = parseEventStartMs(date, timeEnd);
      if (
        eventStartMs !== Number.MAX_SAFE_INTEGER &&
        eventEndMs !== Number.MAX_SAFE_INTEGER &&
        eventEndMs <= eventStartMs
      ) {
        throw new HttpsError(
          "invalid-argument",
          "End time must be later than start time.",
        );
      }

      if (isPreReg && (!Number.isFinite(parsedPreRegSlots) || parsedPreRegSlots < 0)) {
        throw new HttpsError(
          "invalid-argument",
          "Pre-reg slots must be at least 0.",
        );
      }

      const preRegSlots = isPreReg ? Math.max(0, Math.trunc(parsedPreRegSlots)) : null;
      const registrationStartAt = isPreReg ? toFirestoreDateOrNull(body.registrationStartAt) : null;
      const registrationEndAt = isPreReg ? toFirestoreDateOrNull(body.registrationEndAt) : null;
      const cancellationDeadlineAt = isPreReg ?
        toFirestoreDateOrNull(body.cancellationDeadlineAt) :
        null;

      if (
        isPreReg &&
        (!registrationStartAt || !registrationEndAt || !cancellationDeadlineAt)
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Set valid registration and cancellation date/time values.",
        );
      }

      if (
        isPreReg &&
        registrationStartAt &&
        registrationEndAt &&
        registrationStartAt.getTime() > registrationEndAt.getTime()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Registration start must be earlier than the end.",
        );
      }

      if (
        isPreReg &&
        registrationEndAt &&
        eventStartMs !== Number.MAX_SAFE_INTEGER &&
        registrationEndAt.getTime() > eventStartMs
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Registration end must be on or before the event start time.",
        );
      }

      if (
        isPreReg &&
        cancellationDeadlineAt &&
        registrationStartAt &&
        cancellationDeadlineAt.getTime() < registrationStartAt.getTime()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Cancellation deadline cannot be earlier than registration start.",
        );
      }

      if (
        isPreReg &&
        cancellationDeadlineAt &&
        registrationEndAt &&
        cancellationDeadlineAt.getTime() > registrationEndAt.getTime()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Cancellation deadline must be on or before registration end.",
        );
      }

      const selectedStudentIds = toUniqueIdentifierList(body.selectedStudentIds)
        .filter((uid) => !uid.startsWith("manual-"));
      const selectedSchoolIds = toUniqueIdentifierList(body.selectedSchoolIds)
        .filter((schoolId) => schoolId !== "Unknown ID");

      const requestedCourseValue = normalizeText(body.course);
      const requestedYearLevelValue = normalizeText(body.yearLevel);
      const requestedTargetStudent = normalizeText(body.targetStudent);
      const requestedCourseTargetsRaw = Array.from(
        new Set(
          toTargetList(body.courses)
            .map((value) => normalizeText(value))
            .filter(Boolean),
        ),
      );
      const requestedYearTargetsRaw = Array.from(
        new Set(
          toTargetList(body.yearLevels)
            .map((value) => normalizeText(value))
            .filter(Boolean),
        ),
      );

      const requestedHasAllCourses =
        requestedCourseTargetsRaw.some((value) => normalizeLower(value) === "all courses") ||
        normalizeLower(requestedCourseValue) === "all courses";
      const requestedHasAllYears =
        requestedYearTargetsRaw.some((value) => normalizeLower(value) === "all years") ||
        normalizeLower(requestedYearLevelValue) === "all years";

      const normalizedCourseTargets = Array.from(new Set(
        requestedCourseTargetsRaw
          .map((value) => normalizeCourseLabel(value))
          .filter(Boolean),
      ));
      if (!requestedHasAllCourses && normalizedCourseTargets.length === 0) {
        const fallbackCourse = normalizeCourseLabel(requestedCourseValue);
        if (fallbackCourse) {
          normalizedCourseTargets.push(fallbackCourse);
        }
      }

      const normalizedYearTargets = Array.from(new Set(
        requestedYearTargetsRaw
          .map((value) => normalizeYear(value))
          .filter(
            (value) =>
              Boolean(value) &&
              value !== "Unassigned" &&
              normalizeLower(value) !== "all years",
          ),
      ));
      if (!requestedHasAllYears && normalizedYearTargets.length === 0) {
        const fallbackYear = normalizeYear(requestedYearLevelValue);
        if (
          fallbackYear &&
          fallbackYear !== "Unassigned" &&
          normalizeLower(fallbackYear) !== "all years"
        ) {
          normalizedYearTargets.push(fallbackYear);
        }
      }

      const scopedSelectedProfiles = new Map<string, FirebaseFirestore.DocumentData>();
      if (actorIsBod) {
        if (selectedStudentIds.length > 250) {
          throw new HttpsError(
            "invalid-argument",
            "Too many selected students. Please reduce the audience size.",
          );
        }

        if (selectedStudentIds.length > 0) {
          const selectedProfileRefs = selectedStudentIds.map((uid) => db.doc(`profiles/${uid}`));
          const selectedProfileSnaps = await db.getAll(...selectedProfileRefs);

          for (const profileSnap of selectedProfileSnaps) {
            if (!profileSnap.exists) {
              throw new HttpsError(
                "permission-denied",
                "Selected students must belong to your assigned course scope.",
              );
            }

            const profileData = profileSnap.data() ?? {};
            const profileCourseScope = normalizeCourseLabel(profileData.course);
            if (
              !isStudentAudienceProfile(profileData) ||
              profileCourseScope !== actorCourseScope
            ) {
              throw new HttpsError(
                "permission-denied",
                "Selected students must belong to your assigned course scope.",
              );
            }

            scopedSelectedProfiles.set(profileSnap.id, profileData);
          }
        }

        const selectedScopedSchoolIds = new Set(
          Array.from(scopedSelectedProfiles.values())
            .map((profileData) =>
              normalizeText(profileData.schoolId) ||
              normalizeText(profileData.studentId),
            )
            .filter(Boolean),
        );

        for (const selectedSchoolId of selectedSchoolIds) {
          if (selectedScopedSchoolIds.has(selectedSchoolId)) {
            continue;
          }

          const scopedSchoolProfiles = await findStudentAudienceProfilesByIdentifier(
            selectedSchoolId,
            20,
          );

          const scopedSchoolMatch = scopedSchoolProfiles.some((profileDoc) => {
            const profileData = profileDoc.data() ?? {};
            return isStudentAudienceProfile(profileData) &&
              normalizeCourseLabel(profileData.course) === actorCourseScope;
          });

          if (!scopedSchoolMatch) {
            throw new HttpsError(
              "permission-denied",
              "Selected students must belong to your assigned course scope.",
            );
          }
        }
      }

      let ownerType: "ec" | "bod" = "ec";
      let eventCourse =
        requestedHasAllCourses ?
          "All Courses" :
          requestedCourseValue || normalizedCourseTargets.join(", ") || "All Courses";
      let eventCourseScope = normalizeCourseLabel(body.courseScope) || null;
      let eventCourses = requestedHasAllCourses ? [] : [...normalizedCourseTargets];
      const eventYearLevel =
        requestedHasAllYears ?
          "All Years" :
          requestedYearLevelValue || normalizedYearTargets.join(", ") || "All Years";
      const eventYearLevels = requestedHasAllYears ? [] : [...normalizedYearTargets];
      let eventTargetStudent = requestedTargetStudent;
      let createdByCourseScope = actorIsAdmin ? null : actorCourseScope || null;
      const createdByRole =
        actorIsAdmin ? "admin" :
        actorIsBod ? "bod" :
        "ecmember";
      const createdByPosition = normalizeECPosition(actorProfile.ecPosition) || null;

      if (actorIsBod) {
        ownerType = "bod";
        eventCourse = actorCourseScope;
        eventCourseScope = actorCourseScope;
        eventCourses = [actorCourseScope];
        createdByCourseScope = actorCourseScope;
        eventTargetStudent = selectedStudentIds.length > 0 ?
          `Specific students selected (${selectedStudentIds.length})` :
          "";
      }

      const eventDocRef = db.collection("events").doc();
      const eventId = eventDocRef.id;
      let linkedPaymentId: string | null = null;

      if (withPayment) {
        const amountValue = Number(body.paymentAmount);
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
          throw new HttpsError(
            "invalid-argument",
            "Amount is required for paid events.",
          );
        }

        const explicitSelectedStudentIds = new Set(
          selectedStudentIds.map((uid) => normalizeLower(uid)),
        );
        const explicitSelectedSchoolIds = new Set(
          selectedSchoolIds.map((schoolId) => normalizeLower(schoolId)),
        );
        const hasExplicitSelectedAudience =
          explicitSelectedStudentIds.size > 0 || explicitSelectedSchoolIds.size > 0;

        const targetCourseSet = new Set(
          eventCourses
            .map((course) => normalizeLower(normalizeCourseLabel(course)))
            .filter(Boolean),
        );
        const targetYearLevelSet = new Set(
          eventYearLevels
            .map((yearLevel) => normalizeLower(normalizeYear(yearLevel)))
            .filter(
              (yearLevel) =>
                Boolean(yearLevel) &&
                yearLevel !== "all years" &&
                yearLevel !== "unassigned",
            ),
        );

        const audienceCandidates = new Map<string, FirebaseFirestore.DocumentData>();

        if (selectedStudentIds.length > 0) {
          const selectedRefs = selectedStudentIds.map((uid) => db.doc(`profiles/${uid}`));
          const selectedSnaps = await db.getAll(...selectedRefs);
          selectedSnaps.forEach((profileSnap) => {
            if (!profileSnap.exists) {
              return;
            }
            audienceCandidates.set(profileSnap.id, profileSnap.data() ?? {});
          });
        }

        if (selectedSchoolIds.length > 0) {
          for (const schoolId of selectedSchoolIds) {
            const matchedProfiles = await findStudentAudienceProfilesByIdentifier(
              schoolId,
              25,
            );
            matchedProfiles.forEach((profileDoc) => {
              audienceCandidates.set(profileDoc.id, profileDoc.data() ?? {});
            });
          }
        }

        if (audienceCandidates.size === 0) {
          const profileSnapshot = await db
            .collection("profiles")
            .where("role", "in", [...STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES])
            .limit(5000)
            .get();

          profileSnapshot.docs.forEach((profileDoc) => {
            audienceCandidates.set(profileDoc.id, profileDoc.data() ?? {});
          });
        }

        const paymentTargets = Array.from(audienceCandidates.entries())
          .map(([uid, profileData]) => {
            const schoolId =
              normalizeText(profileData.schoolId) ||
              normalizeText(profileData.studentId) ||
              uid;
            const course =
              normalizeCourseLabel(profileData.course) ||
              normalizeText(profileData.course) ||
              "Unassigned";
            const year = normalizeYear(profileData.yearLevel ?? profileData.year);
            const studentName = resolveStudentAudienceIdentityName(
              profileData,
              {},
            );
            const status = normalizeLower(profileData.status);

            return {
              uid,
              schoolId,
              studentName,
              course,
              year,
              status,
              role: normalizeText(profileData.role),
            };
          })
          .filter((student) => isStudentAudienceProfile(student))
          .filter((student) => student.status !== "inactive")
          .filter((student) => {
            if (
              actorIsBod &&
              actorCourseScope &&
              normalizeCourseLabel(student.course) !== actorCourseScope
            ) {
              return false;
            }

            if (hasExplicitSelectedAudience) {
              return explicitSelectedStudentIds.has(normalizeLower(student.uid)) ||
                explicitSelectedSchoolIds.has(normalizeLower(student.schoolId));
            }

            const matchesCourse =
              targetCourseSet.size === 0 ||
              targetCourseSet.has(normalizeLower(normalizeCourseLabel(student.course)));
            const matchesYear =
              targetYearLevelSet.size === 0 ||
              targetYearLevelSet.has(normalizeLower(normalizeYear(student.year)));
            return matchesCourse && matchesYear;
          })
          .sort((left, right) => {
            const bySchoolId = left.schoolId.localeCompare(right.schoolId);
            if (bySchoolId !== 0) {
              return bySchoolId;
            }
            return left.studentName.localeCompare(right.studentName);
          });

        if (paymentTargets.length === 0) {
          throw new HttpsError(
            "invalid-argument",
            "No active students match the selected audience for this paid event.",
          );
        }

        const paymentDocRef = db.collection("payments").doc();
        linkedPaymentId = paymentDocRef.id;

        await paymentDocRef.set({
          title: normalizeText(body.paymentTitle) || title,
          ref: makePaymentRef(paymentDocRef.id),
          amount: amountValue,
          date: normalizeText(body.paymentDueDate),
          yearLevel: eventYearLevel || "All Years",
          course: eventCourse || "All Courses",
          targetStudent: eventTargetStudent,
          targetYearLevels: eventYearLevels,
          targetCourses: eventCourses,
          details: normalizeText(body.paymentDescription),
          linkedEventId: eventId,
          eventId,
          linkedEventTitle: title,
          ownerType,
          createdByUid: actorUid,
          createdByRole,
          createdByCourseScope,
          courseScope: eventCourses.length === 1 ? eventCourses[0] : null,
          source: "event",
          status: "active",
          totalStudents: paymentTargets.length,
          paidCount: 0,
          unpaidCount: paymentTargets.length,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, {merge: true});

        const writesPerBatch = 350;
        for (let index = 0; index < paymentTargets.length; index += writesPerBatch) {
          const batch = db.batch();
          const chunk = paymentTargets.slice(index, index + writesPerBatch);

          chunk.forEach((student) => {
            batch.set(
              db.doc(`payments/${paymentDocRef.id}/students/${student.uid}`),
              {
                uid: student.uid,
                schoolId: student.schoolId,
                name: student.studentName,
                studentName: student.studentName,
                year: student.year || "-",
                section: "-",
                course: student.course || "-",
                status: "Unpaid",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              {merge: true},
            );
          });

          await batch.commit();
        }
      }

      const preRegCount = 0;
      const waitlistCount = 0;
      const preRegRemaining =
        isPreReg && typeof preRegSlots === "number" ?
          Math.max(0, preRegSlots - preRegCount) :
          0;

      await eventDocRef.set({
        title,
        location,
        date,
        scheduledTime,
        timeStart: scheduledTime,
        timeEnd,
        yearLevel: eventYearLevel || "All Years",
        course: eventCourse || "All Courses",
        yearLevels: eventYearLevels,
        courses: eventCourses,
        targetStudent: eventTargetStudent,
        selectedStudentIds,
        selectedSchoolIds,
        details,
        isPreReg,
        withPayment,
        paymentRequired: withPayment,
        waitlistEnabled,
        requiredPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : "",
        linkedPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : null,
        registrationStartAt,
        registrationEndAt,
        cancellationDeadlineAt,
        preRegSlots,
        preRegCount,
        preRegRemaining,
        waitlistCount,
        ownerType,
        courseScope: eventCourseScope,
        createdBy: actorUid,
        createdByUid: actorUid,
        createdByRole,
        createdByPosition,
        createdByCourseScope,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "upcoming",
      });

      await writeStructuredAuditLog({
        actorUid,
        action: "event_created_via_callable",
        targetType: "event",
        targetId: eventId,
        metadata: {
          ownerType,
          courseScope: eventCourseScope,
          withPayment,
          linkedPaymentId: linkedPaymentId || null,
        },
      }).catch((error) => {
        authLogger.warn("createCampusEvent audit log write failed", {error});
      });

      return {
        eventId,
        linkedPaymentId,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        error instanceof Error && error.message ?
          error.message :
          "Failed to create event.",
      );
    }
  });

export const updateCampusEvent = onCall({region: REGION}, async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to update an event.",
      );
    }

    try {
      const actorUid = normalizeText(request.auth.uid);
      const actorProfile = await callerProfileData(request);
      const actorRole = normalizeCampusRoleValue(actorProfile.role);
      const actorIsAdmin = actorRole === "admin";
      const actorIsEcMember = isECMemberRole(actorProfile.role);
      const actorIsBod = actorIsEcMember && isBodProfileData(actorProfile);
      const actorIsRegularEc =
        actorIsEcMember &&
        !actorIsBod &&
        resolveProfileEcScope(actorProfile) === "all";

      if (!actorIsAdmin && !actorIsRegularEc && !actorIsBod) {
        throw new HttpsError(
          "permission-denied",
          "Only admin, regular EC, or B.O.D. users can update events.",
        );
      }

      const body = asRecord(request.data);
      const eventId = normalizeText(body.eventId);
      const title = normalizeText(body.title);
      const location = normalizeText(body.location);
      const date = normalizeText(body.date);
      const timeStart =
        normalizeText(body.timeStart) ||
        normalizeText(body.scheduledTime);
      const scheduledTime = normalizeText(body.scheduledTime) || timeStart;
      const timeEnd = normalizeText(body.timeEnd);
      const details = normalizeText(body.details);

      if (!eventId) {
        throw new HttpsError("invalid-argument", "eventId is required.");
      }
      if (!title) {
        throw new HttpsError("invalid-argument", "Title is required.");
      }
      if (!location) {
        throw new HttpsError("invalid-argument", "Location is required.");
      }
      if (!date) {
        throw new HttpsError("invalid-argument", "Date is required.");
      }
      if (!timeStart) {
        throw new HttpsError("invalid-argument", "timeStart is required.");
      }
      if (!timeEnd) {
        throw new HttpsError("invalid-argument", "timeEnd is required.");
      }

      const eventStartMs = parseEventStartMs(date, scheduledTime);
      const eventEndMs = parseEventStartMs(date, timeEnd);
      if (
        eventStartMs !== Number.MAX_SAFE_INTEGER &&
        eventEndMs !== Number.MAX_SAFE_INTEGER &&
        eventEndMs <= eventStartMs
      ) {
        throw new HttpsError(
          "invalid-argument",
          "End time must be later than start time.",
        );
      }

      const eventRef = db.doc(`events/${eventId}`);
      const eventSnapshot = await eventRef.get();
      if (!eventSnapshot.exists) {
        throw new HttpsError("not-found", "Event not found.");
      }

      const existingEventData = eventSnapshot.data() ?? {};
      const existingEventOwnerType =
        normalizeLower(existingEventData.ownerType) === "bod" ?
          "bod" :
          "ec";
      const existingEventCourseScope =
        normalizeCourseLabel(existingEventData.courseScope) ||
        normalizeCourseLabel(existingEventData.course);
      const actorCourseScope = resolveProfileCourseScope(actorProfile);
      const actorCreatedByRole =
        actorIsAdmin ? "admin" :
        actorIsBod ? "bod" :
        "ecmember";

      if (actorIsBod) {
        if (!actorCourseScope) {
          throw new HttpsError(
            "failed-precondition",
            "B.O.D. profile is missing a valid course scope.",
          );
        }

        if (existingEventOwnerType !== "bod") {
          throw new HttpsError(
            "permission-denied",
            "B.O.D. members can only update their own B.O.D.-created events.",
          );
        }

        if (normalizeText(existingEventData.createdBy) !== actorUid) {
          throw new HttpsError(
            "permission-denied",
            "B.O.D. members can only update their own B.O.D.-created events.",
          );
        }

        if (!existingEventCourseScope || existingEventCourseScope !== actorCourseScope) {
          throw new HttpsError(
            "permission-denied",
            "B.O.D. members can only update events from their assigned course.",
          );
        }
      }

      const isPreReg = body.isPreReg === true;
      const waitlistEnabled = isPreReg ? body.waitlistEnabled === true : false;
      const parsedPreRegSlots = Number(body.preRegSlots);
      if (isPreReg && (!Number.isFinite(parsedPreRegSlots) || parsedPreRegSlots < 0)) {
        throw new HttpsError(
          "invalid-argument",
          "Pre-reg slots must be at least 0.",
        );
      }

      const preRegSlots = isPreReg ? Math.max(0, Math.trunc(parsedPreRegSlots)) : null;
      const registrationStartAt = isPreReg ? toFirestoreDateOrNull(body.registrationStartAt) : null;
      const registrationEndAt = isPreReg ? toFirestoreDateOrNull(body.registrationEndAt) : null;
      const cancellationDeadlineAt = isPreReg ?
        toFirestoreDateOrNull(body.cancellationDeadlineAt) :
        null;

      if (
        isPreReg &&
        (!registrationStartAt || !registrationEndAt || !cancellationDeadlineAt)
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Set valid registration and cancellation date/time values.",
        );
      }

      if (
        isPreReg &&
        registrationStartAt &&
        registrationEndAt &&
        registrationStartAt.getTime() > registrationEndAt.getTime()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Registration start must be earlier than the end.",
        );
      }

      if (
        isPreReg &&
        registrationEndAt &&
        eventStartMs !== Number.MAX_SAFE_INTEGER &&
        registrationEndAt.getTime() > eventStartMs
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Registration end must be on or before the event start time.",
        );
      }

      if (
        isPreReg &&
        cancellationDeadlineAt &&
        registrationStartAt &&
        cancellationDeadlineAt.getTime() < registrationStartAt.getTime()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Cancellation deadline cannot be earlier than registration start.",
        );
      }

      if (
        isPreReg &&
        cancellationDeadlineAt &&
        registrationEndAt &&
        cancellationDeadlineAt.getTime() > registrationEndAt.getTime()
      ) {
        throw new HttpsError(
          "invalid-argument",
          "Cancellation deadline must be on or before registration end.",
        );
      }

      const selectedStudentIds = toUniqueIdentifierList(body.selectedStudentIds)
        .filter((uid) => !uid.startsWith("manual-"));
      const selectedSchoolIdsInput = toUniqueIdentifierList(body.selectedSchoolIds)
        .filter((schoolId) => schoolId !== "Unknown ID");
      let selectedSchoolIds = [...selectedSchoolIdsInput];

      const requestedCourseValue = normalizeText(body.course);
      const requestedYearLevelValue = normalizeText(body.yearLevel);
      const requestedTargetStudent = normalizeText(body.targetStudent);
      const requestedCourseTargetsRaw = Array.from(
        new Set(
          toTargetList(body.courses)
            .map((value) => normalizeText(value))
            .filter(Boolean),
        ),
      );
      const requestedYearTargetsRaw = Array.from(
        new Set(
          toTargetList(body.yearLevels)
            .map((value) => normalizeText(value))
            .filter(Boolean),
        ),
      );

      const requestedHasAllCourses =
        requestedCourseTargetsRaw.some((value) => normalizeLower(value) === "all courses") ||
        normalizeLower(requestedCourseValue) === "all courses";
      const requestedHasAllYears =
        requestedYearTargetsRaw.some((value) => normalizeLower(value) === "all years") ||
        normalizeLower(requestedYearLevelValue) === "all years";

      const normalizedCourseTargets = Array.from(new Set(
        requestedCourseTargetsRaw
          .map((value) => normalizeCourseLabel(value))
          .filter(Boolean),
      ));
      if (!requestedHasAllCourses && normalizedCourseTargets.length === 0) {
        const fallbackCourse = normalizeCourseLabel(requestedCourseValue);
        if (fallbackCourse) {
          normalizedCourseTargets.push(fallbackCourse);
        }
      }

      const normalizedYearTargets = Array.from(new Set(
        requestedYearTargetsRaw
          .map((value) => normalizeYear(value))
          .filter(
            (value) =>
              Boolean(value) &&
              value !== "Unassigned" &&
              normalizeLower(value) !== "all years",
          ),
      ));
      if (!requestedHasAllYears && normalizedYearTargets.length === 0) {
        const fallbackYear = normalizeYear(requestedYearLevelValue);
        if (
          fallbackYear &&
          fallbackYear !== "Unassigned" &&
          normalizeLower(fallbackYear) !== "all years"
        ) {
          normalizedYearTargets.push(fallbackYear);
        }
      }

      let ownerType: "ec" | "bod" =
        normalizeLower(body.ownerType) === "bod" ? "bod" :
          normalizeLower(body.ownerType) === "ec" ? "ec" :
            existingEventOwnerType;
      let eventCourse =
        requestedHasAllCourses ?
          "All Courses" :
          requestedCourseValue || normalizedCourseTargets.join(", ") || "All Courses";
      let eventCourseScope = normalizeCourseLabel(body.courseScope) || null;
      let eventCourses = requestedHasAllCourses ? [] : [...normalizedCourseTargets];
      const eventYearLevel =
        requestedHasAllYears ?
          "All Years" :
          requestedYearLevelValue || normalizedYearTargets.join(", ") || "All Years";
      const eventYearLevels = requestedHasAllYears ? [] : [...normalizedYearTargets];
      let eventTargetStudent = requestedTargetStudent;
      const selectedProfilesByUid = new Map<string, FirebaseFirestore.DocumentData>();

      if (actorIsBod) {
        ownerType = "bod";
        eventCourse = actorCourseScope;
        eventCourseScope = actorCourseScope;
        eventCourses = [actorCourseScope];

        if (selectedStudentIds.length > 0) {
          const selectedProfileRefs = selectedStudentIds.map((uid) => db.doc(`profiles/${uid}`));
          const selectedProfileSnapshots = await db.getAll(...selectedProfileRefs);

          for (const selectedProfileSnapshot of selectedProfileSnapshots) {
            if (!selectedProfileSnapshot.exists) {
              throw new HttpsError(
                "permission-denied",
                "B.O.D. members can only target students from their assigned course.",
              );
            }

            const selectedProfileData = selectedProfileSnapshot.data() ?? {};
            if (
              !isStudentAudienceProfile(selectedProfileData) ||
              normalizeCourseLabel(selectedProfileData.course) !== actorCourseScope
            ) {
              throw new HttpsError(
                "permission-denied",
                "B.O.D. members can only target students from their assigned course.",
              );
            }

            selectedProfilesByUid.set(selectedProfileSnapshot.id, selectedProfileData);
          }

          selectedSchoolIds = Array.from(new Set(
            selectedStudentIds
              .map((uid) =>
                normalizeText(selectedProfilesByUid.get(uid)?.schoolId) ||
                normalizeText(selectedProfilesByUid.get(uid)?.studentId),
              )
              .filter(Boolean),
          ));

          eventTargetStudent = `Specific students selected (${selectedStudentIds.length})`;
        } else {
          selectedSchoolIds = [];
          eventTargetStudent = "";
        }
      }

      const parsedPreRegCount = Number(body.preRegCount);
      const parsedWaitlistCount = Number(body.waitlistCount);
      const preRegCount = isPreReg ?
        (
          Number.isFinite(parsedPreRegCount) ?
            Math.max(0, Math.trunc(parsedPreRegCount)) :
            toPositiveNumber(existingEventData.preRegCount)
        ) :
        0;
      const waitlistCount = isPreReg ?
        (
          Number.isFinite(parsedWaitlistCount) ?
            Math.max(0, Math.trunc(parsedWaitlistCount)) :
            toPositiveNumber(existingEventData.waitlistCount)
        ) :
        0;
      const preRegRemaining =
        isPreReg && typeof preRegSlots === "number" ?
          Math.max(0, preRegSlots - preRegCount) :
          0;

      const withPayment = body.withPayment === true || body.paymentRequired === true;
      const previousLinkedPaymentId =
        normalizeText(existingEventData.linkedPaymentId) ||
        normalizeText(existingEventData.requiredPaymentId);
      const requestedLinkedPaymentId =
        normalizeText(body.linkedPaymentId) ||
        normalizeText(body.requiredPaymentId);
      const paymentTitle = normalizeText(body.paymentTitle);
      const paymentDueDate = normalizeText(body.paymentDueDate);
      const paymentDescription = normalizeText(body.paymentDescription);
      let linkedPaymentId: string | null = null;

      if (withPayment) {
        const amountValue = Number(body.paymentAmount);
        if (!Number.isFinite(amountValue) || amountValue <= 0) {
          throw new HttpsError(
            "invalid-argument",
            "Amount is required for paid events.",
          );
        }

        linkedPaymentId =
          requestedLinkedPaymentId ||
          previousLinkedPaymentId ||
          db.collection("payments").doc().id;

        const paymentRef = db.doc(`payments/${linkedPaymentId}`);
        const paymentSnapshot = await paymentRef.get();
        const existingPaymentData = paymentSnapshot.data() ?? {};

        const createdByUid =
          normalizeText(existingPaymentData.createdByUid) ||
          normalizeText(existingEventData.createdBy) ||
          actorUid;
        const createdByRole =
          normalizeText(existingPaymentData.createdByRole) ||
          actorCreatedByRole;
        const createdByCourseScope = actorIsBod ?
          actorCourseScope :
          normalizeCourseLabel(existingPaymentData.createdByCourseScope) ||
          normalizeCourseLabel(existingEventData.createdByCourseScope) ||
          resolveProfileCourseScope(actorProfile) ||
          null;

        await paymentRef.set(
          {
            title: paymentTitle || title,
            ref:
              normalizeText(existingPaymentData.ref) ||
              makePaymentRef(linkedPaymentId),
            amount: amountValue,
            date: paymentDueDate,
            yearLevel: eventYearLevel || "All Years",
            course: eventCourse || "All Courses",
            targetStudent: eventTargetStudent,
            targetYearLevels: eventYearLevels,
            targetCourses: eventCourses,
            details: paymentDescription,
            linkedEventId: eventId,
            eventId,
            linkedEventTitle: title,
            ownerType,
            createdByUid,
            createdByRole,
            createdByCourseScope,
            courseScope: eventCourses.length === 1 ? eventCourses[0] : null,
            source: "event",
            status: "active",
            updatedAt: serverTimestamp(),
            ...(paymentSnapshot.exists ? {} : {createdAt: serverTimestamp()}),
          },
          {merge: true},
        );

        if (actorIsBod) {
          const assignmentSnapshot = await paymentRef.collection("students").get();
          const existingAssignments = new Map<
            string,
            {
              status: "Paid" | "Unpaid";
            }
          >();

          assignmentSnapshot.docs.forEach((assignmentDoc) => {
            const assignmentData = assignmentDoc.data() ?? {};
            const status = normalizeLower(assignmentData.status) === "paid" ? "Paid" : "Unpaid";
            existingAssignments.set(assignmentDoc.id, {status});
          });

          const explicitStudentIds = new Set(
            selectedStudentIds.map((uid) => normalizeLower(uid)),
          );
          const explicitSchoolIds = new Set(
            selectedSchoolIds.map((schoolId) => normalizeLower(schoolId)),
          );
          const hasExplicitAudience =
            explicitStudentIds.size > 0 || explicitSchoolIds.size > 0;

          const targetYearSet = new Set(
            eventYearLevels
              .map((value) => normalizeLower(normalizeYear(value)))
              .filter(
                (value) =>
                  Boolean(value) &&
                  value !== "all years" &&
                  value !== "unassigned",
              ),
          );

          const audienceCandidates = new Map<string, FirebaseFirestore.DocumentData>();
          if (selectedStudentIds.length > 0) {
            selectedStudentIds.forEach((uid) => {
              const selectedProfile = selectedProfilesByUid.get(uid);
              if (selectedProfile) {
                audienceCandidates.set(uid, selectedProfile);
              }
            });
          }

          if (selectedSchoolIds.length > 0) {
            for (const selectedSchoolId of selectedSchoolIds) {
              const matchedProfiles = await findStudentAudienceProfilesByIdentifier(
                selectedSchoolId,
                25,
              );

              matchedProfiles.forEach((schoolDoc) => {
                audienceCandidates.set(schoolDoc.id, schoolDoc.data() ?? {});
              });
            }
          }

          if (audienceCandidates.size === 0) {
            const profileSnapshot = await db
              .collection("profiles")
              .where("role", "in", [...STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES])
              .limit(5000)
              .get();

            profileSnapshot.docs.forEach((profileDoc) => {
              audienceCandidates.set(profileDoc.id, profileDoc.data() ?? {});
            });
          }

          const paymentTargets = Array.from(audienceCandidates.entries())
            .map(([uid, profileData]) => {
              const schoolId =
                normalizeText(profileData.schoolId) ||
                normalizeText(profileData.studentId) ||
                uid;
              const course =
                normalizeCourseLabel(profileData.course) ||
                normalizeText(profileData.course) ||
                "Unassigned";
              const year = normalizeYear(profileData.yearLevel ?? profileData.year);
              const studentName = resolveStudentAudienceIdentityName(
                profileData,
                {},
              );
              const status = normalizeLower(profileData.status);

              return {
                uid,
                schoolId,
                studentName,
                course,
                year,
                status,
                role: normalizeText(profileData.role),
              };
            })
            .filter((student) => isStudentAudienceProfile(student))
            .filter((student) => student.status !== "inactive")
            .filter((student) => normalizeCourseLabel(student.course) === actorCourseScope)
            .filter((student) => {
              if (hasExplicitAudience) {
                return explicitStudentIds.has(normalizeLower(student.uid)) ||
                  explicitSchoolIds.has(normalizeLower(student.schoolId));
              }

              return targetYearSet.size === 0 ||
                targetYearSet.has(normalizeLower(normalizeYear(student.year)));
            })
            .sort((left, right) => {
              const bySchoolId = left.schoolId.localeCompare(right.schoolId);
              if (bySchoolId !== 0) {
                return bySchoolId;
              }
              return left.studentName.localeCompare(right.studentName);
            });

          if (paymentTargets.length === 0) {
            throw new HttpsError(
              "invalid-argument",
              "No active students match the selected audience for this paid event.",
            );
          }

          const nextTargetIds = new Set(paymentTargets.map((student) => student.uid));
          let paidCount = 0;
          const upsertRows = paymentTargets.map((student) => {
            const existingStatus = existingAssignments.get(student.uid)?.status ?? "Unpaid";
            if (existingStatus === "Paid") {
              paidCount += 1;
            }

            return {
              student,
              status: existingStatus,
            };
          });

          const writesPerBatch = 350;
          for (let index = 0; index < upsertRows.length; index += writesPerBatch) {
            const batch = db.batch();
            const chunk = upsertRows.slice(index, index + writesPerBatch);

            chunk.forEach(({student, status}) => {
              batch.set(
                db.doc(`payments/${linkedPaymentId}/students/${student.uid}`),
                {
                  uid: student.uid,
                  schoolId: student.schoolId,
                  name: student.studentName,
                  studentName: student.studentName,
                  year: student.year || "-",
                  section: "-",
                  course: student.course || "-",
                  status,
                  updatedAt: serverTimestamp(),
                  ...(existingAssignments.has(student.uid) ? {} : {createdAt: serverTimestamp()}),
                },
                {merge: true},
              );
            });

            await batch.commit();
          }

          const removedAssignmentIds = Array.from(existingAssignments.keys()).filter(
            (uid) => !nextTargetIds.has(uid),
          );
          for (let index = 0; index < removedAssignmentIds.length; index += writesPerBatch) {
            const batch = db.batch();
            removedAssignmentIds
              .slice(index, index + writesPerBatch)
              .forEach((uid) => {
                batch.delete(db.doc(`payments/${linkedPaymentId}/students/${uid}`));
              });
            await batch.commit();
          }

          await paymentRef.set(
            {
              totalStudents: paymentTargets.length,
              paidCount,
              unpaidCount: Math.max(0, paymentTargets.length - paidCount),
              updatedAt: serverTimestamp(),
            },
            {merge: true},
          );
        }
      } else if (previousLinkedPaymentId) {
        await db.doc(`payments/${previousLinkedPaymentId}`).set(
          {
            status: "archived",
            linkedEventId: null,
            eventId: null,
            linkedEventTitle: "",
            updatedAt: serverTimestamp(),
          },
          {merge: true},
        );
      }

      const updatePayload: FirebaseFirestore.DocumentData = {
        title,
        location,
        date,
        scheduledTime,
        timeStart,
        timeEnd,
        yearLevel: eventYearLevel || "All Years",
        course: eventCourse || "All Courses",
        yearLevels: eventYearLevels,
        courses: eventCourses,
        targetStudent: eventTargetStudent,
        selectedStudentIds,
        selectedSchoolIds,
        details,
        isPreReg,
        withPayment,
        paymentRequired: withPayment,
        waitlistEnabled,
        requiredPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : "",
        linkedPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : null,
        registrationStartAt,
        registrationEndAt,
        cancellationDeadlineAt,
        preRegSlots,
        preRegCount,
        preRegRemaining,
        waitlistCount,
      };

      if (actorIsBod) {
        updatePayload.ownerType = "bod";
        updatePayload.createdBy = normalizeText(existingEventData.createdBy) || actorUid;
        updatePayload.createdByUid =
          normalizeText(existingEventData.createdByUid) ||
          normalizeText(existingEventData.createdBy) ||
          actorUid;
        updatePayload.createdByRole =
          normalizeText(existingEventData.createdByRole) ||
          actorCreatedByRole;
        updatePayload.createdByPosition = normalizeECPosition(actorProfile.ecPosition) || null;
        updatePayload.course = actorCourseScope;
        updatePayload.courseScope = actorCourseScope;
        updatePayload.createdByCourseScope = actorCourseScope;
        updatePayload.courses = [actorCourseScope];
      } else {
        updatePayload.ownerType = ownerType;
        updatePayload.createdBy =
          normalizeText(existingEventData.createdBy) ||
          normalizeText(body.createdBy) ||
          actorUid;
        updatePayload.createdByUid =
          normalizeText(existingEventData.createdByUid) ||
          normalizeText(existingEventData.createdBy) ||
          actorUid;
        updatePayload.createdByRole =
          normalizeText(body.createdByRole) ||
          normalizeText(existingEventData.createdByRole) ||
          actorCreatedByRole;
        updatePayload.createdByPosition =
          normalizeText(body.createdByPosition) ||
          normalizeText(existingEventData.createdByPosition) ||
          null;
        updatePayload.courseScope = eventCourseScope;
        updatePayload.createdByCourseScope =
          normalizeCourseLabel(body.createdByCourseScope) ||
          normalizeCourseLabel(existingEventData.createdByCourseScope) ||
          null;
      }

      await eventRef.update({
        ...updatePayload,
        updatedAt: serverTimestamp(),
      });

      await writeStructuredAuditLog({
        actorUid,
        action: "event_updated_via_callable",
        targetType: "event",
        targetId: eventId,
        metadata: {
          ownerType: updatePayload.ownerType,
          courseScope: updatePayload.courseScope,
          withPayment,
          linkedPaymentId: withPayment ? linkedPaymentId : null,
        },
      }).catch((error) => {
        authLogger.warn("updateCampusEvent audit log write failed", {error});
      });

      return {
        eventId,
        updated: true,
        linkedPaymentId: withPayment ? linkedPaymentId : null,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        error instanceof Error && error.message ?
          error.message :
          "Failed to update event.",
      );
    }
  });

export const resolveSchoolIdLogin = onCall({region: REGION}, async (request) => {
    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);

    if (!schoolId) {
      throw new HttpsError(
        "invalid-argument",
        "School ID is required."
      );
    }

    const profileSnapshot = await db
      .collection("profiles")
      .where("schoolId", "==", schoolId)
      .limit(1)
      .get();

    if (profileSnapshot.empty) {
      authLogger.debug("resolveSchoolIdLogin profile not found");
      return {
        email: null,
        found: false,
        source: "missing",
      };
    }

    const profileDoc = profileSnapshot.docs[0];
    const profileData = profileDoc.data() ?? {};
    const profileEmail = normalizeText(profileData.email);

    try {
      const userRecord = await admin.auth().getUser(profileDoc.id);
      const resolvedEmail =
        normalizeText(userRecord.email) ||
        profileEmail ||
        `${schoolId}@campus.local`;
      const source =
        normalizeText(userRecord.email) ? "auth" : profileEmail ? "profile" : "fallback";

      authLogger.info("resolveSchoolIdLogin resolved", {
        source,
      });

      return {
        email: resolvedEmail,
        found: true,
        source,
      };
    } catch (error: unknown) {
      authLogger.warn("resolveSchoolIdLogin auth lookup failed, using fallback", {
        error,
      });
      const fallbackEmail = profileEmail || `${schoolId}@campus.local`;
      const source = profileEmail ? "profile" : "fallback";
      return {
        email: fallbackEmail,
        found: true,
        source,
      };
    }
  });

export const getCurrentCampusProfile = onCall({region: REGION}, async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Login required."
      );
    }

    const uid = normalizeText(request.auth.uid);
    const profileRef = db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();

    if (!profileSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Your CAMPUS profile could not be found."
      );
    }

    const profileData = profileSnap.data() ?? {};
    const normalizedRole = normalizeCampusRoleValue(profileData.role);

    if (normalizedRole && normalizeText(profileData.role) !== normalizedRole) {
      await profileRef.set(
        {
          role: normalizedRole,
          updatedAt: serverTimestamp(),
        },
        {merge: true}
      );
      profileData.role = normalizedRole;
    }

    try {
      const authUser = await admin.auth().getUser(uid);
      const authEmail = normalizeLower(authUser.email);
      const currentEmail = normalizeLower(profileData.email);
      const pendingEmail = normalizeLower(profileData.pendingEmail);
      const profileSyncPatch: FirebaseFirestore.DocumentData = {};

      if (authEmail && authEmail !== currentEmail) {
        profileSyncPatch.email = authEmail;
        profileData.email = authEmail;
      }

      const effectiveEmail = normalizeLower(profileSyncPatch.email ?? profileData.email);
      const shouldClearPendingEmail = Boolean(
        pendingEmail &&
        (
          (authEmail && !isCampusLocalEmail(authEmail) && pendingEmail !== authEmail) ||
          (
            effectiveEmail &&
            !isCampusLocalEmail(effectiveEmail) &&
            pendingEmail !== effectiveEmail
          )
        ),
      );

      if (shouldClearPendingEmail) {
        profileSyncPatch.pendingEmail = null;
        profileData.pendingEmail = null;
      }

      if (Object.keys(profileSyncPatch).length > 0) {
        profileSyncPatch.updatedAt = serverTimestamp();
        await profileRef.set(profileSyncPatch, {merge: true});
      }
    } catch (error) {
      authLogger.warn("getCurrentCampusProfile unable to sync auth email", {error});
    }

    return {
      profile: buildCampusProfilePayload(profileData),
    };
  });

export const savePendingEmailVerification = onCall({region: REGION}, async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Login required."
      );
    }

    const body = asRecord(request.data);
    const pendingEmail = normalizeLower(body.pendingEmail);

    if (!pendingEmail) {
      throw new HttpsError(
        "invalid-argument",
        "Email address is required."
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pendingEmail)) {
      throw new HttpsError(
        "invalid-argument",
        "Please provide a valid email address."
      );
    }

    const uid = normalizeText(request.auth.uid);
    const profileRef = db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();

    if (!profileSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Your CAMPUS profile could not be found."
      );
    }

    let authEmail = "";
    try {
      const authUser = await admin.auth().getUser(uid);
      authEmail = normalizeLower(authUser.email);
    } catch (error) {
      authLogger.warn("savePendingEmailVerification unable to load auth email", {
        uid,
        error,
      });
    }

    const tracksCurrentAuthEmail =
      Boolean(authEmail) &&
      !isCampusLocalEmail(authEmail) &&
      authEmail === pendingEmail;

    // We keep onboarding locked until the verified address comes back through
    // Firebase so School ID logins continue to enforce verification safely.
    await profileRef.set(
      {
        email: tracksCurrentAuthEmail ? authEmail : normalizeLower(profileSnap.data()?.email),
        pendingEmail: tracksCurrentAuthEmail ? null : pendingEmail,
        mustChangePassword: true,
        emailVerificationPending: true,
        emailVerified: false,
        firstLoginCompleted: false,
        status: "pending",
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    const refreshedProfileSnap = await profileRef.get();
    return {
      profile: buildCampusProfilePayload(refreshedProfileSnap.data() ?? {}),
    };
  });

export const finalizeVerifiedCampusProfile = onCall({region: REGION}, async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Login required."
      );
    }

    const uid = normalizeText(request.auth.uid);
    const profileRef = db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();

    if (!profileSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Your CAMPUS profile could not be found."
      );
    }

    const profileData = profileSnap.data() ?? {};

    let authUser: admin.auth.UserRecord;
    try {
      authUser = await admin.auth().getUser(uid);
    } catch (error: unknown) {
      const authError = error as {message?: string};
      throw new HttpsError(
        "internal",
        authError.message || "Unable to verify your Firebase account."
      );
    }

    const authEmail = normalizeLower(authUser.email);
    const currentEmail = normalizeLower(profileData.email);
    const pendingEmail = normalizeLower(profileData.pendingEmail);
    const stalePendingEmail = Boolean(
      pendingEmail &&
      (
        (authEmail && !isCampusLocalEmail(authEmail) && pendingEmail !== authEmail) ||
        (
          currentEmail &&
          !isCampusLocalEmail(currentEmail) &&
          pendingEmail !== currentEmail
        )
      ),
    );

    if (authEmail) {
      const syncPatch: FirebaseFirestore.DocumentData = {};
      if (authEmail !== currentEmail) {
        syncPatch.email = authEmail;
        profileData.email = authEmail;
      }
      if (stalePendingEmail) {
        syncPatch.pendingEmail = null;
        profileData.pendingEmail = null;
      }
      if (Object.keys(syncPatch).length > 0) {
        syncPatch.updatedAt = serverTimestamp();
        await profileRef.set(syncPatch, {merge: true});
      }
    }

    if (!authEmail || authUser.emailVerified !== true) {
      return {
        finalized: false,
        profile: buildCampusProfilePayload(profileData),
      };
    }

    const hasVerificationStateToFinalize =
      profileData.emailVerificationPending === true ||
      profileData.emailVerified !== true ||
      profileData.firstLoginCompleted !== true ||
      Boolean(normalizeLower(profileData.pendingEmail));

    if (!hasVerificationStateToFinalize && normalizeLower(profileData.email) === authEmail) {
      return {
        finalized: false,
        profile: buildCampusProfilePayload(profileData),
      };
    }

    await profileRef.set(
      {
        email: authEmail,
        emailVerified: true,
        emailVerificationPending: false,
        mustChangePassword: false,
        firstLoginCompleted: true,
        pendingEmail: null,
        status: profileData.status === "Inactive" ? "Inactive" : "active",
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    const refreshedProfileSnap = await profileRef.get();
    authLogger.info("finalizeVerifiedCampusProfile finalized", {
      role: normalizeText(refreshedProfileSnap.data()?.role),
    });

    return {
      finalized: true,
      profile: buildCampusProfilePayload(refreshedProfileSnap.data() ?? {}),
    };
  });

export const adminUpsertPortableDevice = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const body = asRecord(request.data);
    const deviceId = normalizeText(body.deviceId);
    const secret = normalizeText(body.secret);
    const name = normalizeText(body.name) || deviceId;
    const enabled = body.enabled !== false;

    if (!deviceId) {
      throw new HttpsError(
        "invalid-argument",
        "Device ID is required."
      );
    }

    if (!secret) {
      throw new HttpsError(
        "invalid-argument",
        "Device secret is required."
      );
    }

    await db.doc(`devices/${deviceId}`).set(
      {
        name,
        secret,
        enabled,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      {merge: true}
    );

    return {deviceId, enabled};
  });

export const logPermissionDeniedAttempt = onCall({region: REGION}, async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    const body = asRecord(request.data);
    const targetType = normalizeText(body.targetType) || "unknown";
    const targetId = normalizeText(body.targetId) || "unknown";
    const attemptedAction = normalizeText(body.action) || "unknown";
    const reason = normalizeText(body.reason) || "permission-denied";

    await writeStructuredAuditLog({
      actorUid: request.auth.uid,
      action: "permission_denied_attempt",
      targetType,
      targetId,
      metadata: {
        attemptedAction,
        reason,
      },
    });

    return {ok: true};
  });

export const studentManagePreRegistration = onCall({region: REGION}, async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Login required."
      );
    }

    const body = asRecord(request.data);
    const eventId = normalizeText(body.eventId);
    const action = normalizeLower(body.action) === "cancel" ? "cancel" : "register";
    const uid = normalizeText(request.auth.uid);

    if (!eventId) {
      throw new HttpsError(
        "invalid-argument",
        "eventId is required."
      );
    }

    const eventRef = db.doc(`events/${eventId}`);
    const registrationRef = db.doc(`events/${eventId}/registrations/${uid}`);
    const profileRef = db.doc(`profiles/${uid}`);
    const studentRef = db.doc(`students/${uid}`);

    type ResultPayload = {
      status: "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED";
      message: string;
      preRegCount: number;
      waitlistCount: number;
      promotedStudentUid: string;
    };

    const result = await db.runTransaction<ResultPayload>(async (transaction) => {
      const [eventSnap, profileSnap, studentSnap] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(profileRef),
        transaction.get(studentRef),
      ]);

      if (!eventSnap.exists) {
        throw new HttpsError(
          "not-found",
          "Event not found."
        );
      }

      const profileData = profileSnap.data() ?? {};
      const studentData = studentSnap.data() ?? {};
      if (!hasStudentIdentityData({...studentData, ...profileData})) {
        throw new HttpsError(
          "permission-denied",
          "Student access only."
        );
      }

      const accountStatus =
        normalizeLower(studentData.status) ||
        normalizeLower(profileData.status);
      if (accountStatus === "inactive") {
        throw new HttpsError(
          "failed-precondition",
          "Approach EC member to activate your account first."
        );
      }

      const eventData = eventSnap.data() ?? {};
      if (eventData.isPreReg !== true) {
        throw new HttpsError(
          "failed-precondition",
          "This event is not open for pre-registration."
        );
      }

      const nowMs = Date.now();
      const registrationStartMs = resolveRegistrationStartMs(eventData);
      const registrationEndMs = resolveRegistrationEndMs(eventData);
      const cancellationDeadlineMs = resolveCancellationDeadlineMs(eventData);
      const eventStartMs = resolveEventStartMs(eventData);

      if (action === "register") {
        if (registrationStartMs > 0 && nowMs < registrationStartMs) {
          throw new HttpsError(
            "failed-precondition",
            "Registration has not opened yet."
          );
        }

        if (registrationEndMs > 0 && nowMs > registrationEndMs) {
          throw new HttpsError(
            "failed-precondition",
            "Registration is already closed."
          );
        }

        if (eventStartMs !== Number.MAX_SAFE_INTEGER && nowMs >= eventStartMs) {
          throw new HttpsError(
            "failed-precondition",
            "Registration is already closed for this event."
          );
        }
      } else if (cancellationDeadlineMs > 0 && nowMs > cancellationDeadlineMs) {
        throw new HttpsError(
          "failed-precondition",
          "The cancellation deadline has already passed."
        );
      }

      const schoolId = normalizeText(profileData.schoolId) || uid;
      const studentName =
        normalizeText(profileData.studentName) ||
        normalizeText(profileData.name) ||
        schoolId;
      if (!matchesSelectedAudience(eventData, uid, schoolId)) {
        throw new HttpsError(
          "permission-denied",
          "You are not part of the allowed audience for this event."
        );
      }
      const course = normalizeText(profileData.course) || "Unassigned";
      const year = normalizeYear(profileData.year);

      const courseTargets = toTargetList(eventData.courses);
      const yearTargets = toTargetList(eventData.yearLevels);
      const courseValue =
        courseTargets.length > 0 ?
          courseTargets :
          normalizeText(eventData.course);
      const yearValue =
        yearTargets.length > 0 ?
          yearTargets :
          normalizeText(eventData.yearLevel);

      if (!hasExplicitSelectedAudience(eventData)) {
        if (!matchesTargetList(courseValue, course, "All Courses")) {
          throw new HttpsError(
            "permission-denied",
            "Your course is not allowed for this event."
          );
        }

        if (!matchesTargetList(yearValue, year, "All Years")) {
          throw new HttpsError(
            "permission-denied",
            "Your year level is not allowed for this event."
          );
        }

        if (!matchesSpecificStudentTarget(eventData.targetStudent, schoolId, studentName)) {
          throw new HttpsError(
            "permission-denied",
            "You are not part of the allowed audience for this event."
          );
        }
      }

      const requiredPaymentId =
        normalizeText(eventData.linkedPaymentId) ||
        normalizeText(eventData.requiredPaymentId);
      if (eventData.withPayment === true || eventData.paymentRequired === true) {
        if (!requiredPaymentId) {
          throw new HttpsError(
            "failed-precondition",
            "This event requires a linked payment before registration."
          );
        }

        const paymentAssignmentSnap = await transaction.get(
          db.doc(`payments/${requiredPaymentId}/students/${uid}`)
        );

        if (!paymentAssignmentSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Complete the required payment first."
          );
        }

        const paymentStatus = normalizeLower(paymentAssignmentSnap.data()?.status);
        if (paymentStatus !== "paid") {
          throw new HttpsError(
            "failed-precondition",
            "Complete the required payment first."
          );
        }
      }

      const registrationsSnap = await transaction.get(
        db.collection(`events/${eventId}/registrations`)
      );

      let currentRegistrationData: FirebaseFirestore.DocumentData | null = null;
      const waitlistedSnapshots: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      let preRegisteredCount = 0;
      let waitlistCount = 0;

      registrationsSnap.docs.forEach((registrationDoc) => {
        const registrationData = registrationDoc.data();
        const studentUid =
          normalizeText(registrationData.uid) ||
          normalizeText(registrationData.studentUid) ||
          registrationDoc.id;
        const status = parseRegistrationStatus(registrationData.status);

        if (studentUid === uid || registrationDoc.id === uid) {
          currentRegistrationData = registrationData;
        }

        if (status === "PRE_REGISTERED") {
          preRegisteredCount += 1;
        } else if (status === "WAITLISTED") {
          waitlistCount += 1;
          waitlistedSnapshots.push(registrationDoc);
        }
      });

      const currentRegistrationPayload =
        currentRegistrationData as FirebaseFirestore.DocumentData | null;
      const currentStatus = currentRegistrationPayload ?
        parseRegistrationStatus(currentRegistrationPayload["status"]) :
        null;
      const slots = typeof eventData.preRegSlots === "number" ?
        Math.max(0, Math.trunc(eventData.preRegSlots)) :
        null;
      const waitlistEnabled = eventData.waitlistEnabled === true;
      let nextStatus: "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED";
      let message = "";
      let promotedStudentUid = "";

      const notificationRef = db.doc(
        `profiles/${uid}/notifications/${makeStudentNotificationId(eventId)}`
      );

      if (action === "register") {
        if (currentStatus === "PRE_REGISTERED") {
          throw new HttpsError(
            "already-exists",
            "You are already pre-registered for this event."
          );
        }

        if (currentStatus === "WAITLISTED") {
          throw new HttpsError(
            "already-exists",
            "You are already on the waitlist for this event."
          );
        }

        const hasSlot = slots == null || preRegisteredCount < slots;
        if (hasSlot) {
          nextStatus = "PRE_REGISTERED";
          preRegisteredCount += 1;
          message = "Pre-registration confirmed.";
        } else if (waitlistEnabled) {
          nextStatus = "WAITLISTED";
          waitlistCount += 1;
          message = "Event is full. You have been added to the waitlist.";
        } else {
          throw new HttpsError(
            "failed-precondition",
            "All pre-registration slots are already full."
          );
        }

        const existingRegistrationData =
          (currentRegistrationPayload ?? {}) as FirebaseFirestore.DocumentData;
        transaction.set(
          registrationRef,
          {
            uid,
            schoolId,
            studentName,
            course,
            year,
            status: nextStatus,
            createdAt: existingRegistrationData.createdAt ?? serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedByUid: uid,
            actorRole: "student",
            registeredAt:
              nextStatus === "PRE_REGISTERED" ?
                serverTimestamp() :
                existingRegistrationData.registeredAt ?? null,
            waitlistedAt:
              nextStatus === "WAITLISTED" ?
                serverTimestamp() :
                existingRegistrationData.waitlistedAt ?? null,
            cancelledAt: null,
            cancellationReason: null,
          },
          {merge: true}
        );

        transaction.set(
          notificationRef,
          {
            title:
              nextStatus === "PRE_REGISTERED" ?
                `Pre-registration confirmed: ${normalizeText(eventData.title) || "Event"}` :
                `Waitlisted: ${normalizeText(eventData.title) || "Event"}`,
            message: message,
            date: normalizeText(eventData.date),
            scheduledTime: normalizeText(eventData.scheduledTime) ||
              normalizeText(eventData.timeStart),
            type: "preregister",
            createdAt: serverTimestamp(),
          },
          {merge: true}
        );
      } else {
        if (!currentRegistrationData || !currentStatus) {
          throw new HttpsError(
            "not-found",
            "No active pre-registration record was found."
          );
        }

        if (currentStatus === "CANCELLED") {
          throw new HttpsError(
            "failed-precondition",
            "This registration is already cancelled."
          );
        }

        nextStatus = "CANCELLED";
        const existingRegistrationData =
          currentRegistrationPayload as FirebaseFirestore.DocumentData;

        if (currentStatus === "PRE_REGISTERED") {
          preRegisteredCount = Math.max(0, preRegisteredCount - 1);
        } else if (currentStatus === "WAITLISTED") {
          waitlistCount = Math.max(0, waitlistCount - 1);
        }

        transaction.set(
          registrationRef,
          {
            status: "CANCELLED",
            updatedAt: serverTimestamp(),
            updatedByUid: uid,
            actorRole: "student",
            cancelledAt: serverTimestamp(),
            cancellationReason: "student_cancelled",
            createdAt: existingRegistrationData.createdAt ?? serverTimestamp(),
          },
          {merge: true}
        );

        message = "Your pre-registration was cancelled.";

        if (currentStatus === "PRE_REGISTERED" && waitlistEnabled) {
          const nextWaitlisted = waitlistedSnapshots
            .filter((registrationDoc) => registrationDoc.id !== uid)
            .sort((left, right) => toMillis(left.data().createdAt) - toMillis(right.data().createdAt))[0];

          if (nextWaitlisted) {
            const nextWaitlistedData = nextWaitlisted.data();
            promotedStudentUid =
              normalizeText(nextWaitlistedData.uid) ||
              normalizeText(nextWaitlistedData.studentUid) ||
              nextWaitlisted.id;

            if (promotedStudentUid) {
              preRegisteredCount += 1;
              waitlistCount = Math.max(0, waitlistCount - 1);

              transaction.set(
                nextWaitlisted.ref,
                {
                  status: "PRE_REGISTERED",
                  updatedAt: serverTimestamp(),
                  updatedByUid: uid,
                  actorRole: "system",
                  registeredAt: serverTimestamp(),
                  promotedFromWaitlistAt: serverTimestamp(),
                },
                {merge: true}
              );

              const promotedNotificationRef = db.doc(
                `profiles/${promotedStudentUid}/notifications/${makeStudentNotificationId(eventId)}`
              );
              transaction.set(
                promotedNotificationRef,
                {
                  title: `Pre-registration confirmed: ${normalizeText(eventData.title) || "Event"}`,
                  message: "A slot opened up and your waitlist entry was promoted.",
                  date: normalizeText(eventData.date),
                  scheduledTime: normalizeText(eventData.scheduledTime) ||
                    normalizeText(eventData.timeStart),
                  type: "preregister",
                  createdAt: serverTimestamp(),
                },
                {merge: true}
              );
            }
          }
        }

        transaction.set(
          notificationRef,
          {
            title: `Registration cancelled: ${normalizeText(eventData.title) || "Event"}`,
            message,
            date: normalizeText(eventData.date),
            scheduledTime: normalizeText(eventData.scheduledTime) ||
              normalizeText(eventData.timeStart),
            type: "preregister",
            createdAt: serverTimestamp(),
          },
          {merge: true}
        );
      }

      transaction.set(
        eventRef,
        {
          preRegCount: preRegisteredCount,
          preRegRemaining:
            slots == null ?
              null :
              Math.max(0, slots - preRegisteredCount),
          waitlistCount,
          updatedAt: serverTimestamp(),
        },
        {merge: true}
      );

      return {
        status: nextStatus,
        message,
        preRegCount: preRegisteredCount,
        waitlistCount,
        promotedStudentUid,
      };
    });

    return result;
  });

export const auditStudentWrites = onDocumentUpdatedWithAuthContext(
  {region: REGION, document: "students/{studentId}"},
  async (event) => {
    if (shouldSkipAuthContextAudit(event)) {
      return;
    }

    const beforeData = event.data?.before.data() ?? {};
    const afterData = event.data?.after.data() ?? {};
    const studentId = normalizeText(event.params.studentId);
    const actorUid = normalizeText(event.authId);

    const readyBefore = beforeData.readyForClearance === true;
    const readyAfter = afterData.readyForClearance === true;
    if (!readyBefore && readyAfter) {
      await writeStructuredAuditLog({
        actorUid,
        action: "student_marked_ready_for_clearance",
        targetType: "student",
        targetId: studentId,
      });
    }

    const editedKeys = [
      "schoolId",
      "studentName",
      "name",
      "fullName",
      "course",
      "year",
      "yearLevel",
      "status",
    ].filter((key) => JSON.stringify(beforeData[key]) !== JSON.stringify(afterData[key]));

    if (editedKeys.length > 0) {
      await writeStructuredAuditLog({
        actorUid,
        action: "student_edited",
        targetType: "student",
        targetId: studentId,
        metadata: {
          editedKeys,
        },
      });
    }
  },
);

export const auditEventCreates = onDocumentCreatedWithAuthContext(
  {region: REGION, document: "events/{eventId}"},
  async (event) => {
    if (shouldSkipAuthContextAudit(event)) {
      return;
    }

    await writeStructuredAuditLog({
      actorUid: event.authId,
      action: "event_created",
      targetType: "event",
      targetId: normalizeText(event.params.eventId),
      metadata: {
        ownerType: normalizeText(event.data?.data()?.ownerType),
        courseScope: normalizeCourseLabel(event.data?.data()?.courseScope) || null,
      },
    });
  },
);

export const auditEventUpdates = onDocumentUpdatedWithAuthContext(
  {region: REGION, document: "events/{eventId}"},
  async (event) => {
    if (shouldSkipAuthContextAudit(event)) {
      return;
    }

    await writeStructuredAuditLog({
      actorUid: event.authId,
      action: "event_edited",
      targetType: "event",
      targetId: normalizeText(event.params.eventId),
      metadata: {
        ownerType: normalizeText(event.data?.after.data()?.ownerType),
        courseScope: normalizeCourseLabel(event.data?.after.data()?.courseScope) || null,
      },
    });
  },
);

export const auditEventDeletes = onDocumentDeletedWithAuthContext(
  {region: REGION, document: "events/{eventId}"},
  async (event) => {
    if (shouldSkipAuthContextAudit(event)) {
      return;
    }

    await writeStructuredAuditLog({
      actorUid: event.authId,
      action: "event_deleted",
      targetType: "event",
      targetId: normalizeText(event.params.eventId),
      metadata: {
        ownerType: normalizeText(event.data?.data()?.ownerType),
        courseScope: normalizeCourseLabel(event.data?.data()?.courseScope) || null,
      },
    });
  },
);

// Portable device HTTP endpoints now live exclusively in the
// `portable-device-functions` codebase. Keeping them out of the default
// codebase avoids Firebase deploy ownership conflicts for the same
// `campusDevice*` function names.
