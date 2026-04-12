import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import type { CampusProfileDoc } from "@/lib/campus-auth";

export const CAMPUS_FUNCTIONS_REGION =
  process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION?.trim() ||
  "asia-southeast1";

type ResolveSchoolIdLoginResponse = {
  email?: string | null;
  found?: boolean;
  source?: "auth" | "profile" | "fallback" | "missing";
};
type CampusProfileResponse = {
  profile?: CampusProfileDoc | null;
};
type FinalizeCampusProfileResponse = {
  finalized?: boolean;
  profile?: CampusProfileDoc | null;
};

export type SchoolIdLoginResolution =
  | {
      status: "resolved";
      email: string;
      source: "auth" | "profile" | "fallback" | "missing" | "unknown";
    }
  | {
      status: "missing";
      message: string;
      source: "missing";
    }
  | {
      status: "failed";
      message: string;
      code?: string;
    };

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

function getCampusFunctions() {
  return getFunctions(app, CAMPUS_FUNCTIONS_REGION);
}

function logAuthDebug(
  level: "info" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown>,
) {
  if (typeof window === "undefined") return;

  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.info;

  logger(`[CAMPUS auth] ${message}`, payload ?? {});
}

function toResolverFailureMessage(code?: string) {
  if (
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded" ||
    code === "functions/internal" ||
    code === "functions/unknown"
  ) {
    return "CAMPUS login services are temporarily unavailable. Please try again in a moment.";
  }

  if (code === "functions/invalid-argument") {
    return "School ID is required.";
  }

  return "Unable to verify your School ID right now. Please try again.";
}

export async function resolveSchoolIdLoginForSchoolId(
  schoolId: string,
): Promise<SchoolIdLoginResolution> {
  const normalizedSchoolId = trimValue(schoolId);

  logAuthDebug("info", "Resolving School ID login", {
    schoolId: normalizedSchoolId,
    region: CAMPUS_FUNCTIONS_REGION,
    origin: typeof window !== "undefined" ? window.location.origin : "",
  });

  try {
    const callable = httpsCallable<
      { schoolId: string },
      ResolveSchoolIdLoginResponse
    >(getCampusFunctions(), "resolveSchoolIdLogin");

    const result = await callable({ schoolId: normalizedSchoolId });
    const mappedEmail = trimValue(result.data?.email);
    const source = result.data?.source ?? (mappedEmail ? "unknown" : "missing");
    const found = result.data?.found === true || Boolean(mappedEmail);

    logAuthDebug("info", "resolveSchoolIdLogin completed", {
      schoolId: normalizedSchoolId,
      found,
      source,
      hasEmail: Boolean(mappedEmail),
    });

    if (!found || !mappedEmail) {
      return {
        status: "missing",
        message: "No CAMPUS account was found for that School ID.",
        source: "missing",
      };
    }

    return {
      status: "resolved",
      email: mappedEmail,
      source,
    };
  } catch (error: unknown) {
    const functionError = error as {
      code?: string;
      message?: string;
      details?: unknown;
    };

    logAuthDebug("error", "resolveSchoolIdLogin failed", {
      schoolId: normalizedSchoolId,
      region: CAMPUS_FUNCTIONS_REGION,
      origin: typeof window !== "undefined" ? window.location.origin : "",
      code: functionError.code ?? "unknown",
      message: functionError.message ?? "Unknown resolver error",
      details: functionError.details ?? null,
    });

    return {
      status: "failed",
      code: functionError.code,
      message: toResolverFailureMessage(functionError.code),
    };
  }
}

export async function getCurrentCampusProfileForCurrentUser(): Promise<CampusProfileDoc | null> {
  logAuthDebug("info", "Loading current CAMPUS profile");
  const callable = httpsCallable<Record<string, never>, CampusProfileResponse>(
    getCampusFunctions(),
    "getCurrentCampusProfile",
  );

  const result = await callable({});
  const profile = result.data?.profile ?? null;

  logAuthDebug("info", "Loaded current CAMPUS profile", {
    hasProfile: Boolean(profile),
    role: profile?.role ?? "",
  });

  return profile;
}

export async function savePendingEmailVerificationForCurrentUser(
  pendingEmail: string,
): Promise<CampusProfileDoc | null> {
  const normalizedEmail = trimValue(pendingEmail).toLowerCase();
  logAuthDebug("info", "Saving pending verification email", {
    pendingEmail: normalizedEmail,
  });

  const callable = httpsCallable<
    { pendingEmail: string },
    CampusProfileResponse
  >(getCampusFunctions(), "savePendingEmailVerification");

  const result = await callable({ pendingEmail: normalizedEmail });
  return result.data?.profile ?? null;
}

export async function finalizeVerifiedCampusProfileForCurrentUser(): Promise<{
  finalized: boolean;
  profile: CampusProfileDoc | null;
}> {
  logAuthDebug("info", "Finalizing verified CAMPUS profile");

  const callable = httpsCallable<Record<string, never>, FinalizeCampusProfileResponse>(
    getCampusFunctions(),
    "finalizeVerifiedCampusProfile",
  );

  const result = await callable({});
  return {
    finalized: result.data?.finalized === true,
    profile: result.data?.profile ?? null,
  };
}

export function logCampusAuthEvent(
  level: "info" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown>,
) {
  logAuthDebug(level, message, payload);
}
