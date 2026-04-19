import {createHash, createHmac, timingSafeEqual} from "crypto";

import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import type {Request, Response} from "express";
import {createCampusLogger} from "./campusLogger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-southeast1";
const deviceLogger = createCampusLogger("CAMPUS device");
const MANILA_TIME_ZONE = "Asia/Manila";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EVENT_LIMIT = 20;
const MAX_EVENT_LIMIT = 50;
const DEFAULT_ENROLLMENT_LIMIT = 20;
const MAX_ENROLLMENT_LIMIT = 50;
const DEFAULT_ENROLLMENT_SESSION_LIMIT = 15;
const MAX_ENROLLMENT_SESSION_LIMIT = 25;
const DEFAULT_SYNC_BATCH_LIMIT = 25;
const MAX_SYNC_BATCH_LIMIT = 50;
const DEFAULT_CLEANUP_LIMIT = 10;
const MAX_CLEANUP_LIMIT = 50;
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
  scheduledTimeEnd: string;
  location: string;
  status: string;
  yearLevels: string[];
  courses: string[];
  targetStudent: string;
  selectedStudentIds: string[];
  selectedSchoolIds: string[];
  isPreReg: boolean;
  requiresRegistration: boolean;
  requiresPayment: boolean;
  linkedPaymentId: string;
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

type EventRegistrationLookup = {
  studentId: string;
  registrationId: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  status: "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED";
};

type DeviceContext = {
  deviceId: string;
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
  pairingRef: FirebaseFirestore.DocumentReference;
  pairingData: FirebaseFirestore.DocumentData | null;
  authMode: "secret" | "session";
};

type AttendanceResponseStatus = "uploaded" | "duplicate" | "failed" | "rejected";
type EnrollmentResponseStatus = "uploaded" | "duplicate" | "failed";

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

