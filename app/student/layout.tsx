"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
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
  const { unreadNotificationsCount } = useStudentPortal();
  const [canSwitchToEc, setCanSwitchToEc] = useState(false);

  useEffect(() => {
    const roleCookie = document.cookie
      .split("; ")
      .find((item) => item.startsWith("campus_role="));
    const role = roleCookie?.slice("campus_role=".length) ?? "";
    setCanSwitchToEc(role === "ec");
  }, []);

  const navItems = useMemo<NavItem[]>(() => {
    const notificationCount = unreadNotificationsCount;

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
      {
        href: "/student/payment",
        icon: "payments",
        label: "Payments",
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
  }, [unreadNotificationsCount]);

  return (
    <div className="min-h-[100dvh] bg-[#f2f2f2]">
      <div className="flex flex-col lg:flex-row">
        <Sidebar
          navItems={navItems}
          enableMobileDrawer
          titleSize="sm"
          logoSize={80}
          showStudentAccountSwitch={canSwitchToEc}
          studentAccountHref="/ecmember"
          studentAccountLabel="EC Account"
        />

        <main className="flex-1 min-w-0 p-3 sm:p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
