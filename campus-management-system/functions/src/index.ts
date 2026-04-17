import * as admin from "firebase-admin";
import {HttpsError, onCall, onRequest, type CallableRequest} from "firebase-functions/v2/https";
import {createCampusLogger} from "./campusLogger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-southeast1";

type BulkImportContext = {
  data: Record<string, unknown>;
  auth: {
    uid: string;
    token: admin.auth.DecodedIdToken;
    rawToken: string;
  };
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

type Role = "admin" | "ec" | "teacher" | "student";
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
  year?: string;
  yearLevel?: string;
  readyForClearance?: boolean;
};

const STUDENT_LOOKUP_PROFILE_ROLES = ["student", "ec", "ecmember"] as const;

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

function optionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeNamePart(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function buildStudentFullName(firstName: unknown, lastName: unknown): string {
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);
  return [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");
}

function normalizeCourseLabel(value: unknown): string {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (isValidCourse(normalized)) {
    return normalized;
  }

  const aliasKey = normalized.toLowerCase().replace(/[\s.-]+/g, "");
  return COURSE_ALIASES[aliasKey] ?? "";
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
    role: optionalText(data.role),
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
    year: optionalText(data.year) || optionalText(data.yearLevel),
    yearLevel: optionalText(data.yearLevel) || optionalText(data.year),
    readyForClearance: optionalBoolean(data.readyForClearance),
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
  if (role !== "admin" && role !== "ec") {
    throw new HttpsError(
      "permission-denied",
      "EC/Admin only."
    );
  }
}

export const adminCreateUser = onCall({region: REGION}, async (request) => {
    await requireAdmin(request);

    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const role = normalizeText(body.role) as Role;
    const emailRaw = normalizeText(body.email);
    const name =
      normalizeText(body.name) ||
      normalizeText(body.teacherName) ||
      normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearSource = body.yearLevel ?? body.year;
    const yearRaw = normalizeText(yearSource);
    const year = normalizeYear(yearSource);

    if (!schoolId) {
      throw new HttpsError(
        "invalid-argument",
        "School ID is required."
      );
    }

    if (!["admin", "ec", "teacher", "student"].includes(role)) {
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

    if (role === "ec" && !name) {
      throw new HttpsError(
        "invalid-argument",
        "name is required for ec role."
      );
    }

    if ((role === "student" || role === "ec") && !course) {
      throw new HttpsError(
        "invalid-argument",
        "course is required for student and ec roles."
      );
    }

    if ((role === "student" || role === "ec") && !yearRaw) {
      throw new HttpsError(
        "invalid-argument",
        "yearLevel is required for student and ec roles."
      );
    }

    const email = emailRaw || `${schoolId}@campus.local`;
    const timestamp = serverTimestamp();

    authLogger.debug("adminCreateUser request validated", {
      role,
      schoolId,
      hasName: Boolean(name),
      hasCourse: Boolean(course),
      hasYearLevel: Boolean(year),
      hasCustomEmail: Boolean(emailRaw),
    });

    try {
      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;

      const profilePayload: FirebaseFirestore.DocumentData = {
        name,
        schoolId,
        email,
        role,
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

      await db.doc(`profiles/${uid}`).set(
        profilePayload,
        {merge: true}
      );

      authLogger.debug("adminCreateUser profile write complete", {
        uid,
        role,
        schoolId,
      });

      if (role === "student") {
        await db.doc(`students/${uid}`).set(
          {
            schoolId,
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
          {merge: true}
        );

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
      });

      authLogger.info("adminCreateUser created account", {
        uid,
        role,
        schoolId,
      });

      return {uid};
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};
      authLogger.warn("adminCreateUser failed", {
        role,
        schoolId,
        code: authError.code ?? "unknown",
        message: authError.message ?? "Unknown account creation failure",
      });
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

async function fetchExistingProfileSchoolIds(schoolIds: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  const chunks: string[][] = [];
  const ids = schoolIds.filter(Boolean);
  for (let i = 0; i < ids.length; i += 10) {
    chunks.push(ids.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const snap = await db
      .collection("profiles")
      .where("schoolId", "in", chunk)
      .get();

    snap.docs.forEach((doc) => {
      const data = doc.data();
      const schoolId = normalizeText(data.schoolId);
      if (schoolId) {
        existing.add(schoolId);
      }
    });
  }

  return existing;
}

async function adminBulkImportStudentsLogic(context: BulkImportContext) {
    await requireAdmin({ auth: context.auth });

    const body = asRecord(context.data);
    const filename = normalizeText(body.filename) || "student-import.csv";
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const actorUid = context.auth.uid;
    const callerProfileSnap = await db.doc(`profiles/${actorUid}`).get();
    const actorSchoolId = normalizeText(callerProfileSnap.data()?.schoolId);
    const timestamp = serverTimestamp();

    const validatedRows = rows.map((rawRow, index) => {
      const row = asRecord(rawRow);
      const schoolId = normalizeText(row.schoolId);
      const lastName = normalizeNamePart(row.lastName);
      const firstName = normalizeNamePart(row.firstName);
      const fullName = buildStudentFullName(firstName, lastName);
      const course = normalizeCourseLabel(row.course);
      const yearLevelRaw = normalizeText(row.yearLevel);
      const status = normalizeBulkStudentStatus(row.status);
      const normalizedYear = normalizeYear(yearLevelRaw);
      const errors: string[] = [];

      if (!schoolId) {
        errors.push("School ID is required.");
      } else if (!isValidBulkSchoolId(schoolId)) {
        errors.push("School ID must be alphanumeric and at least 4 characters.");
      }
      if (!lastName) errors.push("Last name is required.");
      if (!firstName) errors.push("First name is required.");
      if (!course) {
        errors.push("Course is required.");
      } else if (!isValidCourse(course)) {
        errors.push("Invalid course. Use a CAMPUS course label such as Computer Engineering or BSCpE.");
      }
      if (!yearLevelRaw) {
        errors.push("Year level is required.");
      } else if (!normalizedYear) {
        errors.push("Invalid year level.");
      }
      if (!status) {
        errors.push("Invalid status. Use active, inactive, or pending.");
      }

      return {
        rowIndex: index + 1,
        schoolId,
        lastName,
        firstName,
        fullName,
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
    const existingSchoolIds = await fetchExistingProfileSchoolIds(uniqueSchoolIds);

    const finalResults = validatedRows.map((row) => ({ ...row })) as Array<{
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
      uid?: string;
      errors?: string[];
    }>;

    finalResults.forEach((row) => {
      const errors = Array.isArray(row.errors) ? [...row.errors] : [];
      if (row.schoolId && schoolIdCounts.get(row.schoolId)! > 1) {
        errors.push("Duplicate schoolId in CSV.");
      }
      if (row.schoolId && existingSchoolIds.has(row.schoolId)) {
        errors.push("Existing schoolId already exists in CAMPUS.");
      }
      if (errors.length > 0) {
        row.skipped = true;
        row.error = errors.join(" ");
      }
    });

    let importedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const resultRow of finalResults) {
      if (resultRow.skipped || resultRow.error) {
        skippedCount += 1;
        continue;
      }

      const email = `${resultRow.schoolId}@campus.local`;
      let createdUid: string | null = null;
      try {
        const userRecord = await admin.auth().createUser({
          email,
          password: resultRow.schoolId,
          disabled: false,
        });
        const uid = userRecord.uid;
        createdUid = uid;
        const fullName = resultRow.fullName ||
          buildStudentFullName(resultRow.firstName, resultRow.lastName);

        const profilePayload: FirebaseFirestore.DocumentData = {
          firstName: resultRow.firstName,
          lastName: resultRow.lastName,
          name: fullName,
          fullName,
          studentName: fullName,
          schoolId: resultRow.schoolId,
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

        await db.doc(`profiles/${uid}`).set(profilePayload, {merge: true});
        await db.doc(`students/${uid}`).set(
          {
            schoolId: resultRow.schoolId,
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

        resultRow.success = true;
        resultRow.uid = uid;
        importedCount += 1;
      } catch (error: unknown) {
        const authError = error as {code?: string; message?: string};
        if (createdUid) {
          await admin.auth().deleteUser(createdUid).catch(() => undefined);
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
    const schoolId = profileSnap.data()?.schoolId ?? null;

    await admin.auth().deleteUser(uid);
    await db.doc(`profiles/${uid}`).delete().catch(() => undefined);

    await db.collection("logs").add({
      action: "DELETE_USER",
      actorUid: normalizeText(request.auth?.uid),
      targetUid: uid,
      targetSchoolId: schoolId,
      createdAt: serverTimestamp(),
    });

    return {success: true};
  });

export const ecListStudents = onCall({region: REGION}, async (request) => {
    await requireAdminOrEC(request);

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
      };
    });

    return {students};
  });

export const ecCreateStudent = onCall({region: REGION}, async (request) => {
    await requireAdminOrEC(request);

    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const studentName = normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);
    const emailRaw = normalizeText(body.email);
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

    if (!yearRaw) {
      throw new HttpsError(
        "invalid-argument",
        "Year is required."
      );
    }

    const existingProfileSnapshot = await db
      .collection("profiles")
      .where("schoolId", "==", schoolId)
      .limit(1)
      .get();

    if (!existingProfileSnapshot.empty) {
      throw new HttpsError(
        "already-exists",
        "Student with this School ID already exists."
      );
    }

    try {
      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;
      const timestamp = serverTimestamp();

        await db.doc(`profiles/${uid}`).set(
          {
            schoolId,
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

        await db.doc(`students/${uid}`).set(
          {
            uid,
            studentId: uid,
            schoolId,
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

      await db.collection("logs").add({
        action: "ec_create_student",
        actorUid: normalizeText(request.auth?.uid),
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: timestamp,
      });

      return {uid};
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};
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

      const requiredPaymentId = normalizeText(eventData.requiredPaymentId);
      if (eventData.withPayment === true) {
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

// Portable device HTTP endpoints now live exclusively in the
// `portable-device-functions` codebase. Keeping them out of the default
// codebase avoids Firebase deploy ownership conflicts for the same
// `campusDevice*` function names.
