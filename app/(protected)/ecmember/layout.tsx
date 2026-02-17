"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Sidebar, NavItem } from "@/components/Sidebar";

type Props = {
    children: ReactNode;
};

const ecNavItems: NavItem[] = [
    {
        href: "/ecmember",
        icon: "dashboard",
        label: "Dashboard"
    },
    {
        href: "/ecmember/students",
        icon: "search",
        label: "Student Lookup"
    },
    {
        href: "/ecmember/event",
        icon: "event",
        label: "Event"
    },
    {
        href: "/ecmember/payment",
        icon: "payments",
        label: "Payments"
    },
    {
        href: "/ecmember/document",
        icon: "folder",
        label: "Document"
    }
];

export default function ECLayout({ children }: Props) {
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

            const data = snap.data() as {
                role?: string;
                mustChangePassword?: boolean;
            };

            if (data.mustChangePassword) {
                router.replace("/change-password");
                return;
            }

            if (data.role !== "ec") {
                router.replace("/login");
                return;
            }

            setAllowed(true);
        });

        return () => unsub();
    }, [router]);

    if (!allowed) {
        return <div className="p-6">Loading...</div>;
    }

    return (
        <div className="min-h-[100dvh] bg-[#f2f2f2]">
            <div className="flex">
                <Sidebar navItems={ecNavItems} enableMobileDrawer titleSize="sm" logoSize={80} />

                <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-10">
                    {children}
                </main>
            </div>
        </div>
    );
}