type EnrollmentSessionSummary = {
  sessionId: string;
  createdBy: string;
  createdByName: string;
  createdBySchoolId: string;
  status: EnrollmentSessionStatus;
  pairedDeviceId: string;
  totalStudents: number;
  pendingCount: number;
  downloadedCount: number;
  enrolledCount: number;
  syncedCount: number;
  failedCount: number;
  selectedStudentIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

type EnrollmentSessionStudent = {
  studentId: string;
  studentUid: string;
  schoolId: string;
  fullName: string;
  course: string;
  yearLevel: string;
  status: EnrollmentStudentStatus;
  syncStatus: "pending" | "synced" | "failed";
  fingerprintTemplateId: number;
  enrolledByDevice: string;
  assignedDeviceId: string;
  remarks: string;
};
type CleanupQueueItemType =
  | "removeMapping"
  | "deleteTemplateIfUnused"
  | "markNeedsReenrollment";
type CleanupQueueItem = {
  cleanupId: string;
  type: CleanupQueueItemType;
  templateId: number;
  uid: string;
  schoolId: string;
  reason: string;
};
type CleanupQueueResult = {
  cleanupId: string;
  processed: boolean;
  message: string;
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

function requestHeader(req: Request, ...names: string[]): string {
  for (const name of names) {
    const value = normalizeText(req.get(name));
    if (value) {
      return value;
    }
  }
  return "";
}

function sanitizeIdComponent(value: string): string {
  return normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function fingerprintTemplateRef(templateId: number) {
  return db.doc(`fingerprintTemplates/${templateId}`);
}

async function upsertFingerprintTemplateOwner(
  templateId: number,
  payload: {
    uid: string;
    schoolId: string;
    studentName: string;
    course: string;
    yearLevel: string;
    deviceId: string;
    enrolledAt: unknown;
  }
): Promise<void> {
  if (templateId <= 0 || !payload.uid) {
    return;
  }

  await fingerprintTemplateRef(templateId).set(
    {
      templateId,
      uid: payload.uid,
      schoolId: payload.schoolId,
      name: payload.studentName,
      course: payload.course,
      yearLevel: payload.yearLevel,
      active: true,
      status: "active",
      sensorId: payload.deviceId,
      enrolledAt: payload.enrolledAt,
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );
}

async function findActiveFingerprintTemplateConflict(
  templateId: number,
  studentId: string
): Promise<FirebaseFirestore.DocumentData | null> {
  if (templateId <= 0) {
    return null;
  }

  const templateSnap = await fingerprintTemplateRef(templateId).get();
  if (!templateSnap.exists) {
    return null;
  }

  const templateData = templateSnap.data() ?? {};
  const ownerUid =
    normalizeText(templateData.uid) ||
    normalizeText(templateData.studentUid) ||
    normalizeText(templateData.studentId);
  if (!ownerUid || ownerUid === studentId) {
    return null;
  }

  if (templateData.active === false) {
    return null;
  }

  const status = normalizeLower(templateData.status);
  if (status === "stale" || status === "needs_reenrollment" || status === "deleted") {
    return null;
  }

  return templateData;
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

async function callerRole(
  context: functions.https.CallableContext
): Promise<string> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }

  const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
  return callerProfileSnap.exists ?
    normalizeLower(callerProfileSnap.data()?.role) :
    "";
}

async function requireAdminOrEC(
  context: functions.https.CallableContext
): Promise<void> {
  const role = await callerRole(context);
  if (role !== "admin" && role !== "ec") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "EC/Admin only."
    );
  }
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

function hasSupportedTimeFormat(raw: string): boolean {
  const value = normalizeText(raw);
  if (!value) {
    return false;
  }

  return /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.test(value) ||
    /^(\d{1,2}):(\d{2})$/.test(value);
}

function parseEventEndMs(date: string, startTime: string, endTime: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !hasSupportedTimeFormat(startTime)) {
    return Number.MAX_SAFE_INTEGER;
  }

  const startMinutes = parseTimeToMinutes(startTime);
  let endMinutes = hasSupportedTimeFormat(endTime) ?
    parseTimeToMinutes(endTime) :
    startMinutes;

  if (endMinutes < startMinutes) {
    endMinutes = startMinutes + 60;
  }

  const hh = String(Math.floor(endMinutes / 60)).padStart(2, "0");
  const mm = String(endMinutes % 60).padStart(2, "0");
  const parsed = Date.parse(`${date}T${hh}:${mm}:00+08:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function hasEventEnded(event: PortableEventSummary, nowMs = Date.now()): boolean {
  const eventEndMs = parseEventEndMs(
    event.date,
    event.scheduledTime,
    event.scheduledTimeEnd
  );
  if (eventEndMs === Number.MAX_SAFE_INTEGER) {
    return false;
  }

  return nowMs > eventEndMs;
}

function normalizeScheduledWindow(startValue: unknown, endValue: unknown): {
  scheduledTime: string;
  scheduledTimeEnd: string;
} {
  let scheduledTime = normalizeText(startValue);
  let scheduledTimeEnd = normalizeText(endValue);

  if (!scheduledTimeEnd) {
    const dashIndex = scheduledTime.indexOf("-");
    if (dashIndex > 0) {
      const start = scheduledTime.slice(0, dashIndex).trim();
      const end = scheduledTime.slice(dashIndex + 1).trim();
      if (start && end) {
        scheduledTime = start;
        scheduledTimeEnd = end;
      }
    }
  }

  return {scheduledTime, scheduledTimeEnd};
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

function normalizeEnrollmentSessionStatus(value: unknown): EnrollmentSessionStatus {
  const raw = normalizeLower(value);
  if (raw === "paired") return "paired";
  if (raw === "downloading") return "downloading";
  if (raw === "enrolling") return "enrolling";
  if (raw === "completed") return "completed";
  if (raw === "partially completed" || raw === "partially-completed") {
    return "partially-completed";
  }
  if (raw === "closed") return "closed";
  return "pending";
}

function normalizeEnrollmentStudentStatus(value: unknown): EnrollmentStudentStatus {
  const raw = normalizeLower(value);
  if (raw === "downloaded") return "downloaded";
  if (raw === "enrolled") return "enrolled";
  if (raw === "synced") return "synced";
  if (raw === "failed") return "failed";
  return "pending";
}

function normalizeEnrollmentSyncStatus(value: unknown): "pending" | "synced" | "failed" {
  const raw = normalizeLower(value);
  if (raw === "synced") return "synced";
  if (raw === "failed") return "failed";
  return "pending";
}

function parseRegistrationStatus(value: unknown): "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED" {
  const raw = normalizeLower(value);
  if (raw === "waitlisted") return "WAITLISTED";
  if (raw === "cancelled") return "CANCELLED";
  return "PRE_REGISTERED";
}

function normalizeTargetList(value: unknown): string[] {
  const raw = dedupeStrings(asStringArray(value));
  return raw.filter((item) => normalizeLower(item) !== "all years" && normalizeLower(item) !== "all courses");
}

function normalizeIdentifierList(value: unknown): string[] {
  return dedupeStrings(asStringArray(value));
}

function getEventLinkedPaymentId(data: FirebaseFirestore.DocumentData): string {
  return normalizeText(data.linkedPaymentId) || normalizeText(data.requiredPaymentId);
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

function hasExplicitSelectedAudience(
  event: Pick<PortableEventSummary, "selectedStudentIds" | "selectedSchoolIds">
): boolean {
  return event.selectedStudentIds.length > 0 || event.selectedSchoolIds.length > 0;
}

function matchesSelectedAudience(
  event: Pick<PortableEventSummary, "selectedStudentIds" | "selectedSchoolIds">,
  studentId: string,
  schoolId: string
): boolean {
  if (!hasExplicitSelectedAudience(event)) {
    return true;
  }

  const normalizedStudentId = normalizeLower(studentId);
  const normalizedSchoolId = normalizeLower(schoolId);
  return event.selectedStudentIds.some((value) => normalizeLower(value) === normalizedStudentId) ||
    event.selectedSchoolIds.some((value) => normalizeLower(value) === normalizedSchoolId);
}

function evaluateEventEligibility(
  event: PortableEventSummary,
  candidate: {
    studentId: string;
    schoolId: string;
    studentName: string;
    course: string;
    yearLevel: string;
    registrationStatus?: unknown;
    paymentStatus?: unknown;
  }
): {allowed: boolean; reason: string} {
  if (!matchesSelectedAudience(event, candidate.studentId, candidate.schoolId)) {
    return {allowed: false, reason: "not_selected_student"};
  }

  if (!hasExplicitSelectedAudience(event)) {
    if (!matchesSpecificStudentTarget(event.targetStudent, {
      uid: candidate.studentId,
      schoolId: candidate.schoolId,
      studentName: candidate.studentName,
      name: candidate.studentName,
    })) {
      return {allowed: false, reason: "not_target_student"};
    }

    if (!matchesTargetList(event.courses, normalizeCourse(candidate.course))) {
      return {allowed: false, reason: "not_target_course"};
    }

    if (!matchesTargetList(event.yearLevels, normalizeYearLevel(candidate.yearLevel))) {
      return {allowed: false, reason: "not_target_year"};
    }
  }

  if (event.requiresRegistration &&
      parseRegistrationStatus(candidate.registrationStatus) !== "PRE_REGISTERED") {
    return {allowed: false, reason: "registration_required"};
  }

  if (event.requiresPayment && normalizeLower(candidate.paymentStatus) !== "paid") {
    return {allowed: false, reason: "payment_required"};
  }

  return {allowed: true, reason: "allowed"};
}

async function loadPaymentStatusesByStudentId(paymentId: string): Promise<Map<string, string>> {
  const normalizedPaymentId = normalizeText(paymentId);
  if (!normalizedPaymentId) {
    return new Map<string, string>();
  }

  const snapshot = await db.collection(`payments/${normalizedPaymentId}/students`).get();
  const paymentStatuses = new Map<string, string>();
  snapshot.docs.forEach((paymentStudentDoc) => {
    const data = paymentStudentDoc.data() ?? {};
    const uid = normalizeText(data.uid) || paymentStudentDoc.id;
    if (!uid) {
      return;
    }

    paymentStatuses.set(uid, normalizeLower(data.status));
  });

  return paymentStatuses;
}

async function loadPaymentStatusForStudent(paymentId: string, studentId: string): Promise<string> {
  const normalizedPaymentId = normalizeText(paymentId);
  const normalizedStudentId = normalizeText(studentId);
  if (!normalizedPaymentId || !normalizedStudentId) {
    return "";
  }

  const paymentStudentSnap = await db.doc(
    `payments/${normalizedPaymentId}/students/${normalizedStudentId}`
  ).get();
  if (!paymentStudentSnap.exists) {
    return "";
  }

  return normalizeLower(paymentStudentSnap.data()?.status);
}

function registrationLookupFromSnapshot(
  snap: FirebaseFirestore.QueryDocumentSnapshot
): EventRegistrationLookup {
  const data = snap.data() ?? {};
  const studentId =
    normalizeText(data.uid) ||
    normalizeText(data.studentUid) ||
    normalizeText(data.studentId) ||
    snap.id;

  return {
    studentId,
    registrationId: snap.id,
    schoolId: normalizeText(data.schoolId),
    studentName:
      normalizeText(data.studentName) ||
      normalizeText(data.name) ||
      studentId,
    course: normalizeCourse(data.course),
    yearLevel: normalizeYearLevel(data.year ?? data.yearLevel),
    status: parseRegistrationStatus(data.status),
  };
}

async function loadStudentProfilesBySchoolIds(
  schoolIds: string[]
): Promise<Array<FirebaseFirestore.QueryDocumentSnapshot>> {
  const probes = normalizeIdentifierList(schoolIds);
  if (probes.length === 0) {
    return [];
  }

  const chunks: string[][] = [];
  for (let index = 0; index < probes.length; index += 10) {
    chunks.push(probes.slice(index, index + 10));
  }

  const snapshots = await Promise.all(chunks.map((chunk) =>
    db.collection("profiles").where("schoolId", "in", chunk).get()
  ));

  const seen = new Set<string>();
  const rows: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((doc) => {
      if (seen.has(doc.id)) {
        return;
      }
      seen.add(doc.id);
      rows.push(doc);
    });
  });
  return rows;
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
    throw new ApiError(401, "Unauthorized device");
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
  const deviceId = requestHeader(req, "X-Campus-Device-Id", "X-Device-Id");
  const secret = requestHeader(
    req,
    "X-Campus-Device-Secret",
    "X-Device-Secret"
  );

  if (!deviceId || !secret) {
    throw new ApiError(401, "Unauthorized device");
  }

  const ref = db.doc(`devices/${deviceId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new ApiError(401, "Unauthorized device");
  }

  const data = snap.data() ?? {};
  if (!deviceSecretMatches(data, secret)) {
    throw new ApiError(401, "Unauthorized device");
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

function getCleanupQueueSharedSecret(): string {
  const envSecret = normalizeText(process.env.CAMPUS_DEVICE_SECRET);
  if (envSecret) {
    return envSecret;
  }

  return "";
}

async function authenticateCleanupQueueRequest(
  req: Request
): Promise<{deviceId: string}> {
  const providedSecret = requestHeader(
    req,
    "X-Campus-Device-Secret",
    "X-Device-Secret"
  );
  if (!providedSecret) {
    throw new ApiError(401, "unauthorized");
  }

  const configuredSecret = getCleanupQueueSharedSecret();
  if (configuredSecret) {
    if (!safeEqual(providedSecret, configuredSecret)) {
      throw new ApiError(401, "unauthorized");
    }
  } else {
    await authenticateDeviceWithSecret(req);
  }

  return {
    deviceId: requestHeader(req, "X-Campus-Device-Id", "X-Device-Id"),
  };
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
      sendJson(res, 405, {ok: false, error: "Method not allowed."});
      return;
    }

    try {
      const device = await authenticateDevice(req, authMode);
      await handler(req, res, device);
    } catch (error: unknown) {
      const status = error instanceof ApiError ? error.status : 500;
      const message = status >= 500 ?
        "Server error" :
        errorMessage(error, "Server error");
      deviceLogger.error("Portable device endpoint failed", {error, status});
      sendJson(res, status, {ok: false, error: message});
    }
  });
}

function eventSummaryFromSnapshot(
  snap: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): PortableEventSummary {
  const data = snap.data() ?? {};
  const date = normalizeText(data.date);
  const schedule = normalizeScheduledWindow(
    normalizeText(data.scheduledTimeStart) ||
      normalizeText(data.scheduledTime) ||
      normalizeText(data.timeStart),
    normalizeText(data.scheduledTimeEnd) ||
      normalizeText(data.endTime) ||
      normalizeText(data.timeEnd)
  );
  const yearLevels = normalizeTargetList(data.yearLevels);
  const courses = normalizeTargetList(data.courses);
  const selectedStudentIds = normalizeIdentifierList(data.selectedStudentIds);
  const selectedSchoolIds = normalizeIdentifierList(data.selectedSchoolIds);
  const linkedPaymentId = getEventLinkedPaymentId(data);
  const requiresPayment =
    data.paymentRequired === true ||
    data.withPayment === true ||
    linkedPaymentId.length > 0;

  return {
    eventId: snap.id,
    title: normalizeText(data.title) || "Untitled Event",
    date,
    scheduledTime: schedule.scheduledTime,
    scheduledTimeEnd: schedule.scheduledTimeEnd,
    location: normalizeText(data.location) || "TBA",
    status: normalizeText(data.status) || "upcoming",
    yearLevels,
    courses,
    targetStudent: normalizeText(data.targetStudent),
    selectedStudentIds,
    selectedSchoolIds,
    isPreReg: data.isPreReg === true,
    requiresRegistration: data.isPreReg === true,
    requiresPayment,
    linkedPaymentId,
    createdAtMs: toMillis(data.createdAt),
    sortMs: parseEventStartMs(date, schedule.scheduledTime),
  };
}

function isActiveEvent(event: PortableEventSummary): boolean {
  const status = normalizeLower(event.status);
  if (status === "completed" || status === "cancelled" || status === "archived") {
    return false;
  }

  return !hasEventEnded(event);
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
  const paymentStatusesByStudentId =
    event.requiresPayment && event.linkedPaymentId ?
      await loadPaymentStatusesByStudentId(event.linkedPaymentId) :
      new Map<string, string>();
  const registrations = registrationsSnap.docs
    .map((doc) => registrationLookupFromSnapshot(doc))
    .filter((registration) => registration.studentId.length > 0);
  const registrationsByStudentId = new Map<string, EventRegistrationLookup>();
  const authorized = new Map<string, {registrationId: string}>();

  registrations.forEach((registration) => {
    const existing = registrationsByStudentId.get(registration.studentId);
    if (!existing || (existing.status !== "PRE_REGISTERED" &&
        registration.status === "PRE_REGISTERED")) {
      registrationsByStudentId.set(registration.studentId, registration);
    }
  });

  if (event.requiresRegistration) {
    registrationsByStudentId.forEach((registration) => {
      const eligibility = evaluateEventEligibility(event, {
        studentId: registration.studentId,
        schoolId: registration.schoolId,
        studentName: registration.studentName,
        course: registration.course,
        yearLevel: registration.yearLevel,
        registrationStatus: registration.status,
        paymentStatus: paymentStatusesByStudentId.get(registration.studentId),
      });
      if (eligibility.allowed) {
        authorized.set(registration.studentId, {
          registrationId: registration.registrationId,
        });
      }
    });
    return authorized;
  }

  if (event.selectedStudentIds.length > 0) {
    event.selectedStudentIds.forEach((studentId) => {
      const registration = registrationsByStudentId.get(studentId);
      authorized.set(studentId, {
        registrationId: registration?.registrationId ?? "",
      });
    });
  }

  if (event.selectedSchoolIds.length > 0) {
    const selectedProfiles = await loadStudentProfilesBySchoolIds(
      event.selectedSchoolIds
    );
    selectedProfiles.forEach((doc) => {
      const data = doc.data() ?? {};
      if (!isStudentProfile(data)) {
        return;
      }

      const registration = registrationsByStudentId.get(doc.id);
      const eligibility = evaluateEventEligibility(event, {
        studentId: doc.id,
        schoolId: normalizeText(data.schoolId),
        studentName:
          normalizeText(data.studentName) ||
          normalizeText(data.name) ||
          doc.id,
        course: normalizeCourse(data.course),
        yearLevel: normalizeYearLevel(data.year ?? data.yearLevel),
        registrationStatus: registration?.status,
        paymentStatus: paymentStatusesByStudentId.get(doc.id),
      });
      if (!eligibility.allowed) {
        return;
      }

      authorized.set(doc.id, {
        registrationId: registration?.registrationId ?? "",
      });
    });
  }

  if (hasExplicitSelectedAudience(event)) {
    return authorized;
  }

  const profilesSnap = await db.collection("profiles").where("role", "==", "student").get();
  profilesSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (!isStudentProfile(data)) {
      return;
    }

    const registration = registrationsByStudentId.get(doc.id);
    const eligibility = evaluateEventEligibility(event, {
      studentId: doc.id,
      schoolId: normalizeText(data.schoolId),
      studentName:
        normalizeText(data.studentName) ||
        normalizeText(data.name) ||
        doc.id,
      course: normalizeCourse(data.course),
      yearLevel: normalizeYearLevel(data.year ?? data.yearLevel),
      registrationStatus: registration?.status,
      paymentStatus: paymentStatusesByStudentId.get(doc.id),
    });
    if (!eligibility.allowed) {
      return;
    }

    authorized.set(doc.id, {
      registrationId: registration?.registrationId ?? "",
    });
  });

  return authorized;
}

