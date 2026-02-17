"use client";

import { ReactNode } from "react";
import { Sidebar, NavItem } from "@/components/Sidebar";

const teacherNavItems: NavItem[] = [
    {
        href: "/teacher",
        icon: "dashboard",
        label: "Dashboard"
    },
    {
        href: "/teacher/students",
        icon: "group",
        label: "Students"
    },
    {
        href: "/teacher/events",
        icon: "event",
        label: "Events"
    }
];

export default function TeacherLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen flex bg-[#f2f2f2]">
            <Sidebar navItems={teacherNavItems} />

            <main className="flex-1 p-10">
                {children}
            </main>
        </div>
    );
}
