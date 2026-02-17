"use client";

import { ReactNode } from "react";
import { Sidebar, NavItem } from "@/components/Sidebar";

const studentNavItems: NavItem[] = [
    {
        href: "/student",
        icon: "dashboard",
        label: "Dashboard"
    },
    {
        href: "/student/status",
        icon: "check",
        label: "Status"
    },
    {
        href: "/student/event",
        icon: "event",
        label: "Events"
    },
    {
        href: "/student/notifications",
        icon: "notifications",
        label: "Notifications",
        badge: {
            content: "8",
            color: "danger"
        }
    }
];

export default function StudentLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen flex bg-[#f2f2f2]">
            <Sidebar navItems={studentNavItems} />

            <main className="flex-1 p-10">
                {children}
            </main>
        </div>
    );
}