function portableEventPayload(event: PortableEventSummary) {
  return {
    eventId: event.eventId,
    title: event.title,
    date: event.date,
    scheduledTime: event.scheduledTime,
    scheduledTimeEnd: event.scheduledTimeEnd,
    location: event.location,
    status: event.status,
    yearLevels: event.yearLevels,
    courses: event.courses,
    targetStudent: event.targetStudent,
    selectedStudentIds: event.selectedStudentIds,
    selectedSchoolIds: event.selectedSchoolIds,
    requiresRegistration: event.requiresRegistration,
    requiresPayment: event.requiresPayment,
    linkedPaymentId: event.linkedPaymentId,
  };
}

function portableEventEligibilityPayload(event: PortableEventSummary) {
  return {
    yearLevels: event.yearLevels,
    courses: event.courses,
    targetStudent: event.targetStudent,
    selectedStudentIds: event.selectedStudentIds,
    selectedSchoolIds: event.selectedSchoolIds,
    requiresRegistration: event.requiresRegistration,
    requiresPayment: event.requiresPayment,
    linkedPaymentId: event.linkedPaymentId,
  };
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

function enrollmentSessionSummaryFromSnapshot(
  snap: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): EnrollmentSessionSummary {
  const data = snap.data() ?? {};

  return {
    sessionId: snap.id,
    createdBy: normalizeText(data.createdBy),
    createdByName: normalizeText(data.createdByName),
    createdBySchoolId: normalizeText(data.createdBySchoolId),
    status: normalizeEnrollmentSessionStatus(data.status),
    pairedDeviceId: normalizeText(data.pairedDeviceId),
    totalStudents: toPositiveInt(data.totalStudents, 0),
    pendingCount: toPositiveInt(data.pendingCount, 0),
    downloadedCount: toPositiveInt(data.downloadedCount, 0),
    enrolledCount: toPositiveInt(data.enrolledCount, 0),
    syncedCount: toPositiveInt(data.syncedCount, 0),
    failedCount: toPositiveInt(data.failedCount, 0),
    selectedStudentIds: asStringArray(data.selectedStudentIds),
    createdAtMs: toMillis(data.createdAt),
    updatedAtMs: toMillis(data.updatedAt),
  };
}

function enrollmentSessionStudentFromSnapshot(
  snap: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): EnrollmentSessionStudent {
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
    course: normalizeCourse(data.course) || "Unassigned",
    yearLevel: normalizeYearLevel(data.yearLevel ?? data.year) || "Unassigned",
    status: normalizeEnrollmentStudentStatus(data.status),
    syncStatus: normalizeEnrollmentSyncStatus(data.syncStatus),
    fingerprintTemplateId: toPositiveInt(data.fingerprintTemplateId ?? data.templateId, -1),
    enrolledByDevice: normalizeText(data.enrolledByDevice),
    assignedDeviceId: normalizeText(data.assignedDeviceId),
    remarks: normalizeText(data.remarks),
  };
}

async function listEnrollmentSessionsForDevice(
  device: DeviceContext,
  limit: number
): Promise<EnrollmentSessionSummary[]> {
  const snapshot = await db
    .collection("enrollmentSessions")
    .limit(MAX_ENROLLMENT_SESSION_LIMIT)
    .get();

  return snapshot.docs
    .map((doc) => enrollmentSessionSummaryFromSnapshot(doc))
    .filter((session) => {
      if (session.status === "completed" || session.status === "closed") {
        return false;
      }

      return !session.pairedDeviceId || session.pairedDeviceId === device.deviceId;
    })
    .sort((left, right) => {
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      return left.sessionId.localeCompare(right.sessionId);
    })
    .slice(0, limit);
}

async function readEnrollmentSessionSummary(sessionId: string): Promise<EnrollmentSessionSummary> {
  const snap = await db.doc(`enrollmentSessions/${sessionId}`).get();
  if (!snap.exists) {
    throw new ApiError(404, "Enrollment session not found.");
  }

  return enrollmentSessionSummaryFromSnapshot(snap);
}

async function readEnrollmentSessionStudents(sessionId: string) {
  const snapshot = await db
    .collection(`enrollmentSessions/${sessionId}/students`)
    .orderBy("fullName", "asc")
    .get();

  return snapshot.docs.map((doc) => ({
    ref: doc.ref,
    student: enrollmentSessionStudentFromSnapshot(doc),
  }));
}

async function refreshEnrollmentSessionSummary(sessionId: string): Promise<EnrollmentSessionSummary> {
  const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new ApiError(404, "Enrollment session not found.");
  }

  const current = enrollmentSessionSummaryFromSnapshot(sessionSnap);
  const students = await readEnrollmentSessionStudents(sessionId);

  let pendingCount = 0;
  let downloadedCount = 0;
  let enrolledCount = 0;
  let syncedCount = 0;
  let failedCount = 0;

  students.forEach(({student}) => {
    if (student.status === "pending") {
      pendingCount += 1;
      return;
    }

    downloadedCount += 1;

    if (student.status === "enrolled" || student.status === "synced") {
      enrolledCount += 1;
    }
    if (student.syncStatus === "synced" || student.status === "synced") {
      syncedCount += 1;
    }
    if (student.status === "failed" || student.syncStatus === "failed") {
      failedCount += 1;
    }
  });

  let nextStatus: EnrollmentSessionStatus = current.pairedDeviceId ? "paired" : "pending";
  const totalStudents = students.length || current.totalStudents;

  if (current.status === "closed") {
    nextStatus = "closed";
  } else if (totalStudents > 0 && syncedCount === totalStudents && failedCount === 0) {
    nextStatus = "completed";
  } else if (totalStudents > 0 && syncedCount > 0 && syncedCount + failedCount >= totalStudents) {
    nextStatus = "partially-completed";
  } else if (enrolledCount > 0 || syncedCount > 0 || failedCount > 0) {
    nextStatus = "enrolling";
  } else if (downloadedCount > 0) {
    nextStatus = "downloading";
  }

  await sessionRef.set(
    {
      totalStudents,
      pendingCount,
      downloadedCount,
      enrolledCount,
      syncedCount,
      failedCount,
      status: nextStatus,
      completedAt: nextStatus === "completed" || nextStatus === "partially-completed" ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );

  return {
    ...current,
    totalStudents,
    pendingCount,
    downloadedCount,
    enrolledCount,
    syncedCount,
    failedCount,
    status: nextStatus,
    updatedAtMs: Date.now(),
  };
}

