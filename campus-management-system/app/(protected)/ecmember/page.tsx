"use client";

import { Card, CardBody } from "@heroui/card";

/**
 * EC landing dashboard.
 * Values are placeholders until live data wiring is added.
 */
type DashboardMetric = {
  label: string;
  value: number;
  valueClassName: string;
};

const DASHBOARD_METRICS: DashboardMetric[] = [
  { label: "Total Students", value: 0, valueClassName: "text-blue-600" },
  { label: "Upcoming Events", value: 0, valueClassName: "text-green-600" },
  { label: "Pending Payments", value: 0, valueClassName: "text-orange-600" },
];

export default function ECMemberDashboard() {
  return (
    <div className="p-3 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold text-primary-900 sm:mb-6 sm:text-3xl">
        EC Member Dashboard
      </h1>

      {/* Metric cards (placeholder values) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {DASHBOARD_METRICS.map((metric) => (
          <Card key={metric.label} shadow="sm">
            <CardBody>
              <p className="text-sm text-campus-text-secondary">{metric.label}</p>
              <h2 className={`mt-2 text-3xl font-bold ${metric.valueClassName}`}>{metric.value}</h2>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
