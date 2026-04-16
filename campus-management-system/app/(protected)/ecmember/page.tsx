"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import {
  CreditCard,
  FileStack,
  LayoutDashboard,
  Search,
} from "lucide-react";
import {
  ECPageHeader,
  ECQuickActionCard,
  ECStatsGrid,
  type ECStatItem,
} from "@/components/ecmember";
import { auth, db } from "@/lib/firebase";
import {
  type CampusProfileDoc,
  resolveCampusDisplayName,
} from "@/lib/campus-auth";

const DASHBOARD_METRICS: ECStatItem[] = [
  {
    label: "Total Students",
    value: 0,
    description: "No live data yet",
    tone: "blue",
    icon: Search,
  },
  {
    label: "Upcoming Events",
    value: 0,
    description: "Waiting for sync",
    tone: "amber",
    icon: LayoutDashboard,
  },
  {
    label: "Pending Payments",
    value: 0,
    description: "No records available",
    tone: "red",
    icon: CreditCard,
  },
  {
    label: "Shared Documents",
    value: 0,
    description: "Waiting for sync",
    tone: "purple",
    icon: FileStack,
  },
];

const QUICK_LINKS = [
  {
    title: "Student Lookup",
    text: "Find student profiles and inspect individual status records.",
    href: "/ecmember/students",
    cta: "Open student lookup",
    icon: Search,
  },
  {
    title: "Events",
    text: "Create events, monitor files, and manage notifications.",
    href: "/ecmember/event",
    cta: "Open events",
    icon: LayoutDashboard,
  },
  {
    title: "Payments",
    text: "Track collection status and export reports for assigned students.",
    href: "/ecmember/payment",
    cta: "Open payments",
    icon: CreditCard,
  },
  {
    title: "Documents",
    text: "Upload, sort, and share the EC document library from one place.",
    href: "/ecmember/document",
    cta: "Open documents",
    icon: FileStack,
  },
];

export default function ECMemberDashboard() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setDisplayName(null);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) {
          setDisplayName("User");
          return;
        }

        setDisplayName(
          resolveCampusDisplayName(snap.data() as CampusProfileDoc),
        );
      } catch {
        setDisplayName("User");
      }
    });

    return () => unsub();
  }, []);

  return (
    <div className="space-y-5 sm:space-y-6">
      <ECPageHeader
        title={`Welcome back${displayName ? `, ${displayName}` : ""}.`}
        description="Keep student operations, events, payments, and shared documents moving from one EC workspace that stays usable on phones, tablets, and desktop."
        eyebrow="EC Member"
        icon={LayoutDashboard}
        variant="hero"
        meta={
          <>
            <Chip variant="flat" className="bg-white/15 text-white">
              Student lookup
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              Event workflow
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              Document sharing
            </Chip>
          </>
        }
      />

      <ECStatsGrid items={DASHBOARD_METRICS} />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-campus-text-primary">
            Quick Access
          </h2>
          <p className="text-sm text-campus-text-secondary">
            Jump into the EC modules you use most often.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {QUICK_LINKS.map((item) => (
            <ECQuickActionCard
              key={item.href}
              title={item.title}
              description={item.text}
              icon={item.icon}
              meta={
                item.href === "/ecmember/event" ? (
                  <Chip size="sm" className="bg-blue-50 text-blue-700">
                    Includes notifications
                  </Chip>
                ) : item.href === "/ecmember/document" ? (
                  <Chip size="sm" className="bg-violet-50 text-violet-700">
                    Shared file library
                  </Chip>
                ) : item.href === "/ecmember/payment" ? (
                  <Chip size="sm" className="bg-amber-50 text-amber-700">
                    Export-ready reports
                  </Chip>
                ) : (
                  <Chip size="sm" className="bg-emerald-50 text-emerald-700">
                    Student records
                  </Chip>
                )
              }
              action={
                <Button
                  color={item.href === "/ecmember/event" ? "primary" : "default"}
                  className="w-full sm:w-auto"
                  onPress={() => router.push(item.href)}
                >
                  {item.cta}
                </Button>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
