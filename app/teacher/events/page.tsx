"use client";

import { useState } from "react";

export default function EventsPage() {
    const [openDetails, setOpenDetails] = useState(null);
    const [openParticipants, setOpenParticipants] = useState(null);

    return (
        <div className="w-full p-10 bg-gray-50 min-h-screen">

            {/* HEADER */}
            <div className="bg-white shadow-xl rounded-2xl p-8 mb-10 border border-gray-200">
                <h1 className="text-3xl font-extrabold text-[#7b0000]">
                    Campus Event Management System
                </h1>
                <p className="text-gray-600 mt-1">
                    Organize, manage, and track all campus events in one centralized dashboard.
                </p>
            </div>

            {/* STATS */}
            <div className="grid grid-cols-5 gap-4 mb-10">
                {[
                    ["1", "Total Events"],
                    ["1", "Upcoming"],
                    ["0", "Ongoing"],
                    ["0", "Completed"],
                    ["0", "Participants"],
                ].map(([value, label], idx) => (
                    <div
                        key={idx}
                        className="bg-white rounded-xl px-6 py-5 shadow-md border border-gray-100 flex flex-col text-center"
                    >
                        <span className="text-3xl font-bold text-gray-800">{value}</span>
                        <span className="text-sm text-gray-500 mt-1">{label}</span>
                    </div>
                ))}
            </div>

            {/* FILTERS */}
            <div className="flex items-center gap-3 mb-8">
                <input
                    placeholder="Search events by title, venue, or organizer..."
                    className="w-[350px] px-4 py-2 rounded-lg border border-gray-300 shadow-sm
                    text-gray-700 placeholder-gray-500 focus:ring focus:ring-yellow-200"
                />
                <select className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700">
                    <option>All Categories</option>
                </select>
                <select className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700">
                    <option>All Status</option>
                </select>
                <input
                    type="date"
                    className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700"
                />
            </div>

            {/* EVENT LIST PANEL */}
            <div className="bg-white shadow-xl rounded-2xl border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Event List</h2>

                {/* EVENT ITEM */}
                <div className="border rounded-xl p-4 shadow-sm bg-white relative">

                    {/* EVENT HEADER */}
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="font-bold text-lg text-gray-800">
                                Engineering Orientation
                            </h3>
                            <p className="text-sm text-gray-600">First year orientation</p>

                            <div className="flex items-center gap-6 mt-3 text-sm text-gray-700">

                                <div className="flex items-center gap-2">
                                    <span className="material-icons text-gray-500 text-base">calendar_today</span>
                                    1/22/2026
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="material-icons text-gray-500 text-base">schedule</span>
                                    07:00 - 12:00
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="material-icons text-gray-500 text-base">location_on</span>
                                    Maritime AVR
                                </div>

                            </div>

                            <p className="mt-3 text-sm text-gray-600">
                                Organized by: President Kian Lacubtan
                            </p>
                        </div>

                        {/* ACTIONS DROPDOWN */}
                        <div className="relative">
                            <button
                                onClick={() =>
                                    setOpenDetails(openDetails === 1 ? null : 1)
                                }
                                className="px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium shadow-sm flex items-center gap-2"
                            >
                                Actions
                                <span className="material-icons text-sm">expand_more</span>
                            </button>

                            {/* DROPDOWN */}
                            <div
                                className={`absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-xl shadow-lg z-50 ${
                                    openDetails === 1 ? "" : "hidden"
                                }`}
                            >
                                <button
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                                    onClick={() => setOpenDetails(2)}
                                >
                                    View Details
                                </button>

                                <button
                                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                                    onClick={() => setOpenParticipants(1)}
                                >
                                    View Participants
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* DETAILS EXPANDED */}
                {openDetails === 2 && (
                    <div className="bg-white rounded-2xl shadow-md border p-6 mt-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4">Event Details</h2>

                        <div className="grid grid-cols-2 gap-6">

                            <div className="border rounded-xl p-4 shadow-sm">
                                <h3 className="font-bold text-gray-800">Description</h3>
                                <p className="text-sm text-gray-600 mt-2">
                                    This orientation welcomes first-year Computer Engineering students,
                                    introduces program expectations, and outlines campus activities.
                                </p>
                            </div>

                            <div className="border rounded-xl p-4 shadow-sm">
                                <h3 className="font-bold text-gray-800">Organizer</h3>
                                <p className="text-sm text-gray-600 mt-2">
                                    President Kian Lacubtan
                                </p>
                            </div>

                        </div>
                    </div>
                )}

                {/* PARTICIPANTS EXPANDED */}
                {openParticipants === 1 && (
                    <>
                        <div className="bg-white rounded-2xl shadow-md border p-6 mt-6">

                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-xl font-bold text-gray-800">Participants</h2>

                                <div className="flex items-center gap-3">

                                    {/* Export Report Button */}
                                    <button className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-black rounded-lg text-sm font-semibold shadow-sm">
                                        Export Report
                                    </button>

                                    {/* Sort Button */}
                                    <button
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 text-sm font-medium shadow-sm flex items-center gap-2"
                                    >
                                        Sort
                                        <span className="material-icons text-sm">expand_more</span>
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-hidden rounded-xl border border-gray-200 shadow-sm bg-white">

                                <table className="w-full">
                                    <thead className="bg-gray-100 border-b">
                                    <tr>
                                        {[
                                            "Student ID",
                                            "Name",
                                            "Course",
                                            "Year Level",
                                            "Section",
                                            "Status",
                                        ].map((head, idx) => (
                                            <th key={idx} className="p-3 text-left text-gray-700 font-semibold text-sm">
                                                {head}
                                            </th>
                                        ))}
                                    </tr>
                                    </thead>

                                    <tbody className="divide-y divide-gray-100">

                                    {[
                                        { id: "2023001", name: "Pino, Marco S.", course: "Industrial Engineering", year: "2", section: "A", status: "Present" },
                                        { id: "2023002", name: "Curry, Steph P.", course: "Computer Engineering", year: "1", section: "A", status: "Present" },
                                        { id: "2023003", name: "Ramos, Dwight H.", course: "Electronics Engineering", year: "3", section: "B", status: "Absent" },
                                        { id: "2023004", name: "Lobetana, Kian F.", course: "Mechanical Engineering", year: "1", section: "B", status: "Absent" },
                                        { id: "2023005", name: "Bayaron, Rhodel D.", course: "Electrical Engineering", year: "4", section: "Non-Block", status: "Present" },
                                    ].map((p, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50 transition">

                                            <td className="p-3 text-gray-700">{p.id}</td>
                                            <td className="p-3 text-gray-700">{p.name}</td>

                                            <td className="p-3">
                                                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                                                    {p.course}
                                                </span>
                                            </td>

                                            <td className="p-3 text-gray-700">{p.year}</td>
                                            <td className="p-3 text-gray-700">{p.section}</td>

                                            <td className="p-3">
                                                <span className={`px-3 py-1 rounded-full text-sm ${
                                                    p.status === "Present"
                                                        ? "bg-green-100 text-green-700"
                                                        : "bg-red-100 text-red-600"
                                                }`}>
                                                    {p.status}
                                                </span>
                                            </td>

                                        </tr>
                                    ))}
                                    </tbody>
                                </table>

                            </div>
                        </div>

                        {/* ⭐ DOCUMENTATION SECTION ⭐ */}
                        <div className="bg-white rounded-2xl shadow-md border p-6 mt-8">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">Documentation</h2>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                                <div className="border rounded-xl shadow-sm overflow-hidden bg-gray-50">
                                    <img
                                        src="/documentation-one.jpg"
                                        className="w-full h-48 object-cover"
                                        alt="Documentation One"
                                    />

                                </div>

                                <div className="border rounded-xl shadow-sm overflow-hidden bg-gray-50">
                                    <img
                                        src="/documentation-two.jpg"
                                        className="w-full h-48 object-cover"
                                        alt="Documentation Two"
                                    />

                                </div>

                                <div className="border rounded-xl shadow-sm overflow-hidden bg-gray-50">
                                    <img
                                        src="/documentation-three.jpg"
                                        className="w-full h-48 object-cover"
                                        alt="Documentation Three"
                                    />

                                </div>

                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
