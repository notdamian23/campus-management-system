"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.campusDeviceConfirmPairing = exports.campusDeviceLatestEvent = exports.campusDeviceSyncAttendance = exports.campusDeviceAcknowledgeCleanupQueue = exports.campusDeviceCleanupQueue = exports.campusDeviceSubmitEnrollment = exports.campusDevicePendingEnrollments = exports.campusDeviceSyncEnrollmentResults = exports.campusDeviceDownloadEnrollmentSession = exports.campusDevicePairEnrollmentSession = exports.campusDeviceListEnrollmentSessions = exports.campusDevicePairedEventContext = exports.campusDevicePairEvent = exports.campusDeviceListEvents = exports.campusDeviceCreateSession = exports.ecCloseFingerprintEnrollmentSession = exports.ecCreateFingerprintEnrollmentSession = exports.ecGetFingerprintEnrollmentSessionDetail = exports.ecListFingerprintEnrollmentSessions = void 0;
const crypto_1 = require("crypto");
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions/v1"));
const campusLogger_1 = require("./campusLogger");
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const REGION = "asia-southeast1";
const deviceLogger = (0, campusLogger_1.createCampusLogger)("CAMPUS device");
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
const DEFAULT_CLEANUP_LIMIT = 25;
const MAX_CLEANUP_LIMIT = 50;
const TOKEN_VERSION = 1;
class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function serverTimestamp() {
    return admin.firestore.FieldValue.serverTimestamp();
}
function normalizeText(value) {
    return String(value !== null && value !== void 0 ? value : "").trim();
}
function normalizeLower(value) {
    return normalizeText(value).toLowerCase();
}
function requestHeader(req, ...names) {
    for (const name of names) {
        const value = normalizeText(req.get(name));
        if (value) {
            return value;
        }
    }
    return "";
}
function sanitizeIdComponent(value) {
    return normalizeLower(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function asRecord(value) {
    return typeof value === "object" && value !== null ?
        value :
        {};
}
function asStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => normalizeText(item))
        .filter((item) => item.length > 0);
}
function dedupeStrings(values) {
    return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}