async function pairDeviceToEnrollmentSession(
  device: DeviceContext,
  sessionId: string
): Promise<EnrollmentSessionSummary> {
  const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new ApiError(404, "Enrollment session not found.");
  }

  const session = enrollmentSessionSummaryFromSnapshot(sessionSnap);
  if (session.pairedDeviceId && session.pairedDeviceId !== device.deviceId) {
    throw new ApiError(409, "Enrollment session is already paired to another device.");
  }
  if (session.status === "completed" || session.status === "closed") {
    throw new ApiError(400, "Enrollment session is no longer available.");
  }

  await sessionRef.set(
    {
      pairedDeviceId: device.deviceId,
      status: session.status === "pending" ? "paired" : session.status,
      pairedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );

  await device.ref.set(
    {
      activeEnrollmentSessionId: sessionId,
      lastEnrollmentSessionPairedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );

  return readEnrollmentSessionSummary(sessionId);
}

async function resolveDeviceEnrollmentSession(
  device: DeviceContext,
  explicitSessionId: string
): Promise<EnrollmentSessionSummary> {
  const sessionId = explicitSessionId || normalizeText(device.data.activeEnrollmentSessionId);
  if (!sessionId) {
    throw new ApiError(404, "Device is not paired to an enrollment session.");
  }

  const session = await readEnrollmentSessionSummary(sessionId);
  if (session.pairedDeviceId && session.pairedDeviceId !== device.deviceId) {
    throw new ApiError(403, "Device can only access its assigned enrollment session.");
  }

  return session;
}

async function markEnrollmentSessionDownloaded(
  device: DeviceContext,
  sessionId: string
): Promise<Array<{ref: FirebaseFirestore.DocumentReference; student: EnrollmentSessionStudent}>> {
  const session = await resolveDeviceEnrollmentSession(device, sessionId);
  if (!session.pairedDeviceId) {
    throw new ApiError(400, "Enrollment session must be paired before download.");
  }

  const students = await readEnrollmentSessionStudents(sessionId);
  const batch = db.batch();

  students.forEach(({ref, student}) => {
    if (student.status === "pending") {
      batch.set(
        ref,
        {
          status: "downloaded",
          syncStatus: student.syncStatus,
          assignedDeviceId: device.deviceId,
          downloadedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        {merge: true}
      );
    }
  });

  batch.set(
    db.doc(`enrollmentSessions/${sessionId}`),
    {
      status: "downloading",
      pairedDeviceId: device.deviceId,
      lastDownloadedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {merge: true}
  );
  await batch.commit();

  await refreshEnrollmentSessionSummary(sessionId);
  return readEnrollmentSessionStudents(sessionId);
}

async function listEnrollmentSessions(
  limit: number
): Promise<EnrollmentSessionSummary[]> {
  const snapshot = await db
    .collection("enrollmentSessions")
    .limit(Math.min(limit, MAX_ENROLLMENT_SESSION_LIMIT))
    .get();

  return snapshot.docs
    .map((doc) => enrollmentSessionSummaryFromSnapshot(doc))
    .sort((left, right) => {
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      return left.sessionId.localeCompare(right.sessionId);
    })
    .slice(0, limit);
}

async function assertStudentsNotInActiveEnrollmentSessions(
  studentIds: string[]
): Promise<void> {
  const probeIds = dedupeStrings(studentIds).slice(0, 30);
  if (probeIds.length === 0) {
    return;
  }

  const snapshot = await db
    .collection("enrollmentSessions")
    .where("selectedStudentIds", "array-contains-any", probeIds)
    .get();

  for (const doc of snapshot.docs) {
    const session = enrollmentSessionSummaryFromSnapshot(doc);
    if (session.status === "completed" || session.status === "closed") {
      continue;
    }

    const overlap = session.selectedStudentIds.filter((id) => probeIds.includes(id));
    if (overlap.length > 0) {
      throw new functions.https.HttpsError(
        "already-exists",
        "One or more students are already included in an active fingerprint enrollment session."
      );
    }
  }
}

async function buildEnrollmentSessionStudentsFromIds(
  studentIds: string[]
): Promise<Array<EnrollmentSessionStudent & {studentUid: string}>> {
  const uniqueIds = dedupeStrings(studentIds);
  const [profilesById, portableStudentsById] = await Promise.all([
    loadDocsById("profiles", uniqueIds),
    loadDocsById("students", uniqueIds),
  ]);

  const rows = uniqueIds.map((studentId) => {
    const merged = {
      ...(profilesById.get(studentId) ?? {}),
      ...(portableStudentsById.get(studentId) ?? {}),
    };
    const context = mapStudentContext(
      studentId,
      profilesById.get(studentId),
      portableStudentsById.get(studentId),
      ""
    );

    const alreadyHasFingerprint =
      context.fingerprintTemplateId > 0 ||
      normalizeLower(merged.fingerprintStatus) === "enrolled" ||
      normalizeLower(merged.fingerprintStatus) === "active";

    if (alreadyHasFingerprint) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `${context.studentName} already has a fingerprint record.`
      );
    }

    return {
      studentId: context.studentId,
      studentUid: context.studentUid,
      schoolId: context.schoolId,
      fullName: context.studentName,
      course: context.course,
      yearLevel: context.yearLevel,
      status: "pending" as EnrollmentStudentStatus,
      syncStatus: "pending" as const,
      fingerprintTemplateId: -1,
      enrolledByDevice: "",
      assignedDeviceId: "",
      remarks: "",
    };
  });

  return rows;
}

function enrollmentSessionPayload(session: EnrollmentSessionSummary) {
  return {
    sessionId: session.sessionId,
    createdBy: session.createdBy,
    createdByName: session.createdByName,
    createdBySchoolId: session.createdBySchoolId,
    status: session.status,
    pairedDeviceId: session.pairedDeviceId,
    totalStudents: session.totalStudents,
    pendingCount: session.pendingCount,
    downloadedCount: session.downloadedCount,
    enrolledCount: session.enrolledCount,
    syncedCount: session.syncedCount,
    failedCount: session.failedCount,
    selectedStudentIds: session.selectedStudentIds,
    createdAtMs: session.createdAtMs,
    updatedAtMs: session.updatedAtMs,
  };
}

function enrollmentSessionStudentPayload(student: EnrollmentSessionStudent) {
  return {
    studentId: student.studentId,
    studentUid: student.studentUid,
    schoolId: student.schoolId,
    fullName: student.fullName,
    course: student.course,
    yearLevel: student.yearLevel,
    status: student.status,
    syncStatus: student.syncStatus,
    fingerprintTemplateId: student.fingerprintTemplateId,
    enrolledByDevice: student.enrolledByDevice,
    assignedDeviceId: student.assignedDeviceId,
    remarks: student.remarks,
  };
}

type EnrollmentCandidate = EventContextStudent & {
  eventId: string;
};

async function listPendingEnrollments(
  device: DeviceContext,
  limit: number
): Promise<EnrollmentCandidate[]> {
  const activeEnrollmentSessionId = normalizeText(device.data.activeEnrollmentSessionId);
  if (activeEnrollmentSessionId) {
    const sessionStudents = await readEnrollmentSessionStudents(activeEnrollmentSessionId);
    return sessionStudents
      .filter(({student}) => student.syncStatus !== "synced" && student.status !== "failed")
      .slice(0, limit)
      .map(({student}) => ({
        studentId: student.studentId,
        studentUid: student.studentUid,
        schoolId: student.schoolId,
        studentName: student.fullName,
        course: student.course,
        yearLevel: student.yearLevel,
        fingerprintTemplateId: student.fingerprintTemplateId,
        fingerprintStatus: student.status,
        fingerprintDeviceId: student.enrolledByDevice,
        queueId: student.studentId,
        registrationId: "",
        eventId: activeEnrollmentSessionId,
      }));
  }

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

function resolveAttendanceMoment(
  epochValue: unknown,
  isoValue: unknown,
  timestampValue?: unknown
) {
  const epochSeconds = toPositiveInt(epochValue);
  const iso = normalizeText(isoValue);

  if (epochSeconds > 0) {
    return {
      hasValue: true,
      timestamp: admin.firestore.Timestamp.fromMillis(epochSeconds * 1000),
      epochSeconds,
      iso,
    };
  }

  const timestampMs = toMillis(timestampValue);
  if (timestampMs > 0) {
    return {
      hasValue: true,
      timestamp: admin.firestore.Timestamp.fromMillis(timestampMs),
      epochSeconds: Math.floor(timestampMs / 1000),
      iso,
    };
  }

  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) {
      return {
        hasValue: true,
        timestamp: admin.firestore.Timestamp.fromMillis(parsed),
        epochSeconds: Math.floor(parsed / 1000),
        iso,
      };
    }
  }

  return {
    hasValue: false,
    timestamp: null,
    epochSeconds: 0,
    iso,
  };
}

function normalizeAttendanceType(value: unknown): "time-in" | "time-out" | "present" | "" {
  const raw = normalizeLower(value);
  if (raw === "time-in" || raw === "timein" || raw === "in") {
    return "time-in";
  }
  if (raw === "time-out" || raw === "timeout" || raw === "out") {
    return "time-out";
  }
  if (raw === "present") {
    return "present";
  }
  return "";
}

function buildAttendanceRecordId(
  eventId: string,
  studentId: string,
  schoolId: string,
  attendanceType: string
): string {
  return [
    sanitizeIdComponent(eventId),
    sanitizeIdComponent(studentId || schoolId),
    sanitizeIdComponent(attendanceType || "attendance"),
  ]
    .filter(Boolean)
    .join("-");
}

function deriveAttendanceStatus(hasTimeIn: boolean, hasTimeOut: boolean): string {
  if (hasTimeIn && hasTimeOut) {
    return "Present";
  }
  if (hasTimeIn) {
    return "Timed In";
  }
  return "";
}

