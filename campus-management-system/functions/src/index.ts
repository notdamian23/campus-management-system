import * as admin from "firebase-admin";
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
  year?: string;
  yearLevel?: string;
  readyForClearance?: boolean;
  ecPosition?: string;
  isBod?: boolean;
};

const STUDENT_LOOKUP_PROFILE_ROLES = ["student"] as const;

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
): "admin" | "ecmember" | "teacher" | "student" | "" {
  const normalized = normalizeLower(value);
  if (!normalized) {
    return "";
  }

  const compact = normalized.replace(/[^a-z]/g, "");
  if (compact === "admin") return "admin";
  if (compact === "teacher") return "teacher";
  if (compact === "student") return "student";
  if (compact === "ec" || compact === "ecmember" || compact === "ecmemberprofile") {
    return "ecmember";
  }

  return "";
}

function isECMemberRole(value: unknown): boolean {
  return normalizeCampusRoleValue(value) === "ecmember";
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

function resolveAssignedCourseCode(data: FirebaseFirestore.DocumentData): string {
  return (
    normalizeAssignedCourseCode(data.assignedCourse) ||
    extractAssignedCourseFromPosition(data.ecPosition) ||
    normalizeAssignedCourseCode(data.courseScope)
  );
}

function resolveProfileEcScope(
  data: FirebaseFirestore.DocumentData,
): "all" | "course" | "" {
  if (!isECMemberRole(data.role)) {
    return "";
  }

  const explicitScope = normalizeEcScope(data.ecScope);
  if (explicitScope) {
    return explicitScope;
  }

  return resolveAssignedCourseCode(data) ? "course" : "all";
}

function resolveProfileCourseScope(data: FirebaseFirestore.DocumentData): string {
  const assignedCourseCode = resolveAssignedCourseCode(data);
  if (resolveProfileEcScope(data) === "course" && assignedCourseCode) {
    return COURSE_CODE_TO_SCOPE[assignedCourseCode] ?? "";
  }

  if (resolveProfileEcScope(data) === "all") {
    return "";
  }

  return (
    normalizeCourseLabel(data.courseScope) ||
    inferCourseScopeFromPosition(data.ecPosition)
  );
}

function isBodProfileData(data: FirebaseFirestore.DocumentData): boolean {
  const explicitEcScope = normalizeEcScope(data.ecScope);
  if (!isECMemberRole(data.role) || explicitEcScope === "all") {
    return false;
  }

  return isECMemberRole(data.role) &&
    (
      resolveProfileEcScope(data) === "course" ||
      data.isBod === true ||
      Boolean(inferCourseScopeFromPosition(data.ecPosition))
    );
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
    courseScope:
      data.courseScope === null ? null : optionalText(data.courseScope) || null,
    year: optionalText(data.year) || optionalText(data.yearLevel),
    yearLevel: optionalText(data.yearLevel) || optionalText(data.year),
    readyForClearance: optionalBoolean(data.readyForClearance),
    ecPosition: optionalText(data.ecPosition),
    isBod: optionalBoolean(data.isBod),
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
  if (isECMemberRole(data.role)) {
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
    const bodAssignedCourse = requestedAssignedCourse || inferredAssignedCourse;
    const isBod = role === "ecmember" &&
      (
        requestedEcScope === "course" ||
        requestedEcPosition === "B.O.D." ||
        Boolean(inferredCourseScope) ||
        Boolean(bodAssignedCourse)
      );
    const ecPosition = role !== "ecmember" ?
      "" :
      isBod ?
        (bodAssignedCourse ? `B.O.D. (${bodAssignedCourse})` : "B.O.D.") :
        requestedEcPosition;
    const ecScope = role !== "ecmember" ?
      "" :
      isBod ?
        "course" :
        "all";
    const courseScope = isBod && bodAssignedCourse ?
      (COURSE_CODE_TO_SCOPE[bodAssignedCourse] ?? "") :
      "";
    const course = normalizeText(body.course);
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

    if (!["admin", "ecmember", "teacher", "student"].includes(role)) {
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

    if ((role === "student" || role === "ecmember") && !course) {
      throw new HttpsError(
        "invalid-argument",
        "course is required for student and ec roles."
      );
    }

    if ((role === "student" || role === "ecmember") && !yearRaw) {
      throw new HttpsError(
        "invalid-argument",
        "yearLevel is required for student and ec roles."
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
    const requiresStudentSchoolIdGuard = role === "student";
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
        role,
        ecPosition: role === "ecmember" ? ecPosition : "",
        ecScope: role === "ecmember" ? ecScope : null,
        assignedCourse: role === "ecmember" ? (bodAssignedCourse || null) : null,
        courseScope: role === "ecmember" ? (courseScope || null) : null,
        isBod: role === "ecmember" ? isBod : false,
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

      if (role === "student") {
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

      if (role === "student") {
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
        role,
        schoolId,
      });

      authLogger.info("adminCreateUser created account", {
        uid,
        role,
        schoolId,
      });

      if (role === "student") {
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
    const rawLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(rawLimit) ?
      Math.min(Math.max(rawLimit, 1), 5000) :
      2000;

    // EC members are still part of the student roster, so the lookup includes
    // both student and ecmember roles.
    const profileSnapshot = await db
      .collection("profiles")
      .where("role", "in", [...STUDENT_LOOKUP_PROFILE_ROLES])
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

    const students = profileSnapshot.docs.map((profileDoc) => {
      const profileData = profileDoc.data() ?? {};
      const studentData = studentByUid.get(profileDoc.id) ?? {};
      const firstName =
        normalizeNamePart(profileData.firstName) ||
        normalizeNamePart(studentData.firstName);
      const lastName =
        normalizeNamePart(profileData.lastName) ||
        normalizeNamePart(studentData.lastName);
      const combinedFullName = buildStudentFullName(firstName, lastName);

        return {
          uid: profileDoc.id,
          role: normalizeText(profileData.role),
          schoolId:
            normalizeText(profileData.schoolId) ||
            normalizeText(studentData.schoolId) ||
          profileDoc.id,
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
        course:
          normalizeText(profileData.course) ||
          normalizeText(studentData.course) ||
          "Unassigned",
        yearLevel: normalizeYear(
          profileData.year ??
          profileData.yearLevel ??
          studentData.year ??
          studentData.yearLevel
        ),
        year: normalizeYear(
          profileData.year ??
          profileData.yearLevel ??
          studentData.year ??
          studentData.yearLevel
        ),
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
    }).filter((student) => {
      if (!actorIsBod) {
        return true;
      }

      return Boolean(
        actorCourseScope &&
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
            studentName,
            name: studentName,
            course,
            year,
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

      if (
        authEmail &&
        authEmail !== currentEmail &&
        (!pendingEmail || pendingEmail === authEmail)
      ) {
        await profileRef.set(
          {
            email: authEmail,
            updatedAt: serverTimestamp(),
          },
          {merge: true}
        );
        profileData.email = authEmail;
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

    // We keep onboarding locked until the verified address comes back through
    // Firebase so School ID logins continue to enforce verification safely.
    await profileRef.set(
      {
        pendingEmail,
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
    if (!authEmail || authUser.emailVerified !== true) {
      return {
        finalized: false,
        profile: buildCampusProfilePayload(profileData),
      };
    }

    const pendingEmail = normalizeLower(profileData.pendingEmail);
    const currentEmail = normalizeLower(profileData.email);
    const shouldFinalize =
      (pendingEmail && pendingEmail === authEmail) ||
      (
        !pendingEmail &&
        currentEmail === authEmail &&
        (
          profileData.emailVerificationPending === true ||
          profileData.emailVerified === false ||
          profileData.firstLoginCompleted === false
        )
      );

    if (!shouldFinalize) {
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
        pendingEmail: admin.firestore.FieldValue.delete(),
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
      const role = normalizeLower(profileData.role);
      if (role !== "student") {
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
