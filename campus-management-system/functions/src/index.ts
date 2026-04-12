import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import type {Request, Response} from "express";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-southeast1";
const MANILA_TIME_ZONE = "Asia/Manila";

type Role = "admin" | "ec" | "teacher" | "student";

type DeviceContext = {
  deviceId: string;
  secret: string;
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
};

type DeviceHandler = (
  req: Request,
  res: Response,
  device: DeviceContext
) => Promise<void>;

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

function parseQueryInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(normalizeText(raw), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function formatManilaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

async function callerRole(
  context: functions.https.CallableContext
): Promise<string> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }

  const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
  return callerProfileSnap.exists ?
    String(callerProfileSnap.data()?.role ?? "") :
    "";
}

async function requireAdmin(
  context: functions.https.CallableContext
): Promise<void> {
  const role = await callerRole(context);
  if (role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin only."
    );
  }
}

async function authenticateDevice(req: Request): Promise<DeviceContext> {
  const deviceId = normalizeText(req.get("X-Device-Id"));
  const secret = normalizeText(req.get("X-Device-Secret"));

  if (!deviceId || !secret) {
    throw new ApiError(401, "Missing device authentication headers.");
  }

  const ref = db.doc(`devices/${deviceId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ApiError(403, "Device is not registered.");
  }

  const data = snap.data() ?? {};
  if (data.enabled === false) {
    throw new ApiError(403, "Device is disabled.");
  }

  if (normalizeText(data.secret) !== secret) {
    throw new ApiError(403, "Device secret is invalid.");
  }

  await ref.set(
    {
      lastSeenAt: serverTimestamp(),
    },
    {merge: true}
  );

  return {deviceId, secret, ref, data};
}

function sendJson(res: Response, status: number, payload: unknown): void {
  res.status(status).json(payload);
}

function deviceEndpoint(
  method: "GET" | "POST",
  handler: DeviceHandler
) {
  return functions.region(REGION).https.onRequest(
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");

      if (req.method === "OPTIONS") {
        res.set("Allow", `${method}, OPTIONS`);
        res.status(204).send("");
        return;
      }

      if (req.method !== method) {
        res.set("Allow", `${method}, OPTIONS`);
        sendJson(res, 405, {error: "Method not allowed."});
        return;
      }

      try {
        const device = await authenticateDevice(req);
        await handler(req, res, device);
      } catch (error: unknown) {
        const status = error instanceof ApiError ? error.status : 500;
        const message = errorMessage(error, "Internal server error.");
        console.error("Portable device endpoint failed", error);
        sendJson(res, status, {error: message});
      }
    }
  );
}

export const adminCreateUser = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdmin(context);

    const body = asRecord(data);
    const schoolId = normalizeText(body.schoolId);
    const role = normalizeText(body.role) as Role;
    const emailRaw = normalizeText(body.email);
    const studentName = normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);

    if (!schoolId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "School ID is required."
      );
    }

    if (!["admin", "ec", "teacher", "student"].includes(role)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid role."
      );
    }

    if (role === "student" && !studentName) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "studentName is required for student role."
      );
    }

    if (role === "student" && !course) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "course is required for student role."
      );
    }

    if (role === "student" && !yearRaw) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "year is required for student role."
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

      if (role === "student") {
        profilePayload.studentName = studentName;
        profilePayload.name = studentName;
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
            studentName,
            name: studentName,
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
        actorUid: normalizeText(context.auth?.uid),
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: serverTimestamp(),
      });

      return {uid};
    } catch (error: unknown) {
      const authError = error as {code?: string; message?: string};
      if (authError.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError(
          "already-exists",
          "Account already exists."
        );
      }

      throw new functions.https.HttpsError(
        "internal",
        authError.message || "Failed to create user."
      );
    }
  });

export const adminDeleteUser = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdmin(context);

    const body = asRecord(data);
    const uid = normalizeText(body.uid);

    if (!uid) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "uid required"
      );
    }

    if (uid === normalizeText(context.auth?.uid)) {
      throw new functions.https.HttpsError(
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
      actorUid: normalizeText(context.auth?.uid),
      targetUid: uid,
      targetSchoolId: schoolId,
      createdAt: serverTimestamp(),
    });

    return {success: true};
  });

export const resolveSchoolIdLogin = functions
  .region(REGION)
  .https.onCall(async (data) => {
    const body = asRecord(data);
    const schoolId = normalizeText(body.schoolId);

    if (!schoolId) {
      throw new functions.https.HttpsError(
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
      return {email: null};
    }

    const profileDoc = profileSnapshot.docs[0];
    const profileData = profileDoc.data() ?? {};
    const profileEmail = normalizeText(profileData.email);

    try {
      const userRecord = await admin.auth().getUser(profileDoc.id);
      return {
        email:
          normalizeText(userRecord.email) ||
          profileEmail ||
          `${schoolId}@campus.local`,
      };
    } catch (error: unknown) {
      console.error("resolveSchoolIdLogin failed to read Auth user", error);
      return {
        email: profileEmail || `${schoolId}@campus.local`,
      };
    }
  });

export const adminUpsertPortableDevice = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdmin(context);

    const body = asRecord(data);
    const deviceId = normalizeText(body.deviceId);
    const secret = normalizeText(body.secret);
    const name = normalizeText(body.name) || deviceId;
    const enabled = body.enabled !== false;

    if (!deviceId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Device ID is required."
      );
    }

    if (!secret) {
      throw new functions.https.HttpsError(
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

export const studentManagePreRegistration = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Login required."
      );
    }

    const body = asRecord(data);
    const eventId = normalizeText(body.eventId);
    const action = normalizeLower(body.action) === "cancel" ? "cancel" : "register";
    const uid = normalizeText(context.auth.uid);

    if (!eventId) {
      throw new functions.https.HttpsError(
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
        throw new functions.https.HttpsError(
          "not-found",
          "Event not found."
        );
      }

      const profileData = profileSnap.data() ?? {};
      const studentData = studentSnap.data() ?? {};
      const role = normalizeLower(profileData.role);
      if (role !== "student") {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Student access only."
        );
      }

      const accountStatus =
        normalizeLower(studentData.status) ||
        normalizeLower(profileData.status);
      if (accountStatus === "inactive") {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Approach EC member to activate your account first."
        );
      }

      const eventData = eventSnap.data() ?? {};
      if (eventData.isPreReg !== true) {
        throw new functions.https.HttpsError(
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
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Registration has not opened yet."
          );
        }

        if (registrationEndMs > 0 && nowMs > registrationEndMs) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Registration is already closed."
          );
        }

        if (eventStartMs !== Number.MAX_SAFE_INTEGER && nowMs >= eventStartMs) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Registration is already closed for this event."
          );
        }
      } else if (cancellationDeadlineMs > 0 && nowMs > cancellationDeadlineMs) {
        throw new functions.https.HttpsError(
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
        throw new functions.https.HttpsError(
          "permission-denied",
          "Your course is not allowed for this event."
        );
      }

      if (!matchesTargetList(yearValue, year, "All Years")) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Your year level is not allowed for this event."
        );
      }

      if (!matchesSpecificStudentTarget(eventData.targetStudent, schoolId, studentName)) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "You are not part of the allowed audience for this event."
        );
      }

      const requiredPaymentId = normalizeText(eventData.requiredPaymentId);
      if (eventData.withPayment === true) {
        if (!requiredPaymentId) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "This event requires a linked payment before registration."
          );
        }

        const paymentAssignmentSnap = await transaction.get(
          db.doc(`payments/${requiredPaymentId}/students/${uid}`)
        );

        if (!paymentAssignmentSnap.exists) {
          throw new functions.https.HttpsError(
            "failed-precondition",
            "Complete the required payment first."
          );
        }

        const paymentStatus = normalizeLower(paymentAssignmentSnap.data()?.status);
        if (paymentStatus !== "paid") {
          throw new functions.https.HttpsError(
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
          throw new functions.https.HttpsError(
            "already-exists",
            "You are already pre-registered for this event."
          );
        }

        if (currentStatus === "WAITLISTED") {
          throw new functions.https.HttpsError(
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
          throw new functions.https.HttpsError(
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
          throw new functions.https.HttpsError(
            "not-found",
            "No active pre-registration record was found."
          );
        }

        if (currentStatus === "CANCELLED") {
          throw new functions.https.HttpsError(
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

export const campusDeviceLatestEvent = deviceEndpoint(
  "GET",
  async (_req, res) => {
    const today = formatManilaDate();
    const snapshot = await db
      .collection("events")
      .where("date", ">=", today)
      .orderBy("date", "asc")
      .limit(25)
      .get();

    const candidates = snapshot.docs
      .map((eventDoc) => {
        const data = eventDoc.data();
        const date = normalizeText(data.date);
        const scheduledTime =
          normalizeText(data.scheduledTime) ||
          normalizeText(data.timeStart);
        const status = normalizeText(data.status).toLowerCase() || "upcoming";

        return {
          eventId: eventDoc.id,
          title: normalizeText(data.title) || "Untitled Event",
          date,
          scheduledTime,
          location: normalizeText(data.location) || "TBA",
          status,
          sortMs: parseEventStartMs(date, scheduledTime),
          createdAtMs: toMillis(data.createdAt),
        };
      })
      .filter((event) => event.status !== "completed");

    candidates.sort((left, right) => {
      if (left.sortMs !== right.sortMs) {
        return left.sortMs - right.sortMs;
      }

      return right.createdAtMs - left.createdAtMs;
    });

    const event = candidates[0];
    if (!event) {
      sendJson(res, 404, {error: "No upcoming event found."});
      return;
    }

    sendJson(res, 200, {
      event: {
        eventId: event.eventId,
        title: event.title,
        date: event.date,
        scheduledTime: event.scheduledTime,
        location: event.location,
        status: event.status,
      },
    });
  }
);

export const campusDeviceConfirmPairing = deviceEndpoint(
  "POST",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const eventId = normalizeText(body.eventId);
    const title = normalizeText(body.title);
    const date = normalizeText(body.date);
    const scheduledTime = normalizeText(body.scheduledTime);
    const location = normalizeText(body.location);

    if (!eventId) {
      throw new ApiError(400, "eventId is required.");
    }

    await db.doc(`devicePairings/${device.deviceId}`).set(
      {
        deviceId: device.deviceId,
        eventId,
        eventTitle: title,
        date,
        scheduledTime,
        location,
        status: "paired",
        pairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    await device.ref.set(
      {
        lastPairedEventId: eventId,
        lastPairedAt: serverTimestamp(),
      },
      {merge: true}
    );

    sendJson(res, 200, {status: "paired"});
  }
);

export const campusDevicePendingEnrollments = deviceEndpoint(
  "GET",
  async (req, res) => {
    const limit = parseQueryInt(req.query.limit, 20, 1, 50);
    const snapshot = await db
      .collection("fingerprintEnrollments")
      .where("status", "==", "pending")
      .limit(limit)
      .get();

    const students = snapshot.docs
      .map((studentDoc) => {
        const data = studentDoc.data();
        return {
          studentUid: normalizeText(data.studentUid) || studentDoc.id,
          schoolId: normalizeText(data.schoolId),
          studentName:
            normalizeText(data.studentName) ||
            normalizeText(data.name),
          course: normalizeText(data.course),
          year: normalizeText(data.year),
        };
      })
      .filter((student) => student.studentUid);

    sendJson(res, 200, {students});
  }
);

export const campusDeviceSubmitEnrollment = deviceEndpoint(
  "POST",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const studentUid = normalizeText(body.studentUid);
    const templateId = Number.parseInt(normalizeText(body.templateId), 10);

    if (!studentUid) {
      throw new ApiError(400, "studentUid is required.");
    }

    if (!Number.isFinite(templateId) || templateId <= 0) {
      throw new ApiError(400, "templateId must be a positive number.");
    }

    await db.doc(`fingerprintEnrollments/${studentUid}`).set(
      {
        studentUid,
        schoolId: normalizeText(body.schoolId),
        studentName: normalizeText(body.studentName),
        course: normalizeText(body.course),
        year: normalizeText(body.year),
        templateId,
        deviceId: device.deviceId,
        status: "enrolled",
        enrolledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    sendJson(res, 200, {status: "enrolled"});
  }
);

export const campusDeviceSyncAttendance = deviceEndpoint(
  "POST",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const rawRecords = Array.isArray(body.records) ? body.records : null;

    if (!rawRecords) {
      throw new ApiError(400, "records must be an array.");
    }

    const results: Array<{
      recordId: string;
      status: "uploaded" | "duplicate" | "failed";
      message: string;
    }> = [];

    for (const rawRecord of rawRecords) {
      const record = asRecord(rawRecord);
      const recordId = normalizeText(record.recordId);
      const eventId = normalizeText(record.eventId);
      const studentUid = normalizeText(record.studentUid);

      if (!recordId) {
        results.push({
          recordId: "",
          status: "failed",
          message: "recordId is required.",
        });
        continue;
      }

      if (!eventId || !studentUid) {
        results.push({
          recordId,
          status: "failed",
          message: "eventId and studentUid are required.",
        });
        continue;
      }

      try {
        const attendanceRef = db.doc(`events/${eventId}/attendance/${studentUid}`);
        const eventRef = db.doc(`events/${eventId}`);
        const payload = {
          uid: studentUid,
          studentUid,
          schoolId: normalizeText(record.schoolId),
          studentName: normalizeText(record.studentName),
          course: normalizeText(record.course),
          year: normalizeText(record.year),
          status: "Present",
          source: "portableModule",
          deviceId: normalizeText(record.deviceId) || device.deviceId,
          templateId: Number.parseInt(normalizeText(record.templateId), 10) || -1,
          capturedAtEpoch:
            Number.parseInt(normalizeText(record.capturedAtEpoch), 10) || 0,
          capturedAtIso: normalizeText(record.capturedAtIso),
          timeSource: normalizeText(record.timeSource) || "unknown",
          eventId,
          eventTitle: normalizeText(record.eventTitle),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        let duplicate = false;

        await db.runTransaction(async (transaction) => {
          const eventSnap = await transaction.get(eventRef);
          if (!eventSnap.exists) {
            throw new ApiError(404, "Event not found.");
          }

          const eventData = eventSnap.data() ?? {};
          if (eventData.isPreReg === true) {
            const registrationSnap = await transaction.get(
              db.doc(`events/${eventId}/registrations/${studentUid}`)
            );

            if (
              !registrationSnap.exists ||
              parseRegistrationStatus(registrationSnap.data()?.status) !==
                "PRE_REGISTERED"
            ) {
              throw new ApiError(
                403,
                "Student is not pre-registered for this event."
              );
            }
          }

          const attendanceSnap = await transaction.get(attendanceRef);
          if (attendanceSnap.exists) {
            duplicate = true;
            return;
          }

          transaction.set(attendanceRef, payload);
        });

        results.push({
          recordId,
          status: duplicate ? "duplicate" : "uploaded",
          message: duplicate ?
            "Attendance already exists." :
            "Attendance saved.",
        });
      } catch (error: unknown) {
        results.push({
          recordId,
          status: "failed",
          message: errorMessage(error, "Failed to sync attendance."),
        });
      }
    }

    sendJson(res, 200, {results});
  }
);