async function syncEnrollmentResult(
  device: DeviceContext,
  record: Record<string, unknown>
): Promise<{
  recordId: string;
  studentId: string;
  status: EnrollmentResponseStatus;
  message: string;
}> {
  const sessionId =
    normalizeText(record.sessionId) ||
    normalizeText(device.data.activeEnrollmentSessionId);
  const studentId =
    normalizeText(record.studentId) ||
    normalizeText(record.studentUid) ||
    normalizeText(record.uid);
  const templateId = toPositiveInt(
    record.fingerprintTemplateId ?? record.templateId,
    -1
  );
  const recordId =
    normalizeText(record.recordId) ||
    `enrollment:${sessionId}:${studentId}`;
  const requestedStatus = normalizeEnrollmentStudentStatus(
    record.status ?? record.enrollmentStatus
  );
  const failedUpload =
    requestedStatus === "failed" ||
    normalizeEnrollmentSyncStatus(record.syncStatus) === "failed";

  if (!sessionId || !studentId) {
    return {
      recordId,
      studentId,
      status: "failed",
      message: "sessionId and studentId are required.",
    };
  }

  if (!failedUpload && templateId <= 0) {
    return {
      recordId,
      studentId,
      status: "failed",
      message: "fingerprintTemplateId must be a positive integer.",
    };
  }

  if (!failedUpload) {
    const templateConflict = await findActiveFingerprintTemplateConflict(
      templateId,
      studentId
    );
    if (templateConflict) {
      return {
        recordId,
        studentId,
        status: "failed",
        message: `Template ${templateId} is already assigned to another active student.`,
      };
    }
  }

  const session = await resolveDeviceEnrollmentSession(device, sessionId);
  if (session.status === "closed") {
    return {
      recordId,
      studentId,
      status: "failed",
      message: "Enrollment session is already closed.",
    };
  }

  const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
  const sessionStudentRef = db.doc(`enrollmentSessions/${sessionId}/students/${studentId}`);
  const portableStudentRef = db.doc(`students/${studentId}`);
  const profileRef = db.doc(`profiles/${studentId}`);
  const syncLogRef = db.doc(`devices/${device.deviceId}/syncLogs/${recordId}`);
  const recordedTimestamp = resolveRecordedTimestamp(record);

  let resultStatus: EnrollmentResponseStatus = "uploaded";
  let resultMessage = failedUpload ?
    "Enrollment marked as failed." :
    "Fingerprint enrollment synced.";
  let templateOwnerPayload: {
    uid: string;
    schoolId: string;
    studentName: string;
    course: string;
    yearLevel: string;
    deviceId: string;
    enrolledAt: unknown;
  } | null = null;

  await db.runTransaction(async (transaction) => {
    const [
      freshSessionSnap,
      sessionStudentSnap,
      portableStudentSnap,
      profileSnap,
      syncLogSnap,
    ] = await transaction.getAll(
      sessionRef,
      sessionStudentRef,
      portableStudentRef,
      profileRef,
      syncLogRef
    );

    if (!freshSessionSnap.exists || !sessionStudentSnap.exists) {
      resultStatus = "failed";
      resultMessage = "Enrollment session student was not found.";
      return;
    }

    if (syncLogSnap.exists) {
      resultStatus = "duplicate";
      resultMessage = "Enrollment result was already processed.";
      return;
    }

    const freshSession = enrollmentSessionSummaryFromSnapshot(freshSessionSnap);
    if (freshSession.pairedDeviceId && freshSession.pairedDeviceId !== device.deviceId) {
      resultStatus = "failed";
      resultMessage = "Device can only sync its assigned enrollment session.";
      return;
    }

    const sessionStudentData = sessionStudentSnap.data() ?? {};
    if (normalizeEnrollmentSyncStatus(sessionStudentData.syncStatus) === "synced") {
      resultStatus = "duplicate";
      resultMessage = "Student fingerprint is already synced.";
      return;
    }

    const mergedStudent = {
      ...(profileSnap.exists ? profileSnap.data() ?? {} : {}),
      ...(portableStudentSnap.exists ? portableStudentSnap.data() ?? {} : {}),
      ...sessionStudentData,
      ...record,
    };

    const sessionStudentPatch: Record<string, unknown> = {
      status: failedUpload ? "failed" : "synced",
      syncStatus: failedUpload ? "failed" : "synced",
      fingerprintTemplateId: failedUpload ? sessionStudentData.fingerprintTemplateId ?? null : templateId,
      enrolledByDevice: device.deviceId,
      assignedDeviceId: device.deviceId,
      remarks: normalizeText(record.remarks) || (failedUpload ? "Enrollment failed on device." : ""),
      updatedAt: serverTimestamp(),
      syncedAt: serverTimestamp(),
    };

    if (!failedUpload) {
      sessionStudentPatch.enrolledAt = recordedTimestamp.timestamp;
    }

    transaction.set(sessionStudentRef, sessionStudentPatch, {merge: true});

    if (!failedUpload) {
      const portableStudentPatch = {
        uid: studentId,
        studentId,
        schoolId: normalizeText(mergedStudent.schoolId) || studentId,
        studentName:
          normalizeText(mergedStudent.studentName) ||
          normalizeText(mergedStudent.fullName) ||
          normalizeText(mergedStudent.name) ||
          studentId,
        course: normalizeCourse(mergedStudent.course) || "Unassigned",
        yearLevel:
          normalizeYearLevel(mergedStudent.yearLevel ?? mergedStudent.year) || "Unassigned",
        year:
          normalizeYearLevel(mergedStudent.yearLevel ?? mergedStudent.year) || "Unassigned",
        hasFingerprint: true,
        fingerprintTemplateId: templateId,
        templateId,
        fingerprintStatus: "enrolled",
        fingerprintDeviceId: device.deviceId,
        fingerprintEnrolledAt: recordedTimestamp.timestamp,
        latestEnrollmentSessionId: sessionId,
        updatedAt: serverTimestamp(),
      };

      transaction.set(portableStudentRef, portableStudentPatch, {merge: true});
      transaction.set(
        profileRef,
        {
          hasFingerprint: true,
          fingerprintTemplateId: templateId,
          fingerprintStatus: "enrolled",
          fingerprintDeviceId: device.deviceId,
          fingerprintEnrolledAt: recordedTimestamp.timestamp,
          latestEnrollmentSessionId: sessionId,
          updatedAt: serverTimestamp(),
        },
        {merge: true}
      );

      templateOwnerPayload = {
        uid: studentId,
        schoolId: portableStudentPatch.schoolId,
        studentName: portableStudentPatch.studentName,
        course: portableStudentPatch.course,
        yearLevel: portableStudentPatch.yearLevel,
        deviceId: device.deviceId,
        enrolledAt: recordedTimestamp.timestamp,
      };
    }

    transaction.set(
      syncLogRef,
      {
        recordId,
        sessionId,
        studentId,
        schoolId: normalizeText(mergedStudent.schoolId) || studentId,
        studentName:
          normalizeText(mergedStudent.studentName) ||
          normalizeText(mergedStudent.fullName) ||
          normalizeText(mergedStudent.name) ||
          studentId,
        deviceId: device.deviceId,
        fingerprintTemplateId: templateId > 0 ? templateId : null,
        syncStatus: failedUpload ? "failed" : "uploaded",
        message: resultMessage,
        attemptedAt: serverTimestamp(),
        processedAt: serverTimestamp(),
        source: "portable-device",
      },
      {merge: true}
    );

    transaction.set(
      device.ref,
      {
        lastEnrollmentSyncAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );
  });

  if (!failedUpload && resultStatus === "uploaded" && templateOwnerPayload) {
    await upsertFingerprintTemplateOwner(templateId, templateOwnerPayload);
  }

  await refreshEnrollmentSessionSummary(sessionId);

  return {
    recordId,
    studentId,
    status: resultStatus,
    message: resultMessage,
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
      eventScheduledTimeEnd: event.scheduledTimeEnd,
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
        scheduledTimeEnd: event.scheduledTimeEnd,
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

async function findStudentRegistrationStatusForEvent(
  eventId: string,
  studentId: string
): Promise<"PRE_REGISTERED" | "WAITLISTED" | "CANCELLED" | ""> {
  const eventSnap = await db.doc(`events/${eventId}`).get();
  const eventData = eventSnap.data() ?? {};
  if (eventData.isPreReg !== true) {
    return "";
  }

  const directSnap = await db.doc(`events/${eventId}/registrations/${studentId}`).get();
  if (directSnap.exists) {
    return parseRegistrationStatus(directSnap.data()?.status);
  }

  const registrationsSnap = await db.collection(`events/${eventId}/registrations`).get();
  for (const doc of registrationsSnap.docs) {
    const data = doc.data();
    if (
      (normalizeText(data.uid) === studentId ||
        normalizeText(data.studentUid) === studentId)
    ) {
      return parseRegistrationStatus(data.status);
    }
  }

  return "";
}

async function syncAttendanceRecord(
  device: DeviceContext,
  record: Record<string, unknown>
): Promise<{recordId: string; status: AttendanceResponseStatus; message: string}> {
  const eventId = normalizeText(record.eventId);
  const studentId =
    normalizeText(record.studentId) ||
    normalizeText(record.studentUid) ||
    normalizeText(record.uid);
  const schoolId = normalizeText(record.schoolId);
  const rawDeviceId = normalizeText(record.deviceId);
  const recordedTimestamp = resolveRecordedTimestamp(record);
  const incomingTimeIn = resolveAttendanceMoment(
    record.timeInEpoch ?? record.timestampEpoch ?? record.capturedAtEpoch,
    record.timeInIso ?? record.timestampIso ?? record.capturedAtIso
  );
  const incomingTimeOut = resolveAttendanceMoment(record.timeOutEpoch, record.timeOutIso);
  const attendanceType =
    normalizeAttendanceType(record.attendanceType) ||
    (incomingTimeOut.hasValue ? "time-out" : incomingTimeIn.hasValue ? "time-in" : "");
  const recordId =
    normalizeText(record.recordId) ||
    buildAttendanceRecordId(eventId, studentId, schoolId, attendanceType);
  const requestDeviceId = rawDeviceId || device.deviceId;

  if (!recordId) {
    return {recordId: "", status: "failed", message: "recordId is required."};
  }

  if (!eventId) {
    return {
      recordId,
      status: "failed",
      message: "eventId is required.",
    };
  }

  if (!studentId || !schoolId) {
    return {
      recordId,
      status: "failed",
      message: "studentId and schoolId are required.",
    };
  }

  if (!attendanceType) {
    return {
      recordId,
      status: "failed",
      message: "attendanceType or attendance time data is required.",
    };
  }

  if (!rawDeviceId) {
    return {
      recordId,
      status: "failed",
      message: "deviceId is required.",
    };
  }

  if (requestDeviceId !== device.deviceId) {
    return {
      recordId,
      status: "failed",
      message: "deviceId does not match the authenticated device.",
    };
  }

  const hasRecordedTimestamp =
    recordedTimestamp.epochSeconds > 0 ||
    recordedTimestamp.iso.length > 0 ||
    incomingTimeIn.hasValue ||
    incomingTimeOut.hasValue;
  if (!hasRecordedTimestamp) {
    return {
      recordId,
      status: "failed",
      message: "timestamp, timeIn, or timeOut is required.",
    };
  }

  if ((attendanceType === "time-in" || attendanceType === "present") &&
      !incomingTimeIn.hasValue) {
    return {
      recordId,
      status: "failed",
      message: "timeIn data is required for this attendanceType.",
    };
  }

  if ((attendanceType === "time-out" || attendanceType === "present") &&
      !incomingTimeOut.hasValue) {
    return {
      recordId,
      status: "failed",
      message: "timeOut data is required for this attendanceType.",
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

  const attendanceRef = db.doc(`events/${eventId}/attendance/${studentId}`);
  const syncLogRef = db.doc(`syncLogs/${recordId}`);
  const eventRef = db.doc(`events/${eventId}`);
  const studentRef = db.doc(`students/${studentId}`);
  const profileRef = db.doc(`profiles/${studentId}`);
  const event = await getEventSummary(eventId);
  const registrationStatus = await findStudentRegistrationStatusForEvent(
    eventId,
    studentId
  );
  const [profileSnap, studentSnap] = await Promise.all([
    profileRef.get(),
    studentRef.get(),
  ]);
  const mergedStudent = {
    ...(profileSnap.exists ? profileSnap.data() : {}),
    ...(studentSnap.exists ? studentSnap.data() : {}),
  };
  const resolvedSchoolId =
    schoolId || normalizeText(mergedStudent.schoolId) || studentId;
  const resolvedStudentName =
    normalizeText(record.studentName) ||
    normalizeText(mergedStudent.studentName) ||
    normalizeText(mergedStudent.name) ||
    resolvedSchoolId ||
    studentId;
  const resolvedCourse =
    normalizeText(record.course) ||
    normalizeText(mergedStudent.course) ||
    "Unassigned";
  const resolvedYearLevel =
    normalizeYearLevel(record.yearLevel ?? record.year) ||
    normalizeYearLevel(mergedStudent.yearLevel ?? mergedStudent.year) ||
    "Unassigned";
  const paymentStatus =
    event.requiresPayment && event.linkedPaymentId ?
      await loadPaymentStatusForStudent(event.linkedPaymentId, studentId) :
      "";
  deviceLogger.info(`[SYNC][ATTEND] validating eventId=${eventId} schoolId=${resolvedSchoolId}`, {
    eventId,
    schoolId: resolvedSchoolId,
    studentId,
    deviceId: device.deviceId,
  });
  const eligibility = evaluateEventEligibility(event, {
    studentId,
    schoolId: resolvedSchoolId,
    studentName: resolvedStudentName,
    course: resolvedCourse,
    yearLevel: resolvedYearLevel,
    registrationStatus,
    paymentStatus,
  });
  if (!eligibility.allowed) {
    const rejectionMessage = eligibility.reason === "payment_required" ?
      "Student has not paid." :
      "Student is not allowed for this event";
    deviceLogger.warn(
      `[SYNC][ATTEND] rejected reason=not_allowed_for_event eventId=${eventId} schoolId=${resolvedSchoolId}`,
      {
      eventId,
      schoolId: resolvedSchoolId,
      studentId,
      reason: eligibility.reason,
      }
    );
    await syncLogRef.set(
      {
        recordId,
        eventId,
        studentId,
        schoolId: resolvedSchoolId,
        studentName: resolvedStudentName,
        deviceId: device.deviceId,
        syncStatus: "rejected",
        message: rejectionMessage,
        attemptedAt: serverTimestamp(),
        processedAt: serverTimestamp(),
        source: "portable-device",
      },
      {merge: true}
    );
    return {
      recordId,
      status: "rejected",
      message: rejectionMessage,
    };
  }

  const incomingTimeInSource =
    normalizeText(record.timeInSource ?? record.timeSource) || "unknown";
  const incomingTimeOutSource = normalizeText(record.timeOutSource) || "unknown";

  let resultStatus: AttendanceResponseStatus = "failed";
  let resultMessage = "Failed to sync attendance.";

  await db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (!eventSnap.exists) {
      throw new ApiError(404, "Event not found.");
    }

    const attendanceSnap = await transaction.get(attendanceRef);
    const existingAttendance = attendanceSnap.exists ? attendanceSnap.data() ?? {} : {};
    const existingTimeIn = resolveAttendanceMoment(
      existingAttendance.timeInEpoch ?? existingAttendance.deviceTimestampEpoch,
      existingAttendance.timeInIso ?? existingAttendance.deviceTimestampIso,
      existingAttendance.timeIn ?? existingAttendance.timestamp
    );
    const existingTimeOut = resolveAttendanceMoment(
      existingAttendance.timeOutEpoch,
      existingAttendance.timeOutIso,
      existingAttendance.timeOut
    );
    const mergedTimeIn = incomingTimeIn.hasValue ? incomingTimeIn : existingTimeIn;
    const mergedTimeOut = incomingTimeOut.hasValue ? incomingTimeOut : existingTimeOut;

    if (incomingTimeOut.hasValue && !mergedTimeIn.hasValue) {
      resultStatus = "failed";
      resultMessage = "No Time in record. Cannot Time out.";

      transaction.set(
        syncLogRef,
        {
          recordId,
          eventId,
          studentId,
          deviceId: device.deviceId,
          syncStatus: "failed",
          message: resultMessage,
          attemptedAt: serverTimestamp(),
          processedAt: serverTimestamp(),
          source: "portable-device",
        },
        {merge: true}
      );
      return;
    }

    const addsNewTimeIn = incomingTimeIn.hasValue && !existingTimeIn.hasValue;
    const addsNewTimeOut = incomingTimeOut.hasValue && !existingTimeOut.hasValue;
    if (attendanceSnap.exists) {
      if (!addsNewTimeIn && !addsNewTimeOut) {
        resultStatus = "duplicate";
        resultMessage = "Attendance already up to date.";

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
    } else if (!mergedTimeIn.hasValue) {
      resultStatus = "failed";
      resultMessage = "Time In data is required.";

      transaction.set(
        syncLogRef,
        {
          recordId,
          eventId,
          studentId,
          deviceId: device.deviceId,
          syncStatus: "failed",
          message: resultMessage,
          attemptedAt: serverTimestamp(),
          processedAt: serverTimestamp(),
          source: "portable-device",
        },
        {merge: true}
      );
      return;
    }

    const transactionProfileSnap = await transaction.get(profileRef);
    const transactionStudentSnap = await transaction.get(studentRef);
    const transactionStudentData = {
      ...(transactionProfileSnap.exists ? transactionProfileSnap.data() : {}),
      ...(transactionStudentSnap.exists ? transactionStudentSnap.data() : {}),
    };
    const attendanceStatus = deriveAttendanceStatus(
      mergedTimeIn.hasValue,
      mergedTimeOut.hasValue
    );

    const attendanceDoc = {
      eventId,
      eventTitle: normalizeText(record.eventTitle) || event.title,
      eventDate: normalizeText(record.eventDate) || event.date,
      studentId,
      uid: studentId,
      studentUid: studentId,
      schoolId: resolvedSchoolId || normalizeText(transactionStudentData.schoolId) || studentId,
      studentName:
        resolvedStudentName ||
        normalizeText(transactionStudentData.studentName) ||
        normalizeText(transactionStudentData.name) ||
        studentId,
      course:
        resolvedCourse ||
        normalizeText(transactionStudentData.course) ||
        "Unassigned",
      yearLevel:
        resolvedYearLevel ||
        normalizeYearLevel(transactionStudentData.yearLevel ?? transactionStudentData.year) ||
        "Unassigned",
      year:
        resolvedYearLevel ||
        normalizeYearLevel(transactionStudentData.yearLevel ?? transactionStudentData.year) ||
        "Unassigned",
      timestamp: mergedTimeIn.timestamp ?? recordedTimestamp.timestamp,
      recordedAt: existingAttendance.recordedAt ?? serverTimestamp(),
      recordedByDevice: true,
      recordedByDeviceId: device.deviceId,
      deviceId: requestDeviceId,
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
      attendanceType,
      deviceTimestampEpoch: recordedTimestamp.epochSeconds,
      deviceTimestampIso: recordedTimestamp.iso,
      timeSource: normalizeText(record.timeSource) || "unknown",
      scheduledTime: normalizeText(record.scheduledTimeStart) || event.scheduledTime,
      scheduledTimeStart: normalizeText(record.scheduledTimeStart) || event.scheduledTime,
      scheduledTimeEnd:
        normalizeText(record.scheduledTimeEnd) || event.scheduledTimeEnd,
      location: normalizeText(record.location ?? record.eventLocation) || event.location,
      attendanceStatus,
      status: attendanceStatus,
      timeInEpoch: mergedTimeIn.epochSeconds,
      timeInIso: mergedTimeIn.iso,
      timeInSource:
        existingTimeIn.hasValue && !incomingTimeIn.hasValue ?
          normalizeText(existingAttendance.timeInSource ?? existingAttendance.timeSource) || "unknown" :
          incomingTimeInSource,
      timeOutEpoch: mergedTimeOut.epochSeconds,
      timeOutIso: mergedTimeOut.iso,
      timeOutSource:
        existingTimeOut.hasValue && !incomingTimeOut.hasValue ?
          normalizeText(existingAttendance.timeOutSource) || "unknown" :
          incomingTimeOutSource,
      createdAt: existingAttendance.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (mergedTimeIn.timestamp) {
      Object.assign(attendanceDoc, {timeIn: mergedTimeIn.timestamp});
    }
    if (mergedTimeOut.timestamp) {
      Object.assign(attendanceDoc, {timeOut: mergedTimeOut.timestamp});
    }

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
        message: mergedTimeOut.hasValue ? "Attendance updated." : "Attendance saved.",
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
    resultMessage = mergedTimeOut.hasValue ? "Attendance updated." : "Attendance saved.";
  });

  return {
    recordId,
    status: resultStatus,
    message: resultMessage,
  };
}

export const ecListFingerprintEnrollmentSessions = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);

    const body = asRecord(data);
    const limit = parseQueryInt(
      body.limit,
      DEFAULT_ENROLLMENT_SESSION_LIMIT,
      1,
      MAX_ENROLLMENT_SESSION_LIMIT
    );
    const sessions = await listEnrollmentSessions(limit);

    return {
      sessions: sessions.map((session) => enrollmentSessionPayload(session)),
    };
  });

export const ecGetFingerprintEnrollmentSessionDetail = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);

    const body = asRecord(data);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "sessionId is required."
      );
    }

    const session = await refreshEnrollmentSessionSummary(sessionId);
    const students = await readEnrollmentSessionStudents(sessionId);

    return {
      session: enrollmentSessionPayload(session),
      students: students.map(({student}) => enrollmentSessionStudentPayload(student)),
    };
  });

