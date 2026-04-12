"use client";

import React from "react";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Switch } from "@heroui/switch";

import { campusToast } from "@/lib/toast";
import { CampusAuthShell, CampusAuthShellSkeleton } from "@/components/ui";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  type CampusProfileDoc,
  finalizeVerifiedProfile,
  getOnboardingRedirect,
  resolveRoleHome,
  setCampusCookies,
} from "@/lib/campus-auth";
import {
  getCurrentCampusProfileForCurrentUser,
  logCampusAuthEvent,
  resolveSchoolIdLoginForSchoolId,
} from "@/lib/firebase-functions";

const EyeSlashFilledIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="1em"
      role="presentation"
      viewBox="0 0 24 24"
      width="1em"
      {...props}
    >
      <path
        d="M21.2714 9.17834C20.9814 8.71834 20.6714 8.28834 20.3514 7.88834C19.9814 7.41834 19.2814 7.37834 18.8614 7.79834L15.8614 10.7983C16.0814 11.4583 16.1214 12.2183 15.9214 13.0083C15.5714 14.4183 14.4314 15.5583 13.0214 15.9083C12.2314 16.1083 11.4714 16.0683 10.8114 15.8483C10.8114 15.8483 9.38141 17.2783 8.35141 18.3083C7.85141 18.8083 8.01141 19.6883 8.68141 19.9483C9.75141 20.3583 10.8614 20.5683 12.0014 20.5683C13.7814 20.5683 15.5114 20.0483 17.0914 19.0783C18.7014 18.0783 20.1514 16.6083 21.3214 14.7383C22.2714 13.2283 22.2214 10.6883 21.2714 9.17834Z"
        fill="currentColor"
      />
      <path
        d="M14.0206 9.98062L9.98062 14.0206C9.47062 13.5006 9.14062 12.7806 9.14062 12.0006C9.14062 10.4306 10.4206 9.14062 12.0006 9.14062C12.7806 9.14062 13.5006 9.47062 14.0206 9.98062Z"
        fill="currentColor"
      />
      <path
        d="M18.25 5.74969L14.86 9.13969C14.13 8.39969 13.12 7.95969 12 7.95969C9.76 7.95969 7.96 9.76969 7.96 11.9997C7.96 13.1197 8.41 14.1297 9.14 14.8597L5.76 18.2497H5.75C4.64 17.3497 3.62 16.1997 2.75 14.8397C1.75 13.2697 1.75 10.7197 2.75 9.14969C3.91 7.32969 5.33 5.89969 6.91 4.91969C8.49 3.95969 10.22 3.42969 12 3.42969C14.23 3.42969 16.39 4.24969 18.25 5.74969Z"
        fill="currentColor"
      />
      <path
        d="M14.8581 11.9981C14.8581 13.5681 13.5781 14.8581 11.9981 14.8581C11.9381 14.8581 11.8881 14.8581 11.8281 14.8381L14.8381 11.8281C14.8581 11.8881 14.8581 11.9381 14.8581 11.9981Z"
        fill="currentColor"
      />
      <path
        d="M21.7689 2.22891C21.4689 1.92891 20.9789 1.92891 20.6789 2.22891L2.22891 20.6889C1.92891 20.9889 1.92891 21.4789 2.22891 21.7789C2.37891 21.9189 2.56891 21.9989 2.76891 21.9989C2.96891 21.9989 3.15891 21.9189 3.30891 21.7689L21.7689 3.30891C22.0789 3.00891 22.0789 2.52891 21.7689 2.22891Z"
        fill="currentColor"
      />
    </svg>
  );
};

const EyeFilledIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="1em"
      role="presentation"
      viewBox="0 0 24 24"
      width="1em"
      {...props}
    >
      <path
        d="M21.25 9.14969C18.94 5.51969 15.56 3.42969 12 3.42969C10.22 3.42969 8.49 3.94969 6.91 4.91969C5.33 5.89969 3.91 7.32969 2.75 9.14969C1.75 10.7197 1.75 13.2697 2.75 14.8397C5.06 18.4797 8.44 20.5597 12 20.5597C13.78 20.5597 15.51 20.0397 17.09 19.0697C18.67 18.0897 20.09 16.6597 21.25 14.8397C22.25 13.2797 22.25 10.7197 21.25 9.14969ZM12 16.0397C9.76 16.0397 7.96 14.2297 7.96 11.9997C7.96 9.76969 9.76 7.95969 12 7.95969C14.24 7.95969 16.04 9.76969 16.04 11.9997C16.04 14.2297 14.24 16.0397 12 16.0397Z"
        fill="currentColor"
      />
      <path
        d="M11.9984 9.14062C10.4284 9.14062 9.14844 10.4206 9.14844 12.0006C9.14844 13.5706 10.4284 14.8506 11.9984 14.8506C13.5684 14.8506 14.8584 13.5706 14.8584 12.0006C14.8584 10.4306 13.5684 9.14062 11.9984 9.14062Z"
        fill="currentColor"
      />
    </svg>
  );
};

