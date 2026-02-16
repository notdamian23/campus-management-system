"use client";

import { useState } from "react";

export default function StudentsPage() {
    const [showDetails, setShowDetails] = useState(false);

    return (
        <div className="w-full p-10 bg-gray-50 min-h-screen">

            {/* HEADER CARD */}
            <div className="bg-white shadow-xl rounded-2xl p-8 mb-10 border border-gray-200">
                <h1 className="text-4xl font-extrabold text-[#7b0000]">
                    Engineering Student Management System
                </h1>
            </div>

            {/* STATS */}
            <div className="grid grid-cols-6 gap-4 mb-10">
                {[
                    ["1", "Total Students"],
                    ["0", "Mechanical"],
                    ["0", "Electrical"],
                    ["0", "Electronics"],
                    ["1", "Computer"],
                    ["0", "Industrial"],
                ].map(([value, label], idx) => (
                    <div
                        key={idx}
                        className="bg-white rounded-xl px-6 py-5 shadow-md border border-gray-100 flex flex-col text-center"
                    >
                        <span className="text-4xl font-bold text-gray-800">{value}</span>
                        <span className="text-sm text-gray-500 mt-1">{label}</span>
                    </div>
                ))}
            </div>

            {/* FILTERS */}
            <div className="flex items-center gap-3 mb-8">
                <input
                    placeholder="Search student name..."
                    className="w-[300px] px-4 py-2 rounded-lg border border-gray-300 shadow-sm
                    text-gray-700 placeholder-gray-500 focus:ring focus:ring-yellow-200"
                />

                <select className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700">
                    <option>All Courses</option>
                </select>

                <select className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700">
                    <option>All Years</option>
                </select>
            </div>

            {/* STUDENT TABLE */}
            <div className="bg-white shadow-xl rounded-2xl overflow-visible border border-gray-200">

                <table className="w-full">
                    <thead className="bg-gray-100 border-b">
                    <tr>
                        {[
                            "Student ID",
                            "Name",
                            "Course",
                            "Year Level",
                            "Status",

                        ].map((th, idx) => (
                            <th
                                key={idx}
                                className="p-4 text-left text-gray-700 font-semibold text-sm"
                            >
                                {th}
                            </th>
                        ))}
                    </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-100">

                    {/* STUDENT ROW */}
                    <tr className="hover:bg-gray-50 transition">

                        <td className="p-4 text-gray-700">23209455</td>
                        <td className="p-4 text-gray-700">Rhodel B. Badiango</td>

                        <td className="p-4 align-middle">
                                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                                    Computer Engineering
                                </span>
                        </td>

                        <td className="p-4 text-gray-700">2nd Year</td>


                        <td className="p-4">
                                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                                    Active
                                </span>
                        </td>

                        {/* ACTIONS */}
                        <td className="p-4 align-middle">
                            <div className="relative flex justify-end items-center">

                                <button
                                    onClick={() => setShowDetails(!showDetails)}
                                    className="px-4 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium shadow-sm flex items-center gap-2"
                                >

                                    <span className="material-icons text-sm">expand_more</span>
                                </button>

                            </div>
                        </td>
                    </tr>

                    {/* EXPANDED STUDENT RECORD OVERVIEW */}
                    {showDetails && (
                        <tr className="bg-transparent">
                            <td colSpan={7} className="p-0">
                                <div className="px-6 pt-3 pb-10 bg-gray-50 border-t">

                                    <div className="bg-white rounded-2xl shadow-md border p-6">

                                        {/* HEADER */}
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-10 h-10 bg-[#7b0000] rounded-full flex items-center justify-center text-white font-bold">
                                                SR
                                            </div>
                                            <h2 className="text-xl font-bold text-gray-800">
                                                Student Record Overview
                                            </h2>
                                        </div>

                                        {/* EVENTS ATTENDED */}
                                        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                            <span className="material-icons text-base">check_circle</span>
                                            EVENTS ATTENDED
                                        </h3>

                                        <div className="grid grid-cols-2 gap-4 mb-6">
                                            <div className="border rounded-xl p-4 shadow-sm">
                                                <h4 className="font-bold text-gray-800 mb-1">
                                                    Graduation Orientation
                                                </h4>
                                                <div className="text-sm text-gray-600">
                                                    March 15, 2024 | 9:00 AM – 5:00 PM <br />
                                                    Fab Lab <br />
                                                </div>
                                            </div>

                                            <div className="border rounded-xl p-4 shadow-sm">
                                                <h4 className="font-bold text-gray-800 mb-1">
                                                    Programming Tutorial
                                                </h4>
                                                <div className="text-sm text-gray-600">
                                                    Feb 28, 2024 | 1:00 PM – 6:00 PM <br />
                                                    CBE 901<br />
                                                </div>
                                            </div>
                                        </div>

                                        {/* EVENTS MISSED */}
                                        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                            <span className="material-icons text-base">cancel</span>
                                            EVENTS MISSED
                                        </h3>

                                        <div className="border rounded-xl p-4 shadow-sm bg-red-50 mb-6">
                                            <h4 className="font-bold text-gray-800 mb-1">
                                                General Assembly
                                            </h4>
                                            <div className="text-sm text-gray-600">
                                                Jan 15, 2024 | 8:00 AM – 12:00 PM <br />
                                                Maritime AVR <br />
                                            </div>
                                        </div>

                                        {/* PAYMENT STATUS */}
                                        <div className="flex justify-between items-center bg-green-50 border border-green-200 rounded-xl p-4">
                                                <span className="font-semibold text-gray-700">
                                                    Acquaintance Fee
                                                </span>

                                            <span className="px-4 py-1 bg-green-500 text-white rounded-full text-sm">
                                                    PAID
                                                </span>
                                        </div>

                                        <div className="flex justify-between items-center bg-red-50 border border-red-200 rounded-xl p-4">
                                                <span className="font-semibold text-gray-700">
                                                    Engineering Merch
                                                </span>

                                            <span className="px-4 py-1 bg-red-800 text-white rounded-full text-sm">
                                                    UNPAID
                                                </span>
                                        </div>

                                    </div>

                                </div>
                            </td>
                        </tr>
                    )}

                    </tbody>
                </table>
            </div>
        </div>
    );
}
