"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Sidebar, NavItem } from "@/components/Sidebar";
import { CampusLayoutLoadingState } from "@/components/ui";
import {
  StudentPortalProvider,
  useStudentPortal,
} from "@/components/student";
import { auth, db } from "@/lib/firebase";
import {
  type CampusProfileDoc,
  getOnboardingRedirect,
} from "@/lib/campus-auth";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <StudentPortalProvider>
      <StudentLayoutShell>{children}</StudentLayoutShell>
    </StudentPortalProvider>
  );
}

function StudentLayoutShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { unreadNotificationsCount } = useStudentPortal();
  const [canSwitchToEc, setCanSwitchToEc] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthorized(false);

      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) {
          router.replace("/login");
          return;
        }

        const profile = snap.data() as CampusProfileDoc;
        const onboardingRedirect = getOnboardingRedirect(profile);
        if (onboardingRedirect) {
          router.replace(onboardingRedirect);
          return;
        }

        if (
          profile.role !== "student" &&
          profile.role !== "ec" &&
          profile.role !== "ecmember"
        ) {
          router.replace("/login");
          return;
        }

        setCanSwitchToEc(
          profile.role === "ec" || profile.role === "ecmember",
        );
        setAuthorized(true);
      } catch {
        router.replace("/login");
      }
    });

    return () => unsub();
  }, [router]);

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

  if (!authorized) {
    return (
      <CampusLayoutLoadingState
        title="Loading student portal"
        description="Checking your CAMPUS account setup and syncing your student dashboard."
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f2f2f2]">
      <div className="flex flex-col lg:flex-row">
        <Sidebar
          navItems={navItems}
          enableMobileDrawer
          titleSize="sm"
          logoSize={208}
          contextLabel="Student Portal"
          showLogout
          showStudentAccountSwitch={canSwitchToEc}
          studentAccountHref="/ecmember"
          studentAccountLabel="EC Account"
        />

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 xl:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
