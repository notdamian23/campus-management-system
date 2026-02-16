"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FiMenu, FiX } from "react-icons/fi";

const nav = [
    { href: "/ecmember", label: "Dashboard" },
    { href: "/ecmember/students", label: "Student Lookup" },
    { href: "/ecmember/event", label: "Event" },
    { href: "/ecmember/payment", label: "Payments" },
    { href: "/ecmember/document", label: "Document" },
];

export default function ECMemberLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    // close drawer when route changes
    useEffect(() => {
        setOpen(false);
    }, [pathname]);

    return (
        <div className="min-h-dvh bg-gray-50">
            {/* ✅ Mobile top bar */}
            <div className="sticky top-0 z-40 flex items-center justify-between bg-white border-b px-4 py-3 lg:hidden">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="p-2 rounded-lg border hover:bg-gray-50"
                    aria-label="Open menu"
                >
                    <FiMenu />
                </button>

                <div className="font-bold text-[#7b0000]">CAMPUS</div>

                <div className="w-10" />
            </div>

            {/* ✅ Desktop layout */}
            <div className="flex">
                {/* Sidebar desktop */}
                <aside className="hidden lg:flex lg:flex-col lg:w-72 lg:min-h-[100dvh] bg-white border-r">
                    <div className="p-6 border-b">
                        <div className="text-3xl font-extrabold text-[#7b0000]">CAMPUS</div>
                        <div className="text-xs text-gray-500 mt-1">EC Member</div>
                    </div>

                    <nav className="p-4 space-y-2">
                        {nav.map((item) => {
                            const active = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`block px-4 py-3 rounded-lg border transition ${
                                        active ? "bg-[#7b0000] text-white border-[#7b0000]" : "bg-white hover:bg-gray-50"
                                    }`}
                                >
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>
                </aside>

                {/* ✅ Mobile drawer overlay */}
                {open && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        <button
                            className="absolute inset-0 bg-black/50"
                            onClick={() => setOpen(false)}
                            aria-label="Close overlay"
                        />
                        <aside className="absolute left-0 top-0 h-full w-72 bg-white border-r shadow-xl">
                            <div className="flex items-center justify-between p-4 border-b">
                                <div className="font-extrabold text-[#7b0000] text-2xl">CAMPUS</div>
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="p-2 rounded-lg border hover:bg-gray-50"
                                    aria-label="Close menu"
                                >
                                    <FiX />
                                </button>
                            </div>

                            <nav className="p-4 space-y-2">
                                {nav.map((item) => {
                                    const active = pathname === item.href;
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={`block px-4 py-3 rounded-lg border transition ${
                                                active ? "bg-[#7b0000] text-white border-[#7b0000]" : "bg-white hover:bg-gray-50"
                                            }`}
                                        >
                                            {item.label}
                                        </Link>
                                    );
                                })}
                            </nav>
                        </aside>
                    </div>
                )}

                {/* ✅ Main content */}
                <main className="flex-1 min-w-0">
                    <div className="w-full max-w-[1200px] mx-auto">{children}</div>
                </main>
            </div>
        </div>
    );
}
