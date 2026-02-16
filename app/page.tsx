"use client";

import Image from "next/image";
import { Poppins } from "next/font/google";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

import { auth, db } from "@/lib/firebase";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const poppins = Poppins({
    subsets: ["latin"],
    weight: ["400", "600", "700", "800"],
});

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
                    <label className="text-sm font-medium text-gray-700">School ID</label>
                    <div className="flex items-center border rounded-lg px-3 py-2 bg-gray-50 mt-1">
                        <span className="material-icons text-gray-400 mr-2">person</span>
                        <input
                            type="text"
                            inputMode="numeric"
                            placeholder="e.g. 23209455"
                            value={schoolId}
                            onChange={(e) => setSchoolId(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleLogin();
                            }}
                            className="w-full bg-gray-50 outline-none text-gray-800"
                        />
                    </div>
                </div>

                {/* Password */}
                <div className="w-full mb-4">
                    <label className="text-sm font-medium text-gray-700">Password</label>
                    <div className="flex items-center border rounded-lg px-3 py-2 bg-gray-50 mt-1">
                        <span className="material-icons text-gray-400 mr-2">lock</span>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleLogin();
                            }}
                            className="w-full bg-gray-50 outline-none text-gray-800"
                            placeholder="Enter password"
                        />
                    </div>
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
                <button
                    onClick={handleLogin}
                    disabled={loading}
                    className="w-full bg-yellow-400 text-black py-2 rounded-lg font-semibold hover:bg-yellow-500 transition disabled:opacity-60"
                >
                    {loading ? "Signing in..." : "Sign In"}
                </button>

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
