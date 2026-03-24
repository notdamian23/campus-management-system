"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@heroui/spinner";
import { Sidebar, NavItem } from "@/components/Sidebar";
import {
  TeacherPortalProvider,
  useTeacherPortal,
} from "@/components/teacher/TeacherPortalProvider";

const teacherNavItems: NavItem[] = [
  {
    href: "/teacher",
    icon: "dashboard",
    label: "Dashboard",
  },
  {
    href: "/teacher/students",
    icon: "group",
    label: "Students",
  },
  {
    href: "/teacher/events",
    icon: "event",
    label: "Events",
  },
  {
    href: "/teacher/documents",
    icon: "description",
    label: "Documents",
  },
];

export default function TeacherLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <TeacherPortalProvider>
      <TeacherLayoutShell>{children}</TeacherLayoutShell>
    </TeacherPortalProvider>
  );
}

function TeacherLayoutShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { accessState } = useTeacherPortal();

  useEffect(() => {
    if (accessState === "unauthenticated" || accessState === "forbidden") {
      router.replace("/login");
      return;
    }

    if (accessState === "must-change-password") {
      router.replace("/change-password");
    }
  }, [accessState, router]);

  if (accessState !== "authorized") {
    return (
      <div className="min-h-[100dvh] bg-[#f2f2f2] flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-bg-main px-6 py-8 text-center shadow-sm">
          <Spinner color="primary" />
          <div>
            <p className="text-sm font-semibold text-campus-text-primary">
              Loading teacher portal
            </p>
            <p className="text-xs text-campus-text-secondary">
              Checking your account access and syncing records.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f2f2f2]">
      <div className="flex flex-col lg:flex-row">
        <Sidebar
          navItems={teacherNavItems}
          enableMobileDrawer
          titleSize="sm"
          logoSize={80}
          showLogout
        />

        <main className="flex-1 min-w-0 p-3 sm:p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
