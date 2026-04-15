export type CampusLogLevel = "debug" | "info" | "warn" | "error";

type CampusLogger = {
  debug: (message: string, payload?: unknown) => void;
  info: (message: string, payload?: unknown) => void;
  warn: (message: string, payload?: unknown) => void;
  error: (message: string, payload?: unknown) => void;
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 500;

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

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string) {
  const normalized = normalizeKey(key);
  return (
    exactSensitiveKeys.has(normalized) ||
    fragmentSensitiveKeys.some((fragment) => normalized.includes(fragment))
  );
}

function sanitizeString(value: string) {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...`
    : value;
}

function sanitizeError(error: Error & { code?: unknown }) {
  return {
    name: error.name,
    message: sanitizeString(error.message),
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(!IS_PRODUCTION && error.stack
      ? { stack: sanitizeString(error.stack) }
      : {}),
  };
}

function sanitizeValue(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>,
): unknown {
  if (value == null) return value;
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeError(value as Error & { code?: unknown });
  }

  if (depth >= MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[Array(${value.length})]`;
    }

    return "[Object]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    const nextSeen = seen ?? new WeakSet<object>();
    if (nextSeen.has(value)) return "[Circular]";
    nextSeen.add(value);

    const objectValue = value as Record<string, unknown>;
    const entries = Object.entries(objectValue).slice(0, 30);

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [
        key,
        isSensitiveKey(key)
          ? "[Redacted]"
          : sanitizeValue(entryValue, depth + 1, nextSeen),
      ]),
    );
  }

  return String(value);
}

function writeLog(level: CampusLogLevel, message: string, payload?: unknown) {
  if ((level === "debug" || level === "info") && IS_PRODUCTION) {
    return;
  }

  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.info;

  if (typeof payload === "undefined") {
    logger(message);
    return;
  }

  logger(message, sanitizeValue(payload));
}

export function logDebug(message: string, payload?: unknown) {
  writeLog("debug", message, payload);
}

export function logInfo(message: string, payload?: unknown) {
  writeLog("info", message, payload);
}

export function logWarn(message: string, payload?: unknown) {
  writeLog("warn", message, payload);
}

export function logError(message: string, payload?: unknown) {
  writeLog("error", message, payload);
}

export function createCampusLogger(scope: string): CampusLogger {
  const prefix = `[${scope}]`;

  return {
    debug: (message, payload) => logDebug(`${prefix} ${message}`, payload),
    info: (message, payload) => logInfo(`${prefix} ${message}`, payload),
    warn: (message, payload) => logWarn(`${prefix} ${message}`, payload),
    error: (message, payload) => logError(`${prefix} ${message}`, payload),
  };
}