export const ecCreateFingerprintEnrollmentSession = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);

    const body = asRecord(data);
    const studentIds = dedupeStrings(asStringArray(body.studentIds));
    if (studentIds.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "studentIds must contain at least one student."
      );
    }

    await assertStudentsNotInActiveEnrollmentSessions(studentIds);

    const [studentRows, callerProfileSnap] = await Promise.all([
      buildEnrollmentSessionStudentsFromIds(studentIds),
      db.doc(`profiles/${context.auth?.uid}`).get(),
    ]);

    const callerProfile = callerProfileSnap.exists ? callerProfileSnap.data() ?? {} : {};
    const createdBy = normalizeText(context.auth?.uid);
    const createdBySchoolId =
      normalizeText(callerProfile.schoolId) ||
      normalizeText(context.auth?.token.email) ||
      createdBy;
    const createdByName =
      normalizeText(callerProfile.name) ||
      normalizeText(callerProfile.studentName) ||
      createdBySchoolId;

    const sessionRef = db.collection("enrollmentSessions").doc();
    const batch = db.batch();

    batch.set(sessionRef, {
      sessionId: sessionRef.id,
      createdBy,
      createdByName,
      createdBySchoolId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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

    studentRows.forEach((student) => {
      batch.set(
        db.doc(`enrollmentSessions/${sessionRef.id}/students/${student.studentId}`),
        {
          enrollmentSessionId: sessionRef.id,
          studentId: student.studentId,
          studentUid: student.studentUid,
          schoolId: student.schoolId,
          fullName: student.fullName,
          course: student.course,
          yearLevel: student.yearLevel,
          status: "pending",
          syncStatus: "pending",
          fingerprintTemplateId: null,
          enrolledByDevice: "",
          assignedDeviceId: "",
          remarks: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
    });

    await batch.commit();
    const session = await readEnrollmentSessionSummary(sessionRef.id);

    return {
      session: enrollmentSessionPayload(session),
    };
  });

export const ecCloseFingerprintEnrollmentSession = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);

    const body = asRecord(data);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "sessionId is required."
      );
    }

    await db.doc(`enrollmentSessions/${sessionId}`).set(
      {
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );

    const session = await readEnrollmentSessionSummary(sessionId);
    return {
      session: enrollmentSessionPayload(session),
    };
  });

