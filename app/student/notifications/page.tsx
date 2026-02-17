"use client";
import { Card, CardBody } from "@heroui/card";

export default function NotificationsPage() {
    const notifications = [
        {
            id: 1,
            title: "Upcoming: C# and C++ Programming Tutorial",
            description: "Open to all CPE students.",
            displayDate: "02/15/2025 09:00 AM",
            date: "2025-02-15T09:00:00",
            type: "upcoming",
        },
        {
            id: 2,
            title: "Payment Due: Acquaintance Party",
            description: "Settle before deadline.",
            displayDate: "02/10/2025 02:30 PM",
            date: "2025-02-10T14:30:00",
            type: "payment",
        },
        {
            id: 3,
            title: "Missed Event: Calculus Tutorial",
            description: "Limits and continuity tutorial.",
            displayDate: "02/09/2025 01:00 PM",
            date: "2025-02-09T13:00:00",
            type: "missed",
        },
        {
            id: 4,
            title: "Pre-Register: Volleyball Tryout",
            description: "Limited slots. Register now.",
            displayDate: "02/08/2025 08:00 AM",
            date: "2025-02-08T08:00:00",
            type: "preregister",
        },
        {
            id: 5,
            title: "Upcoming: OJT Seminar",
            description: "Mandatory for all engineering students.",
            displayDate: "02/20/2025 02:00 PM",
            date: "2025-02-20T14:00:00",
            type: "upcoming",
        },
        {
            id: 6,
            title: "Upcoming: Sumobot",
            description: "Sumobot for CPE students.",
            displayDate: "02/18/2025 10:30 AM",
            date: "2025-02-18T10:30:00",
            type: "upcoming",
        },
        {
            id: 7,
            title: "Missed Event: Graduation Tutorial",
            description: "Report to the department for makeup schedule.",
            displayDate: "02/26/2025 11:00 AM",
            date: "2025-02-26T11:00:00",
            type: "missed",
        },
        {
            id: 8,
            title: "Upcoming: Data Structures Study Group",
            description: "Open session for all BSIT & Computer Engineering students.",
            displayDate: "02/17/2025 03:00 PM",
            date: "2025-02-17T15:00:00",
            type: "upcoming",
        },
    ]
        // sort latest → oldest
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const getCardClasses = (type: string) => {
        if (type === "upcoming") {
            return "bg-green-50 border-l-4 border-green-400";
        }
        if (type === "preregister") {
            return "bg-blue-50 border-l-4 border-blue-400";
        }
        if (type === "payment") {
            return "bg-yellow-50 border-l-4 border-yellow-400";
        }
        if (type === "missed") {
            return "bg-red-50 border-l-4 border-red-400";
        }
        return "bg-white border-l-4 border-gray-200";
    };

    return (
        <main className="min-h-screen bg-[#f7f7f7] px-8 py-6">
            <h1 className="text-3xl font-extrabold text-[#7b0000] mb-4">
                Notifications
            </h1>

            <div className="space-y-4 max-w-4xl">
                {notifications.map((item) => (
                    <Card
                        key={item.id}
                        shadow="sm"
                        className={getCardClasses(item.type)}
                    >
                        <CardBody className="flex flex-row gap-3 p-4">
                            <div className="mt-1">
                                <span className="material-icons text-gray-500 text-lg">
                                    event_note
                                </span>
                            </div>

                            <div className="flex-1">
                                <h2 className="font-semibold text-sm md:text-base text-gray-800">
                                    {item.title}
                                </h2>
                                <p className="text-xs md:text-sm text-gray-600">
                                    {item.description}
                                </p>
                                <p className="text-[11px] md:text-xs text-gray-500 mt-1">
                                    {item.displayDate}
                                </p>
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </div>
        </main>
    );
}
