"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { onAuthStateChanged, signOut, verifyBeforeUpdateEmail } from "firebase/auth";
import { CampusAuthShell, CampusAuthShellSkeleton } from "@/components/ui";
import { auth } from "@/lib/firebase";
import {
  getCurrentCampusProfileForCurrentUser,
  logCampusAuthEvent,
  savePendingEmailVerificationForCurrentUser,
} from "@/lib/firebase-functions";
import { campusToast } from "@/lib/toast";
import {
  buildEmailActionSettings,
  clearCampusCookies,
  finalizeVerifiedProfile,
  getOnboardingRedirect,
  type CampusProfileDoc,
  resolveRoleHome,
  setCampusCookies,
} from "@/lib/campus-auth";

export default function VerifyEmailPendingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<CampusProfileDoc | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resending, setResending] = useState(false);
  const [generalError, setGeneralError] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  const refreshVerificationStatus = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setSignedIn(false);
      clearCampusCookies();
      setGeneralError("Please sign in with your School ID to continue onboarding.");
      setInitializing(false);
      return;
    }

    setSignedIn(true);
    setGeneralError("");

    try {
      logCampusAuthEvent("info", "Refreshing verification status", {
        uid: user.uid,
      });
      await user.reload();
      const activeUser = auth.currentUser;
      if (!activeUser) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const syncResult = await finalizeVerifiedProfile(activeUser);
      let nextProfile = syncResult.profile;

      if (!nextProfile) {
        nextProfile = await getCurrentCampusProfileForCurrentUser();
        if (!nextProfile) {
          throw new Error("Your CAMPUS profile could not be found.");
        }
      }

      setProfile(nextProfile);
      setCampusCookies({
        role: nextProfile.role ?? "",
        mustChangePassword: nextProfile.mustChangePassword === true,
        emailVerificationPending: nextProfile.emailVerificationPending === true,
      });

      const onboardingRedirect = getOnboardingRedirect(nextProfile);
      if (onboardingRedirect === "/change-password") {
        logCampusAuthEvent("info", "Verification page redirected back to change-password", {
          uid: activeUser.uid,
          role: nextProfile.role ?? "",
        });
        router.replace("/change-password");
        return;
      }

      if (!onboardingRedirect) {
        logCampusAuthEvent("info", "Verification flow completed from pending page", {
          uid: activeUser.uid,
          role: nextProfile.role ?? "",
        });
        campusToast.success({
          title: "Onboarding complete",
          description: "Your email is verified and your CAMPUS account is ready.",
          dedupeKey: "verify-email-pending:complete",
        });
        router.replace(resolveRoleHome(nextProfile.role));
        return;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to refresh your verification status.";
      logCampusAuthEvent("error", "Verification status refresh failed", {
        uid: user.uid,
        message,
      });
      setGeneralError(message);
    } finally {
      setInitializing(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setInitializing(true);
      if (!user) {
        setSignedIn(false);
        setProfile(null);
        clearCampusCookies();
        setInitializing(false);
        return;
      }

      await refreshVerificationStatus();
    });

    return () => unsub();
  }, [refreshVerificationStatus]);

  const resendVerification = async () => {
    const user = auth.currentUser;
    const pendingEmail = String(profile?.pendingEmail ?? "").trim().toLowerCase();

    if (!user) {
      setGeneralError("Please sign in again before resending the verification email.");
      router.replace("/login?next=/verify-email-pending");
      return;
    }

    if (!pendingEmail) {
      setGeneralError("No pending email address was found for this account.");
      return;
    }

    setResending(true);
    setGeneralError("");

    try {
      const actionCodeSettings = buildEmailActionSettings();
      logCampusAuthEvent("info", "Resending verification email", {
        currentUser: user.email ? "present" : "present-without-email",
        authCurrentUser: auth.currentUser ? "present" : "missing",
        uid: user.uid,
        currentUserUid: auth.currentUser?.uid ?? "",
        currentUserEmail: auth.currentUser?.email ?? "",
        pendingEmail,
        actionUrl: actionCodeSettings.url,
        handleCodeInApp: actionCodeSettings.handleCodeInApp,
      });
      await verifyBeforeUpdateEmail(user, pendingEmail, actionCodeSettings);
      logCampusAuthEvent("info", "Resend verification email accepted by Firebase", {
        uid: user.uid,
        currentUserEmail: auth.currentUser?.email ?? "",
        pendingEmail,
        actionUrl: actionCodeSettings.url,
      });
      const refreshedProfile =
        await savePendingEmailVerificationForCurrentUser(pendingEmail);
      if (refreshedProfile) {
        setProfile(refreshedProfile as CampusProfileDoc);
      }
      campusToast.success({
        title: "Verification email resent",
        description: `A new verification link was sent to ${pendingEmail}.`,
        dedupeKey: `verify-email-pending:resent:${pendingEmail}`,
      });
    } catch (error: unknown) {
      const authError = error as { code?: string; message?: string };
      const exactErrorMessage = authError.code ?
        `${authError.code}: ${authError.message ?? "Unknown Firebase error."}` :
        authError.message || "Failed to resend the verification email.";
      logCampusAuthEvent("error", "Resend verification email failed", {
        uid: user.uid,
        code: authError.code ?? "unknown",
        message: authError.message ?? "Unknown resend error",
        currentUserEmail: auth.currentUser?.email ?? "",
        pendingEmail,
      });
      if (authError.code === "auth/requires-recent-login") {
        setGeneralError(exactErrorMessage);
        router.replace("/login?next=/verify-email-pending");
      } else if (authError.code === "auth/invalid-email") {
        setGeneralError(exactErrorMessage);
      } else if (authError.code === "auth/network-request-failed") {
        setGeneralError(exactErrorMessage);
      } else {
        setGeneralError(exactErrorMessage);
      }
    } finally {
      setResending(false);
    }
  };

  const handleBackToLogin = async () => {
    try {
      await signOut(auth);
    } finally {
      clearCampusCookies();
      router.replace("/login");
    }
  };

  if (initializing) {
    return <CampusAuthShellSkeleton />;
  }

  const pendingEmail = String(profile?.pendingEmail ?? "").trim();

  return (
    <CampusAuthShell
      title="CAMPUS"
      description="Your password was updated. Verify your email address before CAMPUS unlocks your dashboard."
      eyebrow="Email Verification Required"
      footer="You can keep using School ID login after verification completes."
      cardClassName="max-w-[560px]"
    >
      <div className="space-y-5">
        {!signedIn ? (
          <Alert
            color="warning"
            variant="flat"
            title="Sign in required"
            description="Please sign in with your School ID to resend or refresh your onboarding status."
          />
        ) : null}

        {generalError ? (
          <Alert
            color="danger"
            variant="flat"
            title="Verification still pending"
            description={generalError}
          />
        ) : (
          <Alert
            color="primary"
            variant="flat"
            title="Check your inbox"
            description="Open the verification link we sent, then return here and refresh your status."
          />
        )}

        <div className="rounded-2xl border border-border bg-white/80 px-4 py-4">
          <p className="text-sm font-semibold text-campus-text-primary">
            Pending email
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip color="primary" variant="flat">
              {pendingEmail || "No pending email stored"}
            </Chip>
            {profile?.emailVerificationPending ? (
              <Chip color="warning" variant="flat">
                Awaiting verification
              </Chip>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Button
            variant="bordered"
            onPress={() => {
              setRefreshing(true);
              void refreshVerificationStatus();
            }}
            isLoading={refreshing}
            isDisabled={!signedIn || refreshing || resending}
          >
            Refresh status
          </Button>
          <Button
            className="bg-primary-500 font-semibold text-white"
            onPress={() => {
              void resendVerification();
            }}
            isLoading={resending}
            isDisabled={!signedIn || !pendingEmail || refreshing || resending}
          >
            Resend verification
          </Button>
          <Button variant="light" onPress={() => void handleBackToLogin()}>
            Back to login
          </Button>
        </div>
      </div>
    </CampusAuthShell>
  );
}