async function listPendingCleanupQueueItems(
  deviceId: string,
  limit: number
): Promise<CleanupQueueItem[]> {
  const snapshot = await db
    .collection("moduleCleanupQueue")
    .where("processed", "==", false)
    .get();

  return snapshot.docs
    .map((cleanupDoc) => {
      const data = cleanupDoc.data() ?? {};
      const targetDeviceId = normalizeText(data.targetDeviceId);
      if (targetDeviceId && deviceId && targetDeviceId !== deviceId) {
        return null;
      }

      return {
        cleanupId: cleanupDoc.id,
        type: normalizeText(data.type) as CleanupQueueItemType,
        templateId: toPositiveInt(data.templateId, -1),
        uid: normalizeText(data.uid),
        schoolId: normalizeText(data.schoolId),
        reason: normalizeText(data.reason),
      } satisfies CleanupQueueItem;
    })
    .filter((item): item is CleanupQueueItem => {
      return item !== null && item.templateId > 0 && Boolean(item.type);
    })
    .sort((left, right) => left.cleanupId.localeCompare(right.cleanupId))
    .slice(0, limit);
}

async function acknowledgeCleanupQueueResults(
  deviceId: string,
  results: CleanupQueueResult[]
): Promise<number> {
  if (results.length === 0) {
    return 0;
  }

  const batch = db.batch();
  let processedCount = 0;
  for (const result of results) {
    if (!result.processed || !result.cleanupId) {
      continue;
    }

    const cleanupRef = db.doc(`moduleCleanupQueue/${result.cleanupId}`);
    batch.set(
      cleanupRef,
      {
        processed: true,
        processedAt: serverTimestamp(),
        processedByDeviceId: deviceId,
        processedMessage: result.message,
        updatedAt: serverTimestamp(),
      },
      {merge: true}
    );
    processedCount += 1;
  }

  if (processedCount > 0) {
    await batch.commit();
  }
  return processedCount;
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
        scheduledTimeEnd: event.scheduledTimeEnd,
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
      event: portableEventPayload(context.event),
      eligibility: portableEventEligibilityPayload(context.event),
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
      event: portableEventPayload(context.event),
      eligibility: portableEventEligibilityPayload(context.event),
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

export const campusDeviceListEnrollmentSessions = deviceEndpoint(
  "GET",
  "session-or-secret",
  async (req, res, device) => {
    const limit = parseQueryInt(
      req.query.limit,
      DEFAULT_ENROLLMENT_SESSION_LIMIT,
      1,
      MAX_ENROLLMENT_SESSION_LIMIT
    );
    const sessions = await listEnrollmentSessionsForDevice(device, limit);

    sendJson(res, 200, {
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        createdBy: session.createdBy,
        createdByName: session.createdByName,
        createdBySchoolId: session.createdBySchoolId,
        status: session.status,
        pairedDeviceId: session.pairedDeviceId,
        totalStudents: session.totalStudents,
        pendingCount: session.pendingCount,
        downloadedCount: session.downloadedCount,
        enrolledCount: session.enrolledCount,
        syncedCount: session.syncedCount,
        failedCount: session.failedCount,
        createdAtMs: session.createdAtMs,
        updatedAtMs: session.updatedAtMs,
      })),
    });
  }
);

export const campusDevicePairEnrollmentSession = deviceEndpoint(
  "POST",
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
      throw new ApiError(400, "sessionId is required.");
    }

    const session = await pairDeviceToEnrollmentSession(device, sessionId);
    sendJson(res, 200, {
      status: "paired",
      session: {
        sessionId: session.sessionId,
        createdBy: session.createdBy,
        createdByName: session.createdByName,
        createdBySchoolId: session.createdBySchoolId,
        status: session.status,
        pairedDeviceId: session.pairedDeviceId,
        totalStudents: session.totalStudents,
        pendingCount: session.pendingCount,
        downloadedCount: session.downloadedCount,
        enrolledCount: session.enrolledCount,
        syncedCount: session.syncedCount,
        failedCount: session.failedCount,
      },
    });
  }
);

