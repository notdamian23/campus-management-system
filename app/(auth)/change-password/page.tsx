"use client";

import Image from "next/image";
import { Poppins } from "next/font/google";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { updatePassword } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const poppins = Poppins({
    subsets: ["latin"],
    weight: ["400", "600", "700", "800"],
});

type Role = "teacher" | "student" | "ec";

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
    const [showPass, setShowPass] = useState(false);

    const [loading, setLoading] = useState(false);
    const [errMsg, setErrMsg] = useState("");

    const onSave = async () => {
        setErrMsg("");

        if (newPass.length < 6) return setErrMsg("Password must be at least 6 characters.");
        if (newPass !== confirm) return setErrMsg("Passwords do not match.");

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

            // 2) Turn off mustChangePassword
            await updateDoc(doc(db, "profiles", user.uid), { mustChangePassword: false });

            // 3) Refresh role and update cookies
            const snap = await getDoc(doc(db, "profiles", user.uid));
            const role = snap.data()?.role as Role | undefined;

            if (!role) {
                router.replace("/");
                return;
            }

            setCampusCookies(role, false);

            // 4) Redirect
            if (role === "ec") router.replace("/ecmember");
            else if (role === "teacher") router.replace("/teacher");
            else if (role === "student") router.replace("/student");
            else router.replace("/");
        } catch (e: any) {
            const code = e?.code as string | undefined;
            if (code === "auth/requires-recent-login") {
                setErrMsg("Please log in again, then try changing your password.");
                router.replace("/login?next=/change-password");
            } else {
                setErrMsg(e?.message ?? "Failed to update password.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-[100dvh] w-full bg-[#7b0000] flex items-center justify-center px-4 py-8">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-xl px-6 sm:px-10 py-8 flex flex-col items-center">
                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden flex items-center justify-center mb-4 border-4 border-[#7b0000]">
                    <Image
                        src="/new campus-logo.jpg"
                        alt="Campus Logo"
                        width={220}
                        height={220}
                        className="object-cover"
                        priority
                    />
                </div>

                <h1 className={`text-4xl font-extrabold text-center text-[#7b0000] tracking-tight ${poppins.className}`}>
                    CAMPUS
                </h1>

                <p className="text-gray-500 text-center mb-6 text-sm sm:text-base">
                    First login detected. Please set a new password.
                </p>

                {errMsg && (
                    <div className="w-full mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                        {errMsg}
                    </div>
                )}

                <div className="w-full mb-4">
                    <label className="text-sm font-medium text-gray-700">New Password</label>
                    <div className="flex items-center border rounded-lg px-3 py-2 bg-gray-50 mt-1">
                        <span className="material-icons text-gray-400 mr-2">lock</span>
                        <input
                            type={showPass ? "text" : "password"}
                            value={newPass}
                            onChange={(e) => setNewPass(e.target.value)}
                            className="w-full bg-gray-50 outline-none text-gray-800 text-base"
                            placeholder="Enter new password"
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPass((v) => !v)}
                            className="ml-2 text-sm text-gray-600 hover:text-gray-900"
                        >
                            {showPass ? "Hide" : "Show"}
                        </button>
                    </div>
                </div>

                <div className="w-full mb-6">
                    <label className="text-sm font-medium text-gray-700">Confirm Password</label>
                    <div className="flex items-center border rounded-lg px-3 py-2 bg-gray-50 mt-1">
                        <span className="material-icons text-gray-400 mr-2">lock</span>
                        <input
                            type={showPass ? "text" : "password"}
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            className="w-full bg-gray-50 outline-none text-gray-800 text-base"
                            placeholder="Confirm new password"
                            autoComplete="new-password"
                        />
                    </div>
                </div>

                <button
                    onClick={onSave}
                    disabled={loading}
                    className="w-full bg-yellow-400 text-black py-3 rounded-lg font-semibold hover:bg-yellow-500 transition disabled:opacity-60"
                >
                    {loading ? "Saving..." : "Save password"}
                </button>

                <div className="mt-6 text-sm text-gray-600 text-center">
                    Tip: Use a strong password you can remember.
                </div>
            </div>
        </div>
    );
}
