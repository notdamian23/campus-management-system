"use client";

import { useEffect, useState, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { CampusLayoutLoadingState } from "@/components/ui";
import { auth, db } from "@/lib/firebase";
import { Sidebar, NavItem } from "@/components/Sidebar";

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
  const [viewerRole, setViewerRole] = useState<"ec" | "admin" | null>(null);

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

      const data = snap.data() as {
        role?: string;
        mustChangePassword?: boolean;
      };

      if (data.mustChangePassword) {
        router.replace("/change-password");
        return;
      }

      const canOpenStudentLookupAsAdmin =
        data.role === "admin" && pathname === "/ecmember/students";

      if (data.role !== "ec" && !canOpenStudentLookupAsAdmin) {
        router.replace("/login");
        return;
      }

      setViewerRole(canOpenStudentLookupAsAdmin ? "admin" : "ec");
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
          logoSize={80}
          showLogout
          showStudentAccountSwitch={viewerRole === "ec"}
          studentAccountHref="/student"
          studentAccountLabel="Student Account"
        />

        <main className="flex-1 min-w-0 p-3 sm:p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
