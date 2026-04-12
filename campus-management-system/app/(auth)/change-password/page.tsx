"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { onAuthStateChanged, updatePassword, verifyBeforeUpdateEmail } from "firebase/auth";
import { campusToast } from "@/lib/toast";
import { CampusAuthShell, CampusAuthShellSkeleton } from "@/components/ui";
import { auth } from "@/lib/firebase";
import {
  buildEmailActionSettings,
  getOnboardingRedirect,
  resolveRoleHome,
  setCampusCookies,
} from "@/lib/campus-auth";
import {
  getCurrentCampusProfileForCurrentUser,
  savePendingEmailVerificationForCurrentUser,
} from "@/lib/firebase-functions";

function validatePassword(value: string) {
  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return "Use uppercase, lowercase, and at least one number.";
  }
  return "";
}

function validateEmail(value: string) {
  if (!value) return "Email address is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Please enter a valid email address.";
  }
  return "";
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [generalError, setGeneralError] = useState("");
  const [role, setRole] = useState<string>("");

  const passwordError = useMemo(
    () => (newPassword ? validatePassword(newPassword) : ""),
    [newPassword],
  );
  const emailError = useMemo(() => (email ? validateEmail(email) : ""), [email]);
  const confirmError = useMemo(() => {
    if (!confirmPassword) return "";
    return newPassword === confirmPassword ? "" : "Passwords do not match.";
  }, [confirmPassword, newPassword]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setInitializing(true);
      setGeneralError("");

      if (!user) {
        router.replace("/login?next=/change-password");
        return;
      }

      try {
        const profile = await getCurrentCampusProfileForCurrentUser();
        if (!profile) {
          setGeneralError("Your CAMPUS profile could not be found.");
          router.replace("/login");
          return;
        }
        if (typeof profile.role !== "string" || !profile.role) {
          setGeneralError("Your CAMPUS role is missing. Contact administration.");
          router.replace("/login");
          return;
        }
        setRole(profile.role);

        const onboardingRedirect = getOnboardingRedirect(profile);
        if (onboardingRedirect === "/verify-email-pending") {
          setCampusCookies({
            role: profile.role ?? "",
            mustChangePassword: true,
            emailVerificationPending: true,
          });
          router.replace("/verify-email-pending");
          return;
        }

        if (!profile.mustChangePassword) {
          router.replace(resolveRoleHome(profile.role));
          return;
        }

        const existingEmail = String(
          profile.pendingEmail ?? profile.email ?? "",
        ).trim();
        if (existingEmail && !existingEmail.endsWith("@campus.local")) {
          setEmail(existingEmail);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load your account setup details.";
        setGeneralError(message);
      } finally {
        setInitializing(false);
      }
    });

    return () => unsub();
  }, [router]);

  const onSave = async () => {
    setGeneralError("");

    const normalizedEmail = email.trim().toLowerCase();
    const nextPasswordError = validatePassword(newPassword);
    const nextEmailError = validateEmail(normalizedEmail);
    const nextConfirmError =
      newPassword === confirmPassword ? "" : "Passwords do not match.";

    if (nextPasswordError || nextEmailError || nextConfirmError) {
      setGeneralError(nextPasswordError || nextEmailError || nextConfirmError);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setGeneralError("Your session expired. Please sign in again.");
      router.replace("/login?next=/change-password");
      return;
    }

    setLoading(true);
    try {
      await updatePassword(user, newPassword);
      await verifyBeforeUpdateEmail(
        user,
        normalizedEmail,
        buildEmailActionSettings(),
      );
      await savePendingEmailVerificationForCurrentUser(normalizedEmail);

      setCampusCookies({
        role,
        mustChangePassword: true,
        emailVerificationPending: true,
      });

      campusToast.success({
        title: "Verification email sent",
        description: `We sent a verification link to ${normalizedEmail}.`,
        dedupeKey: `change-password:verification:${normalizedEmail}`,
      });

      router.replace("/verify-email-pending");
    } catch (error: unknown) {
      const authError = error as { code?: string; message?: string };
      if (authError.code === "auth/requires-recent-login") {
        setGeneralError("Please sign in again, then update your password right away.");
        router.replace("/login?next=/change-password");
      } else if (authError.code === "auth/invalid-email") {
        setGeneralError("Please enter a valid email address.");
      } else if (authError.code === "auth/weak-password") {
        setGeneralError(
          authError.message || "Choose a stronger password and try again.",
        );
      } else if (authError.code === "auth/email-already-in-use") {
        setGeneralError("That email address is already in use.");
      } else if (authError.code === "auth/network-request-failed") {
        setGeneralError("Network error. Check your connection and try again.");
      } else {
        setGeneralError(authError.message || "Failed to update your account.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (initializing) {
    return <CampusAuthShellSkeleton />;
  }

  return (
    <CampusAuthShell
      title="CAMPUS"
      description="First login detected. Set your permanent password and verify your email address before entering the portal."
      eyebrow="First Sign-In Setup"
      footer="Use your university email or an address you can access right now."
      cardClassName="max-w-[560px]"
    >
      <div className="space-y-5">
        {generalError ? (
          <Alert
            color="danger"
            variant="flat"
            title="Unable to continue"
            description={generalError}
          />
        ) : null}

        <Input
          label="Email Address"
          labelPlacement="outside"
          placeholder="Enter the email you want to verify"
          type="email"
          value={email}
          onValueChange={setEmail}
          isInvalid={Boolean(emailError)}
          errorMessage={emailError}
          autoComplete="email"
          startContent={
            <span className="material-icons pointer-events-none text-xl text-text-muted">
              email
            </span>
          }
          description="CAMPUS will send a verification link to this address."
        />

        <Input
          label="New Password"
          labelPlacement="outside"
          placeholder="Create your permanent password"
          type={showPassword ? "text" : "password"}
          value={newPassword}
          onValueChange={setNewPassword}
          isInvalid={Boolean(passwordError)}
          errorMessage={passwordError}
          autoComplete="new-password"
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
        />

        <Input
          label="Confirm Password"
          labelPlacement="outside"
          placeholder="Re-enter your new password"
          type={showPassword ? "text" : "password"}
          value={confirmPassword}
          onValueChange={setConfirmPassword}
          isInvalid={Boolean(confirmError)}
          errorMessage={confirmError}
          autoComplete="new-password"
          startContent={
            <span className="material-icons pointer-events-none text-xl text-text-muted">
              lock
            </span>
          }
        />

        <Button
          onPress={() => {
            void onSave();
          }}
          isLoading={loading}
          isDisabled={loading}
          className="h-14 w-full bg-primary-500 font-semibold text-white shadow-lg"
        >
          Save and Send Verification
        </Button>
      </div>
    </CampusAuthShell>
  );
}
