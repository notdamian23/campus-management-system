"use client";

import React from "react";

import Image from "next/image";
import { Poppins } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

import { CampusInput, CampusButton } from "@/components/heroui";

import { auth, db } from "@/lib/firebase";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const poppins = Poppins({
    subsets: ["latin"],
    weight: ["400", "600", "700", "800"],
});


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

type Role = "teacher" | "student" | "ec";

function setCampusCookies(role: string, mustChangePassword: boolean) {
    // Basic cookies for middleware guard (7 days)
    const maxAge = 60 * 60 * 24 * 7;
    document.cookie = `campus_logged_in=1; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    document.cookie = `campus_role=${role}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    document.cookie = `campus_must_change=${mustChangePassword ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextPath = searchParams.get("next"); // optional redirect target

    const [schoolId, setSchoolId] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const [isVisible, setIsVisible] = React.useState(false);
    const toggleVisibility = () => setIsVisible(!isVisible);


    const handleLogin = async () => {
        const sid = schoolId.trim();

        if (!sid || !password) {
            alert("Please enter School ID and password.");
            return;
        }

        // ✅ Option C: validate School ID numeric (6–12 digits; adjust if needed)
        if (!/^\d{6,12}$/.test(sid)) {
            alert("Invalid School ID format. Example: 23209455");
            return;
        }

        // Firebase Email/Password requires an email; we map School ID → pseudo email
        const loginEmail = `${sid}@campus.local`;

        setLoading(true);
        try {
            // 1) Sign in
            const cred = await signInWithEmailAndPassword(auth, loginEmail, password);
            const uid = cred.user.uid;

            // 2) Load profile (role + mustChangePassword) from Firestore
            const snap = await getDoc(doc(db, "profiles", uid));
            if (!snap.exists()) {
                await signOut(auth);
                alert("No profile/role assigned to this account. Contact admin.");
                return;
            }

            const data = snap.data() as {
                role?: Role;
                mustChangePassword?: boolean;
                schoolId?: string;
            };

            // Validate role
            if (data.role !== "teacher" && data.role !== "student" && data.role !== "ec") {
                await signOut(auth);
                alert("Invalid role in database. Contact admin.");
                return;
            }

            // 3) Set cookies ONCE (middleware uses these)
            setCampusCookies(data.role, data.mustChangePassword === true);

            // 4) Force password change on first login
            if (data.mustChangePassword === true) {
                router.push("/change-password");
                return;
            }

            // 5) Redirect by role (or use ?next=...)
            if (nextPath) {
                router.push(nextPath);
                return;
            }

            if (data.role === "teacher") router.push("/teacher");
            else if (data.role === "student") router.push("/student");
            else router.push("/ecmember");
        } catch (e: any) {
            const code = e?.code as string | undefined;

            if (code === "auth/invalid-credential") alert("Wrong School ID or password.");
            else if (code === "auth/user-not-found") alert("Account not found. Contact admin.");
            else alert(e?.message ?? "Login failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-[#7b0000] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-xl shadow-xl px-10 py-8 flex flex-col items-center">
                {/* Logo */}
                <div className="w-40 h-40 rounded-full overflow-hidden flex items-center justify-center mb-4 border-4 border-[#7b0000]">
                    <Image
                        src="/new campus-logo.jpg"
                        alt="Campus Logo"
                        width={200}
                        height={200}
                        className="object-cover"
                    />
                </div>

                {/* Title */}
                <h1
                    className={`text-4xl font-extrabold text-center text-[#7b0000] tracking-tight ${poppins.className}`}
                >
                    CAMPUS
                </h1>

                <p className="text-gray-500 text-center mb-6">
                    Welcome back! Sign in to your account
                </p>

                {/* School ID */}
                <div className="w-full mb-4">
                    <CampusInput
                        type="text"
                        label="School ID"
                        placeholder="e.g. 23209455"
                        value={schoolId}
                        onValueChange={setSchoolId}
                        startContent={<span className="material-icons text-gray-400">person</span>}
                        inputMode="numeric"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleLogin();
                        }}
                    />
                </div>

                {/* Password */}
                <div className="w-full mb-4">
                    <CampusInput
                        label="Password"
                        placeholder="Enter password"
                        type={isVisible ? "text" : "password"}
                        value={password}
                        onValueChange={setPassword}
                        startContent={<span className="material-icons text-gray-400">lock</span>}
                        endContent={
                            <button
                                aria-label="toggle password visibility"
                                className="focus:outline-none"
                                type="button"
                                onClick={toggleVisibility}
                            >
                                {isVisible ? (
                                    <EyeSlashFilledIcon className="text-2xl text-default-400 pointer-events-none" />
                                ) : (
                                    <EyeFilledIcon className="text-2xl text-default-400 pointer-events-none" />
                                )}
                            </button>
                        }
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleLogin();
                        }}
                    />
                </div>

                {/* Remember + Forgot (optional UI only) */}
                <div className="flex justify-between items-center w-full text-sm mb-6">
                    <label className="flex items-center gap-2 text-gray-700">
                        <input type="checkbox" />
                        Remember me
                    </label>
                    <button type="button" className="text-blue-600 hover:underline">
                        Forgot your password?
                    </button>
                </div>

                {/* Sign In */}
                <CampusButton
                    variant="secondary"
                    onClick={handleLogin}
                    isLoading={loading}
                    className="w-full"
                    size="lg"
                >
                    Sign In
                </CampusButton>

                {/* Footer */}
                <div className="mt-6 text-sm text-gray-600">
                    Don’t have an account?
                    <a className="text-blue-600 font-medium hover:underline ml-1">
                        Contact Administration
                    </a>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen w-full bg-[#7b0000] flex items-center justify-center">
                <div className="text-white">Loading...</div>
            </div>
        }>
            <LoginForm />
        </Suspense>
    );
}
