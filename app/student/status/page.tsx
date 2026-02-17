"use client";

import { useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { CampusBadge } from "@/components/heroui";

export default function StudentStatus() {
    const [filter, setFilter] = useState("all");
    const [sortMode, setSortMode] = useState("default");

    // EVENTS DATA
    const attendedEvents = [
        {
            title: "Graduation Orientation",
            date: "March 15, 2024 | 9:00 AM – 5:00 PM",
            location: "Fab Lab",
        },
        {
            title: "Programming Tutorial",
            date: "Feb 28, 2024 | 1:00 PM – 6:00 PM",
            location: "CBE 901",
        },
    ];

    const missedEvents = [
        {
            title: "General Assembly",
            date: "Jan 15, 2024 | 8:00 AM – 12:00 PM",
            location: "Maritime AVR",
        },
    ];

    // PAYMENTS DATA
    const payments = [
        { name: "Acquaintance Fee", status: "PAID" },
        { name: "Engineering Merch", status: "UNPAID" },
    ];

    // SORT PAYMENTS
    const sortedPayments = [...payments].sort((a, b) => {
        if (sortMode === "paid") return a.status === "PAID" ? -1 : 1;
        if (sortMode === "unpaid") return a.status === "UNPAID" ? -1 : 1;
        return 0;
    });

    return (
        <div className="p-10 space-y-10 bg-gray-50 min-h-screen">

            {/* HEADER */}
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 flex items-center justify-center rounded-full bg-[#7b0000] text-white font-bold">
                    ST
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-campus-text-primary">Student Status</h1>
                    <p className="text-sm text-campus-text-secondary">Overview of your attendance and payments</p>
                </div>
            </div>

            {/* FILTER BUTTONS */}
            <div className="flex flex-wrap gap-3 bg-white border rounded-xl p-4 shadow-sm">
                {[
                    { label: "All", value: "all" },
                    { label: "Events Attended", value: "attended" },
                    { label: "Events Missed", value: "missed" },
                    { label: "Payments", value: "payments" },
                ].map((btn) => (
                    <button
                        key={btn.value}
                        onClick={() => setFilter(btn.value)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition
                            ${filter === btn.value
                            ? "bg-[#7b0000] text-white"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"}
                        `}
                    >
                        {btn.label}
                    </button>
                ))}
            </div>

            {/* EVENTS ATTENDED */}
            {(filter === "all" || filter === "attended") && (
                <div>
                    <h2 className="font-semibold text-campus-text-primary mb-3 flex items-center gap-2">
                        <span className="text-green-600">✔</span> Events Attended
                    </h2>

                    <div className="grid md:grid-cols-2 gap-4">
                        {attendedEvents.map((event, index) => (
                            <Card key={index} shadow="sm" isPressable>
                                <CardBody>
                                    <h3 className="font-semibold text-campus-text-primary">{event.title}</h3>
                                    <p className="text-sm text-campus-text-secondary">{event.date}</p>
                                    <p className="text-xs text-campus-text-secondary">{event.location}</p>
                                </CardBody>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* EVENTS MISSED */}
            {(filter === "all" || filter === "missed") && (
                <div>
                    <h2 className="font-semibold text-campus-text-primary mb-3 flex items-center gap-2">
                        <span className="text-red-600">✖</span> Events Missed
                    </h2>

                    <div className="space-y-3">
                        {missedEvents.map((event, index) => (
                            <Card key={index} shadow="sm" className="bg-red-50 border-red-100">
                                <CardBody>
                                    <h3 className="font-semibold text-campus-text-primary">{event.title}</h3>
                                    <p className="text-sm text-campus-text-secondary">{event.date}</p>
                                    <p className="text-xs text-campus-text-secondary">{event.location}</p>
                                </CardBody>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* PAYMENTS */}
            {(filter === "all" || filter === "payments") && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-campus-text-primary text-lg flex items-center gap-2">
                            💰 Payments
                        </h2>

                        {/* SORT DROPDOWN */}
                        <Select
                            size="sm"
                            label="Sort by"
                            selectedKeys={[sortMode]}
                            onChange={(e) => setSortMode(e.target.value)}
                            className="w-48"
                        >
                            <SelectItem key="default">Default</SelectItem>
                            <SelectItem key="paid">PAID First</SelectItem>
                            <SelectItem key="unpaid">UNPAID First</SelectItem>
                        </Select>
                    </div>

                    {/* PAYMENT LIST */}
                    <div className="space-y-3">
                        {sortedPayments.map((p, index) => (
                            <Card
                                key={index}
                                shadow="sm"
                                className={p.status === "PAID" ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}
                            >
                                <CardBody className="flex flex-row justify-between items-center">
                                    <span className="font-medium text-campus-text-primary">{p.name}</span>
                                    <CampusBadge status={p.status === "PAID" ? "paid" : "unpaid"}>
                                        {p.status}
                                    </CampusBadge>
                                </CardBody>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
