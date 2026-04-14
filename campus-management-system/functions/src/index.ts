import * as admin from "firebase-admin";
import {HttpsError, onCall, type CallableRequest} from "firebase-functions/v2/https";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-southeast1";

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
  course?: string;
  year?: string;
};

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
    course: optionalText(data.course),
    year: optionalText(data.year),
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
    const name = normalizeText(body.name);
    const teacherName = normalizeText(body.teacherName);
    const studentName = normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);
    const resolvedTeacherName = teacherName || name;
    const resolvedStudentName = studentName || name;
    const resolvedEcName = name;

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

    if (role === "teacher" && !resolvedTeacherName) {
      throw new HttpsError(
        "invalid-argument",
        "teacherName is required for teacher role."
      );
    }

    if (role === "student" && !resolvedStudentName) {
      throw new HttpsError(
        "invalid-argument",
        "studentName is required for student role."
      );
    }

    if (role === "ec" && !resolvedEcName) {
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
        "year is required for student and ec roles."
      );
    }

    const email = emailRaw || `${schoolId}@campus.local`;

    try {
      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;

      const profilePayload: FirebaseFirestore.DocumentData = {
        schoolId,
        email,
        role,
        mustChangePassword: true,
        emailVerified: false,
        emailVerificationPending: false,
        pendingEmail: null,
        firstLoginCompleted: false,
        status: "pending",
        createdAt: serverTimestamp(),
      };

      if (role === "teacher") {
        profilePayload.teacherName = resolvedTeacherName;
        profilePayload.name = resolvedTeacherName;
      }

      if (role === "student") {
        profilePayload.studentName = resolvedStudentName;
        profilePayload.name = resolvedStudentName;
        profilePayload.course = course;
        profilePayload.year = year;
      }

      if (role === "ec") {
        profilePayload.name = resolvedEcName;
        profilePayload.course = course;
        profilePayload.year = year;
      }

      await db.doc(`profiles/${uid}`).set(
        profilePayload,
        {merge: true}
      );

      if (role === "student") {
        await db.doc(`students/${uid}`).set(
          {
            schoolId,
            studentName: resolvedStudentName,
            name: resolvedStudentName,
            course,
            year,
            status: "active",
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          },
          {merge: true}
        );
      }

      await db.collection("logs").add({
        action: "admin_create_user",
        actorUid: normalizeText(request.auth?.uid),
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: serverTimestamp(),
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
        authError.message || "Failed to create user."
      );
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

    const profileSnapshot = await db
      .collection("profiles")
      .where("role", "==", "student")
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

      return {
        uid: profileDoc.id,
        schoolId:
          normalizeText(profileData.schoolId) ||
          normalizeText(studentData.schoolId) ||
          profileDoc.id,
        studentName:
          normalizeText(profileData.studentName) ||
          normalizeText(studentData.studentName) ||
          normalizeText(profileData.name) ||
          normalizeText(studentData.name),
        name:
          normalizeText(profileData.name) ||
          normalizeText(studentData.name) ||
          normalizeText(profileData.studentName) ||
          normalizeText(studentData.studentName),
        course:
          normalizeText(profileData.course) ||
          normalizeText(studentData.course) ||
          "Unassigned",
        year: normalizeYear(
          profileData.year ??
          studentData.year ??
          studentData.yearLevel
        ),
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
      console.warn("resolveSchoolIdLogin: profile not found", {schoolId});
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

      console.info("resolveSchoolIdLogin: resolved", {
        schoolId,
        uid: profileDoc.id,
        source,
      });

      return {
        email: resolvedEmail,
        found: true,
        source,
      };
    } catch (error: unknown) {
      console.error("resolveSchoolIdLogin failed to read Auth user", error);
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
      console.warn("getCurrentCampusProfile: unable to sync auth email", {
        uid,
        error,
      });
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
    console.info("finalizeVerifiedCampusProfile: finalized", {
      uid,
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
