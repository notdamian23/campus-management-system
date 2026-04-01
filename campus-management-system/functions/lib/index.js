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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.campusDeviceSyncAttendance = exports.campusDeviceSubmitEnrollment = exports.campusDevicePendingEnrollments = exports.campusDeviceConfirmPairing = exports.campusDeviceLatestEvent = exports.adminUpsertPortableDevice = exports.adminCreateUser = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const REGION = "asia-southeast1";
const MANILA_TIME_ZONE = "Asia/Manila";
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
function asRecord(value) {
    return typeof value === "object" && value !== null
        ? value
        : {};
}
function toMillis(value) {
    if (value && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    return 0;
}
function parseQueryInt(value, fallback, min, max) {
    const raw = Array.isArray(value) ? value[0] : value;
    const parsed = Number.parseInt(normalizeText(raw), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
}
function formatManilaDate(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: MANILA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}
function parseEventStartMs(date, time) {
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
    }
    else if (twentyFourHourMatch) {
        hours = Number.parseInt(twentyFourHourMatch[1], 10);
        minutes = Number.parseInt(twentyFourHourMatch[2], 10);
    }
    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const parsed = Date.parse(`${date}T${hh}:${mm}:00+08:00`);
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
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
    var _a, _b;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }
    const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
    return callerProfileSnap.exists ? String((_b = (_a = callerProfileSnap.data()) === null || _a === void 0 ? void 0 : _a.role) !== null && _b !== void 0 ? _b : "") : "";
}
async function requireAdmin(context) {
    const role = await callerRole(context);
    if (role !== "admin") {
        throw new functions.https.HttpsError("permission-denied", "Admin only.");
    }
}
async function authenticateDevice(req) {
    var _a;
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
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    if (data.enabled === false) {
        throw new ApiError(403, "Device is disabled.");
    }
    if (normalizeText(data.secret) !== secret) {
        throw new ApiError(403, "Device secret is invalid.");
    }
    await ref.set({
        lastSeenAt: serverTimestamp(),
    }, { merge: true });
    return { deviceId, secret, ref, data };
}
function sendJson(res, status, payload) {
    res.status(status).json(payload);
}
function deviceEndpoint(method, handler) {
    return functions.region(REGION).https.onRequest(async (req, res) => {
        res.set("Cache-Control", "no-store");
        if (req.method === "OPTIONS") {
            res.set("Allow", `${method}, OPTIONS`);
            res.status(204).send("");
            return;
        }
        if (req.method !== method) {
            res.set("Allow", `${method}, OPTIONS`);
            sendJson(res, 405, { error: "Method not allowed." });
            return;
        }
        try {
            const device = await authenticateDevice(req);
            await handler(req, res, device);
        }
        catch (error) {
            const status = error instanceof ApiError ? error.status : 500;
            const message = errorMessage(error, "Internal server error.");
            console.error("Portable device endpoint failed", error);
            sendJson(res, status, { error: message });
        }
    });
}
exports.adminCreateUser = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    await requireAdmin(context);
    const schoolId = String((_a = data === null || data === void 0 ? void 0 : data.schoolId) !== null && _a !== void 0 ? _a : "").trim();
    const role = String((_b = data === null || data === void 0 ? void 0 : data.role) !== null && _b !== void 0 ? _b : "").trim();
    const emailRaw = (data === null || data === void 0 ? void 0 : data.email) ? String(data.email).trim() : "";
    if (!schoolId) {
        throw new functions.https.HttpsError("invalid-argument", "School ID is required.");
    }
    if (!["admin", "ec", "teacher", "student"].includes(role)) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
    }
    const email = emailRaw || `${schoolId}@campus.local`;
    try {
        const userRecord = await admin.auth().createUser({
            email,
            password: schoolId,
            disabled: false,
        });
        const uid = userRecord.uid;
        await db.doc(`profiles/${uid}`).set({
            schoolId,
            email,
            role,
            mustChangePassword: true,
            createdAt: serverTimestamp(),
        }, { merge: true });
        await db.collection("logs").add({
            action: "admin_create_user",
            actorUid: (_d = (_c = context.auth) === null || _c === void 0 ? void 0 : _c.uid) !== null && _d !== void 0 ? _d : "",
            targetUid: uid,
            targetSchoolId: schoolId,
            createdAt: serverTimestamp(),
        });
        return { uid };
    }
    catch (err) {
        if ((err === null || err === void 0 ? void 0 : err.code) === "auth/email-already-exists") {
            throw new functions.https.HttpsError("already-exists", "Account already exists.");
        }
        throw new functions.https.HttpsError("internal", (err === null || err === void 0 ? void 0 : err.message) || "Failed to create user.");
    }
});
exports.adminUpsertPortableDevice = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
    await requireAdmin(context);
    const deviceId = normalizeText(data === null || data === void 0 ? void 0 : data.deviceId);
    const secret = normalizeText(data === null || data === void 0 ? void 0 : data.secret);
    const name = normalizeText(data === null || data === void 0 ? void 0 : data.name) || deviceId;
    const enabled = (data === null || data === void 0 ? void 0 : data.enabled) !== false;
    if (!deviceId) {
        throw new functions.https.HttpsError("invalid-argument", "Device ID is required.");
    }
    if (!secret) {
        throw new functions.https.HttpsError("invalid-argument", "Device secret is required.");
    }
    await db.doc(`devices/${deviceId}`).set({
        name,
        secret,
        enabled,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
    }, { merge: true });
    return { deviceId, enabled };
});
exports.campusDeviceLatestEvent = deviceEndpoint("GET", async (_req, res) => {
    const today = formatManilaDate();
    const snapshot = await db
        .collection("events")
        .where("date", ">=", today)
        .orderBy("date", "asc")
        .limit(25)
        .get();
    const candidates = snapshot.docs
        .map((doc) => {
        const data = doc.data();
        const date = normalizeText(data.date);
        const scheduledTime = normalizeText(data.scheduledTime) || normalizeText(data.timeStart);
        const status = normalizeText(data.status).toLowerCase() || "upcoming";
        return {
            eventId: doc.id,
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
    candidates.sort((a, b) => {
        if (a.sortMs !== b.sortMs) {
            return a.sortMs - b.sortMs;
        }
        return b.createdAtMs - a.createdAtMs;
    });
    const event = candidates[0];
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
            location: event.location,
            status: event.status,
        },
    });
});
exports.campusDeviceConfirmPairing = deviceEndpoint("POST", async (req, res, device) => {
    const body = asRecord(req.body);
    const eventId = normalizeText(body.eventId);
    const title = normalizeText(body.title);
    const date = normalizeText(body.date);
    const scheduledTime = normalizeText(body.scheduledTime);
    const location = normalizeText(body.location);
    if (!eventId) {
        throw new ApiError(400, "eventId is required.");
    }
    await db.doc(`devicePairings/${device.deviceId}`).set({
        deviceId: device.deviceId,
        eventId,
        eventTitle: title,
        date,
        scheduledTime,
        location,
        status: "paired",
        pairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    await device.ref.set({
        lastPairedEventId: eventId,
        lastPairedAt: serverTimestamp(),
    }, { merge: true });
    sendJson(res, 200, { status: "paired" });
});
exports.campusDevicePendingEnrollments = deviceEndpoint("GET", async (req, res) => {
    const limit = parseQueryInt(req.query.limit, 20, 1, 50);
    const snapshot = await db
        .collection("fingerprintEnrollments")
        .where("status", "==", "pending")
        .limit(limit)
        .get();
    const students = snapshot.docs
        .map((doc) => {
        const data = doc.data();
        return {
            studentUid: normalizeText(data.studentUid) || doc.id,
            schoolId: normalizeText(data.schoolId),
            studentName: normalizeText(data.studentName) || normalizeText(data.name),
            course: normalizeText(data.course),
            year: normalizeText(data.year),
        };
    })
        .filter((student) => student.studentUid);
    sendJson(res, 200, { students });
});
exports.campusDeviceSubmitEnrollment = deviceEndpoint("POST", async (req, res, device) => {
    const body = asRecord(req.body);
    const studentUid = normalizeText(body.studentUid);
    const templateId = Number.parseInt(normalizeText(body.templateId), 10);
    if (!studentUid) {
        throw new ApiError(400, "studentUid is required.");
    }
    if (!Number.isFinite(templateId) || templateId <= 0) {
        throw new ApiError(400, "templateId must be a positive number.");
    }
    await db.doc(`fingerprintEnrollments/${studentUid}`).set({
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
    }, { merge: true });
    sendJson(res, 200, { status: "enrolled" });
});
exports.campusDeviceSyncAttendance = deviceEndpoint("POST", async (req, res, device) => {
    const body = asRecord(req.body);
    const rawRecords = Array.isArray(body.records) ? body.records : null;
    if (!rawRecords) {
        throw new ApiError(400, "records must be an array.");
    }
    const results = [];
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
                capturedAtEpoch: Number.parseInt(normalizeText(record.capturedAtEpoch), 10) || 0,
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
                message: duplicate ? "Attendance already exists." : "Attendance saved.",
            });
        }
        catch (error) {
            results.push({
                recordId,
                status: "failed",
                message: errorMessage(error, "Failed to sync attendance."),
            });
        }
    }
    sendJson(res, 200, { results });
});
//# sourceMappingURL=index.js.map