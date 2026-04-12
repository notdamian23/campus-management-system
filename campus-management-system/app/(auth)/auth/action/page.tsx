"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { applyActionCode, checkActionCode, signOut } from "firebase/auth";
import { CampusAuthShell, CampusAuthShellSkeleton } from "@/components/ui";
import { auth } from "@/lib/firebase";
import { clearCampusCookies, finalizeVerifiedProfile } from "@/lib/campus-auth";

type ActionState = "loading" | "success" | "error";

function AuthActionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasStartedRef = useRef(false);
  const [state, setState] = useState<ActionState>("loading");
  const [message, setMessage] = useState("Completing your email verification...");

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const run = async () => {
      const mode = String(searchParams.get("mode") ?? "").trim();
      const oobCode = String(searchParams.get("oobCode") ?? "").trim();
      const continueUrl = String(searchParams.get("continueUrl") ?? "").trim();
      const apiKey = String(searchParams.get("apiKey") ?? "").trim();
      const lang = String(searchParams.get("lang") ?? "").trim();

      void continueUrl;
      void apiKey;
      void lang;

      if (!oobCode) {
        setState("error");
        setMessage("This verification link is missing its action code.");
        return;
      }

      try {
        const info = await checkActionCode(auth, oobCode);
        const operation = String(info.operation ?? "").trim();
        const targetEmail = String(info.data.email ?? "").trim();

        if (
          mode &&
          mode !== "verifyEmail" &&
          mode !== "verifyAndChangeEmail"
        ) {
          throw new Error("This action link is not supported by CAMPUS.");
        }

        if (
          operation !== "VERIFY_EMAIL" &&
          operation !== "VERIFY_AND_CHANGE_EMAIL"
        ) {
          throw new Error("This action link is not a CAMPUS email verification.");
        }

        await applyActionCode(auth, oobCode);

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

        setState("success");
        setMessage(
          targetEmail
            ? `Email verified for ${targetEmail}. Redirecting you back to CAMPUS login...`
            : "Your email was verified. Redirecting you back to CAMPUS login...",
        );

        window.setTimeout(() => {
          router.replace("/login?verified=1");
        }, 1400);
      } catch (error: unknown) {
        const authError = error as { code?: string; message?: string };
        if (
          authError.code === "auth/expired-action-code" ||
          authError.code === "auth/invalid-action-code"
        ) {
          setMessage(
            "This verification link is invalid or has expired. Sign in again to request a new one.",
          );
        } else if (authError.code === "auth/network-request-failed") {
          setMessage("Network error while applying the verification link.");
        } else {
          setMessage(
            authError.message || "Unable to complete the email verification link.",
          );
        }
        setState("error");
      }
    };

    void run();
  }, [router, searchParams]);

  if (state === "loading") {
    return <CampusAuthShellSkeleton />;
  }

  return (
    <CampusAuthShell
      title="CAMPUS"
      description="We’re processing your Firebase email verification link."
      eyebrow="Account Verification"
      footer="CAMPUS will continue to use School ID as your login identifier."
      cardClassName="max-w-[560px]"
    >
      <div className="space-y-5">
        <Alert
          color={state === "success" ? "success" : "danger"}
          variant="flat"
          title={state === "success" ? "Verification complete" : "Verification failed"}
          description={message}
        />

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            className="bg-primary-500 font-semibold text-white"
            onPress={() => router.replace("/login")}
          >
            Go to login
          </Button>
          {state === "error" ? (
            <Button variant="bordered" onPress={() => router.replace("/verify-email-pending")}>
              Back to verification page
            </Button>
          ) : null}
        </div>
      </div>
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
