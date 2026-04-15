import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import type { CampusProfileDoc } from "@/lib/campus-auth";
import { createCampusLogger } from "@/lib/campus-logger";

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

const authLogger = createCampusLogger("CAMPUS auth");

function logAuthEvent(
  level: "info" | "warn" | "error",
  message: string,
  payload?: Record<string, unknown>,
) {
  if (level === "error") {
    authLogger.error(message, payload);
    return;
  }

  if (level === "warn") {
    authLogger.warn(message, payload);
    return;
  }

  authLogger.info(message, payload);
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

  logAuthEvent("info", "Resolving School ID login", {
    region: CAMPUS_FUNCTIONS_REGION,
    hasSchoolId: Boolean(normalizedSchoolId),
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

    logAuthEvent("info", "resolveSchoolIdLogin completed", {
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

    logAuthEvent("error", "resolveSchoolIdLogin failed", {
      region: CAMPUS_FUNCTIONS_REGION,
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
  logAuthEvent("info", "Loading current CAMPUS profile");
  const callable = httpsCallable<Record<string, never>, CampusProfileResponse>(
    getCampusFunctions(),
    "getCurrentCampusProfile",
  );

  const result = await callable({});
  const profile = result.data?.profile ?? null;

  logAuthEvent("info", "Loaded current CAMPUS profile", {
    hasProfile: Boolean(profile),
    role: profile?.role ?? "",
  });

  return profile;
}

export async function savePendingEmailVerificationForCurrentUser(
  pendingEmail: string,
): Promise<CampusProfileDoc | null> {
  const normalizedEmail = trimValue(pendingEmail).toLowerCase();
  logAuthEvent("info", "Saving pending verification email", {
    emailDomain: normalizedEmail.split("@")[1] ?? "",
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
  logAuthEvent("info", "Finalizing verified CAMPUS profile");

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
  logAuthEvent(level, message, payload);
}
