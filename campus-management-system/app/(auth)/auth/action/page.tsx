"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  signOut,
  verifyPasswordResetCode,
} from "firebase/auth";
import { CampusAuthShell, CampusAuthShellSkeleton } from "@/components/ui";
import { auth } from "@/lib/firebase";
import { logCampusAuthEvent } from "@/lib/firebase-functions";
import { clearCampusCookies, finalizeVerifiedProfile } from "@/lib/campus-auth";

type ActionState = "loading" | "ready" | "success" | "error";
type ActionMode = "verifyEmail" | "resetPassword" | "unsupported";

function validatePassword(value: string) {
  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return "Use uppercase, lowercase, and at least one number.";
  }
  return "";
}

function normalizeActionMode(rawMode: string) {
  if (rawMode === "verifyEmail" || rawMode === "verifyAndChangeEmail") {
    return "verifyEmail" as const;
  }
  if (rawMode === "resetPassword") {
    return "resetPassword" as const;
  }
  return "unsupported" as const;
}

function getVerifyEmailErrorMessage(code?: string, fallback?: string) {
  if (
    code === "auth/expired-action-code" ||
    code === "auth/invalid-action-code"
  ) {
    return "This verification link is invalid or has expired. Sign in again to request a new one.";
  }

  if (code === "auth/network-request-failed") {
    return "Network error while applying the verification link. Check your connection and try again.";
  }

  return fallback || "Unable to complete the email verification link.";
}

function getResetPasswordErrorMessage(code?: string, fallback?: string) {
  if (
    code === "auth/expired-action-code" ||
    code === "auth/invalid-action-code"
  ) {
    return "This password reset link is invalid or has expired. Request a new password reset email from CAMPUS login.";
  }

  if (code === "auth/weak-password") {
    return "Choose a stronger password. Use at least 8 characters with uppercase, lowercase, and a number.";
  }

  if (code === "auth/network-request-failed") {
    return "Network error while processing the password reset link. Check your connection and try again.";
  }

  return fallback || "Unable to complete the password reset link.";
}

function AuthActionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasStartedRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const [mode, setMode] = useState<ActionMode>("verifyEmail");
  const [state, setState] = useState<ActionState>("loading");
  const [message, setMessage] = useState("Completing your email verification...");
  const [targetEmail, setTargetEmail] = useState("");
  const [oobCode, setOobCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submittingReset, setSubmittingReset] = useState(false);
  const [resetFormError, setResetFormError] = useState("");

  const passwordError = useMemo(
    () => (newPassword ? validatePassword(newPassword) : ""),
    [newPassword],
  );
  const confirmError = useMemo(() => {
    if (!confirmPassword) return "";
    return newPassword === confirmPassword ? "" : "Passwords do not match.";
  }, [confirmPassword, newPassword]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const redirectToLogin = useCallback((query = "") => {
    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
    }

    redirectTimerRef.current = window.setTimeout(() => {
      router.replace(query ? `/login?${query}` : "/login");
    }, 1400);
  }, [router]);

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const run = async () => {
      const rawMode = String(searchParams.get("mode") ?? "").trim();
      const normalizedMode = normalizeActionMode(rawMode);
      const nextOobCode = String(searchParams.get("oobCode") ?? "").trim();
      const continueUrl = String(searchParams.get("continueUrl") ?? "").trim();
      const apiKey = String(searchParams.get("apiKey") ?? "").trim();

      setMode(normalizedMode);
      setOobCode(nextOobCode);
      setTargetEmail("");
      setResetFormError("");
      setNewPassword("");
      setConfirmPassword("");

      if (normalizedMode === "unsupported") {
        setState("error");
        setMessage("This action link is not supported by CAMPUS.");
        return;
      }

      if (!nextOobCode) {
        setState("error");
        setMessage(
          normalizedMode === "resetPassword"
            ? "This reset link is missing its action code."
            : "This verification link is missing its action code.",
        );
        return;
      }

      try {
        logCampusAuthEvent("info", "Processing auth action link", {
          mode: rawMode || "unknown",
          normalizedMode,
          hasOobCode: Boolean(nextOobCode),
          hasContinueUrl: Boolean(continueUrl),
          hasApiKey: Boolean(apiKey),
        });

        if (normalizedMode === "resetPassword") {
          const email = await verifyPasswordResetCode(auth, nextOobCode);
          setTargetEmail(String(email ?? "").trim());
          setState("ready");
          setMessage("Your password reset link is ready.");
          return;
        }

        const info = await checkActionCode(auth, nextOobCode);
        const operation = String(info.operation ?? "").trim();
        const email = String(info.data.email ?? "").trim();

        if (
          operation !== "VERIFY_EMAIL" &&
          operation !== "VERIFY_AND_CHANGE_EMAIL"
        ) {
          throw new Error("This action link is not a CAMPUS email verification.");
        }

        await applyActionCode(auth, nextOobCode);
        logCampusAuthEvent("info", "Firebase action code applied", {
          operation,
          hasTargetEmail: Boolean(email),
        });

        try {
          const currentUser = auth.currentUser;
          if (currentUser) {
            await currentUser.reload();
            const reloadedUser = auth.currentUser;
            if (reloadedUser) {
              await finalizeVerifiedProfile(reloadedUser);
            }
          }
        } catch {
          // If the browser no longer has the signed-in session, login will finalize on the next sign-in.
        }

        try {
          await signOut(auth);
        } catch {
          // No-op when there is no local session.
        }
        clearCampusCookies();

        setTargetEmail(email);
        setState("success");
        setMessage(
          email
            ? `Email verified for ${email}. Redirecting you back to CAMPUS login...`
            : "Your email was verified. Redirecting you back to CAMPUS login...",
        );
        redirectToLogin("verified=1");
      } catch (error: unknown) {
        const authError = error as { code?: string; message?: string };
        logCampusAuthEvent("error", "Auth action link failed", {
          mode: rawMode || "unknown",
          normalizedMode,
          code: authError.code ?? "unknown",
          message: authError.message ?? "Unknown auth action error",
        });
        setMessage(
          normalizedMode === "resetPassword"
            ? getResetPasswordErrorMessage(authError.code, authError.message)
            : getVerifyEmailErrorMessage(authError.code, authError.message),
        );
        setState("error");
      }
    };

    void run();
  }, [redirectToLogin, searchParams]);

  const handleResetPassword = async () => {
    const nextPasswordError = validatePassword(newPassword);
    const nextConfirmError =
      newPassword === confirmPassword ? "" : "Passwords do not match.";

    if (nextPasswordError || nextConfirmError) {
      setResetFormError(nextPasswordError || nextConfirmError);
      return;
    }

    if (!oobCode) {
      setState("error");
      setMessage("This password reset link is missing its action code.");
      return;
    }

    setResetFormError("");
    setSubmittingReset(true);

    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      logCampusAuthEvent("info", "Password reset completed", {
        hasTargetEmail: Boolean(targetEmail),
      });

      try {
        await signOut(auth);
      } catch {
        // No-op when there is no local session.
      }
      clearCampusCookies();

      setState("success");
      setMessage(
        targetEmail
          ? `Password updated for ${targetEmail}. Redirecting you back to CAMPUS login...`
          : "Your password was updated. Redirecting you back to CAMPUS login...",
      );
      redirectToLogin("reset=1");
    } catch (error: unknown) {
      const authError = error as { code?: string; message?: string };

      logCampusAuthEvent("error", "Password reset failed", {
        code: authError.code ?? "unknown",
        message: authError.message ?? "Unknown password reset error",
        hasTargetEmail: Boolean(targetEmail),
      });

      if (
        authError.code === "auth/expired-action-code" ||
        authError.code === "auth/invalid-action-code"
      ) {
        setState("error");
        setMessage(getResetPasswordErrorMessage(authError.code, authError.message));
      } else {
        setResetFormError(
          getResetPasswordErrorMessage(authError.code, authError.message),
        );
      }
    } finally {
      setSubmittingReset(false);
    }
  };

  if (state === "loading") {
    return <CampusAuthShellSkeleton />;
  }

  const isResetMode = mode === "resetPassword";
  const isUnsupportedMode = mode === "unsupported";
  const shellDescription = isUnsupportedMode
    ? "We couldn't identify this Firebase action link."
    : isResetMode
      ? state === "ready"
        ? "Create a new password for your CAMPUS account using this Firebase reset link."
        : state === "success"
          ? "Your password reset request was completed."
          : "We're processing your Firebase password reset link."
      : "We're processing your Firebase email verification link.";
  const shellEyebrow = isUnsupportedMode
    ? "Action Link"
    : isResetMode
      ? "Reset Password"
      : "Account Verification";
  const shellFooter = isUnsupportedMode
    ? "Return to CAMPUS login to continue with your account."
    : isResetMode
      ? "After resetting your password, sign in with your School ID and new password."
      : "CAMPUS will continue to use School ID as your login identifier.";

  return (
    <CampusAuthShell
      description={shellDescription}
      eyebrow={shellEyebrow}
      footer={shellFooter}
      cardClassName="max-w-[560px]"
    >
      {isResetMode && state === "ready" ? (
        <div className="space-y-5">
          <Alert
            color="success"
            variant="flat"
            title="Reset link confirmed"
            description={
              targetEmail
                ? `Set a new password for ${targetEmail}.`
                : "Set a new password for your CAMPUS account."
            }
          />

          {resetFormError ? (
            <Alert
              color="danger"
              variant="flat"
              title="Unable to reset password"
              description={resetFormError}
            />
          ) : null}

          <Input
            label="New Password"
            labelPlacement="outside"
            placeholder="Enter your new password"
            type={showPassword ? "text" : "password"}
            value={newPassword}
            onValueChange={(value) => {
              setNewPassword(value);
              if (resetFormError) setResetFormError("");
            }}
            isInvalid={Boolean(passwordError)}
            errorMessage={passwordError}
            autoComplete="new-password"
            autoFocus
            startContent={
              <span className="material-icons pointer-events-none text-xl text-text-muted">
                lock
              </span>
            }
            endContent={
              <Button
                type="button"
                size="sm"
                variant="light"
                className="h-auto min-w-0 px-2 text-xs font-semibold text-text-muted"
                onPress={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "Hide" : "Show"}
              </Button>
            }
            description="Use at least 8 characters with uppercase, lowercase, and a number."
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleResetPassword();
              }
            }}
          />

          <Input
            label="Confirm Password"
            labelPlacement="outside"
            placeholder="Re-enter your new password"
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onValueChange={(value) => {
              setConfirmPassword(value);
              if (resetFormError) setResetFormError("");
            }}
            isInvalid={Boolean(confirmError)}
            errorMessage={confirmError}
            autoComplete="new-password"
            startContent={
              <span className="material-icons pointer-events-none text-xl text-text-muted">
                lock
              </span>
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleResetPassword();
              }
            }}
          />

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="bg-primary-500 font-semibold text-white"
              onPress={() => {
                void handleResetPassword();
              }}
              isLoading={submittingReset}
              isDisabled={submittingReset}
            >
              Update password
            </Button>
            <Button
              variant="bordered"
              onPress={() => router.replace("/login")}
              isDisabled={submittingReset}
            >
              Back to login
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <Alert
            color={state === "success" ? "success" : "danger"}
            variant="flat"
            title={
              state === "success"
                ? isResetMode
                  ? "Password updated"
                  : "Verification complete"
                : isUnsupportedMode
                  ? "Action link unavailable"
                  : isResetMode
                  ? "Reset link unavailable"
                  : "Verification failed"
            }
            description={message}
          />

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="bg-primary-500 font-semibold text-white"
              onPress={() => router.replace("/login")}
            >
              Go to login
            </Button>
            {!isResetMode && state === "error" ? (
              <Button
                variant="bordered"
                onPress={() => router.replace("/verify-email-pending")}
              >
                Back to verification page
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </CampusAuthShell>
  );
}

export default function AuthActionPage() {
  return (
    <Suspense fallback={<CampusAuthShellSkeleton />}>
      <AuthActionContent />
    </Suspense>
  );
}