export const campusDeviceDownloadEnrollmentSession = deviceEndpoint(
  "POST",
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const sessionId = normalizeText(body.sessionId);
    const students = await markEnrollmentSessionDownloaded(device, sessionId);
    const session = await readEnrollmentSessionSummary(
      sessionId || normalizeText(device.data.activeEnrollmentSessionId)
    );

    sendJson(res, 200, {
      session: {
        sessionId: session.sessionId,
        createdBy: session.createdBy,
        createdByName: session.createdByName,
        createdBySchoolId: session.createdBySchoolId,
        status: session.status,
        pairedDeviceId: session.pairedDeviceId,
        totalStudents: session.totalStudents,
        pendingCount: session.pendingCount,
        downloadedCount: session.downloadedCount,
        enrolledCount: session.enrolledCount,
        syncedCount: session.syncedCount,
        failedCount: session.failedCount,
      },
      students: students.map(({student}) => ({
        sessionId: session.sessionId,
        studentId: student.studentId,
        studentUid: student.studentUid,
        schoolId: student.schoolId,
        studentName: student.fullName,
        course: student.course,
        yearLevel: student.yearLevel,
        fingerprintTemplateId: student.fingerprintTemplateId,
        enrollmentStatus: student.status,
        syncStatus: student.syncStatus,
        remarks: student.remarks,
      })),
    });
  }
);

export const campusDeviceSyncEnrollmentResults = deviceEndpoint(
  "POST",
  "session-or-secret",
  async (req, res, device) => {
    const body = asRecord(req.body);
    const rawResults = Array.isArray(body.results) ? body.results : [body];

    if (rawResults.length > MAX_SYNC_BATCH_LIMIT) {
      throw new ApiError(400, `results must contain at most ${MAX_SYNC_BATCH_LIMIT} items.`);
    }

    const results: Array<{
      recordId: string;
      studentId: string;
      status: EnrollmentResponseStatus;
      message: string;
    }> = [];

    for (const rawResult of rawResults.slice(0, DEFAULT_SYNC_BATCH_LIMIT)) {
      const result = await syncEnrollmentResult(device, asRecord(rawResult));
      results.push(result);
    }

    const sessionId =
      normalizeText(body.sessionId) ||
      normalizeText(device.data.activeEnrollmentSessionId);
    const session = sessionId ? await readEnrollmentSessionSummary(sessionId) : null;

    sendJson(res, 200, {
      session: session ? {
        sessionId: session.sessionId,
        status: session.status,
        pairedDeviceId: session.pairedDeviceId,
        totalStudents: session.totalStudents,
        pendingCount: session.pendingCount,
        downloadedCount: session.downloadedCount,
        enrolledCount: session.enrolledCount,
        syncedCount: session.syncedCount,
        failedCount: session.failedCount,
      } : null,
      results,
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
    const sessionId =
      normalizeText(body.sessionId) ||
      normalizeText(device.data.activeEnrollmentSessionId);
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

    if (sessionId) {
      const result = await syncEnrollmentResult(device, {
        ...body,
        sessionId,
        studentId,
        fingerprintTemplateId: templateId,
      });

      sendJson(res, 200, {
        status: result.status === "uploaded" ? "enrolled" : result.status,
        sessionId,
        studentId: result.studentId,
        fingerprintTemplateId: templateId,
        deviceId: device.deviceId,
        message: result.message,
      });
      return;
    }

    if (!studentId) {
      throw new ApiError(400, "studentId is required.");
    }

    if (templateId <= 0) {
      throw new ApiError(400, "fingerprintTemplateId must be a positive integer.");
    }

    const templateConflict = await findActiveFingerprintTemplateConflict(
      templateId,
      studentId
    );
    if (templateConflict) {
      throw new ApiError(
        409,
        `Template ${templateId} is already assigned to another active student.`
      );
    }

    const profileRef = db.doc(`profiles/${studentId}`);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? profileSnap.data() ?? {} : {};
    const resolvedSchoolId =
      normalizeText(body.schoolId) || normalizeText(profileData.schoolId) || studentId;
    const resolvedStudentName =
      normalizeText(body.studentName) ||
      normalizeText(profileData.studentName) ||
      normalizeText(profileData.name) ||
      studentId;
    const resolvedCourse =
      normalizeText(body.course) || normalizeText(profileData.course) || "Unassigned";
    const resolvedYearLevel =
      normalizeYearLevel(body.yearLevel ?? body.year) ||
      normalizeYearLevel(profileData.yearLevel ?? profileData.year) ||
      "Unassigned";

    await db.doc(`students/${studentId}`).set(
      {
        uid: studentId,
        studentId,
        schoolId: resolvedSchoolId,
        studentName: resolvedStudentName,
        course: resolvedCourse,
        yearLevel: resolvedYearLevel,
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
        schoolId: resolvedSchoolId,
        studentName: resolvedStudentName,
        course: resolvedCourse,
        yearLevel: resolvedYearLevel,
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

    await upsertFingerprintTemplateOwner(templateId, {
      uid: studentId,
      schoolId: resolvedSchoolId,
      studentName: resolvedStudentName,
      course: resolvedCourse,
      yearLevel: resolvedYearLevel,
      deviceId: device.deviceId,
      enrolledAt: serverTimestamp(),
    });

    sendJson(res, 200, {
      status: "enrolled",
      studentId,
      fingerprintTemplateId: templateId,
      deviceId: device.deviceId,
    });
  }
);

async function handleCleanupQueueRequest(req: Request, res: Response): Promise<void> {
  const cleanupDevice = await authenticateCleanupQueueRequest(req);

  if (req.method === "GET") {
    const limit = parseQueryInt(
      req.query.limit,
      DEFAULT_CLEANUP_LIMIT,
      1,
      MAX_CLEANUP_LIMIT
    );
    const items = await listPendingCleanupQueueItems(cleanupDevice.deviceId, limit);

    sendJson(res, 200, {
      ok: true,
      items: items.map((item) => ({
        id: item.cleanupId,
        cleanupId: item.cleanupId,
        type: item.type,
        templateId: item.templateId,
        uid: item.uid,
        schoolId: item.schoolId,
        reason: item.reason,
      })),
    });
    return;
  }

  if (req.method === "POST") {
    const body = asRecord(req.body);
    const processedIds = asStringArray(body.processedIds);
    const legacyResults = Array.isArray(body.results) ? body.results : [];

    let results: CleanupQueueResult[] = processedIds.map((cleanupId) => ({
      cleanupId,
      processed: true,
      message: "processed",
    }));

    if (results.length === 0 && legacyResults.length > 0) {
      if (legacyResults.length > MAX_SYNC_BATCH_LIMIT) {
        throw new ApiError(
          400,
          `results must contain at most ${MAX_SYNC_BATCH_LIMIT} items.`
        );
      }

      results = legacyResults
        .map((rawResult) => {
          const result = asRecord(rawResult);
          return {
            cleanupId: normalizeText(result.cleanupId),
            processed: result.processed === true,
            message: normalizeText(result.message),
          } satisfies CleanupQueueResult;
        })
        .filter((result) => result.cleanupId);
    }

    if (results.length === 0) {
      throw new ApiError(400, "processedIds must contain at least one cleanup item ID.");
    }

    const processed = await acknowledgeCleanupQueueResults(
      cleanupDevice.deviceId,
      results
    );
    sendJson(res, 200, {
      ok: true,
      processed,
      processedIds: results
        .filter((result) => result.processed)
        .map((result) => result.cleanupId),
    });
    return;
  }

  res.set("Allow", "GET, POST, OPTIONS");
  sendJson(res, 405, {ok: false, error: "method_not_allowed"});
}

export const campusDeviceCleanupQueue = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.set("Allow", "GET, POST, OPTIONS");
    res.status(204).send("");
    return;
  }

  try {
    await handleCleanupQueueRequest(req, res);
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = errorMessage(error, "Server error");
    const shortError =
      status === 401 ? "unauthorized" :
      status === 400 ? "bad_request" :
        "internal";
    deviceLogger.error("Cleanup queue endpoint failed", {
      status,
      message,
      error,
    });
    sendJson(res, status, {
      ok: false,
      error: shortError,
      ...(shortError === "internal" ? {message} : {}),
    });
  }
});

export const campusDeviceAcknowledgeCleanupQueue = functions.region(REGION).https.onRequest(async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.set("Allow", "POST, OPTIONS");
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.set("Allow", "POST, OPTIONS");
    sendJson(res, 405, {ok: false, error: "method_not_allowed"});
    return;
  }

  try {
    await handleCleanupQueueRequest(req, res);
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 500;
    const message = errorMessage(error, "Server error");
    const shortError =
      status === 401 ? "unauthorized" :
      status === 400 ? "bad_request" :
        "internal";
    deviceLogger.error("Cleanup queue acknowledge alias failed", {
      status,
      message,
      error,
    });
    sendJson(res, status, {
      ok: false,
      error: shortError,
      ...(shortError === "internal" ? {message} : {}),
    });
  }
});

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

    const synced = results.filter((result) =>
      result.status === "uploaded" || result.status === "duplicate"
    ).length;
    const rejected = results.filter((result) => result.status === "rejected");
    const failed = results.filter((result) => result.status === "failed");
    const ok = rejected.length === 0 && failed.length === 0;
    const error =
      rejected.length > 0 ?
        "Student is not allowed for this event" :
        failed[0]?.message ?? "";

    sendJson(res, 200, {
      ok,
      synced,
      ...(error ? {error} : {}),
      rejected,
      results,
    });
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
        scheduledTimeEnd: event.scheduledTimeEnd,
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
