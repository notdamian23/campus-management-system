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
exports.studentManagePreRegistration = exports.adminUpsertPortableDevice = exports.finalizeVerifiedCampusProfile = exports.savePendingEmailVerification = exports.getCurrentCampusProfile = exports.resolveSchoolIdLogin = exports.ecCreateStudent = exports.ecListStudents = exports.adminDeactivateAllStudents = exports.adminDeleteUser = exports.adminBulkImportStudents = exports.adminCreateUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const campusLogger_1 = require("./campusLogger");
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const REGION = "asia-southeast1";
const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://campusportal.site",
    "https://campus-27dd9.web.app",
    "https://campus-27dd9.firebaseapp.com"
];
function setCorsHeaders(res, origin) {
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Methods', 'OPTIONS, POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Vary', 'Origin');
    }
}
const authLogger = (0, campusLogger_1.createCampusLogger)("CAMPUS auth");
const STUDENT_LOOKUP_PROFILE_ROLES = ["student", "ec", "ecmember"];
const VALID_COURSES = [
    "Computer Engineering",
    "Industrial Engineering",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Electronics Engineering",
];
const COURSE_ALIASES = {
    bscpe: "Computer Engineering",
    bsie: "Industrial Engineering",
    bsee: "Electrical Engineering",
    bsme: "Mechanical Engineering",
    bsece: "Electronics Engineering",
};
function isValidCourse(value) {
    return VALID_COURSES.includes(value);
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
function optionalText(value) {
    const normalized = normalizeText(value);
    return normalized || undefined;
}
function normalizeNamePart(value) {
    return normalizeText(value).replace(/\s+/g, " ");
}
function buildStudentFullName(firstName, lastName) {
    const normalizedFirstName = normalizeNamePart(firstName);
    const normalizedLastName = normalizeNamePart(lastName);
    return [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");
}
function resolveBulkImportFullName(row) {
    return (normalizeNamePart(row.fullName) ||
        normalizeNamePart(row.name) ||
        normalizeNamePart(row.studentName));
}
function normalizeCourseLabel(value) {
    var _a;
    const normalized = normalizeText(value).replace(/\s+/g, " ");
    if (isValidCourse(normalized)) {
        return normalized;
    }
    const aliasKey = normalized.toLowerCase().replace(/[\s.-]+/g, "");
    return (_a = COURSE_ALIASES[aliasKey]) !== null && _a !== void 0 ? _a : "";
}
function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function optionalBoolean(value) {
    if (value === true)
        return true;
    if (value === false)
        return false;
    return undefined;
}
function buildCampusProfilePayload(data) {
    return {
        role: optionalText(data.role),
        schoolId: optionalText(data.schoolId),
        email: optionalText(data.email),
        pendingEmail: data.pendingEmail === null ? null : normalizeText(data.pendingEmail) || null,
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
function asRecord(value) {
    return typeof value === "object" && value !== null ?
        value :
        {};
}
function toMillis(value) {
    if (value && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    if (value &&
        typeof value === "object" &&
        typeof value.seconds === "number") {
        return Number(value.seconds) * 1000;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    const parsed = Date.parse(String(value !== null && value !== void 0 ? value : ""));
    return Number.isNaN(parsed) ? 0 : parsed;
}
function normalizeYear(raw) {
    const value = normalizeText(raw);
    const lowered = value.toLowerCase();
    if (!value)
        return "Unassigned";
    if (value === "1" || lowered === "1st year")
        return "1st Year";
    if (value === "2" || lowered === "2nd year")
        return "2nd Year";
    if (value === "3" || lowered === "3rd year")
        return "3rd Year";
    if (value === "4" || lowered === "4th year")
        return "4th Year";
    if (value === "5" || lowered === "5th year")
        return "5th Year";
    return value;
}
function toTargetList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeText(item)).filter(Boolean);
    }
    const raw = normalizeText(value);
    if (!raw)
        return [];
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
function matchesTargetList(targetValue, studentValue, allLabel) {
    const targets = toTargetList(targetValue);
    if (targets.length === 0)
        return true;
    if (targets.some((item) => normalizeLower(item) === normalizeLower(allLabel))) {
        return true;
    }
    return targets.some((item) => normalizeLower(item) === normalizeLower(studentValue));
}
function matchesSpecificStudentTarget(targetValue, schoolId, studentName) {
    var _a;
    const rawTarget = normalizeText(targetValue);
    if (!rawTarget)
        return true;
    const normalizedSchoolId = normalizeLower(schoolId);
    const normalizedStudentName = normalizeLower(studentName);
    if (!normalizedSchoolId && !normalizedStudentName)
        return false;
    const parts = rawTarget
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
    for (const part of parts.length ? parts : [rawTarget]) {
        const normalized = normalizeLower(part);
        const withoutParens = normalizeLower(part.replace(/\([^)]*\)/g, " ").trim());
        const parenMatch = part.match(/\(([^)]+)\)/);
        const insideParen = normalizeLower((_a = parenMatch === null || parenMatch === void 0 ? void 0 : parenMatch[1]) !== null && _a !== void 0 ? _a : "");
        if (normalized === normalizedSchoolId || normalized === normalizedStudentName) {
            return true;
        }
        if (insideParen && insideParen === normalizedSchoolId) {
            return true;
        }
        if (withoutParens &&
            (withoutParens === normalizedStudentName ||
                normalizedStudentName.includes(withoutParens) ||
                withoutParens.includes(normalizedStudentName))) {
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
function parseRegistrationStatus(raw) {
    const normalized = normalizeLower(raw);
    if (normalized === "waitlisted")
        return "WAITLISTED";
    if (normalized === "cancelled")
        return "CANCELLED";
    return "PRE_REGISTERED";
}
function parseEventWindowMs(value) {
    return toMillis(value);
}
function resolveEventStartMs(data) {
    const date = normalizeText(data.date);
    const scheduledTime = normalizeText(data.scheduledTime) ||
        normalizeText(data.scheduledTimeStart) ||
        normalizeText(data.timeStart);
    return parseEventStartMs(date, scheduledTime);
}
function resolveRegistrationStartMs(data) {
    return parseEventWindowMs(data.registrationStartAt);
}
function resolveRegistrationEndMs(data) {
    const explicit = parseEventWindowMs(data.registrationEndAt);
    if (explicit > 0)
        return explicit;
    return resolveEventStartMs(data);
}
function resolveCancellationDeadlineMs(data) {
    const explicit = parseEventWindowMs(data.cancellationDeadlineAt);
    if (explicit > 0)
        return explicit;
    return resolveRegistrationEndMs(data);
}
function makeStudentNotificationId(eventId) {
    return `preregister-${eventId}`;
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
async function callerRole(context) {
    var _a, _b;
    if (!context.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
    return callerProfileSnap.exists ?
        String((_b = (_a = callerProfileSnap.data()) === null || _a === void 0 ? void 0 : _a.role) !== null && _b !== void 0 ? _b : "") :
        "";
}
async function requireAdmin(context) {
    const role = await callerRole(context);
    if (role !== "admin") {
        throw new https_1.HttpsError("permission-denied", "Admin only.");
    }
}
async function requireAdminOrEC(context) {
    const role = await callerRole(context);
    if (role !== "admin" && role !== "ec") {
        throw new https_1.HttpsError("permission-denied", "EC/Admin only.");
    }
}
exports.adminCreateUser = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d;
    await requireAdmin(request);
    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const role = normalizeText(body.role);
    const emailRaw = normalizeText(body.email);
    const name = normalizeText(body.name) ||
        normalizeText(body.teacherName) ||
        normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearSource = (_a = body.yearLevel) !== null && _a !== void 0 ? _a : body.year;
    const yearRaw = normalizeText(yearSource);
    const year = normalizeYear(yearSource);
    if (emailRaw && !isValidEmailAddress(emailRaw)) {
        throw new https_1.HttpsError("invalid-argument", "Please provide a valid email address.");
    }
    if (!schoolId) {
        throw new https_1.HttpsError("invalid-argument", "School ID is required.");
    }
    if (!["admin", "ec", "teacher", "student"].includes(role)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid role.");
    }
    if (role === "teacher" && !name) {
        throw new https_1.HttpsError("invalid-argument", "name is required for teacher role.");
    }
    if (role === "student" && !name) {
        throw new https_1.HttpsError("invalid-argument", "name is required for student role.");
    }
    if (role === "ec" && !name) {
        throw new https_1.HttpsError("invalid-argument", "name is required for ec role.");
    }
    if ((role === "student" || role === "ec") && !course) {
        throw new https_1.HttpsError("invalid-argument", "course is required for student and ec roles.");
    }
    if ((role === "student" || role === "ec") && !yearRaw) {
        throw new https_1.HttpsError("invalid-argument", "yearLevel is required for student and ec roles.");
    }
    // School ID login still resolves through Firebase Auth email, so we can
    // safely use a real contact email here when one is provided.
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
        const profilePayload = {
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
        await db.doc(`profiles/${uid}`).set(profilePayload, { merge: true });
        authLogger.debug("adminCreateUser profile write complete", {
            uid,
            role,
            schoolId,
        });
        if (role === "student") {
            await db.doc(`students/${uid}`).set({
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
            }, { merge: true });
            authLogger.debug("adminCreateUser student projection write complete", {
                uid,
                schoolId,
            });
        }
        await db.collection("logs").add({
            action: "admin_create_user",
            actorUid: normalizeText((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid),
            targetUid: uid,
            targetSchoolId: schoolId,
            createdAt: timestamp,
        });
        authLogger.info("adminCreateUser created account", {
            uid,
            role,
            schoolId,
        });
        return { uid };
    }
    catch (error) {
        const authError = error;
        authLogger.warn("adminCreateUser failed", {
            role,
            schoolId,
            code: (_c = authError.code) !== null && _c !== void 0 ? _c : "unknown",
            message: (_d = authError.message) !== null && _d !== void 0 ? _d : "Unknown account creation failure",
        });
        if (authError.code === "auth/email-already-exists") {
            throw new https_1.HttpsError("already-exists", "Account already exists.");
        }
        throw new https_1.HttpsError("internal", authError.message || "Failed to create user.");
    }
});
function normalizeBulkStudentStatus(raw) {
    const normalized = normalizeText(raw).toLowerCase();
    if (!normalized || normalized === "active")
        return "active";
    if (normalized === "inactive")
        return "inactive";
    if (normalized === "pending")
        return "pending";
    return "";
}
function isValidBulkSchoolId(value) {
    return Boolean(value) && /^[A-Za-z0-9]{4,}$/.test(value);
}
async function fetchExistingProfileSchoolIds(schoolIds) {
    const existing = new Set();
    const chunks = [];
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
async function adminBulkImportStudentsLogic(context) {
    var _a;
    await requireAdmin({ auth: context.auth });
    const body = asRecord(context.data);
    const filename = normalizeText(body.filename) || "student-import.csv";
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const actorUid = context.auth.uid;
    const callerProfileSnap = await db.doc(`profiles/${actorUid}`).get();
    const actorSchoolId = normalizeText((_a = callerProfileSnap.data()) === null || _a === void 0 ? void 0 : _a.schoolId);
    const timestamp = serverTimestamp();
    const validatedRows = rows.map((rawRow, index) => {
        const row = asRecord(rawRow);
        const schoolId = normalizeText(row.schoolId);
        const lastName = normalizeNamePart(row.lastName);
        const firstName = normalizeNamePart(row.firstName);
        const legacyFullName = resolveBulkImportFullName(row);
        const course = normalizeCourseLabel(row.course);
        const yearLevelRaw = normalizeText(row.yearLevel);
        const status = normalizeBulkStudentStatus(row.status);
        const normalizedYear = normalizeYear(yearLevelRaw);
        const errors = [];
        const hasLegacyFullName = Boolean(legacyFullName);
        const hasLegacyFullNameField = "fullName" in row || "name" in row || "studentName" in row;
        if (!schoolId) {
            errors.push("SchoolId is required.");
        }
        else if (!isValidBulkSchoolId(schoolId)) {
            errors.push("SchoolId must be alphanumeric and at least 4 characters.");
        }
        if (!hasLegacyFullName) {
            if (hasLegacyFullNameField && !lastName && !firstName) {
                errors.push("FullName is required.");
            }
            else {
                if (!lastName)
                    errors.push("LastName is required.");
                if (!firstName)
                    errors.push("FirstName is required.");
            }
        }
        if (!course) {
            errors.push("Course is required.");
        }
        else if (!isValidCourse(course)) {
            errors.push("Invalid course. Use a CAMPUS course label such as Computer Engineering or BSCpE.");
        }
        if (!yearLevelRaw) {
            errors.push("YearLevel is required.");
        }
        else if (!normalizedYear) {
            errors.push("YearLevel is invalid.");
        }
        if (!status) {
            errors.push("Status is invalid. Use active, inactive, or pending.");
        }
        return {
            rowIndex: index + 1,
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
        };
    });
    const schoolIdCounts = new Map();
    validatedRows.forEach((row) => {
        var _a;
        const schoolId = String(row.schoolId || "");
        if (schoolId) {
            schoolIdCounts.set(schoolId, ((_a = schoolIdCounts.get(schoolId)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
    });
    const uniqueSchoolIds = Array.from(schoolIdCounts.keys());
    const existingSchoolIds = await fetchExistingProfileSchoolIds(uniqueSchoolIds);
    const finalResults = validatedRows.map((row) => (Object.assign({}, row)));
    finalResults.forEach((row) => {
        const errors = Array.isArray(row.errors) ? [...row.errors] : [];
        if (row.schoolId && schoolIdCounts.get(row.schoolId) > 1) {
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
        let createdUid = null;
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
            const profilePayload = {
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
            await db.doc(`profiles/${uid}`).set(profilePayload, { merge: true });
            await db.doc(`students/${uid}`).set({
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
            }, { merge: true });
            resultRow.success = true;
            resultRow.uid = uid;
            importedCount += 1;
        }
        catch (error) {
            const authError = error;
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
exports.adminBulkImportStudents = (0, https_1.onRequest)({ region: REGION }, async (req, res) => {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
        res.status(403).json({ error: { status: 'PERMISSION_DENIED', message: 'Origin not allowed' } });
        return;
    }
    setCorsHeaders(res, origin);
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: { status: 'FAILED_PRECONDITION', message: 'Method not allowed' } });
        return;
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || !('data' in body)) {
        res.status(400).json({ error: { status: 'FAILED_PRECONDITION', message: 'Bad request' } });
        return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Unauthorized' } });
        return;
    }
    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    }
    catch (_a) {
        res.status(401).json({ error: { status: 'UNAUTHENTICATED', message: 'Unauthorized' } });
        return;
    }
    const context = {
        data: body.data,
        auth: { uid: decodedToken.uid, token: decodedToken, rawToken: idToken }
    };
    try {
        const result = await adminBulkImportStudentsLogic(context);
        res.json({ result });
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            res.status(400).json({ error: { status: error.code, message: error.message } });
        }
        else {
            res.status(500).json({ error: { status: 'INTERNAL', message: 'Internal error' } });
        }
    }
});
exports.adminDeleteUser = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d;
    await requireAdmin(request);
    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);
    if (!uid) {
        throw new https_1.HttpsError("invalid-argument", "uid required");
    }
    if (uid === normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("failed-precondition", "You cannot delete yourself.");
    }
    const profileSnap = await db.doc(`profiles/${uid}`).get();
    const schoolId = (_c = (_b = profileSnap.data()) === null || _b === void 0 ? void 0 : _b.schoolId) !== null && _c !== void 0 ? _c : null;
    await admin.auth().deleteUser(uid);
    await db.doc(`profiles/${uid}`).delete().catch(() => undefined);
    await db.collection("logs").add({
        action: "DELETE_USER",
        actorUid: normalizeText((_d = request.auth) === null || _d === void 0 ? void 0 : _d.uid),
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: serverTimestamp(),
    });
    return { success: true };
});
exports.adminDeactivateAllStudents = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
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
    const studentByUid = new Map();
    const studentRefs = profileDocs.map((profileDoc) => db.doc(`students/${profileDoc.id}`));
    for (let index = 0; index < studentRefs.length; index += 300) {
        const refsChunk = studentRefs.slice(index, index + 300);
        const studentSnapshots = refsChunk.length > 0 ?
            await db.getAll(...refsChunk) :
            [];
        studentSnapshots.forEach((studentSnap) => {
            var _a;
            if (!studentSnap.exists)
                return;
            studentByUid.set(studentSnap.id, (_a = studentSnap.data()) !== null && _a !== void 0 ? _a : {});
        });
    }
    let updatedCount = 0;
    // Update profile and student projections together so admin tables and
    // student-facing account checks stay consistent after the bulk action.
    for (let index = 0; index < profileDocs.length; index += 200) {
        const docsChunk = profileDocs.slice(index, index + 200);
        const batch = db.batch();
        docsChunk.forEach((profileDoc) => {
            var _a, _b;
            const uid = profileDoc.id;
            const profileData = (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {};
            const studentData = (_b = studentByUid.get(uid)) !== null && _b !== void 0 ? _b : {};
            const profileStatus = normalizeLower(profileData.status);
            const studentStatus = normalizeLower(studentData.status);
            if (profileStatus !== "inactive" || studentStatus !== "inactive") {
                updatedCount += 1;
            }
            batch.set(profileDoc.ref, {
                status: "inactive",
                updatedAt: serverTimestamp(),
            }, { merge: true });
            batch.set(db.doc(`students/${uid}`), {
                status: "inactive",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        });
        await batch.commit();
    }
    await db.collection("logs").add({
        action: "ADMIN_DEACTIVATE_ALL_STUDENTS",
        actorUid: normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid),
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
exports.ecListStudents = (0, https_1.onCall)({ region: REGION }, async (request) => {
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
    const studentRefs = profileSnapshot.docs.map((profileDoc) => db.doc(`students/${profileDoc.id}`));
    const studentSnapshots = studentRefs.length > 0 ?
        await db.getAll(...studentRefs) :
        [];
    const studentByUid = new Map();
    studentSnapshots.forEach((studentSnap) => {
        var _a;
        if (!studentSnap.exists)
            return;
        studentByUid.set(studentSnap.id, (_a = studentSnap.data()) !== null && _a !== void 0 ? _a : {});
    });
    const students = profileSnapshot.docs.map((profileDoc) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const profileData = (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {};
        const studentData = (_b = studentByUid.get(profileDoc.id)) !== null && _b !== void 0 ? _b : {};
        const firstName = normalizeNamePart(profileData.firstName) ||
            normalizeNamePart(studentData.firstName);
        const lastName = normalizeNamePart(profileData.lastName) ||
            normalizeNamePart(studentData.lastName);
        const combinedFullName = buildStudentFullName(firstName, lastName);
        return {
            uid: profileDoc.id,
            role: normalizeText(profileData.role),
            schoolId: normalizeText(profileData.schoolId) ||
                normalizeText(studentData.schoolId) ||
                profileDoc.id,
            firstName,
            lastName,
            fullName: normalizeText(profileData.fullName) ||
                normalizeText(studentData.fullName) ||
                combinedFullName,
            studentName: normalizeText(profileData.studentName) ||
                normalizeText(studentData.studentName) ||
                normalizeText(profileData.name) ||
                normalizeText(studentData.name) ||
                combinedFullName,
            name: normalizeText(profileData.name) ||
                normalizeText(profileData.fullName) ||
                normalizeText(studentData.name) ||
                normalizeText(studentData.fullName) ||
                normalizeText(profileData.studentName) ||
                normalizeText(studentData.studentName) ||
                combinedFullName,
            course: normalizeText(profileData.course) ||
                normalizeText(studentData.course) ||
                "Unassigned",
            yearLevel: normalizeYear((_e = (_d = (_c = profileData.year) !== null && _c !== void 0 ? _c : profileData.yearLevel) !== null && _d !== void 0 ? _d : studentData.year) !== null && _e !== void 0 ? _e : studentData.yearLevel),
            year: normalizeYear((_h = (_g = (_f = profileData.year) !== null && _f !== void 0 ? _f : profileData.yearLevel) !== null && _g !== void 0 ? _g : studentData.year) !== null && _h !== void 0 ? _h : studentData.yearLevel),
            readyForClearance: studentData.readyForClearance === true ||
                profileData.readyForClearance === true,
            status: normalizeText(studentData.status) ||
                normalizeText(profileData.status) ||
                "Active",
            email: normalizeText(profileData.email),
            createdAtMs: toMillis((_j = profileData.createdAt) !== null && _j !== void 0 ? _j : studentData.createdAt),
        };
    });
    return { students };
});
exports.ecCreateStudent = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    await requireAdminOrEC(request);
    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const studentName = normalizeText(body.studentName);
    const course = normalizeText(body.course);
    const yearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);
    const emailRaw = normalizeText(body.email);
    if (emailRaw && !isValidEmailAddress(emailRaw)) {
        throw new https_1.HttpsError("invalid-argument", "Please provide a valid email address.");
    }
    const email = emailRaw || `${schoolId}@campus.local`;
    if (!schoolId) {
        throw new https_1.HttpsError("invalid-argument", "School ID is required.");
    }
    if (!studentName) {
        throw new https_1.HttpsError("invalid-argument", "Student name is required.");
    }
    if (!course) {
        throw new https_1.HttpsError("invalid-argument", "Course is required.");
    }
    if (!yearRaw) {
        throw new https_1.HttpsError("invalid-argument", "Year is required.");
    }
    const existingProfileSnapshot = await db
        .collection("profiles")
        .where("schoolId", "==", schoolId)
        .limit(1)
        .get();
    if (!existingProfileSnapshot.empty) {
        throw new https_1.HttpsError("already-exists", "Student with this School ID already exists.");
    }
    try {
        const userRecord = await admin.auth().createUser({
            email,
            password: schoolId,
            disabled: false,
        });
        const uid = userRecord.uid;
        const timestamp = serverTimestamp();
        await db.doc(`profiles/${uid}`).set({
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
        }, { merge: true });
        await db.doc(`students/${uid}`).set({
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
        }, { merge: true });
        await db.collection("logs").add({
            action: "ec_create_student",
            actorUid: normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid),
            targetUid: uid,
            targetSchoolId: schoolId,
            createdAt: timestamp,
        });
        return { uid };
    }
    catch (error) {
        const authError = error;
        if (authError.code === "auth/email-already-exists") {
            throw new https_1.HttpsError("already-exists", "Account already exists.");
        }
        throw new https_1.HttpsError("internal", authError.message || "Failed to create student account.");
    }
});
exports.resolveSchoolIdLogin = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    if (!schoolId) {
        throw new https_1.HttpsError("invalid-argument", "School ID is required.");
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
    const profileData = (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {};
    const profileEmail = normalizeText(profileData.email);
    try {
        const userRecord = await admin.auth().getUser(profileDoc.id);
        const resolvedEmail = normalizeText(userRecord.email) ||
            profileEmail ||
            `${schoolId}@campus.local`;
        const source = normalizeText(userRecord.email) ? "auth" : profileEmail ? "profile" : "fallback";
        authLogger.info("resolveSchoolIdLogin resolved", {
            source,
        });
        return {
            email: resolvedEmail,
            found: true,
            source,
        };
    }
    catch (error) {
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
exports.getCurrentCampusProfile = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    const uid = normalizeText(request.auth.uid);
    const profileRef = db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
        throw new https_1.HttpsError("not-found", "Your CAMPUS profile could not be found.");
    }
    const profileData = (_a = profileSnap.data()) !== null && _a !== void 0 ? _a : {};
    try {
        const authUser = await admin.auth().getUser(uid);
        const authEmail = normalizeLower(authUser.email);
        const currentEmail = normalizeLower(profileData.email);
        const pendingEmail = normalizeLower(profileData.pendingEmail);
        if (authEmail &&
            authEmail !== currentEmail &&
            (!pendingEmail || pendingEmail === authEmail)) {
            await profileRef.set({
                email: authEmail,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            profileData.email = authEmail;
        }
    }
    catch (error) {
        authLogger.warn("getCurrentCampusProfile unable to sync auth email", { error });
    }
    return {
        profile: buildCampusProfilePayload(profileData),
    };
});
exports.savePendingEmailVerification = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    const body = asRecord(request.data);
    const pendingEmail = normalizeLower(body.pendingEmail);
    if (!pendingEmail) {
        throw new https_1.HttpsError("invalid-argument", "Email address is required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pendingEmail)) {
        throw new https_1.HttpsError("invalid-argument", "Please provide a valid email address.");
    }
    const uid = normalizeText(request.auth.uid);
    const profileRef = db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
        throw new https_1.HttpsError("not-found", "Your CAMPUS profile could not be found.");
    }
    // We keep onboarding locked until the verified address comes back through
    // Firebase so School ID logins continue to enforce verification safely.
    await profileRef.set({
        pendingEmail,
        mustChangePassword: true,
        emailVerificationPending: true,
        emailVerified: false,
        firstLoginCompleted: false,
        status: "pending",
        updatedAt: serverTimestamp(),
    }, { merge: true });
    const refreshedProfileSnap = await profileRef.get();
    return {
        profile: buildCampusProfilePayload((_a = refreshedProfileSnap.data()) !== null && _a !== void 0 ? _a : {}),
    };
});
exports.finalizeVerifiedCampusProfile = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    const uid = normalizeText(request.auth.uid);
    const profileRef = db.doc(`profiles/${uid}`);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
        throw new https_1.HttpsError("not-found", "Your CAMPUS profile could not be found.");
    }
    const profileData = (_a = profileSnap.data()) !== null && _a !== void 0 ? _a : {};
    let authUser;
    try {
        authUser = await admin.auth().getUser(uid);
    }
    catch (error) {
        const authError = error;
        throw new https_1.HttpsError("internal", authError.message || "Unable to verify your Firebase account.");
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
    const shouldFinalize = (pendingEmail && pendingEmail === authEmail) ||
        (!pendingEmail &&
            currentEmail === authEmail &&
            (profileData.emailVerificationPending === true ||
                profileData.emailVerified === false ||
                profileData.firstLoginCompleted === false));
    if (!shouldFinalize) {
        return {
            finalized: false,
            profile: buildCampusProfilePayload(profileData),
        };
    }
    await profileRef.set({
        email: authEmail,
        emailVerified: true,
        emailVerificationPending: false,
        mustChangePassword: false,
        firstLoginCompleted: true,
        pendingEmail: admin.firestore.FieldValue.delete(),
        status: profileData.status === "Inactive" ? "Inactive" : "active",
        updatedAt: serverTimestamp(),
    }, { merge: true });
    const refreshedProfileSnap = await profileRef.get();
    authLogger.info("finalizeVerifiedCampusProfile finalized", {
        role: normalizeText((_b = refreshedProfileSnap.data()) === null || _b === void 0 ? void 0 : _b.role),
    });
    return {
        finalized: true,
        profile: buildCampusProfilePayload((_c = refreshedProfileSnap.data()) !== null && _c !== void 0 ? _c : {}),
    };
});
exports.adminUpsertPortableDevice = (0, https_1.onCall)({ region: REGION }, async (request) => {
    await requireAdmin(request);
    const body = asRecord(request.data);
    const deviceId = normalizeText(body.deviceId);
    const secret = normalizeText(body.secret);
    const name = normalizeText(body.name) || deviceId;
    const enabled = body.enabled !== false;
    if (!deviceId) {
        throw new https_1.HttpsError("invalid-argument", "Device ID is required.");
    }
    if (!secret) {
        throw new https_1.HttpsError("invalid-argument", "Device secret is required.");
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
exports.studentManagePreRegistration = (0, https_1.onCall)({ region: REGION }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    const body = asRecord(request.data);
    const eventId = normalizeText(body.eventId);
    const action = normalizeLower(body.action) === "cancel" ? "cancel" : "register";
    const uid = normalizeText(request.auth.uid);
    if (!eventId) {
        throw new https_1.HttpsError("invalid-argument", "eventId is required.");
    }
    const eventRef = db.doc(`events/${eventId}`);
    const registrationRef = db.doc(`events/${eventId}/registrations/${uid}`);
    const profileRef = db.doc(`profiles/${uid}`);
    const studentRef = db.doc(`students/${uid}`);
    const result = await db.runTransaction(async (transaction) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const [eventSnap, profileSnap, studentSnap] = await Promise.all([
            transaction.get(eventRef),
            transaction.get(profileRef),
            transaction.get(studentRef),
        ]);
        if (!eventSnap.exists) {
            throw new https_1.HttpsError("not-found", "Event not found.");
        }
        const profileData = (_a = profileSnap.data()) !== null && _a !== void 0 ? _a : {};
        const studentData = (_b = studentSnap.data()) !== null && _b !== void 0 ? _b : {};
        const role = normalizeLower(profileData.role);
        if (role !== "student") {
            throw new https_1.HttpsError("permission-denied", "Student access only.");
        }
        const accountStatus = normalizeLower(studentData.status) ||
            normalizeLower(profileData.status);
        if (accountStatus === "inactive") {
            throw new https_1.HttpsError("failed-precondition", "Approach EC member to activate your account first.");
        }
        const eventData = (_c = eventSnap.data()) !== null && _c !== void 0 ? _c : {};
        if (eventData.isPreReg !== true) {
            throw new https_1.HttpsError("failed-precondition", "This event is not open for pre-registration.");
        }
        const nowMs = Date.now();
        const registrationStartMs = resolveRegistrationStartMs(eventData);
        const registrationEndMs = resolveRegistrationEndMs(eventData);
        const cancellationDeadlineMs = resolveCancellationDeadlineMs(eventData);
        const eventStartMs = resolveEventStartMs(eventData);
        if (action === "register") {
            if (registrationStartMs > 0 && nowMs < registrationStartMs) {
                throw new https_1.HttpsError("failed-precondition", "Registration has not opened yet.");
            }
            if (registrationEndMs > 0 && nowMs > registrationEndMs) {
                throw new https_1.HttpsError("failed-precondition", "Registration is already closed.");
            }
            if (eventStartMs !== Number.MAX_SAFE_INTEGER && nowMs >= eventStartMs) {
                throw new https_1.HttpsError("failed-precondition", "Registration is already closed for this event.");
            }
        }
        else if (cancellationDeadlineMs > 0 && nowMs > cancellationDeadlineMs) {
            throw new https_1.HttpsError("failed-precondition", "The cancellation deadline has already passed.");
        }
        const schoolId = normalizeText(profileData.schoolId) || uid;
        const studentName = normalizeText(profileData.studentName) ||
            normalizeText(profileData.name) ||
            schoolId;
        const course = normalizeText(profileData.course) || "Unassigned";
        const year = normalizeYear(profileData.year);
        const courseTargets = toTargetList(eventData.courses);
        const yearTargets = toTargetList(eventData.yearLevels);
        const courseValue = courseTargets.length > 0 ?
            courseTargets :
            normalizeText(eventData.course);
        const yearValue = yearTargets.length > 0 ?
            yearTargets :
            normalizeText(eventData.yearLevel);
        if (!matchesTargetList(courseValue, course, "All Courses")) {
            throw new https_1.HttpsError("permission-denied", "Your course is not allowed for this event.");
        }
        if (!matchesTargetList(yearValue, year, "All Years")) {
            throw new https_1.HttpsError("permission-denied", "Your year level is not allowed for this event.");
        }
        if (!matchesSpecificStudentTarget(eventData.targetStudent, schoolId, studentName)) {
            throw new https_1.HttpsError("permission-denied", "You are not part of the allowed audience for this event.");
        }
        const requiredPaymentId = normalizeText(eventData.requiredPaymentId);
        if (eventData.withPayment === true) {
            if (!requiredPaymentId) {
                throw new https_1.HttpsError("failed-precondition", "This event requires a linked payment before registration.");
            }
            const paymentAssignmentSnap = await transaction.get(db.doc(`payments/${requiredPaymentId}/students/${uid}`));
            if (!paymentAssignmentSnap.exists) {
                throw new https_1.HttpsError("failed-precondition", "Complete the required payment first.");
            }
            const paymentStatus = normalizeLower((_d = paymentAssignmentSnap.data()) === null || _d === void 0 ? void 0 : _d.status);
            if (paymentStatus !== "paid") {
                throw new https_1.HttpsError("failed-precondition", "Complete the required payment first.");
            }
        }
        const registrationsSnap = await transaction.get(db.collection(`events/${eventId}/registrations`));
        let currentRegistrationData = null;
        const waitlistedSnapshots = [];
        let preRegisteredCount = 0;
        let waitlistCount = 0;
        registrationsSnap.docs.forEach((registrationDoc) => {
            const registrationData = registrationDoc.data();
            const studentUid = normalizeText(registrationData.uid) ||
                normalizeText(registrationData.studentUid) ||
                registrationDoc.id;
            const status = parseRegistrationStatus(registrationData.status);
            if (studentUid === uid || registrationDoc.id === uid) {
                currentRegistrationData = registrationData;
            }
            if (status === "PRE_REGISTERED") {
                preRegisteredCount += 1;
            }
            else if (status === "WAITLISTED") {
                waitlistCount += 1;
                waitlistedSnapshots.push(registrationDoc);
            }
        });
        const currentRegistrationPayload = currentRegistrationData;
        const currentStatus = currentRegistrationPayload ?
            parseRegistrationStatus(currentRegistrationPayload["status"]) :
            null;
        const slots = typeof eventData.preRegSlots === "number" ?
            Math.max(0, Math.trunc(eventData.preRegSlots)) :
            null;
        const waitlistEnabled = eventData.waitlistEnabled === true;
        let nextStatus;
        let message = "";
        let promotedStudentUid = "";
        const notificationRef = db.doc(`profiles/${uid}/notifications/${makeStudentNotificationId(eventId)}`);
        if (action === "register") {
            if (currentStatus === "PRE_REGISTERED") {
                throw new https_1.HttpsError("already-exists", "You are already pre-registered for this event.");
            }
            if (currentStatus === "WAITLISTED") {
                throw new https_1.HttpsError("already-exists", "You are already on the waitlist for this event.");
            }
            const hasSlot = slots == null || preRegisteredCount < slots;
            if (hasSlot) {
                nextStatus = "PRE_REGISTERED";
                preRegisteredCount += 1;
                message = "Pre-registration confirmed.";
            }
            else if (waitlistEnabled) {
                nextStatus = "WAITLISTED";
                waitlistCount += 1;
                message = "Event is full. You have been added to the waitlist.";
            }
            else {
                throw new https_1.HttpsError("failed-precondition", "All pre-registration slots are already full.");
            }
            const existingRegistrationData = (currentRegistrationPayload !== null && currentRegistrationPayload !== void 0 ? currentRegistrationPayload : {});
            transaction.set(registrationRef, {
                uid,
                schoolId,
                studentName,
                course,
                year,
                status: nextStatus,
                createdAt: (_e = existingRegistrationData.createdAt) !== null && _e !== void 0 ? _e : serverTimestamp(),
                updatedAt: serverTimestamp(),
                updatedByUid: uid,
                actorRole: "student",
                registeredAt: nextStatus === "PRE_REGISTERED" ?
                    serverTimestamp() :
                    (_f = existingRegistrationData.registeredAt) !== null && _f !== void 0 ? _f : null,
                waitlistedAt: nextStatus === "WAITLISTED" ?
                    serverTimestamp() :
                    (_g = existingRegistrationData.waitlistedAt) !== null && _g !== void 0 ? _g : null,
                cancelledAt: null,
                cancellationReason: null,
            }, { merge: true });
            transaction.set(notificationRef, {
                title: nextStatus === "PRE_REGISTERED" ?
                    `Pre-registration confirmed: ${normalizeText(eventData.title) || "Event"}` :
                    `Waitlisted: ${normalizeText(eventData.title) || "Event"}`,
                message: message,
                date: normalizeText(eventData.date),
                scheduledTime: normalizeText(eventData.scheduledTime) ||
                    normalizeText(eventData.timeStart),
                type: "preregister",
                createdAt: serverTimestamp(),
            }, { merge: true });
        }
        else {
            if (!currentRegistrationData || !currentStatus) {
                throw new https_1.HttpsError("not-found", "No active pre-registration record was found.");
            }
            if (currentStatus === "CANCELLED") {
                throw new https_1.HttpsError("failed-precondition", "This registration is already cancelled.");
            }
            nextStatus = "CANCELLED";
            const existingRegistrationData = currentRegistrationPayload;
            if (currentStatus === "PRE_REGISTERED") {
                preRegisteredCount = Math.max(0, preRegisteredCount - 1);
            }
            else if (currentStatus === "WAITLISTED") {
                waitlistCount = Math.max(0, waitlistCount - 1);
            }
            transaction.set(registrationRef, {
                status: "CANCELLED",
                updatedAt: serverTimestamp(),
                updatedByUid: uid,
                actorRole: "student",
                cancelledAt: serverTimestamp(),
                cancellationReason: "student_cancelled",
                createdAt: (_h = existingRegistrationData.createdAt) !== null && _h !== void 0 ? _h : serverTimestamp(),
            }, { merge: true });
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
                        transaction.set(nextWaitlisted.ref, {
                            status: "PRE_REGISTERED",
                            updatedAt: serverTimestamp(),
                            updatedByUid: uid,
                            actorRole: "system",
                            registeredAt: serverTimestamp(),
                            promotedFromWaitlistAt: serverTimestamp(),
                        }, { merge: true });
                        const promotedNotificationRef = db.doc(`profiles/${promotedStudentUid}/notifications/${makeStudentNotificationId(eventId)}`);
                        transaction.set(promotedNotificationRef, {
                            title: `Pre-registration confirmed: ${normalizeText(eventData.title) || "Event"}`,
                            message: "A slot opened up and your waitlist entry was promoted.",
                            date: normalizeText(eventData.date),
                            scheduledTime: normalizeText(eventData.scheduledTime) ||
                                normalizeText(eventData.timeStart),
                            type: "preregister",
                            createdAt: serverTimestamp(),
                        }, { merge: true });
                    }
                }
            }
            transaction.set(notificationRef, {
                title: `Registration cancelled: ${normalizeText(eventData.title) || "Event"}`,
                message,
                date: normalizeText(eventData.date),
                scheduledTime: normalizeText(eventData.scheduledTime) ||
                    normalizeText(eventData.timeStart),
                type: "preregister",
                createdAt: serverTimestamp(),
            }, { merge: true });
        }
        transaction.set(eventRef, {
            preRegCount: preRegisteredCount,
            preRegRemaining: slots == null ?
                null :
                Math.max(0, slots - preRegisteredCount),
            waitlistCount,
            updatedAt: serverTimestamp(),
        }, { merge: true });
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
//# sourceMappingURL=index.js.map