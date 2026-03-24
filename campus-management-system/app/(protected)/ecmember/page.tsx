"use client";

import { useRouter } from "next/navigation";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";

const DASHBOARD_METRICS = [
  { label: "Total Students", value: 0, tone: "text-blue-600" },
  { label: "Upcoming Events", value: 0, tone: "text-emerald-600" },
  { label: "Pending Payments", value: 0, tone: "text-amber-600" },
];

const QUICK_LINKS = [
  { title: "Student Lookup", text: "Find student profiles and inspect individual status records.", href: "/ecmember/students" },
  { title: "Event Management", text: "Create events, monitor files, and manage notifications.", href: "/ecmember/event" },
  { title: "Payments", text: "Track collection status and export reports for assigned students.", href: "/ecmember/payment" },
  { title: "Documents", text: "Upload, sort, and share the EC document library from one place.", href: "/ecmember/document" },
];

export default function ECMemberDashboard() {
  const router = useRouter();

  return (
    <div className="space-y-5 sm:space-y-6">
      <Card shadow="sm" className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#b32020] to-[#f18f4e] text-white">
        <CardBody className="space-y-4 p-5 sm:p-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">EC Member</p>
            <h1 className="text-3xl font-black sm:text-4xl">Operations Dashboard</h1>
            <p className="max-w-2xl text-sm text-white/80 sm:text-base">
              Keep student operations, events, payments, and shared documents in sync from one mobile-friendly workspace.
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DASHBOARD_METRICS.map((metric) => (
          <Card key={metric.label} shadow="sm" className="border">
            <CardBody className="p-5">
              <p className="text-sm text-campus-text-secondary">{metric.label}</p>
              <h2 className={`mt-2 text-3xl font-black ${metric.tone}`}>{metric.value}</h2>
              <p className="mt-3 text-sm text-campus-text-secondary">This tile is ready for live data whenever the backend feed is wired in.</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="text-xl font-bold text-campus-text-primary">Quick access</h2>
            <p className="text-sm text-campus-text-secondary">Jump into the modules EC members use most often.</p>
          </div>
        </CardHeader>
        <CardBody className="grid gap-4 p-5 md:grid-cols-2">
          {QUICK_LINKS.map((item) => (
            <Card key={item.href} shadow="none" className="border bg-white">
              <CardBody className="space-y-4 p-4">
                <div>
                  <h3 className="text-lg font-semibold text-campus-text-primary">{item.title}</h3>
                  <p className="mt-2 text-sm text-campus-text-secondary">{item.text}</p>
                </div>
                <Button className="w-full bg-[#7b0000] font-semibold text-white sm:w-auto" onPress={() => router.push(item.href)}>
                  Open module
                </Button>
              </CardBody>
            </Card>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
