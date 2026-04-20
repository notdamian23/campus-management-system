"use client";

import { useEffect, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { CampusLayoutLoadingState } from "@/components/ui";
import { auth, db } from "@/lib/firebase";
import { Sidebar, NavItem } from "@/components/Sidebar";
import {
  type CampusProfileDoc,
  getOnboardingRedirect,
} from "@/lib/campus-auth";
import { isEcRole, normalizeCampusRole } from "@/lib/campus-role";

type Props = {
  children: ReactNode;
};

const ecNavItems: NavItem[] = [
  {
    href: "/ecmember",
    icon: "dashboard",
    label: "Dashboard",
  },
  {
    href: "/ecmember/students",
    icon: "search",
    label: "Student Lookup",
  },
  {
    href: "/ecmember/event",
    icon: "event",
    label: "Event",
  },
  {
    href: "/ecmember/payment",
    icon: "payments",
    label: "Payments",
  },
  {
    href: "/ecmember/document",
    icon: "folder",
    label: "Document",
  },
];

const adminStudentLookupNavItems: NavItem[] = [
  {
    href: "/admin",
    icon: "dashboard",
    label: "Admin Dashboard",
  },
  {
    href: "/ecmember/students",
    icon: "search",
    label: "Student Lookup",
  },
];

export default function ECLayout({ children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);
  const [viewerRole, setViewerRole] = useState<"ecmember" | "admin" | null>(
    null,
  );

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

      const data = snap.data() as CampusProfileDoc;
      const role = normalizeCampusRole(data.role);
      const onboardingRedirect = getOnboardingRedirect(data);
      if (onboardingRedirect) {
        router.replace(onboardingRedirect);
        return;
      }

      const canOpenStudentLookupAsAdmin =
        role === "admin" && pathname === "/ecmember/students";
      const canOpenEcWorkspace = isEcRole(data.role);

      if (!canOpenEcWorkspace && !canOpenStudentLookupAsAdmin) {
        router.replace("/login");
        return;
      }

      setViewerRole(canOpenStudentLookupAsAdmin ? "admin" : "ecmember");
      setAllowed(true);
    });

    return () => unsub();
  }, [pathname, router]);

  if (!allowed) {
    return (
      <CampusLayoutLoadingState
        title="Loading EC workspace"
        description="Checking your CAMPUS access and preparing the EC dashboard."
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f2f2f2]">
      <div className="flex flex-col lg:flex-row">
        <Sidebar
          navItems={
            viewerRole === "admin" ? adminStudentLookupNavItems : ecNavItems
          }
          enableMobileDrawer
          titleSize="sm"
          logoSize={208}
          contextLabel={
            viewerRole === "admin" ? "Admin Student Lookup" : "EC Workspace"
          }
          showLogout
          showStudentAccountSwitch={viewerRole === "ecmember"}
          studentAccountHref="/student"
          studentAccountLabel="Student Portal"
        />

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 xl:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
