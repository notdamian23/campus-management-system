"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

function clearCampusCookies() {
    document.cookie = "campus_logged_in=; Path=/; Max-Age=0";
    document.cookie = "campus_role=; Path=/; Max-Age=0";
    document.cookie = "campus_must_change=; Path=/; Max-Age=0";
}

export default function LogoutButton() {
    const router = useRouter();

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } finally {
            clearCampusCookies();
            router.replace("/login");
        }
    };

    return (
        <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition"
        >
            Logout
        </button>
    );
}
