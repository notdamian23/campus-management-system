import {createHash, createHmac, timingSafeEqual} from "crypto";

import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import type {Request, Response} from "express";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-southeast1";
const MANILA_TIME_ZONE = "Asia/Manila";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EVENT_LIMIT = 20;
const MAX_EVENT_LIMIT = 50;
const DEFAULT_ENROLLMENT_LIMIT = 20;
const MAX_ENROLLMENT_LIMIT = 50;
const DEFAULT_SYNC_BATCH_LIMIT = 25;
const MAX_SYNC_BATCH_LIMIT = 50;
const TOKEN_VERSION = 1;

type AuthMode = "secret" | "session" | "session-or-secret";

type DeviceSessionPayload = {
  v: number;
  deviceId: string;
  iatMs: number;
  expMs: number;
  sessionVersion: number;
};

type PortableEventSummary = {
  eventId: string;
  title: string;
  date: string;
  scheduledTime: string;
  location: string;
  status: string;
  yearLevels: string[];
  courses: string[];
  targetStudent: string;
  isPreReg: boolean;
  requiresRegistration: boolean;
  createdAtMs: number;
  sortMs: number;
};

type EventContextStudent = {
  studentId: string;
  studentUid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  fingerprintTemplateId: number;
  fingerprintStatus: string;
  fingerprintDeviceId: string;
  queueId: string;
  registrationId: string;
};

type DeviceContext = {
  deviceId: string;
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
  pairingRef: FirebaseFirestore.DocumentReference;
  pairingData: FirebaseFirestore.DocumentData | null;
  authMode: "secret" | "session";
};

