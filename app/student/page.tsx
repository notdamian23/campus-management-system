"use client";
import { FiBell, FiChevronRight } from "react-icons/fi";
import { Card, CardHeader, CardBody } from "@heroui/card";
import { CampusBadge } from "@/components/heroui";

export default function StudentDashboard() {
    return (
        <div className="p-8 space-y-8">

            {/* WELCOME HEADER */}
            <div>
                <h1 className="text-3xl font-bold text-[#7b0000]">Welcome back!</h1>
                <p className="text-campus-text-secondary text-sm">Here's what's happening today 🎓</p>
            </div>

            {/* TOP CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <Card shadow="sm" isPressable>
                    <CardBody>
                        <p className="text-campus-text-secondary text-sm">Upcoming Events</p>
                        <h2 className="text-3xl font-bold text-campus-red-700 mt-2">3</h2>
                    </CardBody>
                </Card>

                <Card shadow="sm" isPressable>
                    <CardBody>
                        <p className="text-campus-text-secondary text-sm">Completed Events</p>
                        <h2 className="text-3xl font-bold text-green-600 mt-2">12</h2>
                    </CardBody>
                </Card>

                <Card shadow="sm" isPressable>
                    <CardBody>
                        <p className="text-campus-text-secondary text-sm">Notifications</p>
                        <div className="flex items-center gap-2 mt-2">
                            <FiBell className="text-red-500" size={22} />
                            <h2 className="text-3xl font-bold text-red-600">5</h2>
                        </div>
                    </CardBody>
                </Card>

            </div>

            {/* EVENT OVERVIEW */}
            <Card shadow="sm">
                <CardHeader className="flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-campus-text-primary">Events Overview</h2>
                    <button className="text-sm text-campus-red-700 hover:underline flex items-center gap-1">
                        View All <FiChevronRight size={16} />
                    </button>
                </CardHeader>
                <CardBody>
                    {/* EVENT LIST */}
                    <div className="space-y-4">

                        {/* EVENT CARD */}
                        <div className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition">
                            <div>
                                <h3 className="font-semibold text-campus-text-primary flex items-center gap-2">
                                    <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                                    Computer Engineering Orientation
                                </h3>
                                <p className="text-sm text-campus-text-secondary">
                                    Tomorrow · 9:00 AM
                                </p>
                            </div>
                            <CampusBadge status="upcoming">Upcoming</CampusBadge>
                        </div>

                        <div className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition">
                            <div>
                                <h3 className="font-semibold text-campus-text-primary flex items-center gap-2">
                                    <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                                    C# Programming Tutorial
                                </h3>
                                <p className="text-sm text-campus-text-secondary">
                                    Yesterday · 2:00 PM
                                </p>
                            </div>
                            <CampusBadge status="completed">Completed</CampusBadge>
                        </div>

                        <div className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition">
                            <div>
                                <h3 className="font-semibold text-campus-text-primary flex items-center gap-2">
                                    <span className="w-3 h-3 bg-yellow-400 rounded-full"></span>
                                    Acquaintance Party
                                </h3>
                                <p className="text-sm text-campus-text-secondary">
                                    Next Monday · 8:00 AM
                                </p>
                            </div>
                            <CampusBadge status="upcoming">Upcoming</CampusBadge>
                        </div>

                    </div>
                </CardBody>
            </Card>

            {/* NOTIFICATIONS SECTION */}
            <Card shadow="sm">
                <CardHeader>
                    <h3 className="text-lg font-semibold text-campus-text-primary">Recent Notifications</h3>
                </CardHeader>
                <CardBody>
                    <div className="space-y-3">

                        <div className="p-3 border rounded-lg hover:bg-gray-50 transition flex justify-between">
                            <span className="text-campus-text-primary">New announcement posted for CPE Week.</span>
                            <span className="text-xs text-campus-text-secondary">5h ago</span>
                        </div>

                        <div className="p-3 border rounded-lg hover:bg-gray-50 transition flex justify-between">
                            <span className="text-campus-text-primary">You have 1 upcoming event tomorrow.</span>
                            <span className="text-xs text-campus-text-secondary">1d ago</span>
                        </div>
                    </div>
                </CardBody>
            </Card>

        </div>
    );
}
