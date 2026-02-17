import { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@heroui/badge";

export default function StudentLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen flex bg-[#f2f2f2] text-gray-800">

            {/* SIDEBAR */}
            <aside className="w-64 bg-white shadow-xl border-r">
                <div className="w-full flex justify-center mt-6 mb-4">
                    <div className="flex flex-col items-center gap-3">
                        <Image
                            src="/new campus-logo.jpg"
                            alt="Campus Logo"
                            width={96}
                            height={96}
                            className="rounded-full object-cover shadow-md"
                        />
                        <h2 className="text-[#7b0000] font-black text-5xl">CAMPUS</h2>
                    </div>
                </div>

                <nav className="flex flex-col gap-2 px-4 mt-4">

                    <Link href="/student" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors">
                        <span className="material-icons">dashboard</span>
                        Dashboard
                    </Link>

                    <Link href="/student/status" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors">
                        <span className="material-icons">check</span>
                        Status
                    </Link>

                    <Link href="/student/event" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors">
                        <span className="material-icons">event</span>
                        Events
                    </Link>

                    {/* 🔔 Notifications with red badge */}
                    <Link href="/student/notifications" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 transition-colors">
                        <Badge content="8" color="danger" size="sm" placement="top-right">
                            <span className="material-icons">notifications</span>
                        </Badge>
                        Notifications
                    </Link>

                </nav>
            </aside>

            {/* MAIN CONTENT (dynamic pages go here) */}
            <main className="flex-1 p-10">
                {children}
            </main>
        </div>
    );
}
