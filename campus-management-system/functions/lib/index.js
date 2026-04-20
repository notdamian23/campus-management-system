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
exports.auditEventDeletes = exports.auditEventUpdates = exports.auditEventCreates = exports.auditStudentWrites = exports.studentManagePreRegistration = exports.logPermissionDeniedAttempt = exports.adminUpsertPortableDevice = exports.finalizeVerifiedCampusProfile = exports.savePendingEmailVerification = exports.getCurrentCampusProfile = exports.resolveSchoolIdLogin = exports.updateCampusEvent = exports.createCampusEvent = exports.closeFingerprintEnrollmentSession = exports.createFingerprintEnrollmentSession = exports.getFingerprintEnrollmentSessionDetail = exports.listFingerprintEnrollmentSessions = exports.deleteCampusDocument = exports.createCampusDocumentMetadata = exports.updateStudentClearanceStatus = exports.updateStudentAccountStatus = exports.updateCampusStudentProfile = exports.createCampusStudent = exports.ecCreateStudent = exports.ecListStudents = exports.adminManageFingerprintCleanup = exports.adminBuildFingerprintMappingsFromProfiles = exports.adminListFingerprintCleanupMappings = exports.adminDeleteDuplicateStudentSchoolIds = exports.adminFindDuplicateStudentSchoolIds = exports.adminDeactivateAllStudents = exports.adminDeleteUser = exports.adminBulkImportStudents = exports.adminCreateUser = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
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
const STUDENT_ONLY_LOOKUP_PROFILE_ROLES = ["student"];
const STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES = [
    "student",
    "ec",
    "ecmember",
];
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
    cpe: "Computer Engineering",
    ie: "Industrial Engineering",
    ee: "Electrical Engineering",
    me: "Mechanical Engineering",
    ece: "Electronics Engineering",
};
const COURSE_CODE_TO_SCOPE = {
    CPE: "Computer Engineering",
    IE: "Industrial Engineering",
    EE: "Electrical Engineering",
    ME: "Mechanical Engineering",
    ECE: "Electronics Engineering",
};
const COURSE_SCOPE_TO_CODE = Object.entries(COURSE_CODE_TO_SCOPE).reduce((lookup, [code, course]) => {
    lookup[course] = code;
    return lookup;
}, {});
const BOD_POSITION_TO_COURSE_SCOPE = {
    "B.O.D. (ME)": "Mechanical Engineering",
    "B.O.D. (EE)": "Electrical Engineering",
    "B.O.D. (IE)": "Industrial Engineering",
    "B.O.D. (CPE)": "Computer Engineering",
    "B.O.D. (ECE)": "Electronics Engineering",
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
function isEcRole(role) {
    const normalized = String(role !== null && role !== void 0 ? role : "").trim().toLowerCase();
    return normalized === "ec" || normalized === "ecmember";
}
function isStudentAudienceRole(value) {
    const normalized = normalizeLower(value);
    return normalized === "student" || isEcRole(value);
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
function normalizeAssignedCourseCode(value) {
    var _a;
    const normalized = normalizeText(value).toUpperCase();
    if (normalized && COURSE_CODE_TO_SCOPE[normalized]) {
        return normalized;
    }
    const normalizedCourse = normalizeCourseLabel(value);
    return normalizedCourse ? ((_a = COURSE_SCOPE_TO_CODE[normalizedCourse]) !== null && _a !== void 0 ? _a : "") : "";
}
function normalizeCampusRoleValue(value) {
    const normalized = normalizeLower(value);
    if (!normalized) {
        return "";
    }
    const compact = normalized.replace(/[^a-z]/g, "");
    if (compact === "admin")
        return "admin";
    if (compact === "teacher")
        return "teacher";
    if (compact === "student")
        return "student";
    if (isEcRole(compact) || compact === "ecmemberprofile") {
        return "ecmember";
    }
    return "";
}
function isECMemberRole(value) {
    return isEcRole(value) || normalizeCampusRoleValue(value) === "ecmember";
}
function normalizeECPosition(value) {
    const position = normalizeText(value);
    if (!position) {
        return "";
    }
    const exact = Object.keys(BOD_POSITION_TO_COURSE_SCOPE).find((item) => normalizeLower(item) === normalizeLower(position));
    return exact !== null && exact !== void 0 ? exact : position;
}
function inferCourseScopeFromPosition(value) {
    var _a;
    const normalizedPosition = normalizeECPosition(value);
    return (_a = BOD_POSITION_TO_COURSE_SCOPE[normalizedPosition]) !== null && _a !== void 0 ? _a : "";
}
function extractAssignedCourseFromPosition(value) {
    const match = normalizeText(value).match(/^B\.O\.D\.\s*\(([A-Za-z]+)\)$/i);
    if (!match) {
        return "";
    }
    return normalizeAssignedCourseCode(match[1]);
}
function normalizeEcScope(value) {
    const normalized = normalizeLower(value);
    if (normalized === "all")
        return "all";
    if (normalized === "course")
        return "course";
    return "";
}
function resolveAssignedCourseCode(data) {
    return (normalizeAssignedCourseCode(data.assignedCourse) ||
        extractAssignedCourseFromPosition(data.ecPosition) ||
        normalizeAssignedCourseCode(data.courseScope));
}
function resolveProfileEcScope(data) {
    if (!isECMemberRole(data.role)) {
        return "";
    }
    const explicitScope = normalizeEcScope(data.ecScope);
    if (explicitScope) {
        return explicitScope;
    }
    return resolveAssignedCourseCode(data) ? "course" : "all";
}
function resolveProfileCourseScope(data) {
    var _a;
    const assignedCourseCode = resolveAssignedCourseCode(data);
    if (resolveProfileEcScope(data) === "course" && assignedCourseCode) {
        return (_a = COURSE_CODE_TO_SCOPE[assignedCourseCode]) !== null && _a !== void 0 ? _a : "";
    }
    if (resolveProfileEcScope(data) === "all") {
        return "";
    }
    return (normalizeCourseLabel(data.courseScope) ||
        inferCourseScopeFromPosition(data.ecPosition));
}
function isBodProfileData(data) {
    const explicitEcScope = normalizeEcScope(data.ecScope);
    if (!isECMemberRole(data.role) || explicitEcScope === "all") {
        return false;
    }
    return isECMemberRole(data.role) &&
        (resolveProfileEcScope(data) === "course" ||
            data.isBod === true ||
            Boolean(inferCourseScopeFromPosition(data.ecPosition)));
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
function extractFingerprintTemplateId(data) {
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
        const parsed = Number(candidate !== null && candidate !== void 0 ? candidate : 0);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.trunc(parsed);
        }
    }
    return 0;
}
function extractFingerprintStatus(data) {
    if (!data) {
        return "";
    }
    return (normalizeText(data.fingerprintStatus) ||
        normalizeText(asRecord(data.fingerprint).status) ||
        normalizeText(asRecord(data.fingerprint).fingerprintStatus));
}
function extractFingerprintEnrolledAt(data) {
    var _a, _b, _c, _d, _e;
    if (!data) {
        return null;
    }
    const fingerprintData = asRecord(data.fingerprint);
    return ((_e = (_d = (_c = (_b = (_a = data.fingerprintEnrolledAt) !== null && _a !== void 0 ? _a : data.enrolledAt) !== null && _b !== void 0 ? _b : fingerprintData.enrolledAt) !== null && _c !== void 0 ? _c : fingerprintData.fingerprintEnrolledAt) !== null && _d !== void 0 ? _d : data.updatedAt) !== null && _e !== void 0 ? _e : data.createdAt);
}
function emptyFingerprintCleanupReport(overrides) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
    const summary = {
        total: (_b = (_a = overrides === null || overrides === void 0 ? void 0 : overrides.summary) === null || _a === void 0 ? void 0 : _a.total) !== null && _b !== void 0 ? _b : 0,
        active: (_d = (_c = overrides === null || overrides === void 0 ? void 0 : overrides.summary) === null || _c === void 0 ? void 0 : _c.active) !== null && _d !== void 0 ? _d : 0,
        stale: (_f = (_e = overrides === null || overrides === void 0 ? void 0 : overrides.summary) === null || _e === void 0 ? void 0 : _e.stale) !== null && _f !== void 0 ? _f : 0,
        duplicate: (_h = (_g = overrides === null || overrides === void 0 ? void 0 : overrides.summary) === null || _g === void 0 ? void 0 : _g.duplicate) !== null && _h !== void 0 ? _h : 0,
        needsReenrollment: (_k = (_j = overrides === null || overrides === void 0 ? void 0 : overrides.summary) === null || _j === void 0 ? void 0 : _j.needsReenrollment) !== null && _k !== void 0 ? _k : 0,
    };
    return {
        generatedAtMs: (_l = overrides === null || overrides === void 0 ? void 0 : overrides.generatedAtMs) !== null && _l !== void 0 ? _l : Date.now(),
        summary,
        totalMappings: (_m = overrides === null || overrides === void 0 ? void 0 : overrides.totalMappings) !== null && _m !== void 0 ? _m : summary.total,
        activeMappings: (_o = overrides === null || overrides === void 0 ? void 0 : overrides.activeMappings) !== null && _o !== void 0 ? _o : summary.active,
        staleMappings: (_p = overrides === null || overrides === void 0 ? void 0 : overrides.staleMappings) !== null && _p !== void 0 ? _p : summary.stale,
        duplicateMappings: (_q = overrides === null || overrides === void 0 ? void 0 : overrides.duplicateMappings) !== null && _q !== void 0 ? _q : summary.duplicate,
        needsReenrollment: (_r = overrides === null || overrides === void 0 ? void 0 : overrides.needsReenrollment) !== null && _r !== void 0 ? _r : summary.needsReenrollment,
        source: (_s = overrides === null || overrides === void 0 ? void 0 : overrides.source) !== null && _s !== void 0 ? _s : "empty",
        fallbackUsed: (_t = overrides === null || overrides === void 0 ? void 0 : overrides.fallbackUsed) !== null && _t !== void 0 ? _t : false,
        emptyMessage: (_u = overrides === null || overrides === void 0 ? void 0 : overrides.emptyMessage) !== null && _u !== void 0 ? _u : "No fingerprint mappings found yet. Existing AS608 templates may still be on the device, but the web app has no mapping records. Run module sync or build mappings from profiles.",
        mappings: (_v = overrides === null || overrides === void 0 ? void 0 : overrides.mappings) !== null && _v !== void 0 ? _v : [],
    };
}
function resolveFingerprintRecordName(data) {
    if (!data) {
        return "";
    }
    return (resolveDuplicateStudentRecordName(data) ||
        normalizeNamePart(data.fullName) ||
        normalizeNamePart(data.displayName) ||
        normalizeNamePart(data.teacherName));
}
function createFingerprintMappingRowId(templateId, uid) {
    return `${templateId}:${uid || "unknown"}`;
}
function getOrCreateFingerprintCleanupMapping(mappings, templateId, uid, schoolId) {
    const normalizedUid = uid || schoolId || `template-${templateId}`;
    const rowId = createFingerprintMappingRowId(templateId, normalizedUid);
    const existing = mappings.get(rowId);
    if (existing) {
        if (!existing.schoolId && schoolId) {
            existing.schoolId = schoolId;
        }
        return existing;
    }
    const created = {
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
        sourceSet: new Set(),
    };
    mappings.set(rowId, created);
    return created;
}
function isFingerprintMappingPotentiallyActive(mapping) {
    const profileStatus = normalizeLower(mapping.profileStatus);
    const profileRole = normalizeLower(mapping.profileRole);
    const fingerprintStatus = normalizeLower(mapping.fingerprintStatus || mapping.templateDocStatus);
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
    if (fingerprintStatus === "needs_reenrollment" ||
        fingerprintStatus === "stale" ||
        fingerprintStatus === "inactive" ||
        fingerprintStatus === "deleted") {
        return false;
    }
    if (mapping.templateDocActive === false) {
        return false;
    }
    return true;
}
async function buildFingerprintCleanupReport() {
    const [templateSnapshot, profileSnapshot, studentSnapshot] = await Promise.all([
        db.collection("fingerprintTemplates").get(),
        db.collection("profiles").get(),
        db.collection("students").get(),
    ]);
    const mappings = new Map();
    let needsReenrollment = 0;
    profileSnapshot.docs.forEach((profileDoc) => {
        var _a, _b;
        const profileData = (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {};
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
        const mapping = getOrCreateFingerprintCleanupMapping(mappings, templateId, profileDoc.id, schoolId);
        mapping.hasProfile = true;
        mapping.profileStatus = normalizeText(profileData.status) || mapping.profileStatus;
        mapping.profileRole = normalizeText(profileData.role) || mapping.profileRole;
        mapping.studentName =
            resolveFingerprintRecordName(profileData) || mapping.studentName || schoolId;
        mapping.course = normalizeText(profileData.course) || mapping.course || "Unassigned";
        mapping.yearLevel =
            normalizeYear((_b = profileData.yearLevel) !== null && _b !== void 0 ? _b : profileData.year) ||
                mapping.yearLevel ||
                "Unassigned";
        mapping.fingerprintStatus = fingerprintStatus || mapping.fingerprintStatus;
        mapping.lastEnrolledAtMs = Math.max(mapping.lastEnrolledAtMs, toMillis(extractFingerprintEnrolledAt(profileData)));
        mapping.sourceSet.add("profile");
    });
    studentSnapshot.docs.forEach((studentDoc) => {
        var _a, _b;
        const studentData = (_a = studentDoc.data()) !== null && _a !== void 0 ? _a : {};
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
        const mapping = getOrCreateFingerprintCleanupMapping(mappings, templateId, studentDoc.id, schoolId);
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
                normalizeYear((_b = studentData.yearLevel) !== null && _b !== void 0 ? _b : studentData.year) || "Unassigned";
        }
        if (!mapping.profileStatus) {
            mapping.profileStatus = normalizeText(studentData.status);
        }
        mapping.fingerprintStatus = fingerprintStatus || mapping.fingerprintStatus;
        mapping.lastEnrolledAtMs = Math.max(mapping.lastEnrolledAtMs, toMillis(extractFingerprintEnrolledAt(studentData)));
        mapping.sourceSet.add("student_projection");
    });
    templateSnapshot.docs.forEach((templateDoc) => {
        var _a, _b, _c, _d, _e;
        const templateData = (_a = templateDoc.data()) !== null && _a !== void 0 ? _a : {};
        const templateId = extractFingerprintTemplateId(templateData) ||
            toPositiveNumber(templateDoc.id);
        const uid = normalizeText(templateData.uid) ||
            normalizeText(templateData.studentUid) ||
            normalizeText(templateData.studentId);
        const schoolId = normalizeText(templateData.schoolId) || uid || templateDoc.id;
        if (templateId <= 0) {
            return;
        }
        const mapping = getOrCreateFingerprintCleanupMapping(mappings, templateId, uid, schoolId);
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
                normalizeYear((_b = templateData.yearLevel) !== null && _b !== void 0 ? _b : templateData.year) || "Unassigned";
        }
        if (!mapping.fingerprintStatus) {
            mapping.fingerprintStatus =
                extractFingerprintStatus(templateData) || mapping.templateDocStatus;
        }
        mapping.lastEnrolledAtMs = Math.max(mapping.lastEnrolledAtMs, toMillis((_e = (_d = (_c = templateData.enrolledAt) !== null && _c !== void 0 ? _c : extractFingerprintEnrolledAt(templateData)) !== null && _d !== void 0 ? _d : templateData.updatedAt) !== null && _e !== void 0 ? _e : templateData.createdAt));
        mapping.sourceSet.add("fingerprint_template");
    });
    const templateCounts = new Map();
    const schoolTemplateSets = new Map();
    mappings.forEach((mapping) => {
        var _a;
        if (mapping.templateId > 0) {
            templateCounts.set(mapping.templateId, ((_a = templateCounts.get(mapping.templateId)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
        if (mapping.schoolId && isFingerprintMappingPotentiallyActive(mapping)) {
            const current = schoolTemplateSets.get(mapping.schoolId) || new Set();
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
        var _a, _b, _c;
        const profileStatus = normalizeLower(mapping.profileStatus);
        const fingerprintStatus = normalizeLower(mapping.fingerprintStatus || mapping.templateDocStatus);
        const duplicateTemplateCount = (_a = templateCounts.get(mapping.templateId)) !== null && _a !== void 0 ? _a : 0;
        const duplicateSchoolIdCount = (_c = (_b = schoolTemplateSets.get(mapping.schoolId)) === null || _b === void 0 ? void 0 : _b.size) !== null && _c !== void 0 ? _c : 0;
        const duplicateReasons = [];
        if (duplicateTemplateCount > 1) {
            duplicateReasons.push("template_shared");
        }
        if (duplicateSchoolIdCount > 1) {
            duplicateReasons.push("multiple_templates_for_school");
        }
        const isDeleted = profileStatus === "deleted" || fingerprintStatus === "deleted";
        const isMissingProfile = !mapping.hasProfile;
        const needsReenrollmentStatus = fingerprintStatus === "needs_reenrollment";
        const isStale = !isDeleted &&
            !isMissingProfile &&
            (profileStatus === "inactive" ||
                profileStatus === "disabled" ||
                fingerprintStatus === "stale" ||
                fingerprintStatus === "inactive" ||
                mapping.templateDocActive === false ||
                !mapping.hasStudentProjection);
        const isDuplicate = duplicateReasons.length > 0;
        let mappingStatus = "active";
        if (isDeleted) {
            mappingStatus = "deleted";
        }
        else if (isMissingProfile) {
            mappingStatus = "missing_profile";
        }
        else if (isDuplicate) {
            mappingStatus = "duplicate";
        }
        else if (needsReenrollmentStatus) {
            mappingStatus = "needs_reenrollment";
        }
        else if (isStale) {
            mappingStatus = "stale";
        }
        if (mappingStatus === "active") {
            activeMappings += 1;
        }
        if (mappingStatus === "stale" ||
            mappingStatus === "deleted" ||
            mappingStatus === "missing_profile") {
            staleMappings += 1;
        }
        if (mappingStatus === "duplicate") {
            duplicateMappings += 1;
        }
        const requiresReenrollment = fingerprintStatus === "needs_reenrollment" ||
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
            fingerprintStatus: mapping.fingerprintStatus ||
                mapping.templateDocStatus ||
                (mapping.templateDocActive ? "active" : "stale"),
            lastEnrolledAtMs: mapping.lastEnrolledAtMs,
            duplicateTemplateCount,
            duplicateSchoolIdCount,
            duplicateReasons,
            sources: Array.from(mapping.sourceSet).sort(),
            canRemoveStale: mappingStatus === "stale" ||
                mappingStatus === "deleted" ||
                mappingStatus === "missing_profile",
            canRemoveMapping: true,
            canKeepTemplateOwner: duplicateTemplateCount > 1 &&
                isFingerprintMappingPotentiallyActive(mapping),
            needsReenrollment: requiresReenrollment,
        };
    })
        .sort((left, right) => {
        if (left.templateId !== right.templateId) {
            return left.templateId - right.templateId;
        }
        return left.studentName.localeCompare(right.studentName);
    });
    const templateBackedCount = resolvedMappings.filter((mapping) => mapping.sources.includes("fingerprint_template")).length;
    const fallbackBackedCount = resolvedMappings.filter((mapping) => !mapping.sources.includes("fingerprint_template")).length;
    const source = resolvedMappings.length === 0 && needsReenrollment === 0 ?
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
function optionalBoolean(value) {
    if (value === true)
        return true;
    if (value === false)
        return false;
    return undefined;
}
function buildCampusProfilePayload(data) {
    return {
        role: normalizeCampusRoleValue(data.role) || optionalText(data.role),
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
        ecScope: data.ecScope === null ?
            null :
            (resolveProfileEcScope(data) || null),
        assignedCourse: data.assignedCourse === null ?
            null :
            (resolveProfileEcScope(data) === "course" ?
                (resolveAssignedCourseCode(data) || null) :
                null),
        courseScope: data.courseScope === null ? null : optionalText(data.courseScope) || null,
        year: optionalText(data.year) || optionalText(data.yearLevel),
        yearLevel: optionalText(data.yearLevel) || optionalText(data.year),
        readyForClearance: optionalBoolean(data.readyForClearance),
        ecPosition: optionalText(data.ecPosition),
        isBod: optionalBoolean(data.isBod),
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
function normalizeIdentifierList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => normalizeText(item)).filter(Boolean);
}
function hasExplicitSelectedAudience(event) {
    return normalizeIdentifierList(event.selectedStudentIds).length > 0 ||
        normalizeIdentifierList(event.selectedSchoolIds).length > 0;
}
function matchesSelectedAudience(event, studentId, schoolId) {
    if (!hasExplicitSelectedAudience(event)) {
        return true;
    }
    const selectedStudentIds = normalizeIdentifierList(event.selectedStudentIds);
    const selectedSchoolIds = normalizeIdentifierList(event.selectedSchoolIds);
    const normalizedStudentId = normalizeLower(studentId);
    const normalizedSchoolId = normalizeLower(schoolId);
    return selectedStudentIds.some((value) => normalizeLower(value) === normalizedStudentId) ||
        selectedSchoolIds.some((value) => normalizeLower(value) === normalizedSchoolId);
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
async function callerProfileData(context) {
    var _a;
    if (!context.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    const callerProfileSnap = await db.doc(`profiles/${context.auth.uid}`).get();
    return callerProfileSnap.exists ? ((_a = callerProfileSnap.data()) !== null && _a !== void 0 ? _a : {}) : {};
}
async function requireAdmin(context) {
    const role = await callerRole(context);
    if (role !== "admin") {
        throw new https_1.HttpsError("permission-denied", "Admin only.");
    }
}
async function requireAdminOrEC(context) {
    const role = await callerRole(context);
    if (role !== "admin" && !isECMemberRole(role)) {
        throw new https_1.HttpsError("permission-denied", "EC/Admin only.");
    }
}
function ensureBodCourseScopeAccess(actorProfile, targetCourse, message) {
    if (!isBodProfileData(actorProfile)) {
        return;
    }
    const actorCourseScope = resolveProfileCourseScope(actorProfile);
    const normalizedTargetCourse = normalizeCourseLabel(targetCourse);
    if (!actorCourseScope || actorCourseScope !== normalizedTargetCourse) {
        throw new https_1.HttpsError("permission-denied", message);
    }
}
function resolveProfileDisplayName(data) {
    return (normalizeText(data.name) ||
        normalizeText(data.fullName) ||
        normalizeText(data.studentName) ||
        normalizeText(data.teacherName) ||
        buildStudentFullName(data.firstName, data.lastName) ||
        normalizeText(data.schoolId) ||
        "Unknown User");
}
function resolveActorPosition(data) {
    if (isECMemberRole(data.role)) {
        return normalizeECPosition(data.ecPosition) || "EC Member";
    }
    const normalizedRole = normalizeText(data.role);
    if (!normalizedRole) {
        return "";
    }
    return normalizedRole[0].toUpperCase() + normalizedRole.slice(1);
}
async function writeStructuredAuditLog(input) {
    var _a, _b;
    const actorUid = normalizeText(input.actorUid);
    const actorProfile = actorUid ?
        ((_a = (await db.doc(`profiles/${actorUid}`).get()).data()) !== null && _a !== void 0 ? _a : {}) :
        {};
    await db.collection("logs").add({
        actorUid: actorUid || null,
        actorName: resolveProfileDisplayName(actorProfile),
        actorPosition: resolveActorPosition(actorProfile),
        actorCourseScope: resolveProfileCourseScope(actorProfile) || null,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        metadata: (_b = input.metadata) !== null && _b !== void 0 ? _b : {},
        createdAt: serverTimestamp(),
    });
}
function shouldSkipAuthContextAudit(event) {
    if (!normalizeText(event.authId)) {
        return true;
    }
    const authType = normalizeLower(event.authType);
    return authType === "service_account" ||
        authType === "system" ||
        authType === "unauthenticated";
}
exports.adminCreateUser = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d, _e;
    await requireAdmin(request);
    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const role = normalizeCampusRoleValue(body.role);
    const emailRaw = normalizeText(body.email);
    const name = normalizeText(body.name) ||
        normalizeText(body.teacherName) ||
        normalizeText(body.studentName);
    const requestedEcPosition = normalizeECPosition(body.ecPosition);
    const requestedEcScope = normalizeEcScope(body.ecScope);
    const requestedAssignedCourse = normalizeAssignedCourseCode(body.assignedCourse);
    const inferredCourseScope = inferCourseScopeFromPosition(requestedEcPosition);
    const inferredAssignedCourse = extractAssignedCourseFromPosition(requestedEcPosition);
    const bodAssignedCourse = requestedAssignedCourse || inferredAssignedCourse;
    const isBod = role === "ecmember" &&
        (requestedEcScope === "course" ||
            requestedEcPosition === "B.O.D." ||
            Boolean(inferredCourseScope) ||
            Boolean(bodAssignedCourse));
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
        ((_a = COURSE_CODE_TO_SCOPE[bodAssignedCourse]) !== null && _a !== void 0 ? _a : "") :
        "";
    const course = normalizeText(body.course);
    const yearSource = (_b = body.yearLevel) !== null && _b !== void 0 ? _b : body.year;
    const yearRaw = normalizeText(yearSource);
    const year = normalizeYear(yearSource);
    if (emailRaw && !isValidEmailAddress(emailRaw)) {
        throw new https_1.HttpsError("invalid-argument", "Please provide a valid email address.");
    }
    if (!schoolId) {
        throw new https_1.HttpsError("invalid-argument", "School ID is required.");
    }
    if (!["admin", "ecmember", "teacher", "student"].includes(role)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid role.");
    }
    if (role === "teacher" && !name) {
        throw new https_1.HttpsError("invalid-argument", "name is required for teacher role.");
    }
    if (role === "student" && !name) {
        throw new https_1.HttpsError("invalid-argument", "name is required for student role.");
    }
    if (role === "ecmember" && !name) {
        throw new https_1.HttpsError("invalid-argument", "name is required for ec role.");
    }
    if ((role === "student" || role === "ecmember") && !course) {
        throw new https_1.HttpsError("invalid-argument", "course is required for student and ec roles.");
    }
    if ((role === "student" || role === "ecmember") && !yearRaw) {
        throw new https_1.HttpsError("invalid-argument", "yearLevel is required for student and ec roles.");
    }
    if (role === "ecmember" && !ecPosition) {
        throw new https_1.HttpsError("invalid-argument", "ecPosition is required for EC member accounts.");
    }
    if (isBod && !bodAssignedCourse) {
        throw new https_1.HttpsError("invalid-argument", "assignedCourse is required for B.O.D. accounts.");
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
            actorUid: normalizeText((_c = request.auth) === null || _c === void 0 ? void 0 : _c.uid),
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
            code: (_d = authError.code) !== null && _d !== void 0 ? _d : "unknown",
            message: (_e = authError.message) !== null && _e !== void 0 ? _e : "Unknown account creation failure",
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
function isValidFingerprintCleanupOwner(mapping) {
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
function fingerprintTemplateRef(templateId) {
    return db.collection("fingerprintTemplates").doc(String(templateId));
}
function buildQueuePayload(type, templateId, uid, schoolId, reason, actorUid) {
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
async function queueFingerprintCleanupInstruction(batch, type, templateId, uid, schoolId, reason, actorUid) {
    const cleanupRef = db.collection("moduleCleanupQueue").doc();
    batch.set(cleanupRef, buildQueuePayload(type, templateId, uid, schoolId, reason, actorUid));
}
async function updateFingerprintTemplateDocument(batch, templateId, keepMapping, fallback) {
    const templateRef = fingerprintTemplateRef(templateId);
    if (keepMapping) {
        batch.set(templateRef, {
            templateId,
            uid: keepMapping.uid,
            schoolId: keepMapping.schoolId,
            name: keepMapping.studentName,
            course: keepMapping.course,
            yearLevel: keepMapping.yearLevel,
            active: true,
            status: "active",
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
    }
    batch.set(templateRef, {
        templateId,
        uid: fallback.uid,
        schoolId: fallback.schoolId,
        name: fallback.studentName,
        course: fallback.course,
        yearLevel: fallback.yearLevel,
        active: false,
        status: "needs_reenrollment",
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
async function clearFingerprintMappingForUid(batch, uid, nextStatus) {
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
        batch.set(profileSnap.ref, clearPatch, { merge: true });
        updatedCount += 1;
    }
    if (studentSnap.exists) {
        batch.set(studentSnap.ref, clearPatch, { merge: true });
        updatedCount += 1;
    }
    return updatedCount;
}
async function activateFingerprintMappingForUid(batch, uid, templateId) {
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
        batch.set(profileSnap.ref, activationPatch, { merge: true });
    }
    if (studentSnap.exists) {
        batch.set(studentSnap.ref, activationPatch, { merge: true });
    }
}
function sortFingerprintCleanupOwnerCandidates(left, right) {
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
function buildFingerprintTemplateMigrationPayload(mapping) {
    const normalizedStatus = normalizeLower(mapping.fingerprintStatus);
    const isActiveOwner = isValidFingerprintCleanupOwner(mapping);
    const status = mapping.mappingStatus === "deleted" ||
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
exports.adminListFingerprintCleanupMappings = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d;
    await requireAdmin(request);
    const actorUid = normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid);
    try {
        const actorProfileSnap = actorUid ? await db.doc(`profiles/${actorUid}`).get() : null;
        authLogger.info("adminListFingerprintCleanupMappings started", {
            actorUid,
            actorRole: normalizeText((_b = actorProfileSnap === null || actorProfileSnap === void 0 ? void 0 : actorProfileSnap.data()) === null || _b === void 0 ? void 0 : _b.role),
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
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        const unexpectedError = error;
        authLogger.error("adminListFingerprintCleanupMappings failed", {
            actorUid,
            code: (_c = unexpectedError.code) !== null && _c !== void 0 ? _c : "unknown",
            message: (_d = unexpectedError.message) !== null && _d !== void 0 ? _d : "Unknown fingerprint cleanup error",
            error,
        });
        throw new https_1.HttpsError("internal", "Unable to load fingerprint mappings. Check Cloud Function logs for the exact error.");
    }
});
exports.adminBuildFingerprintMappingsFromProfiles = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d;
    await requireAdmin(request);
    const actorUid = normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid);
    try {
        const report = await buildFingerprintCleanupReport();
        const groupedByTemplate = new Map();
        report.mappings
            .filter((mapping) => mapping.templateId > 0 &&
            (mapping.sources.includes("profile") || mapping.sources.includes("student_projection")))
            .forEach((mapping) => {
            var _a;
            const current = (_a = groupedByTemplate.get(mapping.templateId)) !== null && _a !== void 0 ? _a : [];
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
            };
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
            const existingData = (_b = templateSnap.data()) !== null && _b !== void 0 ? _b : {};
            const existingUid = normalizeText(existingData.uid);
            const existingSchoolId = normalizeText(existingData.schoolId);
            const existingStatus = normalizeLower(existingData.status);
            const existingActive = existingData.active !== false;
            const nextStatus = normalizeLower(payload.status);
            const nextUid = normalizeText(payload.uid);
            const nextSchoolId = normalizeText(payload.schoolId);
            const nextActive = payload.active === true;
            if (templateSnap.exists &&
                existingUid === nextUid &&
                existingSchoolId === nextSchoolId &&
                existingStatus === nextStatus &&
                existingActive === nextActive) {
                skippedCount += 1;
                continue;
            }
            batch.set(templateRef, payload, { merge: true });
            operationsInBatch += 1;
            if (templateSnap.exists) {
                updatedCount += 1;
            }
            else {
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
            message: createdCount > 0 || updatedCount > 0 ?
                `Fingerprint mappings built from profiles. Created ${createdCount}, updated ${updatedCount}, skipped ${skippedCount}.` :
                "Fingerprint mappings are already up to date.",
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        const unexpectedError = error;
        authLogger.error("adminBuildFingerprintMappingsFromProfiles failed", {
            actorUid,
            code: (_c = unexpectedError.code) !== null && _c !== void 0 ? _c : "unknown",
            message: (_d = unexpectedError.message) !== null && _d !== void 0 ? _d : "Unknown fingerprint migration error",
            error,
        });
        throw new https_1.HttpsError("internal", "Unable to build fingerprint mappings from profiles. Check Cloud Function logs for the exact error.");
    }
});
exports.adminManageFingerprintCleanup = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b;
    await requireAdmin(request);
    const body = asRecord(request.data);
    const action = normalizeText(body.action);
    const actorUid = normalizeText((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid);
    const actorProfileSnap = await db.doc(`profiles/${actorUid}`).get();
    const actorSchoolId = actorProfileSnap.exists ?
        normalizeText((_b = actorProfileSnap.data()) === null || _b === void 0 ? void 0 : _b.schoolId) :
        "";
    const templateId = toPositiveNumber(body.templateId);
    const reason = normalizeText(body.reason) || "Admin fingerprint cleanup";
    if (!action) {
        throw new https_1.HttpsError("invalid-argument", "action is required.");
    }
    if (templateId <= 0) {
        throw new https_1.HttpsError("invalid-argument", "templateId must be a positive integer.");
    }
    const report = await buildFingerprintCleanupReport();
    const templateMappings = report.mappings.filter((mapping) => mapping.templateId === templateId);
    if (templateMappings.length === 0) {
        throw new https_1.HttpsError("not-found", "Fingerprint mapping not found.");
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
            throw new https_1.HttpsError("invalid-argument", "keepUid is required.");
        }
        if (!keepMapping.canKeepTemplateOwner) {
            throw new https_1.HttpsError("failed-precondition", "Selected student cannot keep this fingerprint template.");
        }
        await activateFingerprintMappingForUid(batch, keepUid, templateId);
        const removedMappings = templateMappings.filter((mapping) => mapping.uid !== keepUid);
        for (const mapping of removedMappings) {
            updatedCount += await clearFingerprintMappingForUid(batch, mapping.uid, "needs_reenrollment");
            await queueFingerprintCleanupInstruction(batch, "removeMapping", templateId, mapping.uid, mapping.schoolId, reason, actorUid);
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
    }
    else {
        const uid = normalizeText(body.uid);
        const targetMapping = templateMappings.find((mapping) => mapping.uid === uid);
        if (!uid || !targetMapping) {
            throw new https_1.HttpsError("invalid-argument", "uid is required.");
        }
        const nextStatus = action === "removeStaleMapping" && targetMapping.mappingStatus === "stale" ?
            "stale" :
            "needs_reenrollment";
        if (action === "removeStaleMapping" && !targetMapping.canRemoveStale) {
            throw new https_1.HttpsError("failed-precondition", "Only stale, deleted, or missing-profile mappings can use removeStaleMapping.");
        }
        updatedCount += await clearFingerprintMappingForUid(batch, uid, nextStatus);
        const queueType = action === "markNeedsReenrollment" ?
            "markNeedsReenrollment" :
            "removeMapping";
        await queueFingerprintCleanupInstruction(batch, queueType, templateId, targetMapping.uid, targetMapping.schoolId, reason, actorUid);
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
            await queueFingerprintCleanupInstruction(batch, "deleteTemplateIfUnused", templateId, targetMapping.uid, targetMapping.schoolId, reason, actorUid);
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
    };
});
exports.ecListStudents = (0, https_1.onCall)({ region: REGION }, async (request) => {
    await requireAdminOrEC(request);
    const actorProfile = await callerProfileData(request);
    const actorCourseScope = resolveProfileCourseScope(actorProfile);
    const actorIsBod = isBodProfileData(actorProfile);
    const body = asRecord(request.data);
    const includeEcMembers = body.includeEcMembers === true;
    const rawLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(rawLimit) ?
        Math.min(Math.max(rawLimit, 1), 5000) :
        2000;
    const lookupRoles = includeEcMembers ?
        [...STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES] :
        [...STUDENT_ONLY_LOOKUP_PROFILE_ROLES];
    const profileSnapshot = await db
        .collection("profiles")
        .where("role", "in", lookupRoles)
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
            ecPosition: normalizeECPosition(profileData.ecPosition),
            courseScope: resolveProfileCourseScope(profileData) || null,
            isBod: isBodProfileData(profileData),
        };
    }).filter((student) => {
        if (!actorIsBod) {
            return true;
        }
        return Boolean(actorCourseScope &&
            normalizeCourseLabel(student.course) === actorCourseScope);
    });
    return { students };
});
exports.ecCreateStudent = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
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
    ensureBodCourseScopeAccess(actorProfile, course, "B.O.D. members can only create students inside their own course scope.");
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
const ENROLLMENT_SESSION_QUEUE_HOLD_DEVICE_ID = "__session_only__";
function normalizeEnrollmentSessionStatus(value) {
    const normalized = normalizeLower(value);
    if (normalized === "paired")
        return "paired";
    if (normalized === "downloading")
        return "downloading";
    if (normalized === "enrolling")
        return "enrolling";
    if (normalized === "completed")
        return "completed";
    if (normalized === "partially completed" || normalized === "partially-completed") {
        return "partially-completed";
    }
    if (normalized === "closed")
        return "closed";
    return "pending";
}
function normalizeEnrollmentStudentStatus(value) {
    const normalized = normalizeLower(value);
    if (normalized === "downloaded")
        return "downloaded";
    if (normalized === "enrolled")
        return "enrolled";
    if (normalized === "synced")
        return "synced";
    if (normalized === "failed")
        return "failed";
    return "pending";
}
function normalizeEnrollmentSyncStatus(value) {
    const normalized = normalizeLower(value);
    if (normalized === "synced")
        return "synced";
    if (normalized === "failed")
        return "failed";
    return "pending";
}
function sanitizeCourseScopeForStoragePath(value) {
    return normalizeLower(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function enrollmentSessionCourseScope(data) {
    return (normalizeCourseLabel(data.courseScope) ||
        normalizeCourseLabel(data.createdByCourseScope));
}
function ecDocumentOwnerType(data) {
    return normalizeLower(data.ownerType) === "bod" ? "bod" : "ec";
}
function ecDocumentCourseScope(data) {
    return (normalizeCourseLabel(data.courseScope) ||
        normalizeCourseLabel(data.createdByCourseScope));
}
async function resolveEcActorContext(context) {
    var _a;
    await requireAdminOrEC(context);
    const actorProfile = await callerProfileData(context);
    const actorUid = normalizeText((_a = context.auth) === null || _a === void 0 ? void 0 : _a.uid);
    const actorRole = normalizeCampusRoleValue(actorProfile.role);
    const actorIsAdmin = actorRole === "admin";
    const actorIsEcMember = isECMemberRole(actorProfile.role);
    const actorIsBod = actorIsEcMember && isBodProfileData(actorProfile);
    const actorIsRegularEc = actorIsEcMember &&
        !actorIsBod &&
        resolveProfileEcScope(actorProfile) === "all";
    if (!actorIsAdmin && !actorIsRegularEc && !actorIsBod) {
        throw new https_1.HttpsError("permission-denied", "Only admin, regular EC, or B.O.D. users can perform this action.");
    }
    const actorCourseScope = resolveProfileCourseScope(actorProfile);
    if (actorIsBod && !actorCourseScope) {
        throw new https_1.HttpsError("permission-denied", "B.O.D. profile is missing a valid course scope.");
    }
    return {
        uid: actorUid,
        profile: actorProfile,
        isAdmin: actorIsAdmin,
        isRegularEc: actorIsRegularEc,
        isBod: actorIsBod,
        courseScope: actorCourseScope,
    };
}
async function readStudentSources(uid) {
    var _a, _b;
    const [profileSnap, studentSnap] = await Promise.all([
        db.doc(`profiles/${uid}`).get(),
        db.doc(`students/${uid}`).get(),
    ]);
    return {
        profileData: profileSnap.exists ? ((_a = profileSnap.data()) !== null && _a !== void 0 ? _a : {}) : {},
        studentData: studentSnap.exists ? ((_b = studentSnap.data()) !== null && _b !== void 0 ? _b : {}) : {},
        profileExists: profileSnap.exists,
        studentExists: studentSnap.exists,
    };
}
function resolveStudentCourse(profileData, studentData) {
    return (normalizeCourseLabel(profileData.course) ||
        normalizeCourseLabel(studentData.course));
}
function resolveStudentYearLevel(profileData, studentData) {
    const rawYear = normalizeText(profileData.yearLevel) ||
        normalizeText(profileData.year) ||
        normalizeText(studentData.yearLevel) ||
        normalizeText(studentData.year);
    return rawYear ? normalizeYear(rawYear) : "";
}
function resolveStudentSchoolId(uid, profileData, studentData) {
    return (normalizeText(profileData.schoolId) ||
        normalizeText(studentData.schoolId) ||
        uid);
}
function resolveStudentName(uid, profileData, studentData) {
    const merged = Object.assign(Object.assign({}, studentData), profileData);
    return resolveProfileDisplayName(merged) || uid;
}
function studentHasFingerprint(profileData, studentData) {
    var _a, _b, _c;
    const fingerprintStatus = normalizeLower(profileData.fingerprintStatus) ||
        normalizeLower(studentData.fingerprintStatus);
    const fingerprintTemplateId = toPositiveNumber((_c = (_b = (_a = profileData.fingerprintTemplateId) !== null && _a !== void 0 ? _a : profileData.templateId) !== null && _b !== void 0 ? _b : studentData.fingerprintTemplateId) !== null && _c !== void 0 ? _c : studentData.templateId);
    return (fingerprintTemplateId > 0 ||
        fingerprintStatus === "enrolled" ||
        fingerprintStatus === "active");
}
function enrollmentSessionPayloadFromSnapshot(snap) {
    var _a;
    const data = (_a = snap.data()) !== null && _a !== void 0 ? _a : {};
    return {
        sessionId: snap.id,
        createdBy: normalizeText(data.createdBy),
        createdByName: normalizeText(data.createdByName),
        createdBySchoolId: normalizeText(data.createdBySchoolId),
        status: normalizeEnrollmentSessionStatus(data.status),
        pairedDeviceId: normalizeText(data.pairedDeviceId),
        targetDeviceId: normalizeText(data.targetDeviceId),
        totalStudents: toPositiveNumber(data.totalStudents),
        pendingCount: toPositiveNumber(data.pendingCount),
        downloadedCount: toPositiveNumber(data.downloadedCount),
        enrolledCount: toPositiveNumber(data.enrolledCount),
        syncedCount: toPositiveNumber(data.syncedCount),
        failedCount: toPositiveNumber(data.failedCount),
        selectedStudentIds: normalizeIdentifierList(data.selectedStudentIds),
        createdAtMs: toMillis(data.createdAt),
        updatedAtMs: toMillis(data.updatedAt),
    };
}
function enrollmentSessionStudentPayloadFromSnapshot(snap) {
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
        course: normalizeText(data.course) || "Unassigned",
        yearLevel: normalizeYear((_b = data.yearLevel) !== null && _b !== void 0 ? _b : data.year),
        status: normalizeEnrollmentStudentStatus(data.status),
        syncStatus: normalizeEnrollmentSyncStatus(data.syncStatus),
        fingerprintTemplateId: toPositiveNumber((_c = data.fingerprintTemplateId) !== null && _c !== void 0 ? _c : data.templateId),
        enrolledByDevice: normalizeText(data.enrolledByDevice),
        assignedDeviceId: normalizeText(data.assignedDeviceId),
        remarks: normalizeText(data.remarks),
    };
}
function canActorAccessEnrollmentSession(actor, data) {
    if (actor.isAdmin || actor.isRegularEc) {
        return true;
    }
    if (!actor.isBod || !actor.courseScope) {
        return false;
    }
    return enrollmentSessionCourseScope(data) === actor.courseScope;
}
async function assertNoActiveEnrollmentSessionConflicts(studentIds) {
    var _a;
    const uniqueIds = Array.from(new Set(studentIds.map((id) => normalizeText(id)).filter(Boolean)));
    if (uniqueIds.length === 0) {
        return;
    }
    for (let index = 0; index < uniqueIds.length; index += 10) {
        const chunk = uniqueIds.slice(index, index + 10);
        const sessionSnapshot = await db
            .collection("enrollmentSessions")
            .where("selectedStudentIds", "array-contains-any", chunk)
            .get();
        for (const docSnapshot of sessionSnapshot.docs) {
            const sessionData = (_a = docSnapshot.data()) !== null && _a !== void 0 ? _a : {};
            const sessionStatus = normalizeEnrollmentSessionStatus(sessionData.status);
            if (sessionStatus === "completed" || sessionStatus === "closed") {
                continue;
            }
            const selectedStudentIds = normalizeIdentifierList(sessionData.selectedStudentIds);
            const hasOverlap = selectedStudentIds.some((studentId) => chunk.includes(studentId));
            if (hasOverlap) {
                throw new https_1.HttpsError("already-exists", "One or more students are already included in an active fingerprint enrollment session.");
            }
        }
    }
}
exports.createCampusStudent = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const schoolId = normalizeText(body.schoolId);
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const studentName = normalizeNamePart(body.studentName);
    const requestedCourse = normalizeCourseLabel(body.course) || normalizeText(body.course);
    const requestedYearRaw = normalizeText(body.year);
    const year = normalizeYear(body.year);
    const emailRaw = normalizeText(body.email);
    if (emailRaw && !isValidEmailAddress(emailRaw)) {
        throw new https_1.HttpsError("invalid-argument", "Please provide a valid email address.");
    }
    if (!schoolId) {
        throw new https_1.HttpsError("invalid-argument", "School ID is required.");
    }
    if (!studentName) {
        throw new https_1.HttpsError("invalid-argument", "Student name is required.");
    }
    if (!requestedCourse) {
        throw new https_1.HttpsError("invalid-argument", "Course is required.");
    }
    if (!requestedYearRaw) {
        throw new https_1.HttpsError("invalid-argument", "Year is required.");
    }
    if (actor.isBod) {
        ensureBodCourseScopeAccess(actor.profile, requestedCourse, "B.O.D. members can only manage students from their assigned course.");
    }
    const course = actor.isBod ? actor.courseScope : requestedCourse;
    const email = emailRaw || `${schoolId}@campus.local`;
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
        await schoolIdReservation.activate(uid);
        const timestamp = serverTimestamp();
        const createBatch = db.batch();
        createBatch.set(db.doc(`profiles/${uid}`), {
            schoolId,
            schoolIdKey,
            email,
            role: "student",
            studentName,
            name: studentName,
            fullName: studentName,
            course,
            year,
            yearLevel: year,
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
        createBatch.set(db.doc(`students/${uid}`), {
            uid,
            studentId: uid,
            schoolId,
            schoolIdKey,
            studentName,
            name: studentName,
            fullName: studentName,
            course,
            year,
            yearLevel: year,
            readyForClearance: false,
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
        }, { merge: true });
        await createBatch.commit();
        await db.collection("logs").add({
            action: "create_campus_student",
            actorUid: actor.uid,
            targetUid: uid,
            targetSchoolId: schoolId,
            createdAt: timestamp,
        }).catch((logError) => {
            authLogger.warn("createCampusStudent log write failed", {
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
exports.updateCampusStudentProfile = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);
    const submittedName = normalizeNamePart(body.name);
    const schoolId = normalizeText(body.schoolId);
    const requestedCourse = normalizeCourseLabel(body.course) || normalizeText(body.course);
    const requestedYear = normalizeText(body.yearLevel);
    if (!uid) {
        throw new https_1.HttpsError("invalid-argument", "uid is required.");
    }
    if (!submittedName) {
        throw new https_1.HttpsError("invalid-argument", "name is required.");
    }
    if (!schoolId) {
        throw new https_1.HttpsError("invalid-argument", "schoolId is required.");
    }
    const { profileData, studentData, profileExists, studentExists } = await readStudentSources(uid);
    if (!profileExists && !studentExists) {
        throw new https_1.HttpsError("not-found", "Student profile not found.");
    }
    const targetRole = normalizeText(profileData.role || studentData.role || "student");
    if (!isStudentAudienceRole(targetRole)) {
        throw new https_1.HttpsError("permission-denied", "Only student and EC-member records can be updated here.");
    }
    const currentCourse = resolveStudentCourse(profileData, studentData);
    if (actor.isBod) {
        if (!currentCourse || currentCourse !== actor.courseScope) {
            throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
        }
        if (requestedCourse && requestedCourse !== actor.courseScope) {
            throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
        }
    }
    const effectiveCourse = actor.isBod ? actor.courseScope : (requestedCourse || currentCourse);
    if (!effectiveCourse) {
        throw new https_1.HttpsError("invalid-argument", "Course is required.");
    }
    const currentYear = resolveStudentYearLevel(profileData, studentData);
    const effectiveYear = requestedYear ? normalizeYear(requestedYear) : currentYear;
    if (!effectiveYear || effectiveYear === "Unassigned") {
        throw new https_1.HttpsError("invalid-argument", "Year level is required.");
    }
    const schoolIdKey = normalizeSchoolIdKey(schoolId);
    const timestamp = serverTimestamp();
    const profilePatch = {
        schoolId,
        schoolIdKey,
        name: submittedName,
        fullName: submittedName,
        studentName: submittedName,
        course: effectiveCourse,
        year: effectiveYear,
        yearLevel: effectiveYear,
        updatedAt: timestamp,
    };
    const studentPatch = {
        uid,
        studentId: uid,
        schoolId,
        schoolIdKey,
        name: submittedName,
        fullName: submittedName,
        studentName: submittedName,
        course: effectiveCourse,
        year: effectiveYear,
        yearLevel: effectiveYear,
        status: normalizeText(studentData.status) ||
            normalizeText(profileData.status) ||
            "Active",
        readyForClearance: studentData.readyForClearance === true ||
            profileData.readyForClearance === true,
        updatedAt: timestamp,
    };
    const updateBatch = db.batch();
    updateBatch.set(db.doc(`profiles/${uid}`), profilePatch, { merge: true });
    updateBatch.set(db.doc(`students/${uid}`), studentPatch, { merge: true });
    await updateBatch.commit();
    return {
        uid,
        schoolId,
        name: submittedName,
        course: effectiveCourse,
        yearLevel: effectiveYear,
    };
});
exports.updateStudentAccountStatus = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);
    const statusRaw = normalizeLower(body.status);
    const nextStatus = statusRaw === "inactive" ? "Inactive" :
        statusRaw === "active" ? "Active" :
            "";
    if (!uid) {
        throw new https_1.HttpsError("invalid-argument", "uid is required.");
    }
    if (!nextStatus) {
        throw new https_1.HttpsError("invalid-argument", "status must be Active or Inactive.");
    }
    const { profileData, studentData, profileExists, studentExists } = await readStudentSources(uid);
    if (!profileExists && !studentExists) {
        throw new https_1.HttpsError("not-found", "Student profile not found.");
    }
    const targetRole = normalizeText(profileData.role || studentData.role || "student");
    if (!isStudentAudienceRole(targetRole)) {
        throw new https_1.HttpsError("permission-denied", "Only student and EC-member records can be updated here.");
    }
    const targetCourse = resolveStudentCourse(profileData, studentData);
    if (actor.isBod && targetCourse !== actor.courseScope) {
        throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
    }
    const schoolId = resolveStudentSchoolId(uid, profileData, studentData);
    const studentName = resolveStudentName(uid, profileData, studentData);
    const yearLevel = resolveStudentYearLevel(profileData, studentData) || "Unassigned";
    const timestamp = serverTimestamp();
    const updateBatch = db.batch();
    updateBatch.set(db.doc(`profiles/${uid}`), {
        status: nextStatus,
        updatedAt: timestamp,
    }, { merge: true });
    updateBatch.set(db.doc(`students/${uid}`), {
        uid,
        studentId: uid,
        schoolId,
        studentName,
        name: studentName,
        fullName: studentName,
        course: targetCourse || normalizeText(profileData.course) || normalizeText(studentData.course) || "Unassigned",
        year: yearLevel,
        yearLevel,
        status: nextStatus,
        updatedAt: timestamp,
    }, { merge: true });
    await updateBatch.commit();
    let deletedRegistrationsCount = 0;
    if (nextStatus === "Inactive") {
        const registrationsSnapshot = await db
            .collectionGroup("registrations")
            .where("uid", "==", uid)
            .get();
        deletedRegistrationsCount = registrationsSnapshot.size;
        await Promise.all(registrationsSnapshot.docs.map((registrationDoc) => registrationDoc.ref.delete()));
    }
    return {
        uid,
        status: nextStatus,
        deletedRegistrationsCount,
    };
});
exports.updateStudentClearanceStatus = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const uid = normalizeText(body.uid);
    const readyForClearance = body.readyForClearance === true;
    if (!uid) {
        throw new https_1.HttpsError("invalid-argument", "uid is required.");
    }
    const { profileData, studentData, profileExists, studentExists } = await readStudentSources(uid);
    if (!profileExists && !studentExists) {
        throw new https_1.HttpsError("not-found", "Student profile not found.");
    }
    const targetRole = normalizeText(profileData.role || studentData.role || "student");
    if (!isStudentAudienceRole(targetRole)) {
        throw new https_1.HttpsError("permission-denied", "Only student and EC-member records can be updated here.");
    }
    const targetCourse = resolveStudentCourse(profileData, studentData);
    if (actor.isBod && targetCourse !== actor.courseScope) {
        throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
    }
    const schoolId = resolveStudentSchoolId(uid, profileData, studentData);
    const studentName = resolveStudentName(uid, profileData, studentData);
    const yearLevel = resolveStudentYearLevel(profileData, studentData) || "Unassigned";
    const timestamp = serverTimestamp();
    const updateBatch = db.batch();
    updateBatch.set(db.doc(`profiles/${uid}`), {
        readyForClearance,
        updatedAt: timestamp,
    }, { merge: true });
    updateBatch.set(db.doc(`students/${uid}`), {
        uid,
        studentId: uid,
        schoolId,
        studentName,
        name: studentName,
        fullName: studentName,
        course: targetCourse || normalizeText(profileData.course) || normalizeText(studentData.course) || "Unassigned",
        year: yearLevel,
        yearLevel,
        readyForClearance,
        updatedAt: timestamp,
    }, { merge: true });
    await updateBatch.commit();
    let notificationSent = false;
    if (readyForClearance) {
        await db
            .doc(`profiles/${uid}/notifications/clearance-ready-status`)
            .set({
            title: "Clearance Ready",
            message: "You are now ready for clearance signing.",
            type: "announcement",
            createdAt: timestamp,
            date: "",
            scheduledTime: "",
            read: false,
            targetUid: uid,
        }, { merge: true });
        notificationSent = true;
    }
    return {
        uid,
        readyForClearance,
        notificationSent,
    };
});
exports.createCampusDocumentMetadata = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const docId = normalizeText(body.docId) || db.collection("ecDocuments").doc().id;
    const name = normalizeText(body.name);
    const type = normalizeText(body.type) || "PDF";
    const category = normalizeText(body.category) || "General";
    const sizeBytes = Number(body.sizeBytes);
    const storagePath = normalizeText(body.storagePath);
    const downloadURL = normalizeText(body.downloadURL);
    if (!name) {
        throw new https_1.HttpsError("invalid-argument", "name is required.");
    }
    if (!storagePath) {
        throw new https_1.HttpsError("invalid-argument", "storagePath is required.");
    }
    if (!downloadURL) {
        throw new https_1.HttpsError("invalid-argument", "downloadURL is required.");
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        throw new https_1.HttpsError("invalid-argument", "sizeBytes must be a positive number.");
    }
    if (!storagePath.startsWith("ec-documents/")) {
        throw new https_1.HttpsError("invalid-argument", "storagePath must be under ec-documents/.");
    }
    const documentRef = db.doc(`ecDocuments/${docId}`);
    const documentSnapshot = await documentRef.get();
    if (documentSnapshot.exists) {
        throw new https_1.HttpsError("already-exists", "Document metadata already exists for this file.");
    }
    let ownerType = "ec";
    let courseScope = null;
    let createdByCourseScope = null;
    let courses = [];
    if (actor.isBod) {
        ownerType = "bod";
        courseScope = actor.courseScope;
        createdByCourseScope = actor.courseScope;
        courses = [actor.courseScope];
        const expectedPrefix = `ec-documents/course/${sanitizeCourseScopeForStoragePath(actor.courseScope)}/`;
        if (!storagePath.startsWith(expectedPrefix)) {
            throw new https_1.HttpsError("permission-denied", "B.O.D. members can only upload documents inside their assigned course scope.");
        }
    }
    await documentRef.set({
        name,
        type,
        category,
        sizeBytes,
        downloadURL,
        storagePath,
        uploadedByUid: actor.uid,
        createdBy: actor.uid,
        ownerType,
        courseScope,
        createdByCourseScope,
        courses,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    return {
        docId,
        ownerType,
        courseScope,
    };
});
exports.deleteCampusDocument = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const docId = normalizeText(body.docId);
    if (!docId) {
        throw new https_1.HttpsError("invalid-argument", "docId is required.");
    }
    const documentRef = db.doc(`ecDocuments/${docId}`);
    const documentSnapshot = await documentRef.get();
    if (!documentSnapshot.exists) {
        throw new https_1.HttpsError("not-found", "Document metadata not found.");
    }
    const documentData = (_a = documentSnapshot.data()) !== null && _a !== void 0 ? _a : {};
    const ownerType = ecDocumentOwnerType(documentData);
    const documentScope = ecDocumentCourseScope(documentData);
    const createdByUid = normalizeText(documentData.createdBy || documentData.uploadedByUid);
    if (actor.isBod) {
        if (ownerType !== "bod" ||
            documentScope !== actor.courseScope ||
            createdByUid !== actor.uid) {
            throw new https_1.HttpsError("permission-denied", "B.O.D. members can only delete their own course documents.");
        }
    }
    const storagePath = normalizeText(documentData.storagePath);
    if (storagePath) {
        try {
            await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
        }
        catch (error) {
            const storageErrorCode = Number(error.code);
            if (storageErrorCode !== 404) {
                throw new https_1.HttpsError("internal", "Failed to delete the document file from storage.");
            }
        }
    }
    await documentRef.delete();
    return {
        docId,
        deleted: true,
    };
});
exports.listFingerprintEnrollmentSessions = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const rawLimit = Number.parseInt(normalizeText(body.limit), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;
    const queryLimit = actor.isBod ? Math.min(limit * 5, 200) : limit;
    const sessionSnapshot = await db
        .collection("enrollmentSessions")
        .orderBy("createdAt", "desc")
        .limit(queryLimit)
        .get();
    const sessions = sessionSnapshot.docs
        .filter((sessionDoc) => { var _a; return canActorAccessEnrollmentSession(actor, (_a = sessionDoc.data()) !== null && _a !== void 0 ? _a : {}); })
        .map((sessionDoc) => enrollmentSessionPayloadFromSnapshot(sessionDoc))
        .slice(0, limit);
    return { sessions };
});
exports.getFingerprintEnrollmentSessionDetail = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
        throw new https_1.HttpsError("invalid-argument", "sessionId is required.");
    }
    const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) {
        throw new https_1.HttpsError("not-found", "Enrollment session not found.");
    }
    const sessionData = (_a = sessionSnapshot.data()) !== null && _a !== void 0 ? _a : {};
    if (!canActorAccessEnrollmentSession(actor, sessionData)) {
        throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
    }
    const studentsSnapshot = await db
        .collection(`enrollmentSessions/${sessionId}/students`)
        .orderBy("fullName", "asc")
        .get();
    return {
        session: enrollmentSessionPayloadFromSnapshot(sessionSnapshot),
        students: studentsSnapshot.docs.map((studentDoc) => enrollmentSessionStudentPayloadFromSnapshot(studentDoc)),
    };
});
exports.createFingerprintEnrollmentSession = (0, https_1.onCall)({ region: REGION }, async (request) => {
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const studentIds = Array.from(new Set(normalizeIdentifierList(body.studentIds).map((studentId) => normalizeText(studentId)).filter(Boolean)));
    if (studentIds.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "studentIds must contain at least one student.");
    }
    await assertNoActiveEnrollmentSessionConflicts(studentIds);
    const profileRefs = studentIds.map((studentId) => db.doc(`profiles/${studentId}`));
    const studentRefs = studentIds.map((studentId) => db.doc(`students/${studentId}`));
    const [profileSnapshots, studentSnapshots] = await Promise.all([
        profileRefs.length > 0 ? db.getAll(...profileRefs) : Promise.resolve([]),
        studentRefs.length > 0 ? db.getAll(...studentRefs) : Promise.resolve([]),
    ]);
    const profileByUid = new Map();
    profileSnapshots.forEach((profileSnapshot) => {
        var _a;
        if (profileSnapshot.exists) {
            profileByUid.set(profileSnapshot.id, (_a = profileSnapshot.data()) !== null && _a !== void 0 ? _a : {});
        }
    });
    const studentByUid = new Map();
    studentSnapshots.forEach((studentSnapshot) => {
        var _a;
        if (studentSnapshot.exists) {
            studentByUid.set(studentSnapshot.id, (_a = studentSnapshot.data()) !== null && _a !== void 0 ? _a : {});
        }
    });
    const studentRows = studentIds.map((studentId) => {
        var _a, _b;
        const profileExists = profileByUid.has(studentId);
        const studentExists = studentByUid.has(studentId);
        const profileData = (_a = profileByUid.get(studentId)) !== null && _a !== void 0 ? _a : {};
        const studentData = (_b = studentByUid.get(studentId)) !== null && _b !== void 0 ? _b : {};
        if (!profileExists && !studentExists) {
            throw new https_1.HttpsError("not-found", "One or more selected students no longer exist.");
        }
        const role = normalizeText(profileData.role || studentData.role || "student");
        if (!isStudentAudienceRole(role)) {
            throw new https_1.HttpsError("permission-denied", "Only student and EC-member records can be included in fingerprint enrollment.");
        }
        const course = resolveStudentCourse(profileData, studentData);
        if (actor.isBod && course !== actor.courseScope) {
            throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
        }
        if (studentHasFingerprint(profileData, studentData)) {
            const studentName = resolveStudentName(studentId, profileData, studentData);
            throw new https_1.HttpsError("failed-precondition", `${studentName} already has a fingerprint record.`);
        }
        const schoolId = resolveStudentSchoolId(studentId, profileData, studentData);
        const yearLevel = resolveStudentYearLevel(profileData, studentData) || "Unassigned";
        const fullName = resolveStudentName(studentId, profileData, studentData);
        return {
            studentId,
            studentUid: studentId,
            schoolId,
            fullName,
            course: course ||
                normalizeText(profileData.course) ||
                normalizeText(studentData.course) ||
                "Unassigned",
            yearLevel,
        };
    });
    const sessionRef = db.collection("enrollmentSessions").doc();
    const timestamp = serverTimestamp();
    const createdBySchoolId = normalizeText(actor.profile.schoolId) || actor.uid;
    const createdByName = resolveProfileDisplayName(actor.profile);
    const sessionCourseScope = actor.isBod ? actor.courseScope : null;
    let createBatch = db.batch();
    let writesInBatch = 0;
    const commitCurrentBatch = async () => {
        if (writesInBatch === 0) {
            return;
        }
        await createBatch.commit();
        createBatch = db.batch();
        writesInBatch = 0;
    };
    createBatch.set(sessionRef, {
        sessionId: sessionRef.id,
        createdBy: actor.uid,
        createdByName,
        createdBySchoolId,
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerType: actor.isBod ? "bod" : "ec",
        courseScope: sessionCourseScope,
        createdByCourseScope: sessionCourseScope,
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
    writesInBatch += 1;
    for (const studentRow of studentRows) {
        if (writesInBatch + 2 > 400) {
            await commitCurrentBatch();
        }
        createBatch.set(db.doc(`enrollmentSessions/${sessionRef.id}/students/${studentRow.studentId}`), {
            enrollmentSessionId: sessionRef.id,
            studentId: studentRow.studentId,
            studentUid: studentRow.studentUid,
            schoolId: studentRow.schoolId,
            fullName: studentRow.fullName,
            course: studentRow.course,
            yearLevel: studentRow.yearLevel,
            status: "pending",
            syncStatus: "pending",
            fingerprintTemplateId: null,
            enrolledByDevice: "",
            assignedDeviceId: "",
            remarks: "",
            createdAt: timestamp,
            updatedAt: timestamp,
        }, { merge: true });
        writesInBatch += 1;
        const queueId = `${sessionRef.id}_${studentRow.studentId}`;
        createBatch.set(db.doc(`enrollmentQueue/${queueId}`), {
            queueId,
            enrollmentSessionId: sessionRef.id,
            eventId: sessionRef.id,
            studentId: studentRow.studentId,
            studentUid: studentRow.studentUid,
            schoolId: studentRow.schoolId,
            studentName: studentRow.fullName,
            course: studentRow.course,
            yearLevel: studentRow.yearLevel,
            status: "pending",
            assignedDeviceId: ENROLLMENT_SESSION_QUEUE_HOLD_DEVICE_ID,
            ownerType: actor.isBod ? "bod" : "ec",
            createdBy: actor.uid,
            createdByName,
            createdBySchoolId,
            courseScope: sessionCourseScope,
            createdByCourseScope: sessionCourseScope,
            source: "enrollment-session",
            createdAt: timestamp,
            updatedAt: timestamp,
        }, { merge: true });
        writesInBatch += 1;
    }
    await commitCurrentBatch();
    const createdSessionSnapshot = await sessionRef.get();
    return {
        session: enrollmentSessionPayloadFromSnapshot(createdSessionSnapshot),
    };
});
exports.closeFingerprintEnrollmentSession = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a;
    const actor = await resolveEcActorContext(request);
    const body = asRecord(request.data);
    const sessionId = normalizeText(body.sessionId);
    if (!sessionId) {
        throw new https_1.HttpsError("invalid-argument", "sessionId is required.");
    }
    const sessionRef = db.doc(`enrollmentSessions/${sessionId}`);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) {
        throw new https_1.HttpsError("not-found", "Enrollment session not found.");
    }
    const sessionData = (_a = sessionSnapshot.data()) !== null && _a !== void 0 ? _a : {};
    if (!canActorAccessEnrollmentSession(actor, sessionData)) {
        throw new https_1.HttpsError("permission-denied", "B.O.D. members can only manage students from their assigned course.");
    }
    const queueSnapshot = await db
        .collection("enrollmentQueue")
        .where("enrollmentSessionId", "==", sessionId)
        .get();
    if (!queueSnapshot.empty) {
        const writesPerBatch = 350;
        for (let index = 0; index < queueSnapshot.docs.length; index += writesPerBatch) {
            const batch = db.batch();
            queueSnapshot.docs
                .slice(index, index + writesPerBatch)
                .forEach((queueDoc) => {
                batch.set(queueDoc.ref, {
                    status: "closed",
                    closedAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            });
            await batch.commit();
        }
    }
    await sessionRef.set({
        status: "closed",
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });
    const updatedSessionSnapshot = await sessionRef.get();
    return {
        session: enrollmentSessionPayloadFromSnapshot(updatedSessionSnapshot),
    };
});
function makePaymentRef(paymentId) {
    return `PMT-${paymentId.slice(-6).toUpperCase()}`;
}
function toFirestoreDateOrNull(value) {
    const millis = toMillis(value);
    if (!Number.isFinite(millis) || millis <= 0) {
        return null;
    }
    return new Date(millis);
}
function toUniqueIdentifierList(value) {
    return Array.from(new Set(normalizeIdentifierList(value)));
}
exports.createCampusEvent = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
    }
    try {
        const actorUid = normalizeText(request.auth.uid);
        const actorProfile = await callerProfileData(request);
        const actorRole = normalizeCampusRoleValue(actorProfile.role);
        const actorIsAdmin = actorRole === "admin";
        const actorIsEcMember = isECMemberRole(actorProfile.role);
        const actorIsBod = actorIsEcMember && isBodProfileData(actorProfile);
        const actorIsRegularEc = actorIsEcMember &&
            !actorIsBod &&
            resolveProfileEcScope(actorProfile) === "all";
        if (!actorIsAdmin && !actorIsRegularEc && !actorIsBod) {
            throw new https_1.HttpsError("permission-denied", "Only admin, regular EC, or B.O.D. users can create events.");
        }
        const actorCourseScope = resolveProfileCourseScope(actorProfile);
        if (actorIsBod && !actorCourseScope) {
            throw new https_1.HttpsError("permission-denied", "B.O.D. profile is missing a valid course scope.");
        }
        const body = asRecord(request.data);
        const title = normalizeText(body.title);
        const location = normalizeText(body.location);
        const date = normalizeText(body.date);
        const scheduledTime = normalizeText(body.scheduledTime) ||
            normalizeText(body.timeStart);
        const timeEnd = normalizeText(body.timeEnd);
        const details = normalizeText(body.details);
        const isPreReg = body.isPreReg === true;
        const withPayment = body.withPayment === true || body.paymentRequired === true;
        const waitlistEnabled = isPreReg ? body.waitlistEnabled === true : false;
        const parsedPreRegSlots = Number(body.preRegSlots);
        if (!title) {
            throw new https_1.HttpsError("invalid-argument", "Title is required.");
        }
        if (!date) {
            throw new https_1.HttpsError("invalid-argument", "Date is required.");
        }
        if (!scheduledTime) {
            throw new https_1.HttpsError("invalid-argument", "Scheduled time is required.");
        }
        if (!timeEnd) {
            throw new https_1.HttpsError("invalid-argument", "End time is required.");
        }
        const eventStartMs = parseEventStartMs(date, scheduledTime);
        const eventEndMs = parseEventStartMs(date, timeEnd);
        if (eventStartMs !== Number.MAX_SAFE_INTEGER &&
            eventEndMs !== Number.MAX_SAFE_INTEGER &&
            eventEndMs <= eventStartMs) {
            throw new https_1.HttpsError("invalid-argument", "End time must be later than start time.");
        }
        if (isPreReg && (!Number.isFinite(parsedPreRegSlots) || parsedPreRegSlots < 0)) {
            throw new https_1.HttpsError("invalid-argument", "Pre-reg slots must be at least 0.");
        }
        const preRegSlots = isPreReg ? Math.max(0, Math.trunc(parsedPreRegSlots)) : null;
        const registrationStartAt = isPreReg ? toFirestoreDateOrNull(body.registrationStartAt) : null;
        const registrationEndAt = isPreReg ? toFirestoreDateOrNull(body.registrationEndAt) : null;
        const cancellationDeadlineAt = isPreReg ?
            toFirestoreDateOrNull(body.cancellationDeadlineAt) :
            null;
        if (isPreReg &&
            (!registrationStartAt || !registrationEndAt || !cancellationDeadlineAt)) {
            throw new https_1.HttpsError("invalid-argument", "Set valid registration and cancellation date/time values.");
        }
        if (isPreReg &&
            registrationStartAt &&
            registrationEndAt &&
            registrationStartAt.getTime() > registrationEndAt.getTime()) {
            throw new https_1.HttpsError("invalid-argument", "Registration start must be earlier than the end.");
        }
        if (isPreReg &&
            registrationEndAt &&
            eventStartMs !== Number.MAX_SAFE_INTEGER &&
            registrationEndAt.getTime() > eventStartMs) {
            throw new https_1.HttpsError("invalid-argument", "Registration end must be on or before the event start time.");
        }
        if (isPreReg &&
            cancellationDeadlineAt &&
            registrationStartAt &&
            cancellationDeadlineAt.getTime() < registrationStartAt.getTime()) {
            throw new https_1.HttpsError("invalid-argument", "Cancellation deadline cannot be earlier than registration start.");
        }
        if (isPreReg &&
            cancellationDeadlineAt &&
            registrationEndAt &&
            cancellationDeadlineAt.getTime() > registrationEndAt.getTime()) {
            throw new https_1.HttpsError("invalid-argument", "Cancellation deadline must be on or before registration end.");
        }
        const selectedStudentIds = toUniqueIdentifierList(body.selectedStudentIds)
            .filter((uid) => !uid.startsWith("manual-"));
        const selectedSchoolIds = toUniqueIdentifierList(body.selectedSchoolIds)
            .filter((schoolId) => schoolId !== "Unknown ID");
        const requestedCourseValue = normalizeText(body.course);
        const requestedYearLevelValue = normalizeText(body.yearLevel);
        const requestedTargetStudent = normalizeText(body.targetStudent);
        const requestedCourseTargetsRaw = Array.from(new Set(toTargetList(body.courses)
            .map((value) => normalizeText(value))
            .filter(Boolean)));
        const requestedYearTargetsRaw = Array.from(new Set(toTargetList(body.yearLevels)
            .map((value) => normalizeText(value))
            .filter(Boolean)));
        const requestedHasAllCourses = requestedCourseTargetsRaw.some((value) => normalizeLower(value) === "all courses") ||
            normalizeLower(requestedCourseValue) === "all courses";
        const requestedHasAllYears = requestedYearTargetsRaw.some((value) => normalizeLower(value) === "all years") ||
            normalizeLower(requestedYearLevelValue) === "all years";
        const normalizedCourseTargets = Array.from(new Set(requestedCourseTargetsRaw
            .map((value) => normalizeCourseLabel(value))
            .filter(Boolean)));
        if (!requestedHasAllCourses && normalizedCourseTargets.length === 0) {
            const fallbackCourse = normalizeCourseLabel(requestedCourseValue);
            if (fallbackCourse) {
                normalizedCourseTargets.push(fallbackCourse);
            }
        }
        const normalizedYearTargets = Array.from(new Set(requestedYearTargetsRaw
            .map((value) => normalizeYear(value))
            .filter((value) => Boolean(value) &&
            value !== "Unassigned" &&
            normalizeLower(value) !== "all years")));
        if (!requestedHasAllYears && normalizedYearTargets.length === 0) {
            const fallbackYear = normalizeYear(requestedYearLevelValue);
            if (fallbackYear &&
                fallbackYear !== "Unassigned" &&
                normalizeLower(fallbackYear) !== "all years") {
                normalizedYearTargets.push(fallbackYear);
            }
        }
        const scopedSelectedProfiles = new Map();
        if (actorIsBod) {
            if (selectedStudentIds.length > 250) {
                throw new https_1.HttpsError("invalid-argument", "Too many selected students. Please reduce the audience size.");
            }
            if (selectedStudentIds.length > 0) {
                const selectedProfileRefs = selectedStudentIds.map((uid) => db.doc(`profiles/${uid}`));
                const selectedProfileSnaps = await db.getAll(...selectedProfileRefs);
                for (const profileSnap of selectedProfileSnaps) {
                    if (!profileSnap.exists) {
                        throw new https_1.HttpsError("permission-denied", "Selected students must belong to your assigned course scope.");
                    }
                    const profileData = (_b = profileSnap.data()) !== null && _b !== void 0 ? _b : {};
                    const profileCourseScope = normalizeCourseLabel(profileData.course);
                    if (!isStudentAudienceRole(profileData.role) ||
                        profileCourseScope !== actorCourseScope) {
                        throw new https_1.HttpsError("permission-denied", "Selected students must belong to your assigned course scope.");
                    }
                    scopedSelectedProfiles.set(profileSnap.id, profileData);
                }
            }
            const selectedScopedSchoolIds = new Set(Array.from(scopedSelectedProfiles.values())
                .map((profileData) => normalizeText(profileData.schoolId))
                .filter(Boolean));
            for (const selectedSchoolId of selectedSchoolIds) {
                if (selectedScopedSchoolIds.has(selectedSchoolId)) {
                    continue;
                }
                const scopedSchoolSnapshot = await db
                    .collection("profiles")
                    .where("schoolId", "==", selectedSchoolId)
                    .limit(20)
                    .get();
                const scopedSchoolMatch = scopedSchoolSnapshot.docs.some((profileDoc) => {
                    var _a;
                    const profileData = (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {};
                    return isStudentAudienceRole(profileData.role) &&
                        normalizeCourseLabel(profileData.course) === actorCourseScope;
                });
                if (!scopedSchoolMatch) {
                    throw new https_1.HttpsError("permission-denied", "Selected students must belong to your assigned course scope.");
                }
            }
        }
        let ownerType = "ec";
        let eventCourse = requestedHasAllCourses ?
            "All Courses" :
            requestedCourseValue || normalizedCourseTargets.join(", ") || "All Courses";
        let eventCourseScope = normalizeCourseLabel(body.courseScope) || null;
        let eventCourses = requestedHasAllCourses ? [] : [...normalizedCourseTargets];
        let eventYearLevel = requestedHasAllYears ?
            "All Years" :
            requestedYearLevelValue || normalizedYearTargets.join(", ") || "All Years";
        let eventYearLevels = requestedHasAllYears ? [] : [...normalizedYearTargets];
        let eventTargetStudent = requestedTargetStudent;
        let createdByCourseScope = actorIsAdmin ? null : actorCourseScope || null;
        const createdByPosition = normalizeECPosition(actorProfile.ecPosition) || null;
        if (actorIsBod) {
            ownerType = "bod";
            eventCourse = actorCourseScope;
            eventCourseScope = actorCourseScope;
            eventCourses = [actorCourseScope];
            createdByCourseScope = actorCourseScope;
            eventTargetStudent = selectedStudentIds.length > 0 ?
                `Specific students selected (${selectedStudentIds.length})` :
                "";
        }
        const eventDocRef = db.collection("events").doc();
        const eventId = eventDocRef.id;
        let linkedPaymentId = null;
        if (withPayment) {
            const amountValue = Number(body.paymentAmount);
            if (!Number.isFinite(amountValue) || amountValue <= 0) {
                throw new https_1.HttpsError("invalid-argument", "Amount is required for paid events.");
            }
            const explicitSelectedStudentIds = new Set(selectedStudentIds.map((uid) => normalizeLower(uid)));
            const explicitSelectedSchoolIds = new Set(selectedSchoolIds.map((schoolId) => normalizeLower(schoolId)));
            const hasExplicitSelectedAudience = explicitSelectedStudentIds.size > 0 || explicitSelectedSchoolIds.size > 0;
            const targetCourseSet = new Set(eventCourses
                .map((course) => normalizeLower(normalizeCourseLabel(course)))
                .filter(Boolean));
            const targetYearLevelSet = new Set(eventYearLevels
                .map((yearLevel) => normalizeLower(normalizeYear(yearLevel)))
                .filter((yearLevel) => Boolean(yearLevel) &&
                yearLevel !== "all years" &&
                yearLevel !== "unassigned"));
            const audienceCandidates = new Map();
            if (selectedStudentIds.length > 0) {
                const selectedRefs = selectedStudentIds.map((uid) => db.doc(`profiles/${uid}`));
                const selectedSnaps = await db.getAll(...selectedRefs);
                selectedSnaps.forEach((profileSnap) => {
                    var _a;
                    if (!profileSnap.exists) {
                        return;
                    }
                    audienceCandidates.set(profileSnap.id, (_a = profileSnap.data()) !== null && _a !== void 0 ? _a : {});
                });
            }
            if (selectedSchoolIds.length > 0) {
                for (const schoolId of selectedSchoolIds) {
                    const profileSnapshot = await db
                        .collection("profiles")
                        .where("schoolId", "==", schoolId)
                        .limit(25)
                        .get();
                    profileSnapshot.docs.forEach((profileDoc) => {
                        var _a;
                        audienceCandidates.set(profileDoc.id, (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {});
                    });
                }
            }
            if (audienceCandidates.size === 0) {
                const profileSnapshot = await db
                    .collection("profiles")
                    .where("role", "in", [...STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES])
                    .limit(5000)
                    .get();
                profileSnapshot.docs.forEach((profileDoc) => {
                    var _a;
                    audienceCandidates.set(profileDoc.id, (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {});
                });
            }
            const paymentTargets = Array.from(audienceCandidates.entries())
                .map(([uid, profileData]) => {
                var _a;
                const schoolId = normalizeText(profileData.schoolId) || uid;
                const course = normalizeCourseLabel(profileData.course) ||
                    normalizeText(profileData.course) ||
                    "Unassigned";
                const year = normalizeYear((_a = profileData.yearLevel) !== null && _a !== void 0 ? _a : profileData.year);
                const studentName = resolveProfileDisplayName(profileData);
                const status = normalizeLower(profileData.status);
                return {
                    uid,
                    schoolId,
                    studentName,
                    course,
                    year,
                    status,
                    role: normalizeText(profileData.role),
                };
            })
                .filter((student) => isStudentAudienceRole(student.role))
                .filter((student) => student.status !== "inactive")
                .filter((student) => {
                if (actorIsBod &&
                    actorCourseScope &&
                    normalizeCourseLabel(student.course) !== actorCourseScope) {
                    return false;
                }
                if (hasExplicitSelectedAudience) {
                    return explicitSelectedStudentIds.has(normalizeLower(student.uid)) ||
                        explicitSelectedSchoolIds.has(normalizeLower(student.schoolId));
                }
                const matchesCourse = targetCourseSet.size === 0 ||
                    targetCourseSet.has(normalizeLower(normalizeCourseLabel(student.course)));
                const matchesYear = targetYearLevelSet.size === 0 ||
                    targetYearLevelSet.has(normalizeLower(normalizeYear(student.year)));
                return matchesCourse && matchesYear;
            })
                .sort((left, right) => {
                const bySchoolId = left.schoolId.localeCompare(right.schoolId);
                if (bySchoolId !== 0) {
                    return bySchoolId;
                }
                return left.studentName.localeCompare(right.studentName);
            });
            if (paymentTargets.length === 0) {
                throw new https_1.HttpsError("invalid-argument", "No active students match the selected audience for this paid event.");
            }
            const paymentDocRef = db.collection("payments").doc();
            linkedPaymentId = paymentDocRef.id;
            await paymentDocRef.set({
                title: normalizeText(body.paymentTitle) || title,
                ref: makePaymentRef(paymentDocRef.id),
                amount: amountValue,
                date: normalizeText(body.paymentDueDate),
                yearLevel: eventYearLevel || "All Years",
                course: eventCourse || "All Courses",
                targetStudent: eventTargetStudent,
                targetYearLevels: eventYearLevels,
                targetCourses: eventCourses,
                details: normalizeText(body.paymentDescription),
                linkedEventId: eventId,
                eventId,
                linkedEventTitle: title,
                createdByUid: actorUid,
                createdByRole: actorIsAdmin ? "admin" : "ecmember",
                createdByCourseScope,
                courseScope: eventCourses.length === 1 ? eventCourses[0] : null,
                source: "event",
                status: "active",
                totalStudents: paymentTargets.length,
                paidCount: 0,
                unpaidCount: paymentTargets.length,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            const writesPerBatch = 350;
            for (let index = 0; index < paymentTargets.length; index += writesPerBatch) {
                const batch = db.batch();
                const chunk = paymentTargets.slice(index, index + writesPerBatch);
                chunk.forEach((student) => {
                    batch.set(db.doc(`payments/${paymentDocRef.id}/students/${student.uid}`), {
                        uid: student.uid,
                        schoolId: student.schoolId,
                        name: student.studentName,
                        studentName: student.studentName,
                        year: student.year || "-",
                        section: "-",
                        course: student.course || "-",
                        status: "Unpaid",
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                });
                await batch.commit();
            }
        }
        const preRegCount = 0;
        const waitlistCount = 0;
        const preRegRemaining = isPreReg && typeof preRegSlots === "number" ?
            Math.max(0, preRegSlots - preRegCount) :
            0;
        await eventDocRef.set({
            title,
            location,
            date,
            scheduledTime,
            timeStart: scheduledTime,
            timeEnd,
            yearLevel: eventYearLevel || "All Years",
            course: eventCourse || "All Courses",
            yearLevels: eventYearLevels,
            courses: eventCourses,
            targetStudent: eventTargetStudent,
            selectedStudentIds,
            selectedSchoolIds,
            details,
            isPreReg,
            withPayment,
            paymentRequired: withPayment,
            waitlistEnabled,
            requiredPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : "",
            linkedPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : null,
            registrationStartAt,
            registrationEndAt,
            cancellationDeadlineAt,
            preRegSlots,
            preRegCount,
            preRegRemaining,
            waitlistCount,
            ownerType,
            courseScope: eventCourseScope,
            createdBy: actorUid,
            createdByPosition,
            createdByCourseScope,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: "upcoming",
        });
        await writeStructuredAuditLog({
            actorUid,
            action: "event_created_via_callable",
            targetType: "event",
            targetId: eventId,
            metadata: {
                ownerType,
                courseScope: eventCourseScope,
                withPayment,
                linkedPaymentId: linkedPaymentId || null,
            },
        }).catch((error) => {
            authLogger.warn("createCampusEvent audit log write failed", { error });
        });
        return {
            eventId,
            linkedPaymentId,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", error instanceof Error && error.message ?
            error.message :
            "Failed to create event.");
    }
});
exports.updateCampusEvent = (0, https_1.onCall)({ region: REGION }, async (request) => {
    var _a, _b, _c, _d;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to update an event.");
    }
    try {
        const actorUid = normalizeText(request.auth.uid);
        const actorProfile = await callerProfileData(request);
        const actorRole = normalizeCampusRoleValue(actorProfile.role);
        const actorIsAdmin = actorRole === "admin";
        const actorIsEcMember = isECMemberRole(actorProfile.role);
        const actorIsBod = actorIsEcMember && isBodProfileData(actorProfile);
        const actorIsRegularEc = actorIsEcMember &&
            !actorIsBod &&
            resolveProfileEcScope(actorProfile) === "all";
        if (!actorIsAdmin && !actorIsRegularEc && !actorIsBod) {
            throw new https_1.HttpsError("permission-denied", "Only admin, regular EC, or B.O.D. users can update events.");
        }
        const body = asRecord(request.data);
        const eventId = normalizeText(body.eventId);
        const title = normalizeText(body.title);
        const location = normalizeText(body.location);
        const date = normalizeText(body.date);
        const timeStart = normalizeText(body.timeStart) ||
            normalizeText(body.scheduledTime);
        const scheduledTime = normalizeText(body.scheduledTime) || timeStart;
        const timeEnd = normalizeText(body.timeEnd);
        const details = normalizeText(body.details);
        if (!eventId) {
            throw new https_1.HttpsError("invalid-argument", "eventId is required.");
        }
        if (!title) {
            throw new https_1.HttpsError("invalid-argument", "Title is required.");
        }
        if (!location) {
            throw new https_1.HttpsError("invalid-argument", "Location is required.");
        }
        if (!date) {
            throw new https_1.HttpsError("invalid-argument", "Date is required.");
        }
        if (!timeStart) {
            throw new https_1.HttpsError("invalid-argument", "timeStart is required.");
        }
        if (!timeEnd) {
            throw new https_1.HttpsError("invalid-argument", "timeEnd is required.");
        }
        const eventStartMs = parseEventStartMs(date, scheduledTime);
        const eventEndMs = parseEventStartMs(date, timeEnd);
        if (eventStartMs !== Number.MAX_SAFE_INTEGER &&
            eventEndMs !== Number.MAX_SAFE_INTEGER &&
            eventEndMs <= eventStartMs) {
            throw new https_1.HttpsError("invalid-argument", "End time must be later than start time.");
        }
        const eventRef = db.doc(`events/${eventId}`);
        const eventSnapshot = await eventRef.get();
        if (!eventSnapshot.exists) {
            throw new https_1.HttpsError("not-found", "Event not found.");
        }
        const existingEventData = (_b = eventSnapshot.data()) !== null && _b !== void 0 ? _b : {};
        const existingEventOwnerType = normalizeLower(existingEventData.ownerType) === "bod" ?
            "bod" :
            "ec";
        const existingEventCourseScope = normalizeCourseLabel(existingEventData.courseScope) ||
            normalizeCourseLabel(existingEventData.course);
        const actorCourseScope = resolveProfileCourseScope(actorProfile);
        if (actorIsBod) {
            if (!actorCourseScope) {
                throw new https_1.HttpsError("permission-denied", "B.O.D. profile is missing a valid course scope.");
            }
            if (existingEventOwnerType !== "bod") {
                throw new https_1.HttpsError("permission-denied", "B.O.D. members can only update their own B.O.D.-created events.");
            }
            if (normalizeText(existingEventData.createdBy) !== actorUid) {
                throw new https_1.HttpsError("permission-denied", "B.O.D. members can only update their own B.O.D.-created events.");
            }
            if (!existingEventCourseScope || existingEventCourseScope !== actorCourseScope) {
                throw new https_1.HttpsError("permission-denied", "B.O.D. members can only update events from their assigned course.");
            }
        }
        const isPreReg = body.isPreReg === true;
        const waitlistEnabled = isPreReg ? body.waitlistEnabled === true : false;
        const parsedPreRegSlots = Number(body.preRegSlots);
        if (isPreReg && (!Number.isFinite(parsedPreRegSlots) || parsedPreRegSlots < 0)) {
            throw new https_1.HttpsError("invalid-argument", "Pre-reg slots must be at least 0.");
        }
        const preRegSlots = isPreReg ? Math.max(0, Math.trunc(parsedPreRegSlots)) : null;
        const registrationStartAt = isPreReg ? toFirestoreDateOrNull(body.registrationStartAt) : null;
        const registrationEndAt = isPreReg ? toFirestoreDateOrNull(body.registrationEndAt) : null;
        const cancellationDeadlineAt = isPreReg ?
            toFirestoreDateOrNull(body.cancellationDeadlineAt) :
            null;
        if (isPreReg &&
            (!registrationStartAt || !registrationEndAt || !cancellationDeadlineAt)) {
            throw new https_1.HttpsError("invalid-argument", "Set valid registration and cancellation date/time values.");
        }
        if (isPreReg &&
            registrationStartAt &&
            registrationEndAt &&
            registrationStartAt.getTime() > registrationEndAt.getTime()) {
            throw new https_1.HttpsError("invalid-argument", "Registration start must be earlier than the end.");
        }
        if (isPreReg &&
            registrationEndAt &&
            eventStartMs !== Number.MAX_SAFE_INTEGER &&
            registrationEndAt.getTime() > eventStartMs) {
            throw new https_1.HttpsError("invalid-argument", "Registration end must be on or before the event start time.");
        }
        if (isPreReg &&
            cancellationDeadlineAt &&
            registrationStartAt &&
            cancellationDeadlineAt.getTime() < registrationStartAt.getTime()) {
            throw new https_1.HttpsError("invalid-argument", "Cancellation deadline cannot be earlier than registration start.");
        }
        if (isPreReg &&
            cancellationDeadlineAt &&
            registrationEndAt &&
            cancellationDeadlineAt.getTime() > registrationEndAt.getTime()) {
            throw new https_1.HttpsError("invalid-argument", "Cancellation deadline must be on or before registration end.");
        }
        const selectedStudentIds = toUniqueIdentifierList(body.selectedStudentIds)
            .filter((uid) => !uid.startsWith("manual-"));
        const selectedSchoolIdsInput = toUniqueIdentifierList(body.selectedSchoolIds)
            .filter((schoolId) => schoolId !== "Unknown ID");
        let selectedSchoolIds = [...selectedSchoolIdsInput];
        const requestedCourseValue = normalizeText(body.course);
        const requestedYearLevelValue = normalizeText(body.yearLevel);
        const requestedTargetStudent = normalizeText(body.targetStudent);
        const requestedCourseTargetsRaw = Array.from(new Set(toTargetList(body.courses)
            .map((value) => normalizeText(value))
            .filter(Boolean)));
        const requestedYearTargetsRaw = Array.from(new Set(toTargetList(body.yearLevels)
            .map((value) => normalizeText(value))
            .filter(Boolean)));
        const requestedHasAllCourses = requestedCourseTargetsRaw.some((value) => normalizeLower(value) === "all courses") ||
            normalizeLower(requestedCourseValue) === "all courses";
        const requestedHasAllYears = requestedYearTargetsRaw.some((value) => normalizeLower(value) === "all years") ||
            normalizeLower(requestedYearLevelValue) === "all years";
        const normalizedCourseTargets = Array.from(new Set(requestedCourseTargetsRaw
            .map((value) => normalizeCourseLabel(value))
            .filter(Boolean)));
        if (!requestedHasAllCourses && normalizedCourseTargets.length === 0) {
            const fallbackCourse = normalizeCourseLabel(requestedCourseValue);
            if (fallbackCourse) {
                normalizedCourseTargets.push(fallbackCourse);
            }
        }
        const normalizedYearTargets = Array.from(new Set(requestedYearTargetsRaw
            .map((value) => normalizeYear(value))
            .filter((value) => Boolean(value) &&
            value !== "Unassigned" &&
            normalizeLower(value) !== "all years")));
        if (!requestedHasAllYears && normalizedYearTargets.length === 0) {
            const fallbackYear = normalizeYear(requestedYearLevelValue);
            if (fallbackYear &&
                fallbackYear !== "Unassigned" &&
                normalizeLower(fallbackYear) !== "all years") {
                normalizedYearTargets.push(fallbackYear);
            }
        }
        let ownerType = normalizeLower(body.ownerType) === "bod" ? "bod" :
            normalizeLower(body.ownerType) === "ec" ? "ec" :
                existingEventOwnerType;
        let eventCourse = requestedHasAllCourses ?
            "All Courses" :
            requestedCourseValue || normalizedCourseTargets.join(", ") || "All Courses";
        let eventCourseScope = normalizeCourseLabel(body.courseScope) || null;
        let eventCourses = requestedHasAllCourses ? [] : [...normalizedCourseTargets];
        let eventYearLevel = requestedHasAllYears ?
            "All Years" :
            requestedYearLevelValue || normalizedYearTargets.join(", ") || "All Years";
        let eventYearLevels = requestedHasAllYears ? [] : [...normalizedYearTargets];
        let eventTargetStudent = requestedTargetStudent;
        const selectedProfilesByUid = new Map();
        if (actorIsBod) {
            ownerType = "bod";
            eventCourse = actorCourseScope;
            eventCourseScope = actorCourseScope;
            eventCourses = [actorCourseScope];
            if (selectedStudentIds.length > 0) {
                const selectedProfileRefs = selectedStudentIds.map((uid) => db.doc(`profiles/${uid}`));
                const selectedProfileSnapshots = await db.getAll(...selectedProfileRefs);
                for (const selectedProfileSnapshot of selectedProfileSnapshots) {
                    if (!selectedProfileSnapshot.exists) {
                        throw new https_1.HttpsError("permission-denied", "B.O.D. members can only target students from their assigned course.");
                    }
                    const selectedProfileData = (_c = selectedProfileSnapshot.data()) !== null && _c !== void 0 ? _c : {};
                    if (!isStudentAudienceRole(selectedProfileData.role) ||
                        normalizeCourseLabel(selectedProfileData.course) !== actorCourseScope) {
                        throw new https_1.HttpsError("permission-denied", "B.O.D. members can only target students from their assigned course.");
                    }
                    selectedProfilesByUid.set(selectedProfileSnapshot.id, selectedProfileData);
                }
                selectedSchoolIds = Array.from(new Set(selectedStudentIds
                    .map((uid) => { var _a; return normalizeText((_a = selectedProfilesByUid.get(uid)) === null || _a === void 0 ? void 0 : _a.schoolId); })
                    .filter(Boolean)));
                eventTargetStudent = `Specific students selected (${selectedStudentIds.length})`;
            }
            else {
                selectedSchoolIds = [];
                eventTargetStudent = "";
            }
        }
        const parsedPreRegCount = Number(body.preRegCount);
        const parsedWaitlistCount = Number(body.waitlistCount);
        const preRegCount = isPreReg ?
            (Number.isFinite(parsedPreRegCount) ?
                Math.max(0, Math.trunc(parsedPreRegCount)) :
                toPositiveNumber(existingEventData.preRegCount)) :
            0;
        const waitlistCount = isPreReg ?
            (Number.isFinite(parsedWaitlistCount) ?
                Math.max(0, Math.trunc(parsedWaitlistCount)) :
                toPositiveNumber(existingEventData.waitlistCount)) :
            0;
        const preRegRemaining = isPreReg && typeof preRegSlots === "number" ?
            Math.max(0, preRegSlots - preRegCount) :
            0;
        const withPayment = body.withPayment === true || body.paymentRequired === true;
        const previousLinkedPaymentId = normalizeText(existingEventData.linkedPaymentId) ||
            normalizeText(existingEventData.requiredPaymentId);
        const requestedLinkedPaymentId = normalizeText(body.linkedPaymentId) ||
            normalizeText(body.requiredPaymentId);
        const paymentTitle = normalizeText(body.paymentTitle);
        const paymentDueDate = normalizeText(body.paymentDueDate);
        const paymentDescription = normalizeText(body.paymentDescription);
        let linkedPaymentId = null;
        if (withPayment) {
            const amountValue = Number(body.paymentAmount);
            if (!Number.isFinite(amountValue) || amountValue <= 0) {
                throw new https_1.HttpsError("invalid-argument", "Amount is required for paid events.");
            }
            linkedPaymentId =
                requestedLinkedPaymentId ||
                    previousLinkedPaymentId ||
                    db.collection("payments").doc().id;
            const paymentRef = db.doc(`payments/${linkedPaymentId}`);
            const paymentSnapshot = await paymentRef.get();
            const existingPaymentData = (_d = paymentSnapshot.data()) !== null && _d !== void 0 ? _d : {};
            const createdByUid = normalizeText(existingPaymentData.createdByUid) ||
                normalizeText(existingEventData.createdBy) ||
                actorUid;
            const createdByRole = normalizeText(existingPaymentData.createdByRole) ||
                (actorIsAdmin ? "admin" : "ecmember");
            const createdByCourseScope = actorIsBod ?
                actorCourseScope :
                normalizeCourseLabel(existingPaymentData.createdByCourseScope) ||
                    normalizeCourseLabel(existingEventData.createdByCourseScope) ||
                    resolveProfileCourseScope(actorProfile) ||
                    null;
            await paymentRef.set(Object.assign({ title: paymentTitle || title, ref: normalizeText(existingPaymentData.ref) ||
                    makePaymentRef(linkedPaymentId), amount: amountValue, date: paymentDueDate, yearLevel: eventYearLevel || "All Years", course: eventCourse || "All Courses", targetStudent: eventTargetStudent, targetYearLevels: eventYearLevels, targetCourses: eventCourses, details: paymentDescription, linkedEventId: eventId, eventId, linkedEventTitle: title, createdByUid,
                createdByRole,
                createdByCourseScope, courseScope: eventCourses.length === 1 ? eventCourses[0] : null, source: "event", status: "active", updatedAt: serverTimestamp() }, (paymentSnapshot.exists ? {} : { createdAt: serverTimestamp() })), { merge: true });
            if (actorIsBod) {
                const assignmentSnapshot = await paymentRef.collection("students").get();
                const existingAssignments = new Map();
                assignmentSnapshot.docs.forEach((assignmentDoc) => {
                    var _a;
                    const assignmentData = (_a = assignmentDoc.data()) !== null && _a !== void 0 ? _a : {};
                    const status = normalizeLower(assignmentData.status) === "paid" ? "Paid" : "Unpaid";
                    existingAssignments.set(assignmentDoc.id, { status });
                });
                const explicitStudentIds = new Set(selectedStudentIds.map((uid) => normalizeLower(uid)));
                const explicitSchoolIds = new Set(selectedSchoolIds.map((schoolId) => normalizeLower(schoolId)));
                const hasExplicitAudience = explicitStudentIds.size > 0 || explicitSchoolIds.size > 0;
                const targetYearSet = new Set(eventYearLevels
                    .map((value) => normalizeLower(normalizeYear(value)))
                    .filter((value) => Boolean(value) &&
                    value !== "all years" &&
                    value !== "unassigned"));
                const audienceCandidates = new Map();
                if (selectedStudentIds.length > 0) {
                    selectedStudentIds.forEach((uid) => {
                        const selectedProfile = selectedProfilesByUid.get(uid);
                        if (selectedProfile) {
                            audienceCandidates.set(uid, selectedProfile);
                        }
                    });
                }
                if (selectedSchoolIds.length > 0) {
                    for (const selectedSchoolId of selectedSchoolIds) {
                        const schoolSnapshot = await db
                            .collection("profiles")
                            .where("schoolId", "==", selectedSchoolId)
                            .limit(25)
                            .get();
                        schoolSnapshot.docs.forEach((schoolDoc) => {
                            var _a;
                            audienceCandidates.set(schoolDoc.id, (_a = schoolDoc.data()) !== null && _a !== void 0 ? _a : {});
                        });
                    }
                }
                if (audienceCandidates.size === 0) {
                    const profileSnapshot = await db
                        .collection("profiles")
                        .where("role", "in", [...STUDENT_AUDIENCE_LOOKUP_PROFILE_ROLES])
                        .limit(5000)
                        .get();
                    profileSnapshot.docs.forEach((profileDoc) => {
                        var _a;
                        audienceCandidates.set(profileDoc.id, (_a = profileDoc.data()) !== null && _a !== void 0 ? _a : {});
                    });
                }
                const paymentTargets = Array.from(audienceCandidates.entries())
                    .map(([uid, profileData]) => {
                    var _a;
                    const schoolId = normalizeText(profileData.schoolId) || uid;
                    const course = normalizeCourseLabel(profileData.course) ||
                        normalizeText(profileData.course) ||
                        "Unassigned";
                    const year = normalizeYear((_a = profileData.yearLevel) !== null && _a !== void 0 ? _a : profileData.year);
                    const studentName = resolveProfileDisplayName(profileData);
                    const status = normalizeLower(profileData.status);
                    return {
                        uid,
                        schoolId,
                        studentName,
                        course,
                        year,
                        status,
                        role: normalizeText(profileData.role),
                    };
                })
                    .filter((student) => isStudentAudienceRole(student.role))
                    .filter((student) => student.status !== "inactive")
                    .filter((student) => normalizeCourseLabel(student.course) === actorCourseScope)
                    .filter((student) => {
                    if (hasExplicitAudience) {
                        return explicitStudentIds.has(normalizeLower(student.uid)) ||
                            explicitSchoolIds.has(normalizeLower(student.schoolId));
                    }
                    return targetYearSet.size === 0 ||
                        targetYearSet.has(normalizeLower(normalizeYear(student.year)));
                })
                    .sort((left, right) => {
                    const bySchoolId = left.schoolId.localeCompare(right.schoolId);
                    if (bySchoolId !== 0) {
                        return bySchoolId;
                    }
                    return left.studentName.localeCompare(right.studentName);
                });
                if (paymentTargets.length === 0) {
                    throw new https_1.HttpsError("invalid-argument", "No active students match the selected audience for this paid event.");
                }
                const nextTargetIds = new Set(paymentTargets.map((student) => student.uid));
                let paidCount = 0;
                const upsertRows = paymentTargets.map((student) => {
                    var _a, _b;
                    const existingStatus = (_b = (_a = existingAssignments.get(student.uid)) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : "Unpaid";
                    if (existingStatus === "Paid") {
                        paidCount += 1;
                    }
                    return {
                        student,
                        status: existingStatus,
                    };
                });
                const writesPerBatch = 350;
                for (let index = 0; index < upsertRows.length; index += writesPerBatch) {
                    const batch = db.batch();
                    const chunk = upsertRows.slice(index, index + writesPerBatch);
                    chunk.forEach(({ student, status }) => {
                        batch.set(db.doc(`payments/${linkedPaymentId}/students/${student.uid}`), Object.assign({ uid: student.uid, schoolId: student.schoolId, name: student.studentName, studentName: student.studentName, year: student.year || "-", section: "-", course: student.course || "-", status, updatedAt: serverTimestamp() }, (existingAssignments.has(student.uid) ? {} : { createdAt: serverTimestamp() })), { merge: true });
                    });
                    await batch.commit();
                }
                const removedAssignmentIds = Array.from(existingAssignments.keys()).filter((uid) => !nextTargetIds.has(uid));
                for (let index = 0; index < removedAssignmentIds.length; index += writesPerBatch) {
                    const batch = db.batch();
                    removedAssignmentIds
                        .slice(index, index + writesPerBatch)
                        .forEach((uid) => {
                        batch.delete(db.doc(`payments/${linkedPaymentId}/students/${uid}`));
                    });
                    await batch.commit();
                }
                await paymentRef.set({
                    totalStudents: paymentTargets.length,
                    paidCount,
                    unpaidCount: Math.max(0, paymentTargets.length - paidCount),
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            }
        }
        else if (previousLinkedPaymentId) {
            await db.doc(`payments/${previousLinkedPaymentId}`).set({
                status: "archived",
                linkedEventId: null,
                eventId: null,
                linkedEventTitle: "",
                updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        const updatePayload = {
            title,
            location,
            date,
            scheduledTime,
            timeStart,
            timeEnd,
            yearLevel: eventYearLevel || "All Years",
            course: eventCourse || "All Courses",
            yearLevels: eventYearLevels,
            courses: eventCourses,
            targetStudent: eventTargetStudent,
            selectedStudentIds,
            selectedSchoolIds,
            details,
            isPreReg,
            withPayment,
            paymentRequired: withPayment,
            waitlistEnabled,
            requiredPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : "",
            linkedPaymentId: withPayment && linkedPaymentId ? linkedPaymentId : null,
            registrationStartAt,
            registrationEndAt,
            cancellationDeadlineAt,
            preRegSlots,
            preRegCount,
            preRegRemaining,
            waitlistCount,
        };
        if (actorIsBod) {
            updatePayload.ownerType = "bod";
            updatePayload.createdBy = normalizeText(existingEventData.createdBy) || actorUid;
            updatePayload.createdByPosition = normalizeECPosition(actorProfile.ecPosition) || null;
            updatePayload.course = actorCourseScope;
            updatePayload.courseScope = actorCourseScope;
            updatePayload.createdByCourseScope = actorCourseScope;
            updatePayload.courses = [actorCourseScope];
        }
        else {
            updatePayload.ownerType = ownerType;
            updatePayload.createdBy =
                normalizeText(existingEventData.createdBy) ||
                    normalizeText(body.createdBy) ||
                    actorUid;
            updatePayload.createdByPosition =
                normalizeText(body.createdByPosition) ||
                    normalizeText(existingEventData.createdByPosition) ||
                    null;
            updatePayload.courseScope = eventCourseScope;
            updatePayload.createdByCourseScope =
                normalizeCourseLabel(body.createdByCourseScope) ||
                    normalizeCourseLabel(existingEventData.createdByCourseScope) ||
                    null;
        }
        await eventRef.update(Object.assign(Object.assign({}, updatePayload), { updatedAt: serverTimestamp() }));
        await writeStructuredAuditLog({
            actorUid,
            action: "event_updated_via_callable",
            targetType: "event",
            targetId: eventId,
            metadata: {
                ownerType: updatePayload.ownerType,
                courseScope: updatePayload.courseScope,
                withPayment,
                linkedPaymentId: withPayment ? linkedPaymentId : null,
            },
        }).catch((error) => {
            authLogger.warn("updateCampusEvent audit log write failed", { error });
        });
        return {
            eventId,
            updated: true,
            linkedPaymentId: withPayment ? linkedPaymentId : null,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", error instanceof Error && error.message ?
            error.message :
            "Failed to update event.");
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
    const normalizedRole = normalizeCampusRoleValue(profileData.role);
    if (normalizedRole && normalizeText(profileData.role) !== normalizedRole) {
        await profileRef.set({
            role: normalizedRole,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        profileData.role = normalizedRole;
    }
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
exports.logPermissionDeniedAttempt = (0, https_1.onCall)({ region: REGION }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Login required.");
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
    return { ok: true };
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
        if (!isStudentAudienceRole(role)) {
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
        if (!matchesSelectedAudience(eventData, uid, schoolId)) {
            throw new https_1.HttpsError("permission-denied", "You are not part of the allowed audience for this event.");
        }
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
        if (!hasExplicitSelectedAudience(eventData)) {
            if (!matchesTargetList(courseValue, course, "All Courses")) {
                throw new https_1.HttpsError("permission-denied", "Your course is not allowed for this event.");
            }
            if (!matchesTargetList(yearValue, year, "All Years")) {
                throw new https_1.HttpsError("permission-denied", "Your year level is not allowed for this event.");
            }
            if (!matchesSpecificStudentTarget(eventData.targetStudent, schoolId, studentName)) {
                throw new https_1.HttpsError("permission-denied", "You are not part of the allowed audience for this event.");
            }
        }
        const requiredPaymentId = normalizeText(eventData.linkedPaymentId) ||
            normalizeText(eventData.requiredPaymentId);
        if (eventData.withPayment === true || eventData.paymentRequired === true) {
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
exports.auditStudentWrites = (0, firestore_1.onDocumentUpdatedWithAuthContext)({ region: REGION, document: "students/{studentId}" }, async (event) => {
    var _a, _b, _c, _d;
    if (shouldSkipAuthContextAudit(event)) {
        return;
    }
    const beforeData = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data()) !== null && _b !== void 0 ? _b : {};
    const afterData = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after.data()) !== null && _d !== void 0 ? _d : {};
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
});
exports.auditEventCreates = (0, firestore_1.onDocumentCreatedWithAuthContext)({ region: REGION, document: "events/{eventId}" }, async (event) => {
    var _a, _b, _c, _d;
    if (shouldSkipAuthContextAudit(event)) {
        return;
    }
    await writeStructuredAuditLog({
        actorUid: event.authId,
        action: "event_created",
        targetType: "event",
        targetId: normalizeText(event.params.eventId),
        metadata: {
            ownerType: normalizeText((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data()) === null || _b === void 0 ? void 0 : _b.ownerType),
            courseScope: normalizeCourseLabel((_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.data()) === null || _d === void 0 ? void 0 : _d.courseScope) || null,
        },
    });
});
exports.auditEventUpdates = (0, firestore_1.onDocumentUpdatedWithAuthContext)({ region: REGION, document: "events/{eventId}" }, async (event) => {
    var _a, _b, _c, _d;
    if (shouldSkipAuthContextAudit(event)) {
        return;
    }
    await writeStructuredAuditLog({
        actorUid: event.authId,
        action: "event_edited",
        targetType: "event",
        targetId: normalizeText(event.params.eventId),
        metadata: {
            ownerType: normalizeText((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data()) === null || _b === void 0 ? void 0 : _b.ownerType),
            courseScope: normalizeCourseLabel((_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after.data()) === null || _d === void 0 ? void 0 : _d.courseScope) || null,
        },
    });
});
exports.auditEventDeletes = (0, firestore_1.onDocumentDeletedWithAuthContext)({ region: REGION, document: "events/{eventId}" }, async (event) => {
    var _a, _b, _c, _d;
    if (shouldSkipAuthContextAudit(event)) {
        return;
    }
    await writeStructuredAuditLog({
        actorUid: event.authId,
        action: "event_deleted",
        targetType: "event",
        targetId: normalizeText(event.params.eventId),
        metadata: {
            ownerType: normalizeText((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data()) === null || _b === void 0 ? void 0 : _b.ownerType),
            courseScope: normalizeCourseLabel((_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.data()) === null || _d === void 0 ? void 0 : _d.courseScope) || null,
        },
    });
});
// Portable device HTTP endpoints now live exclusively in the
// `portable-device-functions` codebase. Keeping them out of the default
// codebase avoids Firebase deploy ownership conflicts for the same
// `campusDevice*` function names.
//# sourceMappingURL=index.js.map