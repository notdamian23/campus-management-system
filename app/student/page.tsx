"use client";
import { FiBell, FiCalendar, FiChevronRight } from "react-icons/fi";

export default function StudentDashboard() {
    return (
        <div className="p-8 space-y-8">

            {/* WELCOME HEADER */}
            <div>
                <h1 className="text-3xl font-bold text-[#7b0000]">Welcome back!</h1>
                <p className="text-gray-600 text-sm">Here's what's happening today 🎓</p>
            </div>

            {/* TOP CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <div className="bg-white border rounded-xl p-6 shadow hover:shadow-md transition">
                    <p className="text-gray-500 text-sm">Upcoming Events</p>
                    <h2 className="text-3xl font-bold text-blue-600 mt-2">3</h2>
                </div>

                <div className="bg-white border rounded-xl p-6 shadow hover:shadow-md transition">
                    <p className="text-gray-500 text-sm">Completed Events</p>
                    <h2 className="text-3xl font-bold text-green-600 mt-2">12</h2>
                </div>

                <div className="bg-white border rounded-xl p-6 shadow hover:shadow-md transition">
                    <p className="text-gray-500 text-sm">Notifications</p>
                    <div className="flex items-center gap-2 mt-2">
                        <FiBell className="text-red-500" size={22} />
                        <h2 className="text-3xl font-bold text-red-600">5</h2>
                    </div>
                </div>

            </div>

            {/* EVENT OVERVIEW */}
            <div className="bg-white border rounded-xl shadow p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-800">Events Overview</h2>
                    <button className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        View All <FiChevronRight size={16} />
                    </button>
                </div>

                {/* EVENT LIST */}
                <div className="space-y-4">

                    {/* EVENT CARD */}
                    <div className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition">
                        <div>
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                                Computer Engineering Orientation
                            </h3>
                            <p className="text-sm text-gray-500">
                                Tomorrow · 9:00 AM
                            </p>
                        </div>
                        <span className="px-3 py-1 text-xs bg-blue-100 text-blue-600 rounded-full shadow-sm">
                            Upcoming
                        </span>
                    </div>

                    <div className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition">
                        <div>
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                                C# Programming Tutorial
                            </h3>
                            <p className="text-sm text-gray-500">
                                Yesterday · 2:00 PM
                            </p>
                        </div>
                        <span className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-full shadow-sm">
                            Completed
                        </span>
                    </div>

                    <div className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition">
                        <div>
                            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                <span className="w-3 h-3 bg-yellow-400 rounded-full"></span>
                                Acquaintance Party
                            </h3>
                            <p className="text-sm text-gray-500">
                                Next Monday · 8:00 AM
                            </p>
                        </div>
                        <span className="px-3 py-1 text-xs bg-yellow-100 text-yellow-600 rounded-full shadow-sm">
                            Upcoming
                        </span>
                    </div>

                </div>
            </div>

            {/* NOTIFICATIONS SECTION */}
            <div className="bg-white border rounded-xl shadow p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">Recent Notifications</h3>

                <div className="space-y-3">


                    <div className="p-3 border rounded-lg hover:bg-gray-50 transition flex justify-between">
                        <span className="text-gray-700">New announcement posted for CPE Week.</span>
                        <span className="text-xs text-gray-500">5h ago</span>
                    </div>

                    <div className="p-3 border rounded-lg hover:bg-gray-50 transition flex justify-between">
                        <span className="text-gray-700">You have 1 upcoming event tomorrow.</span>
                        <span className="text-xs text-gray-500">1d ago</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
