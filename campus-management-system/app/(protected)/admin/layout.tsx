"use client";

import {useEffect, useState, type ReactNode} from "react";
import {useRouter} from "next/navigation";
import {onAuthStateChanged} from "firebase/auth";
import {doc, getDoc} from "firebase/firestore";
import {Sidebar, type NavItem} from "@/components/Sidebar";
import {CampusLayoutLoadingState} from "@/components/ui";
import {auth, db} from "@/lib/firebase";
import {
  type CampusProfileDoc,
  getOnboardingRedirect,
} from "@/lib/campus-auth";

type Props = {
  children: ReactNode;
};

const adminNavItems: NavItem[] = [
  {
    href: "/admin",
    icon: "dashboard",
    label: "Dashboard",
  },
  {
    href: "/admin/fingerprint-cleanup",
    icon: "fingerprint",
    label: "Fingerprint Cleanup",
  },
];

export default function AdminLayout({children}: Props) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

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

      const profile = snap.data() as CampusProfileDoc;
      const onboardingRedirect = getOnboardingRedirect(profile);
      if (onboardingRedirect) {
        router.replace(onboardingRedirect);
        return;
      }

      if (profile.role !== "admin") {
        router.replace("/login");
        return;
      }

      setAllowed(true);
    });

    return () => unsub();
  }, [router]);

  if (!allowed) {
    return (
      <CampusLayoutLoadingState
        title="Loading admin workspace"
        description="Checking your CAMPUS access and preparing admin tools."
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f2f2f2]">
      <div className="flex flex-col lg:flex-row">
        <Sidebar
          navItems={adminNavItems}
          enableMobileDrawer
          titleSize="sm"
          logoSize={208}
          contextLabel="Admin Workspace"
          showLogout
        />
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8 xl:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
