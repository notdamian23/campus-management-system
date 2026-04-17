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
exports.studentManagePreRegistration = exports.adminUpsertPortableDevice = exports.finalizeVerifiedCampusProfile = exports.savePendingEmailVerification = exports.getCurrentCampusProfile = exports.resolveSchoolIdLogin = exports.ecCreateStudent = exports.ecListStudents = exports.adminDeleteDuplicateStudentSchoolIds = exports.adminFindDuplicateStudentSchoolIds = exports.adminDeactivateAllStudents = exports.adminDeleteUser = exports.adminBulkImportStudents = exports.adminCreateUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const campusLogger_1 = require("./campusLogger");
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const REGION = "asia-southeast1";
const STUDENT_SCHOOL_ID_INDEX_COLLECTION = "studentSchoolIds";
const STUDENT_SCHOOL_ID_RESERVATION_TTL_MS = 10 * 60 * 1000;
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
function normalizeSchoolIdKey(value) {
    return normalizeLower(value);
}
function optionalText(value) {
    const normalized = normalizeText(value);
    return normalized || undefined;
}
function toPositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
function normalizeNamePart(value) {
    // Preserve Unicode student names such as Peña, Niño, and Muñoz while still
    // trimming pasted/imported whitespace.
    return String(value !== null && value !== void 0 ? value : "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ");
}
function buildStudentFullName(firstName, lastName) {
    const normalizedFirstName = normalizeNamePart(firstName);
    const normalizedLastName = normalizeNamePart(lastName);
    return [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");
}
function resolveBulkImportFullName(row) {
    return (normalizeNamePart(row.fullName) ||
        normalizeNamePart(row.name) ||
        normalizeNamePart(row.studentName) ||
        buildStudentFullName(row.firstName, row.lastName));
}
function normalizeBulkStudentImportInputSchema(value) {
    const normalized = normalizeLower(value);
    if (normalized === "legacy")
        return "legacy";
    if (normalized === "split")
        return "split";
    return "";
}
function resolveBulkStudentImportInputSchema(row, fallbackSchema) {
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
function studentSchoolIdIndexRef(schoolIdKey) {
    return db.collection(STUDENT_SCHOOL_ID_INDEX_COLLECTION).doc(schoolIdKey);
}
function schoolIdAlreadyExistsError(message = "School ID already exists.") {
    return new https_1.HttpsError("already-exists", message);
}
function isHttpsErrorCode(error, code) {
    if (error instanceof https_1.HttpsError) {
        return error.code === code;
    }
    return typeof error === "object" && error !== null &&
        error.code === code;
}
async function findExistingSchoolIdDocument(collectionName, schoolId, schoolIdKey) {
    var _a, _b;
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
        const keyedData = (_a = keyedDoc.data()) !== null && _a !== void 0 ? _a : {};
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
    const exactData = (_b = exactDoc.data()) !== null && _b !== void 0 ? _b : {};
    return {
        uid: exactDoc.id,
        schoolId: normalizeText(exactData.schoolId) || schoolId,
        role: normalizeText(exactData.role),
    };
}
async function syncStudentSchoolIdIndex(schoolId, schoolIdKey, uid, source) {
    await studentSchoolIdIndexRef(schoolIdKey).set({
        schoolId,
        schoolIdKey,
        uid,
        role: "student",
        status: "active",
        source,
        updatedAt: serverTimestamp(),
        activatedAt: serverTimestamp(),
    }, { merge: true });
}
async function findExistingStudentSchoolId(schoolId) {
    var _a;
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
        await syncStudentSchoolIdIndex(profileMatch.schoolId, schoolIdKey, profileMatch.uid, "profile");
        return {
            schoolId: profileMatch.schoolId,
            schoolIdKey,
            uid: profileMatch.uid,
            source: "profile",
        };
    }
    if (studentMatch) {
        await syncStudentSchoolIdIndex(studentMatch.schoolId, schoolIdKey, studentMatch.uid, "student");
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
    const indexData = (_a = indexSnapshot.data()) !== null && _a !== void 0 ? _a : {};
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
async function reserveUniqueStudentSchoolId(schoolId, source) {
    const normalizedSchoolId = normalizeText(schoolId);
    const schoolIdKey = normalizeSchoolIdKey(normalizedSchoolId);
    if (!normalizedSchoolId || !schoolIdKey) {
        throw new https_1.HttpsError("invalid-argument", "School ID is required.");
    }
    const existingMatch = await findExistingStudentSchoolId(normalizedSchoolId);
    if (existingMatch) {
        const duplicateMessage = existingMatch.source === "reservation" ?
            "School ID is already being created. Please try again." :
            "School ID already exists.";
        throw schoolIdAlreadyExistsError(duplicateMessage);
    }
    const indexRef = studentSchoolIdIndexRef(schoolIdKey);
    const reservedAtMs = Date.now();
    await db.runTransaction(async (transaction) => {
        var _a;
        const reservationSnapshot = await transaction.get(indexRef);
        if (reservationSnapshot.exists) {
            const reservationData = (_a = reservationSnapshot.data()) !== null && _a !== void 0 ? _a : {};
            const reservationUid = normalizeText(reservationData.uid);
            const reservationStatus = normalizeLower(reservationData.status);
            const previousReservedAtMs = toPositiveNumber(reservationData.reservedAtMs);
            const isStaleReservation = previousReservedAtMs > 0 &&
                Date.now() - previousReservedAtMs > STUDENT_SCHOOL_ID_RESERVATION_TTL_MS;
            if (reservationUid || reservationStatus === "active" || !isStaleReservation) {
                throw schoolIdAlreadyExistsError(reservationUid || reservationStatus === "active" ?
                    "School ID already exists." :
                    "School ID is already being created. Please try again.");
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
        }, { merge: true });
    });
    return {
        schoolId: normalizedSchoolId,
        schoolIdKey,
        activate: async (uid) => {
            await indexRef.set({
                schoolId: normalizedSchoolId,
                schoolIdKey,
                uid,
                role: "student",
                status: "active",
                source,
                updatedAt: serverTimestamp(),
                activatedAt: serverTimestamp(),
            }, { merge: true });
        },
        release: async () => {
            await indexRef.delete().catch(() => undefined);
        },
    };
}
async function fetchExistingStudentSchoolIds(schoolIds) {
    const normalizedIds = Array.from(new Set(schoolIds.map((value) => normalizeText(value)).filter(Boolean)));
    const existing = new Set();
    if (normalizedIds.length === 0) {
        return existing;
    }
    const indexedIdsByKey = new Map();
    normalizedIds.forEach((schoolId) => {
        indexedIdsByKey.set(normalizeSchoolIdKey(schoolId), schoolId);
    });
    for (let i = 0; i < normalizedIds.length; i += 10) {
        const chunk = normalizedIds.slice(i, i + 10);
        const chunkKeys = chunk.map((schoolId) => normalizeSchoolIdKey(schoolId));
        const chunkLookup = new Map();
        chunk.forEach((schoolId) => {
            chunkLookup.set(normalizeSchoolIdKey(schoolId), schoolId);
        });
        const indexSnapshots = await db.getAll(...chunkKeys.map((schoolIdKey) => studentSchoolIdIndexRef(schoolIdKey)));
        indexSnapshots.forEach((snapshot, index) => {
            var _a;
            if (!snapshot.exists) {
                return;
            }
            const data = (_a = snapshot.data()) !== null && _a !== void 0 ? _a : {};
            const indexedUid = normalizeText(data.uid);
            const indexedStatus = normalizeLower(data.status);
            const reservedAtMs = toPositiveNumber(data.reservedAtMs);
            if (indexedUid ||
                indexedStatus === "active" ||
                (reservedAtMs &&
                    Date.now() - reservedAtMs <= STUDENT_SCHOOL_ID_RESERVATION_TTL_MS)) {
                existing.add(chunk[index]);
            }
        });
        const [profileSchoolIdSnapshot, profileKeySnapshot, studentSchoolIdSnapshot, studentKeySnapshot,] = await Promise.all([
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
                var _a;
                const data = (_a = doc.data()) !== null && _a !== void 0 ? _a : {};
                const docSchoolId = normalizeText(data.schoolId);
                const docSchoolIdKey = normalizeSchoolIdKey(data.schoolIdKey || data.schoolId);
                const matchedSchoolId = chunkLookup.get(docSchoolIdKey) ||
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
function resolveDuplicateStudentRecordName(data) {
    const firstName = normalizeNamePart(data.firstName);
    const lastName = normalizeNamePart(data.lastName);
    const combinedName = buildStudentFullName(firstName, lastName);
    return (combinedName ||
        normalizeNamePart(data.fullName) ||
        normalizeNamePart(data.studentName) ||
        normalizeNamePart(data.name));
}
function sortDuplicateStudentRecords(left, right) {
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
function duplicateEntrySourceToIndexSource(source) {
    return source === "profile" ? "profile" : "student";
}
async function buildDuplicateStudentSchoolIdReport(limit = Number.MAX_SAFE_INTEGER) {
    const [profileSnapshot, studentSnapshot] = await Promise.all([
        db.collection("profiles").where("role", "==", "student").get(),
        db.collection("students").get(),
    ]);
    const mergedRecords = new Map();
    profileSnapshot.docs.forEach((profileDoc) => {
        var _a;
        const profileData = (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {};
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
        var _a;
        const studentData = (_a = studentDoc.data()) !== null && _a !== void 0 ? _a : {};
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
    const groupedDuplicates = new Map();
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
        };
    })
        .sort((left, right) => {
        if (right.count !== left.count) {
            return right.count - left.count;
        }
        return left.schoolId.localeCompare(right.schoolId);
    });
    const duplicateEntryCount = duplicates.reduce((total, group) => total + group.count, 0);
    const cleanupCandidateCount = duplicates.reduce((total, group) => total + group.cleanupCandidateCount, 0);
    return {
        duplicateGroupCount: duplicates.length,
        duplicateEntryCount,
        cleanupCandidateCount,
        duplicates: duplicates.slice(0, limit),
    };
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
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
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
    const requiresStudentSchoolIdGuard = role === "student";
    let schoolIdReservation = null;
    let createdUid = null;
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
            schoolIdReservation = await reserveUniqueStudentSchoolId(schoolId, "admin_create_student");
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
        const profilePayload = {
            name,
            schoolId,
            schoolIdKey,
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
        if (role === "student") {
            const studentBatch = db.batch();
            studentBatch.set(db.doc(`profiles/${uid}`), profilePayload, { merge: true });
            studentBatch.set(db.doc(`students/${uid}`), {
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
            }, { merge: true });
            await studentBatch.commit();
        }
        else {
            await db.doc(`profiles/${uid}`).set(profilePayload, { merge: true });
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
            actorUid: normalizeText((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid),
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
        return { uid };
    }
    catch (error) {
        const authError = error;
        if (createdUid) {
            await admin.auth().deleteUser(createdUid).catch(() => undefined);
        }
        if (schoolIdReservation) {
            await schoolIdReservation.release();
        }
        authLogger.warn("adminCreateUser failed", {
            role,
            schoolId,
            code: (_c = authError.code) !== null && _c !== void 0 ? _c : "unknown",
            message: (_d = authError.message) !== null && _d !== void 0 ? _d : "Unknown account creation failure",
        });
        if (isHttpsErrorCode(error, "already-exists")) {
            throw schoolIdAlreadyExistsError(authError.message || "School ID already exists.");
        }
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
async function adminBulkImportStudentsLogic(context) {
    var _a, _b, _c;
    await requireAdmin({ auth: context.auth });
    const body = asRecord(context.data);
    const filename = normalizeText(body.filename) || "student-import.csv";
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const requestInputSchema = normalizeBulkStudentImportInputSchema(body.inputSchema) || undefined;
    const previewOnly = body.previewOnly === true;
    const actorUid = context.auth.uid;
    const callerProfileSnap = await db.doc(`profiles/${actorUid}`).get();
    const actorSchoolId = normalizeText((_a = callerProfileSnap.data()) === null || _a === void 0 ? void 0 : _a.schoolId);
    const timestamp = serverTimestamp();
    const validatedRows = rows.map((rawRow, index) => {
        const row = asRecord(rawRow);
        const nameSchema = resolveBulkStudentImportInputSchema(row, requestInputSchema);
        const schoolId = normalizeText(row.schoolId);
        const lastName = normalizeNamePart(row.lastName);
        const firstName = normalizeNamePart(row.firstName);
        const legacyFullName = resolveBulkImportFullName(row);
        const course = normalizeCourseLabel(row.course);
        const yearLevelRaw = normalizeText(row.yearLevel);
        const status = normalizeBulkStudentStatus(row.status);
        const normalizedYear = normalizeYear(yearLevelRaw);
        const errors = [];
        if (!schoolId) {
            errors.push("SchoolId is required.");
        }
        else if (!isValidBulkSchoolId(schoolId)) {
            errors.push("SchoolId must be alphanumeric and at least 4 characters.");
        }
        if (nameSchema === "legacy") {
            if (!legacyFullName) {
                errors.push("FullName is required.");
            }
        }
        else {
            if (!lastName)
                errors.push("LastName is required.");
            if (!firstName)
                errors.push("FirstName is required.");
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
    const existingSchoolIds = await fetchExistingStudentSchoolIds(uniqueSchoolIds);
    const finalResults = validatedRows.map((row) => (Object.assign({}, row)));
    finalResults.forEach((row) => {
        const errors = Array.isArray(row.errors) ? [...row.errors] : [];
        if (row.schoolId && schoolIdCounts.get(row.schoolId) > 1) {
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
            inputSchema: requestInputSchema ||
                ((_b = finalResults[0]) === null || _b === void 0 ? void 0 : _b.nameSchema) ||
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
        let createdUid = null;
        let schoolIdReservation = null;
        try {
            // Import uses the same reservation/index as manual creation so a row
            // previewed as valid cannot create a duplicate UID during final submit.
            schoolIdReservation = await reserveUniqueStudentSchoolId(resultRow.schoolId, "bulk_student_import");
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
            const profilePayload = {
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
            studentBatch.set(db.doc(`profiles/${uid}`), profilePayload, { merge: true });
            studentBatch.set(db.doc(`students/${uid}`), {
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
            }, { merge: true });
            await studentBatch.commit();
            resultRow.success = true;
            resultRow.uid = uid;
            importedCount += 1;
        }
        catch (error) {
            const authError = error;
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
        inputSchema: requestInputSchema ||
            ((_c = finalResults[0]) === null || _c === void 0 ? void 0 : _c.nameSchema) ||
            "split",
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
    var _a, _b, _c;
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
    const profileData = (_b = profileSnap.data()) !== null && _b !== void 0 ? _b : {};
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
        actorUid: normalizeText((_c = request.auth) === null || _c === void 0 ? void 0 : _c.uid),
        targetUid: uid,
        targetSchoolId: schoolId || null,
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
exports.adminFindDuplicateStudentSchoolIds = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    await requireAdmin(request);
    const body = asRecord(request.data);
    const requestedLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ?
        Math.min(requestedLimit, 5000) :
        50;
    const report = await buildDuplicateStudentSchoolIdReport(limit);
    await db.collection("logs").add({
        action: "ADMIN_FIND_DUPLICATE_STUDENT_SCHOOL_IDS",
        actorUid: normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid),
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
exports.adminDeleteDuplicateStudentSchoolIds = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    await requireAdmin(request);
    const actorUid = normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid);
    const report = await buildDuplicateStudentSchoolIdReport();
    if (report.duplicateGroupCount === 0) {
        return {
            duplicateGroupCount: 0,
            keptCount: 0,
            deletedCount: 0,
            deletedAuthCount: 0,
            failedCount: 0,
            failureDetails: [],
        };
    }
    let deletedCount = 0;
    let deletedAuthCount = 0;
    let failedCount = 0;
    const failureDetails = [];
    for (const group of report.duplicates) {
        const primaryEntry = group.entries.find((entry) => entry.isPrimary) || group.entries[0];
        for (const duplicateEntry of group.entries.filter((entry) => !entry.isPrimary)) {
            let deletedAuthUser = false;
            try {
                try {
                    await admin.auth().deleteUser(duplicateEntry.uid);
                    deletedAuthUser = true;
                    deletedAuthCount += 1;
                }
                catch (error) {
                    const authError = error;
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
            }
            catch (error) {
                failedCount += 1;
                const failureMessage = `${group.schoolId} (${duplicateEntry.uid}): ${error instanceof Error ? error.message : "Cleanup failed."}`;
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
        await syncStudentSchoolIdIndex(group.schoolId, group.schoolIdKey, primaryEntry.uid, duplicateEntrySourceToIndexSource(primaryEntry.source)).catch((error) => {
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
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
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
    let schoolIdReservation = null;
    let createdUid = null;
    try {
        schoolIdReservation = await reserveUniqueStudentSchoolId(schoolId, "ec_create_student");
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
        studentBatch.set(db.doc(`profiles/${uid}`), {
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
        }, { merge: true });
        studentBatch.set(db.doc(`students/${uid}`), {
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
        }, { merge: true });
        await studentBatch.commit();
        await db.collection("logs").add({
            action: "ec_create_student",
            actorUid: normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid),
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
        return { uid };
    }
    catch (error) {
        const authError = error;
        if (createdUid) {
            await admin.auth().deleteUser(createdUid).catch(() => undefined);
        }
        if (schoolIdReservation) {
            await schoolIdReservation.release();
        }
        if (isHttpsErrorCode(error, "already-exists")) {
            throw schoolIdAlreadyExistsError(authError.message || "School ID already exists.");
        }
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