function toMillis(value) {
    if (value && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
function toPositiveInt(value, fallback = 0) {
    const parsed = Number.parseInt(normalizeText(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function fingerprintTemplateRef(templateId) {
    return db.doc(`fingerprintTemplates/${templateId}`);
}
async function upsertFingerprintTemplateOwner(templateId, payload) {
    if (templateId <= 0 || !payload.uid) {
        return;
    }
    await fingerprintTemplateRef(templateId).set({
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
    }, { merge: true });
}
async function findActiveFingerprintTemplateConflict(templateId, studentId) {
    var _a;
    if (templateId <= 0) {
        return null;
    }
    const templateSnap = await fingerprintTemplateRef(templateId).get();
    if (!templateSnap.exists) {
        return null;
    }
    const templateData = (_a = templateSnap.data()) !== null && _a !== void 0 ? _a : {};
    const ownerUid = normalizeText(templateData.uid) ||
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
function parseQueryInt(value, fallback, min, max) {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = Number.parseInt(normalizeText(raw), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
}
function sendJson(res, status, payload) {
    res.status(status).json(payload);
}
function errorMessage(error, fallback) {
    if (error instanceof ApiError) {
        return error.message;
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    return fallback;
}
async function callerRole(context) {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }
    const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
    return callerProfileSnap.exists ?
        normalizeLower((_a = callerProfileSnap.data()) === null || _a === void 0 ? void 0 : _a.role) :
        "";
}
async function requireAdminOrEC(context) {
    const role = await callerRole(context);
    if (role !== "admin" && role !== "ec") {
        throw new functions.https.HttpsError("permission-denied", "EC/Admin only.");
    }
}
function formatManilaDate(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: MANILA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}
function addDays(now, days) {
    const next = new Date(now.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
function parseTimeToMinutes(raw) {
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
function parseEventStartMs(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return Number.MAX_SAFE_INTEGER;
    }
    const minutes = parseTimeToMinutes(time);
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    const parsed = Date.parse(`${date}T${hh}:${mm}:00+08:00`);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}
function hasSupportedTimeFormat(raw) {
    const value = normalizeText(raw);
    if (!value) {
        return false;
    }
    return /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.test(value) ||
        /^(\d{1,2}):(\d{2})$/.test(value);
}
function parseEventEndMs(date, startTime, endTime) {
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
function hasEventEnded(event, nowMs = Date.now()) {
    const eventEndMs = parseEventEndMs(event.date, event.scheduledTime, event.scheduledTimeEnd);
    if (eventEndMs === Number.MAX_SAFE_INTEGER) {
        return false;
    }
    return nowMs > eventEndMs;
}
function normalizeScheduledWindow(startValue, endValue) {
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
    return { scheduledTime, scheduledTimeEnd };
}
function normalizeYearLevel(value) {
    const raw = normalizeText(value);
    const lower = raw.toLowerCase();
    if (!raw) {
        return "";
    }
    if (lower === "1" || lower === "1st year")
        return "1st Year";
    if (lower === "2" || lower === "2nd year")
        return "2nd Year";
    if (lower === "3" || lower === "3rd year")
        return "3rd Year";
    if (lower === "4" || lower === "4th year")
        return "4th Year";
    if (lower === "5" || lower === "5th year")
        return "5th Year";
    return raw;
}
function normalizeCourse(value) {
    return normalizeText(value);
}
function normalizeEnrollmentSessionStatus(value) {
    const raw = normalizeLower(value);
    if (raw === "paired")
        return "paired";
    if (raw === "downloading")
        return "downloading";
    if (raw === "enrolling")
        return "enrolling";
    if (raw === "completed")
        return "completed";
    if (raw === "partially completed" || raw === "partially-completed") {
        return "partially-completed";
    }
    if (raw === "closed")
        return "closed";
    return "pending";
}
function normalizeEnrollmentStudentStatus(value) {
    const raw = normalizeLower(value);
    if (raw === "downloaded")
        return "downloaded";
    if (raw === "enrolled")
        return "enrolled";
    if (raw === "synced")
        return "synced";
    if (raw === "failed")
        return "failed";
    return "pending";
}
function normalizeEnrollmentSyncStatus(value) {
    const raw = normalizeLower(value);
    if (raw === "synced")
        return "synced";
    if (raw === "failed")
        return "failed";
    return "pending";
}
function parseRegistrationStatus(value) {
    const raw = normalizeLower(value);
    if (raw === "waitlisted")
        return "WAITLISTED";
    if (raw === "cancelled")
        return "CANCELLED";
    return "PRE_REGISTERED";
}
function normalizeTargetList(value) {
    const raw = dedupeStrings(asStringArray(value));
    return raw.filter((item) => normalizeLower(item) !== "all years" && normalizeLower(item) !== "all courses");
}
function normalizeIdentifierList(value) {
    return dedupeStrings(asStringArray(value));
}
function matchesTargetList(targets, value) {
    if (targets.length === 0) {
        return true;
    }
    const expected = normalizeLower(value);
    return targets.some((target) => normalizeLower(target) === expected);
}
function matchesSpecificStudentTarget(targetStudent, candidate) {
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
function hasExplicitSelectedAudience(event) {
    return event.selectedStudentIds.length > 0 || event.selectedSchoolIds.length > 0;
}
function matchesSelectedAudience(event, studentId, schoolId) {
    if (!hasExplicitSelectedAudience(event)) {
        return true;
    }
    const normalizedStudentId = normalizeLower(studentId);
    const normalizedSchoolId = normalizeLower(schoolId);
    return event.selectedStudentIds.some((value) => normalizeLower(value) === normalizedStudentId) ||
        event.selectedSchoolIds.some((value) => normalizeLower(value) === normalizedSchoolId);
}
function evaluateEventEligibility(event, candidate) {
    if (!matchesSelectedAudience(event, candidate.studentId, candidate.schoolId)) {
        return { allowed: false, reason: "not_selected_student" };
    }
    if (!hasExplicitSelectedAudience(event)) {
        if (!matchesSpecificStudentTarget(event.targetStudent, {
            uid: candidate.studentId,
            schoolId: candidate.schoolId,
            studentName: candidate.studentName,
            name: candidate.studentName,
        })) {
            return { allowed: false, reason: "not_target_student" };
        }
        if (!matchesTargetList(event.courses, normalizeCourse(candidate.course))) {
            return { allowed: false, reason: "not_target_course" };
        }
        if (!matchesTargetList(event.yearLevels, normalizeYearLevel(candidate.yearLevel))) {
            return { allowed: false, reason: "not_target_year" };
        }
    }
    if (event.requiresRegistration &&
        parseRegistrationStatus(candidate.registrationStatus) !== "PRE_REGISTERED") {
        return { allowed: false, reason: "registration_required" };
    }
    return { allowed: true, reason: "allowed" };
}
function registrationLookupFromSnapshot(snap) {
    var _a, _b;
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    const studentId = normalizeText(data.uid) ||
        normalizeText(data.studentUid) ||
        normalizeText(data.studentId) ||
        snap.id;
    return {
        studentId,
        registrationId: snap.id,
        schoolId: normalizeText(data.schoolId),
        studentName: normalizeText(data.studentName) ||
            normalizeText(data.name) ||
            studentId,
        course: normalizeCourse(data.course),
        yearLevel: normalizeYearLevel((_b = data.year) !== null && _b !== void 0 ? _b : data.yearLevel),
        status: parseRegistrationStatus(data.status),
    };
}
async function loadStudentProfilesBySchoolIds(schoolIds) {
    const probes = normalizeIdentifierList(schoolIds);
    if (probes.length === 0) {
        return [];
    }
    const chunks = [];
    for (let index = 0; index < probes.length; index += 10) {
        chunks.push(probes.slice(index, index + 10));
    }
    const snapshots = await Promise.all(chunks.map((chunk) => db.collection("profiles").where("schoolId", "in", chunk).get()));
    const seen = new Set();
    const rows = [];
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
function isStudentProfile(data) {
    return normalizeLower(data === null || data === void 0 ? void 0 : data.role) === "student";
}
function base64UrlEncode(value) {
    const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}
function base64UrlDecode(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
}
function safeEqual(left, right) {
    const leftBytes = new Uint8Array(Buffer.from(left, "utf8"));
    const rightBytes = new Uint8Array(Buffer.from(right, "utf8"));
    if (leftBytes.length !== rightBytes.length) {
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(leftBytes, rightBytes);
}
function sha256(value) {
    return (0, crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
}
function deviceSecretMatches(deviceData, providedSecret) {
    const secretHash = normalizeLower(deviceData.secretHash);
    if (secretHash) {
        return safeEqual(sha256(providedSecret), secretHash);
    }
    const legacySecret = normalizeText(deviceData.secret);
    return legacySecret ? safeEqual(legacySecret, providedSecret) : false;
}
function getSessionSecret() {
    const secret = normalizeText(process.env.CAMPUS_DEVICE_SESSION_SECRET);
    if (!secret) {
        throw new ApiError(500, "CAMPUS_DEVICE_SESSION_SECRET is not configured.");
    }
    return secret;
}
function signSessionToken(payload) {
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const encodedSignature = base64UrlEncode((0, crypto_1.createHmac)("sha256", getSessionSecret()).update(encodedPayload).digest());
    return `${encodedPayload}.${encodedSignature}`;
}
function verifySessionToken(token) {
    const trimmed = normalizeText(token);
    const parts = trimmed.split(".");
    if (parts.length !== 2) {
        throw new ApiError(401, "Device session token is invalid.");
    }
    const [encodedPayload, encodedSignature] = parts;
    const expectedSignature = base64UrlEncode((0, crypto_1.createHmac)("sha256", getSessionSecret()).update(encodedPayload).digest());
    if (!safeEqual(encodedSignature, expectedSignature)) {
        throw new ApiError(401, "Device session token signature is invalid.");
    }
    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(encodedPayload));
    }
    catch (error) {
        throw new ApiError(401, "Device session token payload is invalid.");
    }
    if (payload.v !== TOKEN_VERSION ||
        !normalizeText(payload.deviceId) ||
        !Number.isFinite(payload.iatMs) ||
        !Number.isFinite(payload.expMs)) {
        throw new ApiError(401, "Device session token payload is malformed.");
    }
    if (Date.now() >= payload.expMs) {
        throw new ApiError(401, "Device session token has expired.");
    }
    return payload;
}
function readBearerToken(req) {
    const authorization = normalizeText(req.get("Authorization"));
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? normalizeText(match[1]) : "";
}
async function loadDeviceContext(deviceId, authMode, deviceData) {
    var _a;
    const ref = db.doc(`devices/${deviceId}`);
    const snap = deviceData ? null : await ref.get();
    const data = deviceData !== null && deviceData !== void 0 ? deviceData : snap === null || snap === void 0 ? void 0 : snap.data();
    if (!data) {
        throw new ApiError(401, "Unauthorized device");
    }
    if (data.enabled === false) {
        throw new ApiError(403, "Device is disabled.");
    }
    const pairingRef = db.doc(`devicePairings/${deviceId}`);
    const pairingSnap = await pairingRef.get();
    await ref.set({
        lastSeenAt: serverTimestamp(),
        lastAuthMode: authMode,
        updatedAt: serverTimestamp(),
    }, { merge: true });
    return {
        deviceId,
        ref,
        data,
        pairingRef,
        pairingData: pairingSnap.exists ? (_a = pairingSnap.data()) !== null && _a !== void 0 ? _a : null : null,
        authMode,
    };
}
async function authenticateDeviceWithSecret(req) {
    var _a;
    const deviceId = requestHeader(req, "X-Campus-Device-Id", "X-Device-Id");
    const secret = requestHeader(req, "X-Campus-Device-Secret", "X-Device-Secret");
    if (!deviceId || !secret) {
        throw new ApiError(401, "Unauthorized device");
    }
    const ref = db.doc(`devices/${deviceId}`);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new ApiError(401, "Unauthorized device");
    }
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    if (!deviceSecretMatches(data, secret)) {
        throw new ApiError(401, "Unauthorized device");
    }
    return loadDeviceContext(deviceId, "secret", data);
}
async function authenticateDeviceWithSession(req) {
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
async function authenticateDevice(req, authMode) {
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
function deviceEndpoint(method, authMode, handler) {
    return functions.region(REGION).https.onRequest(async (req, res) => {
        res.set("Cache-Control", "no-store");
        if (req.method === "OPTIONS") {
            res.set("Allow", `${method}, OPTIONS`);
            res.status(204).send("");
            return;
        }
        if (req.method !== method) {
            res.set("Allow", `${method}, OPTIONS`);
            sendJson(res, 405, { ok: false, error: "Method not allowed." });
            return;
        }
        try {
            const device = await authenticateDevice(req, authMode);
            await handler(req, res, device);
        }
        catch (error) {
            const status = error instanceof ApiError ? error.status : 500;
            const message = status >= 500 ?
                "Server error" :
                errorMessage(error, "Server error");
            deviceLogger.error("Portable device endpoint failed", { error, status });
            sendJson(res, status, { ok: false, error: message });
        }
    });
}
function eventSummaryFromSnapshot(snap) {
    var _a;
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    const date = normalizeText(data.date);
    const schedule = normalizeScheduledWindow(normalizeText(data.scheduledTimeStart) ||
        normalizeText(data.scheduledTime) ||
        normalizeText(data.timeStart), normalizeText(data.scheduledTimeEnd) ||
        normalizeText(data.endTime) ||
        normalizeText(data.timeEnd));
    const yearLevels = normalizeTargetList(data.yearLevels);
    const courses = normalizeTargetList(data.courses);
    const selectedStudentIds = normalizeIdentifierList(data.selectedStudentIds);
    const selectedSchoolIds = normalizeIdentifierList(data.selectedSchoolIds);
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
        createdAtMs: toMillis(data.createdAt),
        sortMs: parseEventStartMs(date, schedule.scheduledTime),
    };
}
function isActiveEvent(event) {
    const status = normalizeLower(event.status);
    if (status === "completed" || status === "cancelled" || status === "archived") {
        return false;
    }
    return !hasEventEnded(event);
}
async function listAvailableEvents(limit) {
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
async function getEventSummary(eventId) {
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
async function loadDocsById(collectionName, ids) {
    if (ids.length === 0) {
        return new Map();
    }
    const refs = ids.map((id) => db.doc(`${collectionName}/${id}`));
    const snaps = await db.getAll(...refs);
    const map = new Map();
    snaps.forEach((snap) => {
        var _a;
        if (snap.exists) {
            map.set(snap.id, (_a = snap.data()) !== null && _a !== void 0 ? _a : {});
        }
    });
    return map;
}
async function resolveAuthorizedStudentIds(eventId, event) {
    const registrationsSnap = await db.collection(`events/${eventId}/registrations`).get();
    const registrations = registrationsSnap.docs
        .map((doc) => registrationLookupFromSnapshot(doc))
        .filter((registration) => registration.studentId.length > 0);
    const registrationsByStudentId = new Map();
    const authorized = new Map();
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
            var _a;
            const registration = registrationsByStudentId.get(studentId);
            authorized.set(studentId, {
                registrationId: (_a = registration === null || registration === void 0 ? void 0 : registration.registrationId) !== null && _a !== void 0 ? _a : "",
            });
        });
    }
    if (event.selectedSchoolIds.length > 0) {
        const selectedProfiles = await loadStudentProfilesBySchoolIds(event.selectedSchoolIds);
        selectedProfiles.forEach((doc) => {
            var _a, _b, _c;
            const data = (_a = doc.data()) !== null && _a !== void 0 ? _a : {};
            if (!isStudentProfile(data)) {
                return;
            }
            const registration = registrationsByStudentId.get(doc.id);
            const eligibility = evaluateEventEligibility(event, {
                studentId: doc.id,
                schoolId: normalizeText(data.schoolId),
                studentName: normalizeText(data.studentName) ||
                    normalizeText(data.name) ||
                    doc.id,
                course: normalizeCourse(data.course),
                yearLevel: normalizeYearLevel((_b = data.year) !== null && _b !== void 0 ? _b : data.yearLevel),
                registrationStatus: registration === null || registration === void 0 ? void 0 : registration.status,
            });
            if (!eligibility.allowed) {
                return;
            }
            authorized.set(doc.id, {
                registrationId: (_c = registration === null || registration === void 0 ? void 0 : registration.registrationId) !== null && _c !== void 0 ? _c : "",
            });
        });
    }
    if (hasExplicitSelectedAudience(event)) {
        return authorized;
    }
    const profilesSnap = await db.collection("profiles").where("role", "==", "student").get();
    profilesSnap.docs.forEach((doc) => {
        var _a, _b;
        const data = doc.data();
        if (!isStudentProfile(data)) {
            return;
        }
        const registration = registrationsByStudentId.get(doc.id);
        const eligibility = evaluateEventEligibility(event, {
            studentId: doc.id,
            schoolId: normalizeText(data.schoolId),
            studentName: normalizeText(data.studentName) ||
                normalizeText(data.name) ||
                doc.id,
            course: normalizeCourse(data.course),
            yearLevel: normalizeYearLevel((_a = data.year) !== null && _a !== void 0 ? _a : data.yearLevel),
            registrationStatus: registration === null || registration === void 0 ? void 0 : registration.status,
        });
        if (!eligibility.allowed) {
            return;
        }
        authorized.set(doc.id, {
            registrationId: (_b = registration === null || registration === void 0 ? void 0 : registration.registrationId) !== null && _b !== void 0 ? _b : "",
        });
    });
    return authorized;
}
function portableEventPayload(event) {
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
    };
}
function portableEventEligibilityPayload(event) {
    return {
        yearLevels: event.yearLevels,
        courses: event.courses,
        targetStudent: event.targetStudent,
        selectedStudentIds: event.selectedStudentIds,
        selectedSchoolIds: event.selectedSchoolIds,
        requiresRegistration: event.requiresRegistration,
    };
}
function mapStudentContext(studentId, profileData, studentData, registrationId) {
    var _a, _b;
    const merged = Object.assign(Object.assign({}, profileData), studentData);
    const schoolId = normalizeText(merged.schoolId) || studentId;
    const yearLevel = normalizeYearLevel((_a = merged.yearLevel) !== null && _a !== void 0 ? _a : merged.year);
    const fingerprintTemplateId = toPositiveInt((_b = merged.fingerprintTemplateId) !== null && _b !== void 0 ? _b : merged.templateId, -1);
    return {
        studentId,
        studentUid: studentId,
        schoolId,
        studentName: normalizeText(merged.studentName) ||
            normalizeText(merged.name) ||
            schoolId,
        course: normalizeCourse(merged.course) || "Unassigned",
        yearLevel: yearLevel || "Unassigned",
        fingerprintTemplateId,
        fingerprintStatus: normalizeText(merged.fingerprintStatus) ||
            (fingerprintTemplateId > 0 ? "enrolled" : "pending"),
        fingerprintDeviceId: normalizeText(merged.fingerprintDeviceId),
        queueId: normalizeText(merged.queueId),
        registrationId,
    };
}
async function buildEventContext(eventId) {
    const event = await getEventSummary(eventId);
    const authorizedStudents = await resolveAuthorizedStudentIds(eventId, event);
    const studentIds = Array.from(authorizedStudents.keys());
    const [profilesById, studentRecordsById, attendanceSnap] = await Promise.all([
        loadDocsById("profiles", studentIds),
        loadDocsById("students", studentIds),
        db.collection(`events/${eventId}/attendance`).get(),
    ]);
    const students = studentIds
        .map((studentId) => {
        var _a, _b;
        return mapStudentContext(studentId, profilesById.get(studentId), studentRecordsById.get(studentId), (_b = (_a = authorizedStudents.get(studentId)) === null || _a === void 0 ? void 0 : _a.registrationId) !== null && _b !== void 0 ? _b : "");
    })
        .sort((left, right) => left.studentName.localeCompare(right.studentName));
    const recordedStudentIds = dedupeStrings(attendanceSnap.docs.map((doc) => {
        const data = doc.data();
        return normalizeText(data.studentId) ||
            normalizeText(data.uid) ||
            normalizeText(data.studentUid) ||
            doc.id;
    }));
    return {
        event,
        students,
        attendanceCount: attendanceSnap.size,
        recordedStudentIds,
    };
}
async function ensurePairedEventContext(device) {
    var _a, _b;
    const pairedEventId = normalizeText((_a = device.pairingData) === null || _a === void 0 ? void 0 : _a.eventId) ||
        normalizeText(device.data.lastPairedEventId);
    if (!pairedEventId) {
        throw new ApiError(404, "Device is not paired to an event.");
    }
    const context = await buildEventContext(pairedEventId);
    return Object.assign(Object.assign({}, context), { pairing: (_b = device.pairingData) !== null && _b !== void 0 ? _b : {} });
}
function enrollmentSessionSummaryFromSnapshot(snap) {
    var _a;
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
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
function enrollmentSessionStudentFromSnapshot(snap) {
    var _a, _b, _c;
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    const studentId = normalizeText(data.studentId) || snap.id;
    return {
        studentId,
        studentUid: normalizeText(data.studentUid) || studentId,
        schoolId: normalizeText(data.schoolId) || studentId,
        fullName: normalizeText(data.fullName) ||
            normalizeText(data.studentName) ||
            normalizeText(data.name) ||
            studentId,
        course: normalizeCourse(data.course) || "Unassigned",
        yearLevel: normalizeYearLevel((_b = data.yearLevel) !== null && _b !== void 0 ? _b : data.year) || "Unassigned",
        status: normalizeEnrollmentStudentStatus(data.status),
        syncStatus: normalizeEnrollmentSyncStatus(data.syncStatus),
        fingerprintTemplateId: toPositiveInt((_c = data.fingerprintTemplateId) !== null && _c !== void 0 ? _c : data.templateId, -1),
        enrolledByDevice: normalizeText(data.enrolledByDevice),
        assignedDeviceId: normalizeText(data.assignedDeviceId),
        remarks: normalizeText(data.remarks),
    };
}
async function listEnrollmentSessionsForDevice(device, limit) {
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
async function readEnrollmentSessionSummary(sessionId) {
    const snap = await db.doc(`enrollmentSessions/${sessionId}`).get();
    if (!snap.exists) {
        throw new ApiError(404, "Enrollment session not found.");
    }
    return enrollmentSessionSummaryFromSnapshot(snap);
}
async function readEnrollmentSessionStudents(sessionId) {
    const snapshot = await db
        .collection(`enrollmentSessions/${sessionId}/students`)
        .orderBy("fullName", "asc")
        .get();
    return snapshot.docs.map((doc) => ({
        ref: doc.ref,
        student: enrollmentSessionStudentFromSnapshot(doc),
    }));
}
async function refreshEnrollmentSessionSummary(sessionId) {
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
    students.forEach(({ student }) => {
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
    let nextStatus = current.pairedDeviceId ? "paired" : "pending";
    const totalStudents = students.length || current.totalStudents;
    if (current.status === "closed") {
        nextStatus = "closed";
    }
    else if (totalStudents > 0 && syncedCount === totalStudents && failedCount === 0) {
        nextStatus = "completed";
    }
    else if (totalStudents > 0 && syncedCount > 0 && syncedCount + failedCount >= totalStudents) {
        nextStatus = "partially-completed";
    }
    else if (enrolledCount > 0 || syncedCount > 0 || failedCount > 0) {
        nextStatus = "enrolling";
    }
    else if (downloadedCount > 0) {
        nextStatus = "downloading";
    }
    await sessionRef.set({
        totalStudents,
        pendingCount,
        downloadedCount,
        enrolledCount,
        syncedCount,
        failedCount,
        status: nextStatus,
        completedAt: nextStatus === "completed" || nextStatus === "partially-completed" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
    }, { merge: true });
    return Object.assign(Object.assign({}, current), { totalStudents,
        pendingCount,
        downloadedCount,
        enrolledCount,
        syncedCount,
        failedCount, status: nextStatus, updatedAtMs: Date.now() });
}
async function pairDeviceToEnrollmentSession(device, sessionId) {
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
    await sessionRef.set({
        pairedDeviceId: device.deviceId,
        status: session.status === "pending" ? "paired" : session.status,
        pairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    await device.ref.set({
        activeEnrollmentSessionId: sessionId,
        lastEnrollmentSessionPairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    return readEnrollmentSessionSummary(sessionId);
}
async function resolveDeviceEnrollmentSession(device, explicitSessionId) {
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
async function markEnrollmentSessionDownloaded(device, sessionId) {
    const session = await resolveDeviceEnrollmentSession(device, sessionId);
    if (!session.pairedDeviceId) {
        throw new ApiError(400, "Enrollment session must be paired before download.");
    }
    const students = await readEnrollmentSessionStudents(sessionId);
    const batch = db.batch();
    students.forEach(({ ref, student }) => {
        if (student.status === "pending") {
            batch.set(ref, {
                status: "downloaded",
                syncStatus: student.syncStatus,
                assignedDeviceId: device.deviceId,
                downloadedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
    });
    batch.set(db.doc(`enrollmentSessions/${sessionId}`), {
        status: "downloading",
        pairedDeviceId: device.deviceId,
        lastDownloadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    await refreshEnrollmentSessionSummary(sessionId);
    return readEnrollmentSessionStudents(sessionId);
}
async function listEnrollmentSessions(limit) {
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
async function assertStudentsNotInActiveEnrollmentSessions(studentIds) {
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
            throw new functions.https.HttpsError("already-exists", "One or more students are already included in an active fingerprint enrollment session.");
        }
    }
}
async function buildEnrollmentSessionStudentsFromIds(studentIds) {
    const uniqueIds = dedupeStrings(studentIds);
    const [profilesById, portableStudentsById] = await Promise.all([
        loadDocsById("profiles", uniqueIds),
        loadDocsById("students", uniqueIds),
    ]);
    const rows = uniqueIds.map((studentId) => {
        var _a, _b;
        const merged = Object.assign(Object.assign({}, ((_a = profilesById.get(studentId)) !== null && _a !== void 0 ? _a : {})), ((_b = portableStudentsById.get(studentId)) !== null && _b !== void 0 ? _b : {}));
        const context = mapStudentContext(studentId, profilesById.get(studentId), portableStudentsById.get(studentId), "");
        const alreadyHasFingerprint = context.fingerprintTemplateId > 0 ||
            normalizeLower(merged.fingerprintStatus) === "enrolled" ||
            normalizeLower(merged.fingerprintStatus) === "active";
        if (alreadyHasFingerprint) {
            throw new functions.https.HttpsError("failed-precondition", `${context.studentName} already has a fingerprint record.`);
        }
        return {
            studentId: context.studentId,
            studentUid: context.studentUid,
            schoolId: context.schoolId,
            fullName: context.studentName,
            course: context.course,
            yearLevel: context.yearLevel,
            status: "pending",
            syncStatus: "pending",
            fingerprintTemplateId: -1,
            enrolledByDevice: "",
            assignedDeviceId: "",
            remarks: "",
        };
    });
    return rows;
}
function enrollmentSessionPayload(session) {
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
function enrollmentSessionStudentPayload(student) {
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
async function listPendingEnrollments(device, limit) {
    var _a;
    const activeEnrollmentSessionId = normalizeText(device.data.activeEnrollmentSessionId);
    if (activeEnrollmentSessionId) {
        const sessionStudents = await readEnrollmentSessionStudents(activeEnrollmentSessionId);
        return sessionStudents
            .filter(({ student }) => student.syncStatus !== "synced" && student.status !== "failed")
            .slice(0, limit)
            .map(({ student }) => ({
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
    const pairedEventId = normalizeText((_a = device.pairingData) === null || _a === void 0 ? void 0 : _a.eventId);
    const snapshot = await db
        .collection("enrollmentQueue")
        .where("status", "in", ["pending", "assigned"])
        .limit(MAX_ENROLLMENT_LIMIT)
        .get();
    const queueCandidates = [];
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
        const candidate = mapStudentContext(studentId, undefined, Object.assign(Object.assign({}, data), { queueId: doc.id }), "");
        queueCandidates.push(Object.assign(Object.assign({}, candidate), { eventId }));
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
        .map((student) => (Object.assign(Object.assign({}, student), { eventId: pairedEventId })));
}
function resolveRecordedTimestamp(record) {
    var _a, _b;
    const epochSeconds = toPositiveInt((_a = record.timestampEpoch) !== null && _a !== void 0 ? _a : record.capturedAtEpoch);
    const iso = normalizeText((_b = record.timestampIso) !== null && _b !== void 0 ? _b : record.capturedAtIso);
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
function resolveAttendanceMoment(epochValue, isoValue, timestampValue) {
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
function normalizeAttendanceType(value) {
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
function buildAttendanceRecordId(eventId, studentId, schoolId, attendanceType) {
    return [
        sanitizeIdComponent(eventId),
        sanitizeIdComponent(studentId || schoolId),
        sanitizeIdComponent(attendanceType || "attendance"),
    ]
        .filter(Boolean)
        .join("-");
}
function deriveAttendanceStatus(hasTimeIn, hasTimeOut) {
    if (hasTimeIn && hasTimeOut) {
        return "Present";
    }
    if (hasTimeIn) {
        return "Timed In";
    }
    return "";
}
async function syncEnrollmentResult(device, record) {
    var _a, _b;
    const sessionId = normalizeText(record.sessionId) ||
        normalizeText(device.data.activeEnrollmentSessionId);
    const studentId = normalizeText(record.studentId) ||
        normalizeText(record.studentUid) ||
        normalizeText(record.uid);
    const templateId = toPositiveInt((_a = record.fingerprintTemplateId) !== null && _a !== void 0 ? _a : record.templateId, -1);
    const recordId = normalizeText(record.recordId) ||
        `enrollment:${sessionId}:${studentId}`;
    const requestedStatus = normalizeEnrollmentStudentStatus((_b = record.status) !== null && _b !== void 0 ? _b : record.enrollmentStatus);
    const failedUpload = requestedStatus === "failed" ||
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
        const templateConflict = await findActiveFingerprintTemplateConflict(templateId, studentId);
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
    let resultStatus = "uploaded";
    let resultMessage = failedUpload ?
        "Enrollment marked as failed." :
        "Fingerprint enrollment synced.";
    let templateOwnerPayload = null;
    await db.runTransaction(async (transaction) => {
        var _a, _b, _c, _d, _e, _f;
        const [freshSessionSnap, sessionStudentSnap, portableStudentSnap, profileSnap, syncLogSnap,] = await transaction.getAll(sessionRef, sessionStudentRef, portableStudentRef, profileRef, syncLogRef);
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
        const sessionStudentData = (_a = sessionStudentSnap.data()) !== null && _a !== void 0 ? _a : {};
        if (normalizeEnrollmentSyncStatus(sessionStudentData.syncStatus) === "synced") {
            resultStatus = "duplicate";
            resultMessage = "Student fingerprint is already synced.";
            return;
        }
        const mergedStudent = Object.assign(Object.assign(Object.assign(Object.assign({}, (profileSnap.exists ? (_b = profileSnap.data()) !== null && _b !== void 0 ? _b : {} : {})), (portableStudentSnap.exists ? (_c = portableStudentSnap.data()) !== null && _c !== void 0 ? _c : {} : {})), sessionStudentData), record);
        const sessionStudentPatch = {
            status: failedUpload ? "failed" : "synced",
            syncStatus: failedUpload ? "failed" : "synced",
            fingerprintTemplateId: failedUpload ? (_d = sessionStudentData.fingerprintTemplateId) !== null && _d !== void 0 ? _d : null : templateId,
            enrolledByDevice: device.deviceId,
            assignedDeviceId: device.deviceId,
            remarks: normalizeText(record.remarks) || (failedUpload ? "Enrollment failed on device." : ""),
            updatedAt: serverTimestamp(),
            syncedAt: serverTimestamp(),
        };
        if (!failedUpload) {
            sessionStudentPatch.enrolledAt = recordedTimestamp.timestamp;
        }
        transaction.set(sessionStudentRef, sessionStudentPatch, { merge: true });
        if (!failedUpload) {
            const portableStudentPatch = {
                uid: studentId,
                studentId,
                schoolId: normalizeText(mergedStudent.schoolId) || studentId,
                studentName: normalizeText(mergedStudent.studentName) ||
                    normalizeText(mergedStudent.fullName) ||
                    normalizeText(mergedStudent.name) ||
                    studentId,
                course: normalizeCourse(mergedStudent.course) || "Unassigned",
                yearLevel: normalizeYearLevel((_e = mergedStudent.yearLevel) !== null && _e !== void 0 ? _e : mergedStudent.year) || "Unassigned",
                year: normalizeYearLevel((_f = mergedStudent.yearLevel) !== null && _f !== void 0 ? _f : mergedStudent.year) || "Unassigned",
                hasFingerprint: true,
                fingerprintTemplateId: templateId,
                templateId,
                fingerprintStatus: "enrolled",
                fingerprintDeviceId: device.deviceId,
                fingerprintEnrolledAt: recordedTimestamp.timestamp,
                latestEnrollmentSessionId: sessionId,
                updatedAt: serverTimestamp(),
            };
            transaction.set(portableStudentRef, portableStudentPatch, { merge: true });
            transaction.set(profileRef, {
                hasFingerprint: true,
                fingerprintTemplateId: templateId,
                fingerprintStatus: "enrolled",
                fingerprintDeviceId: device.deviceId,
                fingerprintEnrolledAt: recordedTimestamp.timestamp,
                latestEnrollmentSessionId: sessionId,
                updatedAt: serverTimestamp(),
            }, { merge: true });
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
        transaction.set(syncLogRef, {
            recordId,
            sessionId,
            studentId,
            schoolId: normalizeText(mergedStudent.schoolId) || studentId,
            studentName: normalizeText(mergedStudent.studentName) ||
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
        }, { merge: true });
        transaction.set(device.ref, {
            lastEnrollmentSyncAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
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
async function createDeviceSessionResponse(device) {
    const sessionVersion = toPositiveInt(device.data.sessionVersion, 1);
    const now = Date.now();
    const payload = {
        v: TOKEN_VERSION,
        deviceId: device.deviceId,
        iatMs: now,
        expMs: now + SESSION_TTL_MS,
        sessionVersion,
    };
    const token = signSessionToken(payload);
    await device.ref.set({
        lastSessionIssuedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
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
async function pairDeviceToEvent(device, eventId) {
    const context = await buildEventContext(eventId);
    const event = context.event;
    await device.pairingRef.set({
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
    }, { merge: true });
    await device.ref.set({
        lastPairedEventId: event.eventId,
        lastPairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    return context;
}
async function findStudentRegistrationStatusForEvent(eventId, studentId) {
    var _a, _b;
    const eventSnap = await db.doc(`events/${eventId}`).get();
    const eventData = (_a = eventSnap.data()) !== null && _a !== void 0 ? _a : {};
    if (eventData.isPreReg !== true) {
        return "";
    }
    const directSnap = await db.doc(`events/${eventId}/registrations/${studentId}`).get();
    if (directSnap.exists) {
        return parseRegistrationStatus((_b = directSnap.data()) === null || _b === void 0 ? void 0 : _b.status);
    }
    const registrationsSnap = await db.collection(`events/${eventId}/registrations`).get();
    for (const doc of registrationsSnap.docs) {
        const data = doc.data();
        if ((normalizeText(data.uid) === studentId ||
            normalizeText(data.studentUid) === studentId)) {
            return parseRegistrationStatus(data.status);
        }
    }
    return "";
}
async function syncAttendanceRecord(device, record) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const eventId = normalizeText(record.eventId);
    const studentId = normalizeText(record.studentId) ||
        normalizeText(record.studentUid) ||
        normalizeText(record.uid);
    const schoolId = normalizeText(record.schoolId);
    const rawDeviceId = normalizeText(record.deviceId);
    const recordedTimestamp = resolveRecordedTimestamp(record);
    const incomingTimeIn = resolveAttendanceMoment((_b = (_a = record.timeInEpoch) !== null && _a !== void 0 ? _a : record.timestampEpoch) !== null && _b !== void 0 ? _b : record.capturedAtEpoch, (_d = (_c = record.timeInIso) !== null && _c !== void 0 ? _c : record.timestampIso) !== null && _d !== void 0 ? _d : record.capturedAtIso);
    const incomingTimeOut = resolveAttendanceMoment(record.timeOutEpoch, record.timeOutIso);
    const attendanceType = normalizeAttendanceType(record.attendanceType) ||
        (incomingTimeOut.hasValue ? "time-out" : incomingTimeIn.hasValue ? "time-in" : "");
    const recordId = normalizeText(record.recordId) ||
        buildAttendanceRecordId(eventId, studentId, schoolId, attendanceType);
    const requestDeviceId = rawDeviceId || device.deviceId;
    if (!recordId) {
        return { recordId: "", status: "failed", message: "recordId is required." };
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
    const hasRecordedTimestamp = recordedTimestamp.epochSeconds > 0 ||
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
    const pairedEventId = normalizeText((_e = device.pairingData) === null || _e === void 0 ? void 0 : _e.eventId);
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
    const registrationStatus = await findStudentRegistrationStatusForEvent(eventId, studentId);
    const [profileSnap, studentSnap] = await Promise.all([
        profileRef.get(),
        studentRef.get(),
    ]);
    const mergedStudent = Object.assign(Object.assign({}, (profileSnap.exists ? profileSnap.data() : {})), (studentSnap.exists ? studentSnap.data() : {}));
    const resolvedSchoolId = schoolId || normalizeText(mergedStudent.schoolId) || studentId;
    const resolvedStudentName = normalizeText(record.studentName) ||
        normalizeText(mergedStudent.studentName) ||
        normalizeText(mergedStudent.name) ||
        resolvedSchoolId ||
        studentId;
    const resolvedCourse = normalizeText(record.course) ||
        normalizeText(mergedStudent.course) ||
        "Unassigned";
    const resolvedYearLevel = normalizeYearLevel((_f = record.yearLevel) !== null && _f !== void 0 ? _f : record.year) ||
        normalizeYearLevel((_g = mergedStudent.yearLevel) !== null && _g !== void 0 ? _g : mergedStudent.year) ||
        "Unassigned";
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
    });
    if (!eligibility.allowed) {
        deviceLogger.warn(`[SYNC][ATTEND] rejected reason=not_allowed_for_event eventId=${eventId} schoolId=${resolvedSchoolId}`, {
            eventId,
            schoolId: resolvedSchoolId,
            studentId,
            reason: eligibility.reason,
        });
        await syncLogRef.set({
            recordId,
            eventId,
            studentId,
            schoolId: resolvedSchoolId,
            studentName: resolvedStudentName,
            deviceId: device.deviceId,
            syncStatus: "rejected",
            message: "Student is not allowed for this event",
            attemptedAt: serverTimestamp(),
            processedAt: serverTimestamp(),
            source: "portable-device",
        }, { merge: true });
        return {
            recordId,
            status: "rejected",
            message: "Student is not allowed for this event",
        };
    }
    const incomingTimeInSource = normalizeText((_h = record.timeInSource) !== null && _h !== void 0 ? _h : record.timeSource) || "unknown";
    const incomingTimeOutSource = normalizeText(record.timeOutSource) || "unknown";
    let resultStatus = "failed";
    let resultMessage = "Failed to sync attendance.";
    await db.runTransaction(async (transaction) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists) {
            throw new ApiError(404, "Event not found.");
        }
        const attendanceSnap = await transaction.get(attendanceRef);
        const existingAttendance = attendanceSnap.exists ? (_a = attendanceSnap.data()) !== null && _a !== void 0 ? _a : {} : {};
        const existingTimeIn = resolveAttendanceMoment((_b = existingAttendance.timeInEpoch) !== null && _b !== void 0 ? _b : existingAttendance.deviceTimestampEpoch, (_c = existingAttendance.timeInIso) !== null && _c !== void 0 ? _c : existingAttendance.deviceTimestampIso, (_d = existingAttendance.timeIn) !== null && _d !== void 0 ? _d : existingAttendance.timestamp);
        const existingTimeOut = resolveAttendanceMoment(existingAttendance.timeOutEpoch, existingAttendance.timeOutIso, existingAttendance.timeOut);
        const mergedTimeIn = incomingTimeIn.hasValue ? incomingTimeIn : existingTimeIn;
        const mergedTimeOut = incomingTimeOut.hasValue ? incomingTimeOut : existingTimeOut;
        if (incomingTimeOut.hasValue && !mergedTimeIn.hasValue) {
            resultStatus = "failed";
            resultMessage = "No Time in record. Cannot Time out.";
            transaction.set(syncLogRef, {
                recordId,
                eventId,
                studentId,
                deviceId: device.deviceId,
                syncStatus: "failed",
                message: resultMessage,
                attemptedAt: serverTimestamp(),
                processedAt: serverTimestamp(),
                source: "portable-device",
            }, { merge: true });
            return;
        }
        const addsNewTimeIn = incomingTimeIn.hasValue && !existingTimeIn.hasValue;
        const addsNewTimeOut = incomingTimeOut.hasValue && !existingTimeOut.hasValue;
        if (attendanceSnap.exists) {
            if (!addsNewTimeIn && !addsNewTimeOut) {
                resultStatus = "duplicate";
                resultMessage = "Attendance already up to date.";
                transaction.set(syncLogRef, {
                    recordId,
                    eventId,
                    studentId,
                    deviceId: device.deviceId,
                    syncStatus: "duplicate",
                    message: resultMessage,
                    attemptedAt: serverTimestamp(),
                    processedAt: serverTimestamp(),
                    source: "portable-device",
                }, { merge: true });
                return;
            }
        }
        else if (!mergedTimeIn.hasValue) {
            resultStatus = "failed";
            resultMessage = "Time In data is required.";
            transaction.set(syncLogRef, {
                recordId,
                eventId,
                studentId,
                deviceId: device.deviceId,
                syncStatus: "failed",
                message: resultMessage,
                attemptedAt: serverTimestamp(),
                processedAt: serverTimestamp(),
                source: "portable-device",
            }, { merge: true });
            return;
        }
        const transactionProfileSnap = await transaction.get(profileRef);
        const transactionStudentSnap = await transaction.get(studentRef);
        const transactionStudentData = Object.assign(Object.assign({}, (transactionProfileSnap.exists ? transactionProfileSnap.data() : {})), (transactionStudentSnap.exists ? transactionStudentSnap.data() : {}));
        const attendanceStatus = deriveAttendanceStatus(mergedTimeIn.hasValue, mergedTimeOut.hasValue);
        const attendanceDoc = {
            eventId,
            eventTitle: normalizeText(record.eventTitle) || event.title,
            eventDate: normalizeText(record.eventDate) || event.date,
            studentId,
            uid: studentId,
            studentUid: studentId,
            schoolId: resolvedSchoolId || normalizeText(transactionStudentData.schoolId) || studentId,
            studentName: resolvedStudentName ||
                normalizeText(transactionStudentData.studentName) ||
                normalizeText(transactionStudentData.name) ||
                studentId,
            course: resolvedCourse ||
                normalizeText(transactionStudentData.course) ||
                "Unassigned",
            yearLevel: resolvedYearLevel ||
                normalizeYearLevel((_e = transactionStudentData.yearLevel) !== null && _e !== void 0 ? _e : transactionStudentData.year) ||
                "Unassigned",
            year: resolvedYearLevel ||
                normalizeYearLevel((_f = transactionStudentData.yearLevel) !== null && _f !== void 0 ? _f : transactionStudentData.year) ||
                "Unassigned",
            timestamp: (_g = mergedTimeIn.timestamp) !== null && _g !== void 0 ? _g : recordedTimestamp.timestamp,
            recordedAt: (_h = existingAttendance.recordedAt) !== null && _h !== void 0 ? _h : serverTimestamp(),
            recordedByDevice: true,
            recordedByDeviceId: device.deviceId,
            deviceId: requestDeviceId,
            syncedAt: serverTimestamp(),
            syncStatus: "synced",
            fingerprintTemplateId: toPositiveInt((_j = record.fingerprintTemplateId) !== null && _j !== void 0 ? _j : record.templateId, -1),
            templateId: toPositiveInt((_k = record.fingerprintTemplateId) !== null && _k !== void 0 ? _k : record.templateId, -1),
            source: normalizeText(record.source) || "portable-device",
            deviceRecordId: recordId,
            attendanceType,
            deviceTimestampEpoch: recordedTimestamp.epochSeconds,
            deviceTimestampIso: recordedTimestamp.iso,
            timeSource: normalizeText(record.timeSource) || "unknown",
            scheduledTime: normalizeText(record.scheduledTimeStart) || event.scheduledTime,
            scheduledTimeStart: normalizeText(record.scheduledTimeStart) || event.scheduledTime,
            scheduledTimeEnd: normalizeText(record.scheduledTimeEnd) || event.scheduledTimeEnd,
            location: normalizeText((_l = record.location) !== null && _l !== void 0 ? _l : record.eventLocation) || event.location,
            attendanceStatus,
            status: attendanceStatus,
            timeInEpoch: mergedTimeIn.epochSeconds,
            timeInIso: mergedTimeIn.iso,
            timeInSource: existingTimeIn.hasValue && !incomingTimeIn.hasValue ?
                normalizeText((_m = existingAttendance.timeInSource) !== null && _m !== void 0 ? _m : existingAttendance.timeSource) || "unknown" :
                incomingTimeInSource,
            timeOutEpoch: mergedTimeOut.epochSeconds,
            timeOutIso: mergedTimeOut.iso,
            timeOutSource: existingTimeOut.hasValue && !incomingTimeOut.hasValue ?
                normalizeText(existingAttendance.timeOutSource) || "unknown" :
                incomingTimeOutSource,
            createdAt: (_o = existingAttendance.createdAt) !== null && _o !== void 0 ? _o : serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        if (mergedTimeIn.timestamp) {
            Object.assign(attendanceDoc, { timeIn: mergedTimeIn.timestamp });
        }
        if (mergedTimeOut.timestamp) {
            Object.assign(attendanceDoc, { timeOut: mergedTimeOut.timestamp });
        }
        transaction.set(attendanceRef, attendanceDoc, { merge: true });
        transaction.set(syncLogRef, {
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
        }, { merge: true });
        transaction.set(device.pairingRef, {
            lastAttendanceSyncAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        resultStatus = "uploaded";
        resultMessage = mergedTimeOut.hasValue ? "Attendance updated." : "Attendance saved.";
    });
    return {
        recordId,
        status: resultStatus,
        message: resultMessage,
    };
}
exports.ecListFingerprintEnrollmentSessions = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);
    const body = asRecord(data);
    const limit = parseQueryInt(body.limit, DEFAULT_ENROLLMENT_SESSION_LIMIT, 1, MAX_ENROLLMENT_SESSION_LIMIT);
    const sessions = await listEnrollmentSessions(limit);
    return {
        sessions: sessions.map((session) => enrollmentSessionPayload(session)),
    };
});
exports.ecGetFingerprintEnrollmentSessionDetail = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);
    const body = asRecord(data);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
        throw new functions.https.HttpsError("invalid-argument", "sessionId is required.");
    }
    const session = await refreshEnrollmentSessionSummary(sessionId);
    const students = await readEnrollmentSessionStudents(sessionId);
    return {
        session: enrollmentSessionPayload(session),
        students: students.map(({ student }) => enrollmentSessionStudentPayload(student)),
    };
});
exports.ecCreateFingerprintEnrollmentSession = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    await requireAdminOrEC(context);
    const body = asRecord(data);
    const studentIds = dedupeStrings(asStringArray(body.studentIds));
    if (studentIds.length === 0) {
        throw new functions.https.HttpsError("invalid-argument", "studentIds must contain at least one student.");
    }
    await assertStudentsNotInActiveEnrollmentSessions(studentIds);
    const [studentRows, callerProfileSnap] = await Promise.all([
        buildEnrollmentSessionStudentsFromIds(studentIds),
        db.doc(`profiles/${(_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid}`).get(),
    ]);
    const callerProfile = callerProfileSnap.exists ? (_b = callerProfileSnap.data()) !== null && _b !== void 0 ? _b : {} : {};
    const createdBy = normalizeText((_c = context.auth) === null || _c === void 0 ? void 0 : _c.uid);
    const createdBySchoolId = normalizeText(callerProfile.schoolId) ||
        normalizeText((_d = context.auth) === null || _d === void 0 ? void 0 : _d.token.email) ||
        createdBy;
    const createdByName = normalizeText(callerProfile.name) ||
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
        batch.set(db.doc(`enrollmentSessions/${sessionRef.id}/students/${student.studentId}`), {
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
        });
    });
    await batch.commit();
    const session = await readEnrollmentSessionSummary(sessionRef.id);
    return {
        session: enrollmentSessionPayload(session),
    };
});
exports.ecCloseFingerprintEnrollmentSession = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    await requireAdminOrEC(context);
    const body = asRecord(data);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
        throw new functions.https.HttpsError("invalid-argument", "sessionId is required.");
    }
    await db.doc(`enrollmentSessions/${sessionId}`).set({
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    const session = await readEnrollmentSessionSummary(sessionId);
    return {
        session: enrollmentSessionPayload(session),
    };
});
async function listPendingCleanupQueueItems(device, limit) {
    const snapshot = await db
        .collection("moduleCleanupQueue")
        .where("processed", "==", false)
        .get();
    return snapshot.docs
        .map((cleanupDoc) => {
        var _a;
        const data = (_a = cleanupDoc.data()) !== null && _a !== void 0 ? _a : {};
        const targetDeviceId = normalizeText(data.targetDeviceId);
        if (targetDeviceId && targetDeviceId !== device.deviceId) {
            return null;
        }
        return {
            cleanupId: cleanupDoc.id,
            type: normalizeText(data.type),
            templateId: toPositiveInt(data.templateId, -1),
            uid: normalizeText(data.uid),
            schoolId: normalizeText(data.schoolId),
            reason: normalizeText(data.reason),
        };
    })
        .filter((item) => {
        return item !== null && item.templateId > 0 && Boolean(item.type);
    })
        .sort((left, right) => left.cleanupId.localeCompare(right.cleanupId))
        .slice(0, limit);
}
async function acknowledgeCleanupQueueResults(device, results) {
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
        batch.set(cleanupRef, {
            processed: true,
            processedAt: serverTimestamp(),
            processedByDeviceId: device.deviceId,
            processedMessage: result.message,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        processedCount += 1;
    }
    if (processedCount > 0) {
        await batch.commit();
    }
    return processedCount;
}
exports.campusDeviceCreateSession = deviceEndpoint("POST", "secret", async (_req, res, device) => {
    const payload = await createDeviceSessionResponse(device);
    sendJson(res, 200, payload);
});
exports.campusDeviceListEvents = deviceEndpoint("GET", "session-or-secret", async (req, res) => {
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
});
exports.campusDevicePairEvent = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
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
});
exports.campusDevicePairedEventContext = deviceEndpoint("GET", "session-or-secret", async (_req, res, device) => {
    const context = await ensurePairedEventContext(device);
    await device.pairingRef.set({
        lastContextRefreshAt: serverTimestamp(),
        rosterCount: context.students.length,
        attendanceCount: context.attendanceCount,
        updatedAt: serverTimestamp(),
    }, { merge: true });
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
});
exports.campusDeviceListEnrollmentSessions = deviceEndpoint("GET", "session-or-secret", async (req, res, device) => {
    const limit = parseQueryInt(req.query.limit, DEFAULT_ENROLLMENT_SESSION_LIMIT, 1, MAX_ENROLLMENT_SESSION_LIMIT);
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
});
exports.campusDevicePairEnrollmentSession = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
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
});
exports.campusDeviceDownloadEnrollmentSession = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
    const body = asRecord(req.body);
    const sessionId = normalizeText(body.sessionId);
    const students = await markEnrollmentSessionDownloaded(device, sessionId);
    const session = await readEnrollmentSessionSummary(sessionId || normalizeText(device.data.activeEnrollmentSessionId));
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
        students: students.map(({ student }) => ({
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
});
exports.campusDeviceSyncEnrollmentResults = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
    const body = asRecord(req.body);
    const rawResults = Array.isArray(body.results) ? body.results : [body];
    if (rawResults.length > MAX_SYNC_BATCH_LIMIT) {
        throw new ApiError(400, `results must contain at most ${MAX_SYNC_BATCH_LIMIT} items.`);
    }
    const results = [];
    for (const rawResult of rawResults.slice(0, DEFAULT_SYNC_BATCH_LIMIT)) {
        const result = await syncEnrollmentResult(device, asRecord(rawResult));
        results.push(result);
    }
    const sessionId = normalizeText(body.sessionId) ||
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
});
exports.campusDevicePendingEnrollments = deviceEndpoint("GET", "session-or-secret", async (req, res, device) => {
    const limit = parseQueryInt(req.query.limit, DEFAULT_ENROLLMENT_LIMIT, 1, MAX_ENROLLMENT_LIMIT);
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
});
exports.campusDeviceSubmitEnrollment = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
    var _a, _b, _c, _d, _e;
    const body = asRecord(req.body);
    const sessionId = normalizeText(body.sessionId) ||
        normalizeText(device.data.activeEnrollmentSessionId);
    const studentId = normalizeText(body.studentId) ||
        normalizeText(body.studentUid);
    const templateId = toPositiveInt((_a = body.fingerprintTemplateId) !== null && _a !== void 0 ? _a : body.templateId, -1);
    const queueId = normalizeText(body.queueId);
    const eventId = normalizeText(body.eventId) ||
        normalizeText((_b = device.pairingData) === null || _b === void 0 ? void 0 : _b.eventId);
    if (sessionId) {
        const result = await syncEnrollmentResult(device, Object.assign(Object.assign({}, body), { sessionId,
            studentId, fingerprintTemplateId: templateId }));
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
    const templateConflict = await findActiveFingerprintTemplateConflict(templateId, studentId);
    if (templateConflict) {
        throw new ApiError(409, `Template ${templateId} is already assigned to another active student.`);
    }
    const profileRef = db.doc(`profiles/${studentId}`);
    const profileSnap = await profileRef.get();
    const profileData = profileSnap.exists ? (_c = profileSnap.data()) !== null && _c !== void 0 ? _c : {} : {};
    const resolvedSchoolId = normalizeText(body.schoolId) || normalizeText(profileData.schoolId) || studentId;
    const resolvedStudentName = normalizeText(body.studentName) ||
        normalizeText(profileData.studentName) ||
        normalizeText(profileData.name) ||
        studentId;
    const resolvedCourse = normalizeText(body.course) || normalizeText(profileData.course) || "Unassigned";
    const resolvedYearLevel = normalizeYearLevel((_d = body.yearLevel) !== null && _d !== void 0 ? _d : body.year) ||
        normalizeYearLevel((_e = profileData.yearLevel) !== null && _e !== void 0 ? _e : profileData.year) ||
        "Unassigned";
    await db.doc(`students/${studentId}`).set({
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
    }, { merge: true });
    await profileRef.set({
        fingerprintTemplateId: templateId,
        fingerprintStatus: "enrolled",
        fingerprintDeviceId: device.deviceId,
        fingerprintEnrolledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    const enrollmentDocId = queueId || studentId;
    await db.doc(`enrollmentQueue/${enrollmentDocId}`).set({
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
    }, { merge: true });
    await device.pairingRef.set({
        lastEnrollmentSyncAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
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
});
exports.campusDeviceCleanupQueue = deviceEndpoint("GET", "session-or-secret", async (req, res, device) => {
    const limit = parseQueryInt(req.query.limit, DEFAULT_CLEANUP_LIMIT, 1, MAX_CLEANUP_LIMIT);
    const items = await listPendingCleanupQueueItems(device, limit);
    sendJson(res, 200, {
        ok: true,
        count: items.length,
        items,
    });
});
exports.campusDeviceAcknowledgeCleanupQueue = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
    const body = asRecord(req.body);
    const rawResults = Array.isArray(body.results) ? body.results : [];
    if (rawResults.length > MAX_SYNC_BATCH_LIMIT) {
        throw new ApiError(400, `results must contain at most ${MAX_SYNC_BATCH_LIMIT} items.`);
    }
    const results = rawResults
        .map((rawResult) => {
        const result = asRecord(rawResult);
        return {
            cleanupId: normalizeText(result.cleanupId),
            processed: result.processed === true,
            message: normalizeText(result.message),
        };
    })
        .filter((result) => result.cleanupId);
    const processed = await acknowledgeCleanupQueueResults(device, results);
    sendJson(res, 200, {
        ok: true,
        processed,
    });
});
exports.campusDeviceSyncAttendance = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
    var _a, _b;
    const body = asRecord(req.body);
    const rawRecords = Array.isArray(body.records) ? body.records : null;
    if (!rawRecords) {
        throw new ApiError(400, "records must be an array.");
    }
    if (rawRecords.length > MAX_SYNC_BATCH_LIMIT) {
        throw new ApiError(400, `records must contain at most ${MAX_SYNC_BATCH_LIMIT} items.`);
    }
    const results = [];
    for (const rawRecord of rawRecords.slice(0, DEFAULT_SYNC_BATCH_LIMIT)) {
        try {
            const result = await syncAttendanceRecord(device, asRecord(rawRecord));
            results.push(result);
        }
        catch (error) {
            const record = asRecord(rawRecord);
            const recordId = normalizeText(record.recordId);
            const eventId = normalizeText(record.eventId);
            const studentId = normalizeText(record.studentId) ||
                normalizeText(record.studentUid) ||
                normalizeText(record.uid);
            if (recordId) {
                await db.doc(`syncLogs/${recordId}`).set({
                    recordId,
                    eventId,
                    studentId,
                    deviceId: device.deviceId,
                    syncStatus: "failed",
                    message: errorMessage(error, "Failed to sync attendance."),
                    attemptedAt: serverTimestamp(),
                    processedAt: serverTimestamp(),
                    source: "portable-device",
                }, { merge: true });
            }
            results.push({
                recordId,
                status: "failed",
                message: errorMessage(error, "Failed to sync attendance."),
            });
        }
    }
    const synced = results.filter((result) => result.status === "uploaded" || result.status === "duplicate").length;
    const rejected = results.filter((result) => result.status === "rejected");
    const failed = results.filter((result) => result.status === "failed");
    const ok = rejected.length === 0 && failed.length === 0;
    const error = rejected.length > 0 ?
        "Student is not allowed for this event" :
        (_b = (_a = failed[0]) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : "";
    sendJson(res, 200, Object.assign(Object.assign({ ok,
        synced }, (error ? { error } : {})), { rejected,
        results }));
});
exports.campusDeviceLatestEvent = deviceEndpoint("GET", "session-or-secret", async (_req, res) => {
    const [event] = await listAvailableEvents(1);
    if (!event) {
        sendJson(res, 404, { error: "No upcoming event found." });
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
});
exports.campusDeviceConfirmPairing = deviceEndpoint("POST", "session-or-secret", async (req, res, device) => {
    const body = asRecord(req.body);
    const eventId = normalizeText(body.eventId);
    if (!eventId) {
        throw new ApiError(400, "eventId is required.");
    }
    await pairDeviceToEvent(device, eventId);
    sendJson(res, 200, { status: "paired" });
});
//# sourceMappingURL=index.js.map