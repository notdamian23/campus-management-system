"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCampusLogger = createCampusLogger;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_DEPTH = 4;
const exactSensitiveKeys = new Set([
    "actionurl",
    "authorization",
    "currentuseremail",
    "downloadurl",
    "email",
    "enteredemail",
    "fileurl",
    "link",
    "oobcode",
    "password",
    "pendingemail",
    "profile",
    "resetlink",
    "reseturl",
    "serverresponse",
    "storagepath",
    "targetemail",
    "url",
]);
const fragmentSensitiveKeys = [
    "password",
    "token",
    "secret",
    "authorization",
    "authheader",
    "cookie",
];
function normalizeKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isSensitiveKey(key) {
    const normalized = normalizeKey(key);
    return (exactSensitiveKeys.has(normalized) ||
        fragmentSensitiveKeys.some((fragment) => normalized.includes(fragment)));
}
function sanitizeError(error) {
    return Object.assign(Object.assign({ name: error.name, message: error.message }, (typeof error.code === "string" ? { code: error.code } : {})), (!IS_PRODUCTION && error.stack ? { stack: error.stack } : {}));
}
function sanitizeValue(value, depth = 0, seen) {
    if (value == null)
        return value;
    if (typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        typeof value === "string") {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value instanceof Error) {
        return sanitizeError(value);
    }
    if (depth >= MAX_DEPTH) {
        return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1, seen));
    }
    if (typeof value === "object") {
        const nextSeen = seen !== null && seen !== void 0 ? seen : new WeakSet();
        if (nextSeen.has(value))
            return "[Circular]";
        nextSeen.add(value);
        return Object.fromEntries(Object.entries(value)
            .slice(0, 30)
            .map(([key, entryValue]) => [
            key,
            isSensitiveKey(key) ?
                "[Redacted]" :
                sanitizeValue(entryValue, depth + 1, nextSeen),
        ]));
    }
    return String(value);
}
function writeLog(level, message, payload) {
    if ((level === "debug" || level === "info") && IS_PRODUCTION) {
        return;
    }
    const logger = level === "error" ?
        console.error :
        level === "warn" ?
            console.warn :
            level === "debug" ?
                console.debug :
                console.info;
    if (typeof payload === "undefined") {
        logger(message);
        return;
    }
    logger(message, sanitizeValue(payload));
}
function createCampusLogger(scope) {
    const prefix = `[${scope}]`;
    return {
        debug: (message, payload) => writeLog("debug", `${prefix} ${message}`, payload),
        info: (message, payload) => writeLog("info", `${prefix} ${message}`, payload),
        warn: (message, payload) => writeLog("warn", `${prefix} ${message}`, payload),
        error: (message, payload) => writeLog("error", `${prefix} ${message}`, payload),
    };
}
//# sourceMappingURL=campusLogger.js.map