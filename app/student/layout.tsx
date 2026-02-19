"use client";

import { ReactNode, useMemo } from "react";
import { Sidebar, NavItem } from "@/components/Sidebar";
import {
  StudentPortalProvider,
  useStudentPortal,
} from "@/components/student/StudentPortalProvider";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <StudentPortalProvider>
      <StudentLayoutShell>{children}</StudentLayoutShell>
    </StudentPortalProvider>
  );
}

function StudentLayoutShell({ children }: { children: ReactNode }) {
  const { notifications } = useStudentPortal();

  const navItems = useMemo<NavItem[]>(() => {
    const notificationCount = notifications.length;

    const baseItems: NavItem[] = [
      {
        href: "/student",
        icon: "dashboard",
        label: "Dashboard",
      },
      {
        href: "/student/status",
        icon: "check",
        label: "Status",
      },
      {
        href: "/student/event",
        icon: "event",
        label: "Events",
      },
    ];

    const notificationsItem: NavItem = {
      href: "/student/notifications",
      icon: "notifications",
      label: "Notifications",
    };

    if (notificationCount > 0) {
      notificationsItem.badge = {
        content: String(Math.min(notificationCount, 99)),
        color: "danger",
      };
    }

    return [...baseItems, notificationsItem];
  }, [notifications.length]);

  return (
    <div className="min-h-screen flex bg-[#f2f2f2]">
      <Sidebar navItems={navItems} />

      <main className="flex-1 p-10">{children}</main>
    </div>
  );
}
