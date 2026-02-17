import { Card, CardBody, CardHeader } from "@heroui/card";
import { CampusBadge } from "@/components/heroui";

export default function TeacherDashboard() {
    return (
        <div className="min-h-screen bg-[#f2f2f2] px-10 py-8">

            {/* HEADER */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-5xl font-extrabold text-[#7b0000] drop-shadow-sm">
                        Welcome back!
                    </h1>
                    <p className="text-gray-600 text-lg mt-1">
                        Here's what's happening today.
                    </p>
                </div>

                {/* PROFILE */}
                <div className="flex flex-col items-center">
                    <div className="w-14 h-14 bg-[#7b0000] hover:bg-red-900 transition text-white rounded-full flex items-center justify-center shadow-lg cursor-pointer">
                        <span className="material-icons text-3xl">person</span>
                    </div>
                    <p className="text-xs mt-1 text-gray-600 font-medium">Teacher</p>
                </div>
            </div>

            {/* EVENTS OVERVIEW */}
            <section className="mt-10 flex justify-center">
                <Card className="w-full max-w-7xl" shadow="lg">
                    <CardHeader className="flex flex-wrap items-center justify-between gap-4 px-10 py-6">
                        <div>
                            <h2 className="text-3xl font-bold text-[#7b0000]">
                                Events Overview
                            </h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Quick glance at your upcoming and recent activities.
                            </p>
                        </div>

                        {/* FILTERS / VIEW ALL */}
                        <div className="flex items-center gap-3">
                            <div className="flex gap-2 text-xs font-semibold">
                                <button className="px-3 py-1 rounded-full bg-[#7b0000] text-white">
                                    All
                                </button>
                                <button className="px-3 py-1 rounded-full bg-blue-50 text-blue-600">
                                    Upcoming
                                </button>
                                <button className="px-3 py-1 rounded-full bg-green-50 text-green-700">
                                    Completed
                                </button>
                            </div>
                            <button className="text-xs font-semibold text-[#7b0000] hover:underline ml-2">
                                View All
                            </button>
                        </div>
                    </CardHeader>

                    <CardBody className="px-10 py-6">
                        {/* EVENT LIST */}
                        <div className="space-y-4">
                            {[
                                {
                                    title: "Computer Engineering Orientation",
                                    datetime: "Tomorrow • 9:00 AM",
                                    location: "ECE Lecture Hall",
                                    status: "upcoming",
                                    dot: "bg-blue-600",
                                    type: "Orientation",
                                },
                                {
                                    title: "C# Programming Tutorial",
                                    datetime: "Yesterday • 2:00 PM",
                                    location: "CBE 901",
                                    status: "completed",
                                    dot: "bg-green-600",
                                    type: "Tutorial",
                                },
                                {
                                    title: "Acquaintance Party",
                                    datetime: "Next Monday • 8:00 AM",
                                    location: "Engineering AVR",
                                    status: "upcoming",
                                    dot: "bg-yellow-500",
                                    type: "Student Activity",
                                },
                            ].map((event, index) => (
                                <Card key={index} shadow="sm" isPressable>
                                    <CardBody className="flex flex-row justify-between items-center">
                                        {/* LEFT SIDE: TITLE + DETAILS */}
                                        <div className="flex gap-4">
                                            <div className={`w-3 h-3 mt-2 rounded-full ${event.dot}`} />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-semibold text-lg">
                                                        {event.title}
                                                    </h3>
                                                    <span className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
                                                        {event.type}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    {event.datetime}
                                                </p>
                                                <p className="text-xs text-gray-400 mt-0.5">
                                                    {event.location}
                                                </p>
                                            </div>
                                        </div>

                                        {/* RIGHT: STATUS BADGE */}
                                        <CampusBadge status={event.status as "upcoming" | "completed"}>
                                            {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                                        </CampusBadge>
                                    </CardBody>
                                </Card>
                            ))}
                        </div>
                    </CardBody>
                </Card>
            </section>
        </div>
    );
}