type LoginFieldErrors = {
  schoolId?: string;
  password?: string;
};

function getLoginInputClassNames(isInvalid: boolean) {
  return {
    base: "w-full",
    mainWrapper: "gap-0",
    label: "text-sm font-semibold text-text-primary mb-2",
    input: "text-base text-text-primary placeholder:text-text-muted",
    inputWrapper: [
      "bg-bg-main px-0 min-h-[58px] border-2 rounded-xl shadow-none transition-all",
      isInvalid
        ? "border-danger hover:border-danger focus-within:border-danger focus-within:ring-4 focus-within:ring-danger/20"
        : "border-border-input hover:border-primary-600 focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/20",
    ].join(" "),
    innerWrapper: "gap-3 px-4",
    helperWrapper: "px-1 pt-2",
    errorMessage: "text-sm text-danger",
  };
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next"); // optional redirect target

  const [schoolId, setSchoolId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});

  const [isVisible, setIsVisible] = React.useState(false);
  const toggleVisibility = () => setIsVisible(!isVisible);

  useEffect(() => {
    if (searchParams.get("verified") !== "1") return;

    campusToast.success({
      title: "Email verified",
      description:
        "Your CAMPUS email is verified. Sign in with your School ID and new password to continue.",
      dedupeKey: "login:verified-email",
    });
  }, [searchParams]);

  const showLoginToast = (
    title: string,
    description: string,
    color: "danger" | "warning" = "danger",
  ) => {
    campusToast.show({
      title,
      description,
      tone: color === "warning" ? "warning" : "error",
    });
  };

  const clearFieldErrors = (...fields: (keyof LoginFieldErrors)[]) => {
    setFieldErrors((current) => {
      if (!fields.some((field) => current[field])) {
        return current;
      }

      const next = { ...current };
      for (const field of fields) {
        delete next[field];
      }

      return next;
    });
  };

  const handleLogin = async () => {
    const sid = schoolId.trim();
    const nextErrors: LoginFieldErrors = {};

    if (!sid) {
      nextErrors.schoolId = "School ID is required";
    }

    if (!password) {
      nextErrors.password = "Password is required";
    }

    if (nextErrors.schoolId || nextErrors.password) {
      setFieldErrors(nextErrors);
      return;
    }

    // ✅ Option C: validate School ID numeric (6–12 digits; adjust if needed)
    if (!/^\d{6,12}$/.test(sid)) {
      setFieldErrors({ schoolId: "Invalid School ID" });
      return;
    }

    // Firebase Email/Password requires an email; we map School ID → pseudo email
    setFieldErrors({});

    setLoading(true);
    try {
      const resolution = await resolveSchoolIdLoginForSchoolId(sid);

      if (resolution.status === "missing") {
        setFieldErrors({ schoolId: "Invalid School ID" });
        return;
      }

      if (resolution.status === "failed") {
        showLoginToast("Login service unavailable", resolution.message, "warning");
        return;
      }

      const loginEmail = resolution.email;

      const cred = await signInWithEmailAndPassword(auth, loginEmail, password);
      const uid = cred.user.uid;
      await cred.user.reload();

      logCampusAuthEvent("info", "Firebase sign-in succeeded", {
        schoolId: sid,
        uid,
        resolverSource: resolution.source,
        emailVerified: cred.user.emailVerified,
      });

      // 2) Load profile (role + mustChangePassword) from backend
      let data = await getCurrentCampusProfileForCurrentUser();
      if (!data) {
        await signOut(auth);
        showLoginToast(
          "Profile not found",
          "No profile or role is assigned to this account. Contact admin.",
        );
        return;
      }

      // Validate role
      if (
        data.role !== "teacher" &&
        data.role !== "student" &&
        data.role !== "ec" &&
        data.role !== "admin"
      ) {
        await signOut(auth);
        showLoginToast(
          "Invalid account role",
          "The account role in the database is invalid. Contact admin.",
        );
        return;
      }
      const role = data.role;

      logCampusAuthEvent("info", "Loaded CAMPUS profile after sign-in", {
        schoolId: sid,
        uid,
        role,
        mustChangePassword: data.mustChangePassword === true,
        emailVerificationPending: data.emailVerificationPending === true,
      });

      if (
        data.emailVerificationPending === true ||
        (data.firstLoginCompleted === false && data.emailVerified === false)
      ) {
        const syncResult = await finalizeVerifiedProfile(cred.user);
        if (syncResult.profile) {
          data = syncResult.profile as CampusProfileDoc;
        } else {
          const refreshedProfile = await getCurrentCampusProfileForCurrentUser();
          if (refreshedProfile) {
            data = refreshedProfile;
          }
        }
      }

      // 3) Set cookies ONCE (middleware uses these)
      setCampusCookies({
        role,
        mustChangePassword: data.mustChangePassword === true,
        emailVerificationPending: data.emailVerificationPending === true,
      });

      const onboardingRedirect = getOnboardingRedirect(data);
      if (onboardingRedirect) {
        logCampusAuthEvent("info", "Redirecting to onboarding step", {
          schoolId: sid,
          uid,
          onboardingRedirect,
        });
        router.push(onboardingRedirect);
        return;
      }

      // 4) Redirect by role (or use ?next=...)
      if (nextPath) {
        logCampusAuthEvent("info", "Redirecting to next path after login", {
          schoolId: sid,
          uid,
          nextPath,
        });
        router.push(nextPath);
        return;
      }

      logCampusAuthEvent("info", "Redirecting to role home after login", {
        schoolId: sid,
        uid,
        role,
      });
      router.push(resolveRoleHome(role));
    } catch (e: unknown) {
      const error = e as { code?: string; message?: string };
      const code = error.code;

      logCampusAuthEvent("error", "Login failed", {
        schoolId: sid,
        code: code ?? "unknown",
        message: error.message ?? "Unknown login error",
      });

      if (
        code === "functions/not-found" ||
        code === "functions/invalid-argument"
      ) {
        setFieldErrors({ schoolId: "Invalid School ID" });
      } else if (code === "auth/invalid-credential") {
        setFieldErrors({ password: "Invalid password" });
      } else if (code === "auth/user-not-found") {
        setFieldErrors({ schoolId: "Invalid School ID" });
      } else {
        showLoginToast(
          "Login failed",
          error.message ?? "Unable to sign in right now. Please try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <CampusAuthShell
      description="Welcome back! Sign in to your account to access attendance, events, documents, and payment tools."
      logoSrc="/campus-login logo.png"
      logoAlt="CAMPUS login logo"
      logoWidth={720}
      logoHeight={280}
      logoWrapperClassName="mb-5 flex w-full items-center justify-center overflow-visible rounded-none border-0 bg-transparent shadow-none"
      logoImageClassName="h-auto w-full max-w-[300px] object-contain drop-shadow-[0_22px_40px_rgba(123,0,0,0.2)] sm:max-w-[360px] lg:max-w-[400px]"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <span className="font-bold text-primary-600">
            Contact Administration
          </span>
        </>
      }
    >
      <div className="space-y-7">
        <Input
          label="School ID"
          labelPlacement="outside"
          placeholder="e.g. 23209455"
          type="text"
          value={schoolId}
          onValueChange={(value) => {
            setSchoolId(value);
            clearFieldErrors("schoolId", "password");
          }}
          inputMode="numeric"
          isInvalid={Boolean(fieldErrors.schoolId)}
          errorMessage={fieldErrors.schoolId}
          startContent={
            <span className="material-icons pointer-events-none text-xl text-text-muted">
              person
            </span>
          }
          classNames={getLoginInputClassNames(Boolean(fieldErrors.schoolId))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLogin();
          }}
        />

        <Input
          label="Password"
          labelPlacement="outside"
          placeholder="Enter password"
          type={isVisible ? "text" : "password"}
          value={password}
          onValueChange={(value) => {
            setPassword(value);
            clearFieldErrors("password");
          }}
          isInvalid={Boolean(fieldErrors.password)}
          errorMessage={fieldErrors.password}
          startContent={
            <span className="material-icons pointer-events-none text-xl text-text-muted">
              lock
            </span>
          }
          endContent={
            <Button
              isIconOnly
              aria-label="Toggle password visibility"
              className="h-9 w-9 min-w-0 rounded-full bg-transparent text-text-muted"
              variant="light"
              type="button"
              onPress={toggleVisibility}
            >
              {isVisible ? (
                <EyeSlashFilledIcon className="pointer-events-none text-2xl" />
              ) : (
                <EyeFilledIcon className="pointer-events-none text-2xl" />
              )}
            </Button>
          }
          classNames={getLoginInputClassNames(Boolean(fieldErrors.password))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLogin();
          }}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Switch
            size="sm"
            isSelected={rememberMe}
            onValueChange={setRememberMe}
            classNames={{
              label: "text-sm font-medium text-text-primary",
            }}
          >
            Remember me
          </Switch>
          <Button
            type="button"
            variant="light"
            className="h-auto min-w-0 self-start px-0 text-sm font-semibold text-primary-600 data-[hover=true]:bg-transparent sm:self-auto"
          >
            Forgot password?
          </Button>
        </div>

        <Button
          onPress={handleLogin}
          isLoading={loading}
          className="h-14 w-full bg-primary-500 text-base font-bold text-white shadow-lg"
        >
          Sign In
        </Button>
      </div>
    </CampusAuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<CampusAuthShellSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
