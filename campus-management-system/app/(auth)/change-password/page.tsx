"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";

import {
  sendEmailVerification,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { campusToast } from "@/lib/toast";
import { CampusAuthShell } from "@/components/ui";
import { auth, db } from "@/lib/firebase";

type Role = "teacher" | "student" | "ec" | "admin";

function setCampusCookies(role: Role, mustChangePassword: boolean) {
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `campus_logged_in=1; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_role=${role}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_must_change=${mustChangePassword ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export default function ChangePasswordPage() {
  const router = useRouter();

  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const onSave = async () => {
    setErrMsg("");
    const normalizedEmail = verifiedEmail.trim().toLowerCase();

    if (newPass.length < 6)
      return setErrMsg("Password must be at least 6 characters.");
    if (newPass !== confirm) return setErrMsg("Passwords do not match.");
    if (!normalizedEmail) return setErrMsg("Verified email is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
      return setErrMsg("Please enter a valid email address.");

    const user = auth.currentUser;
    if (!user) {
      setErrMsg("Not logged in. Please log in again.");
      router.replace("/login");
      return;
    }

    setLoading(true);
    try {
      // 1) Update Auth password
      await updatePassword(user, newPass);

      const actionCodeSettings = {
        url: `${window.location.origin}/login`,
        handleCodeInApp: false,
      };

      if ((user.email ?? "").toLowerCase() === normalizedEmail) {
        await sendEmailVerification(user, actionCodeSettings);
      } else {
        await verifyBeforeUpdateEmail(
          user,
          normalizedEmail,
          actionCodeSettings,
        );
      }

      // 2) Turn off mustChangePassword
      await updateDoc(doc(db, "profiles", user.uid), {
        mustChangePassword: false,
      });

      // 3) Refresh role and update cookies
      const snap = await getDoc(doc(db, "profiles", user.uid));
      const role = snap.data()?.role as Role | undefined;

      if (!role) {
        router.replace("/");
        return;
      }

      setCampusCookies(role, false);
      campusToast.success({
        title: "Verification email sent",
        description: `Check ${normalizedEmail} for your Firebase verification link.`,
        dedupeKey: `change-password:verification:${normalizedEmail}`,
      });

      // 4) Redirect
      if (role === "ec") router.replace("/ecmember");
      else if (role === "teacher") router.replace("/teacher");
      else if (role === "student") router.replace("/student");
      else if (role === "admin") router.replace("/admin");
      else router.replace("/");
    } catch (e: unknown) {
      const error = e as { code?: string; message?: string };
      const code = error?.code as string | undefined;
      if (code === "auth/requires-recent-login") {
        setErrMsg("Please log in again, then try changing your password.");
        router.replace("/login?next=/change-password");
      } else if (code === "auth/email-already-in-use") {
        setErrMsg("That email is already being used by another account.");
      } else if (code === "auth/invalid-email") {
        setErrMsg("Please enter a valid email address.");
      } else {
        setErrMsg(error?.message ?? "Failed to update password.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <CampusAuthShell
      title="CAMPUS"
      description="First login detected. Set a new password and verify your email before entering the portal."
      eyebrow="First Sign-In Setup"
      footer="Tip: Use a strong password you can remember."
      cardClassName="max-w-[520px]"
    >
      <div className="space-y-5">
        {errMsg ? (
          <Alert
            color="danger"
            variant="flat"
            title="Unable to save changes"
            description={errMsg}
          />
        ) : null}

        <Input
          label="New Password"
          labelPlacement="outside"
          placeholder="Enter new password"
          type={showPass ? "text" : "password"}
          value={newPass}
          onValueChange={setNewPass}
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
              onPress={() => setShowPass((value) => !value)}
            >
              {showPass ? "Hide" : "Show"}
            </Button>
          }
          description="Use at least 6 characters."
        />

        <Input
          label="Confirm Password"
          labelPlacement="outside"
          placeholder="Confirm new password"
          type={showPass ? "text" : "password"}
          value={confirm}
          onValueChange={setConfirm}
          autoComplete="new-password"
          startContent={
            <span className="material-icons pointer-events-none text-xl text-text-muted">
              lock
            </span>
          }
        />

        <Input
          label="Verified Email"
          labelPlacement="outside"
          placeholder="Enter your email address"
          type="email"
          value={verifiedEmail}
          onValueChange={setVerifiedEmail}
          autoComplete="email"
          startContent={
            <span className="material-icons pointer-events-none text-xl text-text-muted">
              email
            </span>
          }
          description="We&apos;ll send a Firebase verification link to this address."
        />

        <Button
          onPress={() => {
            void onSave();
          }}
          isLoading={loading}
          className="h-14 w-full bg-primary-500 font-semibold text-white shadow-lg"
        >
          Save and Send Verification
        </Button>
      </div>
    </CampusAuthShell>
  );
}