type AttendanceResponseStatus = "uploaded" | "duplicate" | "failed";

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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function toMillis(value: unknown): number {
  if (value && typeof (value as {toMillis?: unknown}).toMillis === "function") {
    return (value as {toMillis: () => number}).toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toPositiveInt(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(normalizeText(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function sendJson(res: Response, status: number, payload: unknown): void {
  res.status(status).json(payload);
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

function formatManilaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(now: Date, days: number): Date {
  const next = new Date(now.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseTimeToMinutes(raw: string): number {
  const value = normalizeText(raw);
  if (!value) {
    return 0;
  }

  const twelveHourMatch = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (twelveHourMatch) {
    let hours = Number.parseInt(twelveHourMatch[1], 10) % 12;
    const minutes = Number.parseInt(twelveHourMatch[2], 10);
    if (twelveHourMatch[3].toUpperCase() === "PM") {
      hours += 12;
    }
    return (hours * 60) + minutes;
  }

  const twentyFourHourMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!twentyFourHourMatch) {
    return 0;
  }

  const hours = Number.parseInt(twentyFourHourMatch[1], 10);
  const minutes = Number.parseInt(twentyFourHourMatch[2], 10);
  return (hours * 60) + minutes;
}

function parseEventStartMs(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Number.MAX_SAFE_INTEGER;
  }

  const minutes = parseTimeToMinutes(time);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const parsed = Date.parse(`${date}T${hh}:${mm}:00+08:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function normalizeYearLevel(value: unknown): string {
  const raw = normalizeText(value);
  const lower = raw.toLowerCase();
  if (!raw) {
    return "";
  }
  if (lower === "1" || lower === "1st year") return "1st Year";
  if (lower === "2" || lower === "2nd year") return "2nd Year";
  if (lower === "3" || lower === "3rd year") return "3rd Year";
  if (lower === "4" || lower === "4th year") return "4th Year";
  if (lower === "5" || lower === "5th year") return "5th Year";
  return raw;
}

function normalizeCourse(value: unknown): string {
  return normalizeText(value);
}

function normalizeTargetList(value: unknown): string[] {
  const raw = dedupeStrings(asStringArray(value));
  return raw.filter((item) => normalizeLower(item) !== "all years" && normalizeLower(item) !== "all courses");
}

function matchesTargetList(targets: string[], value: string): boolean {
  if (targets.length === 0) {
    return true;
  }

  const expected = normalizeLower(value);
  return targets.some((target) => normalizeLower(target) === expected);
}

function matchesSpecificStudentTarget(targetStudent: unknown, candidate: FirebaseFirestore.DocumentData): boolean {
  const target = normalizeLower(targetStudent);
  if (!target) {
    return true;
  }

  const identifiers = [
    normalizeLower(candidate.uid),
    normalizeLower(candidate.schoolId),
    normalizeLower(candidate.studentName),
    normalizeLower(candidate.name),
  ].filter(Boolean);

  return identifiers.includes(target);
}

function isStudentProfile(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return normalizeLower(data?.role) === "student";
}

function base64UrlEncode(value: string | Buffer): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = new Uint8Array(Buffer.from(left, "utf8"));
  const rightBytes = new Uint8Array(Buffer.from(right, "utf8"));
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deviceSecretMatches(deviceData: FirebaseFirestore.DocumentData, providedSecret: string): boolean {
  const secretHash = normalizeLower(deviceData.secretHash);
  if (secretHash) {
    return safeEqual(sha256(providedSecret), secretHash);
  }

  const legacySecret = normalizeText(deviceData.secret);
  return legacySecret ? safeEqual(legacySecret, providedSecret) : false;
}

function getSessionSecret(): string {
  const secret = normalizeText(process.env.CAMPUS_DEVICE_SESSION_SECRET);
  if (!secret) {
    throw new ApiError(500, "CAMPUS_DEVICE_SESSION_SECRET is not configured.");
  }
  return secret;
}

function signSessionToken(payload: DeviceSessionPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const encodedSignature = base64UrlEncode(
    createHmac("sha256", getSessionSecret()).update(encodedPayload).digest()
  );
  return `${encodedPayload}.${encodedSignature}`;
}

function verifySessionToken(token: string): DeviceSessionPayload {
  const trimmed = normalizeText(token);
  const parts = trimmed.split(".");
  if (parts.length !== 2) {
    throw new ApiError(401, "Device session token is invalid.");
  }

  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = base64UrlEncode(
    createHmac("sha256", getSessionSecret()).update(encodedPayload).digest()
  );

  if (!safeEqual(encodedSignature, expectedSignature)) {
    throw new ApiError(401, "Device session token signature is invalid.");
  }

  let payload: DeviceSessionPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as DeviceSessionPayload;
  } catch (error) {
    throw new ApiError(401, "Device session token payload is invalid.");
  }

  if (
    payload.v !== TOKEN_VERSION ||
    !normalizeText(payload.deviceId) ||
    !Number.isFinite(payload.iatMs) ||
    !Number.isFinite(payload.expMs)
  ) {
    throw new ApiError(401, "Device session token payload is malformed.");
  }

  if (Date.now() >= payload.expMs) {
    throw new ApiError(401, "Device session token has expired.");
  }

  return payload;
}

function readBearerToken(req: Request): string {
  const authorization = normalizeText(req.get("Authorization"));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? normalizeText(match[1]) : "";
}

async function loadDeviceContext(
  deviceId: string,
  authMode: "secret" | "session",
  deviceData?: FirebaseFirestore.DocumentData
): Promise<DeviceContext> {
  const ref = db.doc(`devices/${deviceId}`);
  const snap = deviceData ? null : await ref.get();
  const data = deviceData ?? snap?.data();

  if (!data) {
    throw new ApiError(403, "Device is not registered.");
  }

  if (data.enabled === false) {
    throw new ApiError(403, "Device is disabled.");
  }

  const pairingRef = db.doc(`devicePairings/${deviceId}`);
  const pairingSnap = await pairingRef.get();

  await ref.set(
    {
      lastSeenAt: serverTimestamp(),
      lastAuthMode: authMode,
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );

  return {
    deviceId,
    ref,
    data,
    pairingRef,
    pairingData: pairingSnap.exists ? pairingSnap.data() ?? null : null,
    authMode,
  };
}

async function authenticateDeviceWithSecret(req: Request): Promise<DeviceContext> {
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
  if (!deviceSecretMatches(data, secret)) {
    throw new ApiError(403, "Device secret is invalid.");
  }

  return loadDeviceContext(deviceId, "secret", data);
}

async function authenticateDeviceWithSession(req: Request): Promise<DeviceContext> {
  const token = readBearerToken(req);
  if (!token) {
    throw new ApiError(401, "Missing device session token.");
  }

  const payload = verifySessionToken(token);
  const context = await loadDeviceContext(payload.deviceId, "session");
  const sessionVersion = toPositiveInt(context.data.sessionVersion, 1);

  if (payload.sessionVersion !== sessionVersion) {
    throw new ApiError(401, "Device session token is no longer valid.");
  }

  return context;
}

async function authenticateDevice(req: Request, authMode: AuthMode): Promise<DeviceContext> {
  if (authMode === "secret") {
    return authenticateDeviceWithSecret(req);
  }

  const hasBearerToken = readBearerToken(req).length > 0;
  if (hasBearerToken) {
    return authenticateDeviceWithSession(req);
  }

  if (authMode === "session") {
    throw new ApiError(401, "Missing device session token.");
  }

  return authenticateDeviceWithSecret(req);
}

function deviceEndpoint(
  method: "GET" | "POST",
  authMode: AuthMode,
  handler: DeviceHandler
) {
  return functions.region(REGION).https.onRequest(async (req, res) => {
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
      const device = await authenticateDevice(req, authMode);
      await handler(req, res, device);
    } catch (error: unknown) {
      const status = error instanceof ApiError ? error.status : 500;
      const message = errorMessage(error, "Internal server error.");
      console.error("Portable device endpoint failed", error);
      sendJson(res, status, {error: message});
    }
  });
}

function eventSummaryFromSnapshot(
  snap: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): PortableEventSummary {
  const data = snap.data() ?? {};
  const date = normalizeText(data.date);
  const scheduledTime = normalizeText(data.scheduledTime) || normalizeText(data.timeStart);
  const yearLevels = normalizeTargetList(data.yearLevels);
  const courses = normalizeTargetList(data.courses);

  return {
    eventId: snap.id,
    title: normalizeText(data.title) || "Untitled Event",
    date,
    scheduledTime,
    location: normalizeText(data.location) || "TBA",
    status: normalizeText(data.status) || "upcoming",
    yearLevels,
    courses,
    targetStudent: normalizeText(data.targetStudent),
    isPreReg: data.isPreReg === true,
    requiresRegistration: data.isPreReg === true,
    createdAtMs: toMillis(data.createdAt),
    sortMs: parseEventStartMs(date, scheduledTime),
  };
}

function isActiveEvent(event: PortableEventSummary): boolean {
  const status = normalizeLower(event.status);
  return status !== "completed" && status !== "cancelled" && status !== "archived";
}

async function listAvailableEvents(limit: number): Promise<PortableEventSummary[]> {
  const todayMinusOne = formatManilaDate(addDays(new Date(), -1));
  const snapshot = await db
    .collection("events")
    .where("date", ">=", todayMinusOne)
    .orderBy("date", "asc")
    .limit(Math.min(limit, MAX_EVENT_LIMIT))
    .get();

  return snapshot.docs
    .map((doc) => eventSummaryFromSnapshot(doc))
    .filter((event) => isActiveEvent(event))
    .sort((left, right) => {
      if (left.sortMs !== right.sortMs) {
        return left.sortMs - right.sortMs;
      }
      return right.createdAtMs - left.createdAtMs;
    });
}

async function getEventSummary(eventId: string): Promise<PortableEventSummary> {
  const ref = db.doc(`events/${eventId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ApiError(404, "Event not found.");
  }

  const event = eventSummaryFromSnapshot(snap);
  if (!isActiveEvent(event)) {
    throw new ApiError(400, "Event is no longer available for pairing.");
  }

  return event;
}

async function loadDocsById(
  collectionName: string,
  ids: string[]
): Promise<Map<string, FirebaseFirestore.DocumentData>> {
  if (ids.length === 0) {
    return new Map<string, FirebaseFirestore.DocumentData>();
  }

  const refs = ids.map((id) => db.doc(`${collectionName}/${id}`));
  const snaps = await db.getAll(...refs);
  const map = new Map<string, FirebaseFirestore.DocumentData>();
  snaps.forEach((snap) => {
    if (snap.exists) {
      map.set(snap.id, snap.data() ?? {});
    }
  });
  return map;
}

async function resolveAuthorizedStudentIds(
  eventId: string,
  event: PortableEventSummary
): Promise<Map<string, {registrationId: string}>> {
  const registrationsSnap = await db.collection(`events/${eventId}/registrations`).get();
  const authorized = new Map<string, {registrationId: string}>();

  registrationsSnap.docs.forEach((doc) => {
    const data = doc.data();
    const studentId = normalizeText(data.uid) || normalizeText(data.studentUid) || doc.id;
    if (studentId) {
      authorized.set(studentId, {registrationId: doc.id});
    }
  });

  if (authorized.size > 0) {
    return authorized;
  }

  const profilesSnap = await db.collection("profiles").where("role", "==", "student").get();
  profilesSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (!isStudentProfile(data)) {
      return;
    }

    if (!matchesSpecificStudentTarget(event.targetStudent, {...data, uid: doc.id})) {
      return;
    }

    const course = normalizeCourse(data.course);
    const yearLevel = normalizeYearLevel(data.year ?? data.yearLevel);
    if (!matchesTargetList(event.courses, course)) {
      return;
    }
    if (!matchesTargetList(event.yearLevels, yearLevel)) {
      return;
    }

    authorized.set(doc.id, {registrationId: ""});
  });

  return authorized;
}

function mapStudentContext(
  studentId: string,
  profileData: FirebaseFirestore.DocumentData | undefined,
  studentData: FirebaseFirestore.DocumentData | undefined,
  registrationId: string
): EventContextStudent {
  const merged = {...profileData, ...studentData};
  const schoolId = normalizeText(merged.schoolId) || studentId;
  const yearLevel = normalizeYearLevel(merged.yearLevel ?? merged.year);
  const fingerprintTemplateId = toPositiveInt(
    merged.fingerprintTemplateId ?? merged.templateId,
    -1
  );

  return {
    studentId,
    studentUid: studentId,
    schoolId,
    studentName:
      normalizeText(merged.studentName) ||
      normalizeText(merged.name) ||
      schoolId,
    course: normalizeCourse(merged.course) || "Unassigned",
    yearLevel: yearLevel || "Unassigned",
    fingerprintTemplateId,
    fingerprintStatus:
      normalizeText(merged.fingerprintStatus) ||
      (fingerprintTemplateId > 0 ? "enrolled" : "pending"),
    fingerprintDeviceId: normalizeText(merged.fingerprintDeviceId),
    queueId: normalizeText(merged.queueId),
    registrationId,
  };
}

async function buildEventContext(eventId: string) {
  const event = await getEventSummary(eventId);
  const authorizedStudents = await resolveAuthorizedStudentIds(eventId, event);
  const studentIds = Array.from(authorizedStudents.keys());
  const [profilesById, studentRecordsById, attendanceSnap] = await Promise.all([
    loadDocsById("profiles", studentIds),
    loadDocsById("students", studentIds),
    db.collection(`events/${eventId}/attendance`).get(),
  ]);

  const students = studentIds
    .map((studentId) => mapStudentContext(
      studentId,
      profilesById.get(studentId),
      studentRecordsById.get(studentId),
      authorizedStudents.get(studentId)?.registrationId ?? ""
    ))
    .sort((left, right) => left.studentName.localeCompare(right.studentName));

  const recordedStudentIds = dedupeStrings(
    attendanceSnap.docs.map((doc) => {
      const data = doc.data();
      return normalizeText(data.studentId) ||
        normalizeText(data.uid) ||
        normalizeText(data.studentUid) ||
        doc.id;
    })
  );

  return {
    event,
    students,
    attendanceCount: attendanceSnap.size,
    recordedStudentIds,
  };
}

async function ensurePairedEventContext(device: DeviceContext) {
  const pairedEventId =
    normalizeText(device.pairingData?.eventId) ||
    normalizeText(device.data.lastPairedEventId);

  if (!pairedEventId) {
    throw new ApiError(404, "Device is not paired to an event.");
  }

  const context = await buildEventContext(pairedEventId);
  return {
    ...context,
    pairing: device.pairingData ?? {},
  };
}

type EnrollmentCandidate = EventContextStudent & {
  eventId: string;
};

async function listPendingEnrollments(
  device: DeviceContext,
  limit: number
): Promise<EnrollmentCandidate[]> {
  const pairedEventId = normalizeText(device.pairingData?.eventId);
  const snapshot = await db
    .collection("enrollmentQueue")
    .where("status", "in", ["pending", "assigned"])
    .limit(MAX_ENROLLMENT_LIMIT)
    .get();

  const queueCandidates: EnrollmentCandidate[] = [];
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const assignedDeviceId = normalizeText(data.assignedDeviceId);
    const eventId = normalizeText(data.eventId);
    if (assignedDeviceId && assignedDeviceId !== device.deviceId) {
      return;
    }
    if (pairedEventId && eventId && eventId !== pairedEventId) {
      return;
    }

    const studentId = normalizeText(data.studentId) || normalizeText(data.studentUid) || doc.id;
    if (!studentId) {
      return;
    }

    const candidate = mapStudentContext(
      studentId,
      undefined,
      {
        ...data,
        queueId: doc.id,
      },
      ""
    );

    queueCandidates.push({
      ...candidate,
      eventId,
    });
  });

  if (queueCandidates.length > 0) {
    return queueCandidates.slice(0, limit);
  }

  if (!pairedEventId) {
    return [];
  }

  const context = await buildEventContext(pairedEventId);
  return context.students
    .filter((student) => student.fingerprintTemplateId <= 0)
    .slice(0, limit)
    .map((student) => ({
      ...student,
      eventId: pairedEventId,
    }));
}

function resolveRecordedTimestamp(record: Record<string, unknown>) {
  const epochSeconds = toPositiveInt(record.timestampEpoch ?? record.capturedAtEpoch);
  const iso = normalizeText(record.timestampIso ?? record.capturedAtIso);

  if (epochSeconds > 0) {
    return {
      timestamp: admin.firestore.Timestamp.fromMillis(epochSeconds * 1000),
      epochSeconds,
      iso,
    };
  }

  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) {
      return {
        timestamp: admin.firestore.Timestamp.fromMillis(parsed),
        epochSeconds: Math.floor(parsed / 1000),
        iso,
      };
    }
  }

  return {
    timestamp: serverTimestamp(),
    epochSeconds: 0,
    iso: "",
  };
}

async function createDeviceSessionResponse(device: DeviceContext) {
  const sessionVersion = toPositiveInt(device.data.sessionVersion, 1);
  const now = Date.now();
  const payload: DeviceSessionPayload = {
    v: TOKEN_VERSION,
    deviceId: device.deviceId,
    iatMs: now,
    expMs: now + SESSION_TTL_MS,
    sessionVersion,
  };

  const token = signSessionToken(payload);

  await device.ref.set(
    {
      lastSessionIssuedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );

  return {
    sessionToken: token,
    expiresAtMs: payload.expMs,
    authMode: "bearer",
    device: {
      deviceId: device.deviceId,
      label: normalizeText(device.data.label) || normalizeText(device.data.name) || device.deviceId,
    },
    pairing: device.pairingData ? {
      eventId: normalizeText(device.pairingData.eventId),
      eventTitle: normalizeText(device.pairingData.eventTitle),
      status: normalizeText(device.pairingData.status) || "paired",
    } : null,
  };
}

async function pairDeviceToEvent(device: DeviceContext, eventId: string) {
  const context = await buildEventContext(eventId);
  const event = context.event;

  await device.pairingRef.set(
    {
      deviceId: device.deviceId,
      eventId: event.eventId,
      eventTitle: event.title,
      eventDate: event.date,
      eventScheduledTime: event.scheduledTime,
      eventLocation: event.location,
      status: "paired",
      source: "portable-device",
      pairedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastContextRefreshAt: serverTimestamp(),
      rosterCount: context.students.length,
      attendanceCount: context.attendanceCount,
      eventSnapshot: {
        eventId: event.eventId,
        title: event.title,
        date: event.date,
        scheduledTime: event.scheduledTime,
        location: event.location,
        status: event.status,
      },
    },
    {merge: true}
  );

  await device.ref.set(
    {
      lastPairedEventId: event.eventId,
      lastPairedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );

  return context;
}

async function isStudentRegisteredForEvent(eventId: string, studentId: string): Promise<boolean> {
  const registrationsSnap = await db.collection(`events/${eventId}/registrations`).limit(1).get();
  if (registrationsSnap.empty) {
    return true;
  }

  const directSnap = await db.doc(`events/${eventId}/registrations/${studentId}`).get();
  if (directSnap.exists) {
    return true;
  }

  return registrationsSnap.docs.some((doc) => {
    const data = doc.data();
    return normalizeText(data.uid) === studentId || normalizeText(data.studentUid) === studentId;
  });
}

async function syncAttendanceRecord(
  device: DeviceContext,
  record: Record<string, unknown>
): Promise<{recordId: string; status: AttendanceResponseStatus; message: string}> {
  const recordId = normalizeText(record.recordId);
  const eventId = normalizeText(record.eventId);
  const studentId =
    normalizeText(record.studentId) ||
    normalizeText(record.studentUid) ||
    normalizeText(record.uid);

  if (!recordId) {
    return {recordId: "", status: "failed", message: "recordId is required."};
  }

  if (!eventId || !studentId) {
    return {
      recordId,
      status: "failed",
      message: "eventId and studentId are required.",
    };
  }

  const pairedEventId = normalizeText(device.pairingData?.eventId);
  if (!pairedEventId || pairedEventId !== eventId) {
    return {
      recordId,
      status: "failed",
      message: "Device can only sync attendance to its paired event.",
    };
  }

  const isRegistered = await isStudentRegisteredForEvent(eventId, studentId);
  if (!isRegistered) {
    return {
      recordId,
      status: "failed",
      message: "Student is not registered for the paired event.",
    };
  }

  const attendanceRef = db.doc(`events/${eventId}/attendance/${studentId}`);
  const syncLogRef = db.doc(`syncLogs/${recordId}`);
  const eventRef = db.doc(`events/${eventId}`);
  const studentRef = db.doc(`students/${studentId}`);
  const profileRef = db.doc(`profiles/${studentId}`);
  const event = await getEventSummary(eventId);
  const recordedTimestamp = resolveRecordedTimestamp(record);

  let resultStatus: AttendanceResponseStatus = "failed";
  let resultMessage = "Failed to sync attendance.";

  await db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (!eventSnap.exists) {
      throw new ApiError(404, "Event not found.");
    }

    const existingSyncLog = await transaction.get(syncLogRef);
    if (existingSyncLog.exists) {
      const data = existingSyncLog.data() ?? {};
      resultStatus = normalizeLower(data.syncStatus) === "uploaded" ? "uploaded" :
        normalizeLower(data.syncStatus) === "duplicate" ? "duplicate" :
        "failed";
      resultMessage = normalizeText(data.message) || "Attendance already processed.";
      return;
    }

    const attendanceSnap = await transaction.get(attendanceRef);
    if (attendanceSnap.exists) {
      resultStatus = "duplicate";
      resultMessage = "Attendance already exists for this student.";

      transaction.set(
        syncLogRef,
        {
          recordId,
          eventId,
          studentId,
          deviceId: device.deviceId,
          syncStatus: "duplicate",
          message: resultMessage,
          attemptedAt: serverTimestamp(),
          processedAt: serverTimestamp(),
          source: "portable-device",
        },
        {merge: true}
      );
      return;
    }

    const profileSnap = await transaction.get(profileRef);
    const studentSnap = await transaction.get(studentRef);
    const mergedStudent = {
      ...(profileSnap.exists ? profileSnap.data() : {}),
      ...(studentSnap.exists ? studentSnap.data() : {}),
    };

    const attendanceDoc = {
      eventId,
      eventTitle: event.title,
      studentId,
      uid: studentId,
      studentUid: studentId,
      schoolId: normalizeText(record.schoolId) || normalizeText(mergedStudent.schoolId) || studentId,
      studentName:
        normalizeText(record.studentName) ||
        normalizeText(mergedStudent.studentName) ||
        normalizeText(mergedStudent.name) ||
        normalizeText(record.schoolId) ||
        studentId,
      course:
        normalizeText(record.course) ||
        normalizeText(mergedStudent.course) ||
        "Unassigned",
      yearLevel:
        normalizeYearLevel(record.yearLevel ?? record.year) ||
        normalizeYearLevel(mergedStudent.yearLevel ?? mergedStudent.year) ||
        "Unassigned",
      year:
        normalizeYearLevel(record.yearLevel ?? record.year) ||
        normalizeYearLevel(mergedStudent.yearLevel ?? mergedStudent.year) ||
        "Unassigned",
      timestamp: recordedTimestamp.timestamp,
      recordedAt: serverTimestamp(),
      recordedByDevice: true,
      recordedByDeviceId: device.deviceId,
      deviceId: normalizeText(record.deviceId) || device.deviceId,
      syncedAt: serverTimestamp(),
      syncStatus: "synced",
      fingerprintTemplateId: toPositiveInt(
        record.fingerprintTemplateId ?? record.templateId,
        -1
      ),
      templateId: toPositiveInt(
        record.fingerprintTemplateId ?? record.templateId,
        -1
      ),
      source: normalizeText(record.source) || "portable-device",
      deviceRecordId: recordId,
      deviceTimestampEpoch: recordedTimestamp.epochSeconds,
      deviceTimestampIso: recordedTimestamp.iso,
      timeSource: normalizeText(record.timeSource) || "unknown",
      status: "Present",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(attendanceRef, attendanceDoc, {merge: true});
    transaction.set(
      syncLogRef,
      {
        recordId,
        eventId,
        studentId,
        schoolId: attendanceDoc.schoolId,
        studentName: attendanceDoc.studentName,
        deviceId: device.deviceId,
        syncStatus: "uploaded",
        message: "Attendance saved.",
        attemptedAt: serverTimestamp(),
        processedAt: serverTimestamp(),
        source: "portable-device",
      },
      {merge: true}
    );
    transaction.set(
      device.pairingRef,
      {
        lastAttendanceSyncAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    resultStatus = "uploaded";
    resultMessage = "Attendance saved.";
  });

  return {
    recordId,
    status: resultStatus,
    message: resultMessage,
  };
}

export const campusDeviceCreateSession = deviceEndpoint(
  "POST",
  "secret",
  async (_req, res, device) => {
    const payload = await createDeviceSessionResponse(device);
    sendJson(res, 200, payload);
  }
);

export const campusDeviceListEvents = deviceEndpoint(
  "GET",
  "session-or-secret",
  async (req, res) => {
    const limit = parseQueryInt(req.query.limit, DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT);
    const events = await listAvailableEvents(limit);
    sendJson(res, 200, {
      events: events.map((event) => ({
        eventId: event.eventId,
        title: event.title,
        date: event.date,
        scheduledTime: event.scheduledTime,
        location: event.location,
        status: event.status,
      })),
    });
  }
);

export const campusDevicePairEvent = deviceEndpoint(
  "POST",
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const eventId = normalizeText(body.eventId);

    if (!eventId) {
      throw new ApiError(400, "eventId is required.");
    }

    const context = await pairDeviceToEvent(device, eventId);
    sendJson(res, 200, {
      status: "paired",
      event: {
        eventId: context.event.eventId,
        title: context.event.title,
        date: context.event.date,
        scheduledTime: context.event.scheduledTime,
        location: context.event.location,
        status: context.event.status,
      },
      roster: {
        count: context.students.length,
        recordedStudentIds: context.recordedStudentIds,
      },
      students: context.students.map((student) => ({
        studentId: student.studentId,
        studentUid: student.studentUid,
        schoolId: student.schoolId,
        studentName: student.studentName,
        course: student.course,
        yearLevel: student.yearLevel,
        fingerprintTemplateId: student.fingerprintTemplateId,
        fingerprintStatus: student.fingerprintStatus,
        fingerprintDeviceId: student.fingerprintDeviceId,
      })),
    });
  }
);

export const campusDevicePairedEventContext = deviceEndpoint(
  "GET",
  "session-or-secret",
  async (_req, res, device) => {
    const context = await ensurePairedEventContext(device);

    await device.pairingRef.set(
      {
        lastContextRefreshAt: serverTimestamp(),
        rosterCount: context.students.length,
        attendanceCount: context.attendanceCount,
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    sendJson(res, 200, {
      pairing: {
        deviceId: device.deviceId,
        eventId: context.event.eventId,
        status: normalizeText(context.pairing.status) || "paired",
      },
      event: {
        eventId: context.event.eventId,
        title: context.event.title,
        date: context.event.date,
        scheduledTime: context.event.scheduledTime,
        location: context.event.location,
        status: context.event.status,
      },
      roster: {
        count: context.students.length,
        recordedStudentIds: context.recordedStudentIds,
      },
      students: context.students.map((student) => ({
        studentId: student.studentId,
        studentUid: student.studentUid,
        schoolId: student.schoolId,
        studentName: student.studentName,
        course: student.course,
        yearLevel: student.yearLevel,
        fingerprintTemplateId: student.fingerprintTemplateId,
        fingerprintStatus: student.fingerprintStatus,
        fingerprintDeviceId: student.fingerprintDeviceId,
        queueId: student.queueId,
      })),
    });
  }
);

export const campusDevicePendingEnrollments = deviceEndpoint(
  "GET",
  "session-or-secret",
  async (req, res, device) => {
    const limit = parseQueryInt(
      req.query.limit,
      DEFAULT_ENROLLMENT_LIMIT,
      1,
      MAX_ENROLLMENT_LIMIT
    );
    const students = await listPendingEnrollments(device, limit);

    sendJson(res, 200, {
      students: students.map((student) => ({
        queueId: student.queueId,
        eventId: student.eventId,
        studentId: student.studentId,
        studentUid: student.studentUid,
        schoolId: student.schoolId,
        studentName: student.studentName,
        course: student.course,
        yearLevel: student.yearLevel,
        fingerprintTemplateId: student.fingerprintTemplateId,
      })),
    });
  }
);

export const campusDeviceSubmitEnrollment = deviceEndpoint(
  "POST",
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const studentId =
      normalizeText(body.studentId) ||
      normalizeText(body.studentUid);
    const templateId = toPositiveInt(
      body.fingerprintTemplateId ?? body.templateId,
      -1
    );
    const queueId = normalizeText(body.queueId);
    const eventId =
      normalizeText(body.eventId) ||
      normalizeText(device.pairingData?.eventId);

    if (!studentId) {
      throw new ApiError(400, "studentId is required.");
    }

    if (templateId <= 0) {
      throw new ApiError(400, "fingerprintTemplateId must be a positive integer.");
    }

    const profileRef = db.doc(`profiles/${studentId}`);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() ?? {} : {};

    await db.doc(`students/${studentId}`).set(
      {
        uid: studentId,
        studentId,
        schoolId: normalizeText(body.schoolId) || normalizeText(profileData.schoolId) || studentId,
        studentName:
          normalizeText(body.studentName) ||
          normalizeText(profileData.studentName) ||
          normalizeText(profileData.name) ||
          studentId,
        course: normalizeText(body.course) || normalizeText(profileData.course) || "Unassigned",
        yearLevel:
          normalizeYearLevel(body.yearLevel ?? body.year) ||
          normalizeYearLevel(profileData.yearLevel ?? profileData.year) ||
          "Unassigned",
        fingerprintTemplateId: templateId,
        fingerprintStatus: "enrolled",
        fingerprintDeviceId: device.deviceId,
        fingerprintEnrolledAt: serverTimestamp(),
        queueId,
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    await profileRef.set(
      {
        fingerprintTemplateId: templateId,
        fingerprintStatus: "enrolled",
        fingerprintDeviceId: device.deviceId,
        fingerprintEnrolledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    const enrollmentDocId = queueId || studentId;
    await db.doc(`enrollmentQueue/${enrollmentDocId}`).set(
      {
        queueId: enrollmentDocId,
        studentId,
        eventId,
        schoolId: normalizeText(body.schoolId) || normalizeText(profileData.schoolId) || studentId,
        studentName:
          normalizeText(body.studentName) ||
          normalizeText(profileData.studentName) ||
          normalizeText(profileData.name) ||
          studentId,
        course: normalizeText(body.course) || normalizeText(profileData.course) || "Unassigned",
        yearLevel:
          normalizeYearLevel(body.yearLevel ?? body.year) ||
          normalizeYearLevel(profileData.yearLevel ?? profileData.year) ||
          "Unassigned",
        status: "enrolled",
        fingerprintTemplateId: templateId,
        fingerprintDeviceId: device.deviceId,
        enrolledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    await device.pairingRef.set(
      {
        lastEnrollmentSyncAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    sendJson(res, 200, {
      status: "enrolled",
      studentId,
      fingerprintTemplateId: templateId,
      deviceId: device.deviceId,
    });
  }
);

export const campusDeviceSyncAttendance = deviceEndpoint(
  "POST",
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const rawRecords = Array.isArray(body.records) ? body.records : null;

    if (!rawRecords) {
      throw new ApiError(400, "records must be an array.");
    }

    if (rawRecords.length > MAX_SYNC_BATCH_LIMIT) {
      throw new ApiError(400, `records must contain at most ${MAX_SYNC_BATCH_LIMIT} items.`);
    }

    const results: Array<{recordId: string; status: AttendanceResponseStatus; message: string}> = [];
    for (const rawRecord of rawRecords.slice(0, DEFAULT_SYNC_BATCH_LIMIT)) {
      try {
        const result = await syncAttendanceRecord(device, asRecord(rawRecord));
        results.push(result);
      } catch (error: unknown) {
        const record = asRecord(rawRecord);
        const recordId = normalizeText(record.recordId);
        const eventId = normalizeText(record.eventId);
        const studentId =
          normalizeText(record.studentId) ||
          normalizeText(record.studentUid) ||
          normalizeText(record.uid);

        if (recordId) {
          await db.doc(`syncLogs/${recordId}`).set(
            {
              recordId,
              eventId,
              studentId,
              deviceId: device.deviceId,
              syncStatus: "failed",
              message: errorMessage(error, "Failed to sync attendance."),
              attemptedAt: serverTimestamp(),
              processedAt: serverTimestamp(),
              source: "portable-device",
            },
            {merge: true}
          );
        }

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

export const campusDeviceLatestEvent = deviceEndpoint(
  "GET",
  "session-or-secret",
  async (_req, res) => {
    const [event] = await listAvailableEvents(1);
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
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const eventId = normalizeText(body.eventId);
    if (!eventId) {
      throw new ApiError(400, "eventId is required.");
    }

    await pairDeviceToEvent(device, eventId);
    sendJson(res, 200, {status: "paired"});
  }
);
