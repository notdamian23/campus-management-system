"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CampusLayoutLoadingState } from "@/components/ui";
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

export default function TeacherLayout({ children }: { children: ReactNode }) {
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
      return;
    }

    if (accessState === "verification-pending") {
      router.replace("/verify-email-pending");
    }
  }, [accessState, router]);

  if (accessState !== "authorized") {
    return (
      <CampusLayoutLoadingState
        title="Loading teacher portal"
        description="Checking your account access and syncing records."
      />
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
          contextLabel="Teacher Portal"
          showLogout
        />

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 xl:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
