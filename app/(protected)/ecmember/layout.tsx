"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import Link from "next/link";
import { FiMenu, FiX } from "react-icons/fi";

type Props = {
    children: ReactNode;
};

export default function ECLayout({ children }: Props) {
    const router = useRouter();
    const pathname = usePathname();

    const [allowed, setAllowed] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) {
                router.replace("/login");
                return;
            }

            const snap = await getDoc(doc(db, "profiles", user.uid));
            if (!snap.exists()) {
                router.replace("/login");
                return;
            }

            const data = snap.data() as {
                role?: string;
                mustChangePassword?: boolean;
            };

            if (data.mustChangePassword) {
                router.replace("/change-password");
                return;
            }

            if (data.role !== "ec") {
                router.replace("/login");
                return;
            }

            setAllowed(true);
        });

        return () => unsub();
    }, [router]);

    // Close mobile drawer on route change
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    if (!allowed) {
        return <div className="p-6">Loading...</div>;
    }

    const NavLinks = () => (
        <nav className="flex flex-col gap-2 px-4 mt-4">
            <Link
                href="/ecmember"
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100"
            >
                <span className="material-icons">dashboard</span> Dashboard
            </Link>

            <Link
                href="/ecmember/students"
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100"
            >
                <span className="material-icons">search</span> Student Lookup
            </Link>

            <Link
                href="/ecmember/event"
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100"
            >
                <span className="material-icons">event</span> Event
            </Link>

            <Link
                href="/ecmember/payment"
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100"
            >
                <span className="material-icons">payments</span> Payments
            </Link>

            <Link
                href="/ecmember/document"
                className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100"
            >
                <span className="material-icons">folder</span> Document
            </Link>
        </nav>
    );

    return (
        <div className="min-h-[100dvh] bg-[#f2f2f2] text-gray-800">
            {/* Mobile Top Bar */}
            <div className="sticky top-0 z-40 flex items-center justify-between bg-white border-b px-4 py-3 lg:hidden">
                <button
                    onClick={() => setOpen(true)}
                    className="p-2 rounded-lg border hover:bg-gray-50"
                >
                    <FiMenu />
                </button>

                <div className="font-black text-[#7b0000]">CAMPUS</div>
                <div className="w-8" />
            </div>

            <div className="flex">
                {/* Desktop Sidebar */}
                <aside className="hidden lg:block w-64 bg-white shadow-xl border-r min-h-[100dvh]">
                    <div className="w-full flex justify-center mt-6 mb-4">
                        <div className="flex flex-col items-center gap-3">
                            <img
                                src="/new campus-logo.jpg"
                                className="w-20 h-20 rounded-full object-cover shadow-md"
                                alt="CAMPUS Logo"
                            />
                            <h2 className="text-[#7b0000] font-black text-3xl">
                                CAMPUS
                            </h2>
                        </div>
                    </div>

                    <NavLinks />
                </aside>

                {/* Mobile Drawer */}
                {open && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        <button
                            className="absolute inset-0 bg-black/50"
                            onClick={() => setOpen(false)}
                        />

                        <aside className="absolute left-0 top-0 h-full w-72 bg-white border-r shadow-xl">
                            <div className="flex items-center justify-between p-4 border-b">
                                <div className="font-black text-[#7b0000] text-2xl">
                                    CAMPUS
                                </div>
                                <button
                                    onClick={() => setOpen(false)}
                                    className="p-2 rounded-lg border hover:bg-gray-50"
                                >
                                    <FiX />
                                </button>
                            </div>

                            <div className="w-full flex justify-center mt-6 mb-2">
                                <img
                                    src="/new campus-logo.jpg"
                                    className="w-16 h-16 rounded-full object-cover shadow-md"
                                    alt="CAMPUS Logo"
                                />
                            </div>

                            <NavLinks />
                        </aside>
                    </div>
                )}

                {/* Page Content */}
                <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-10">
                    {children}
                </main>
            </div>
        </div>
    );
}
