"use client";
import { useState } from "react";

export default function StudentEvents() {
    const events = [
        {
            date: "Thursday, October 23",
            items: [
                {
                    event: "A.I Lab Orientation",
                    description: "All CPE students are required.",
                    status: "Missed",
                    time: "10:00 AM",
                    details: {
                        location: "Computer Lab 1",
                        requirement: "Bring student ID.",
                        note: "Attendance will be checked."
                    }
                }
            ]
        },

        {
            date: "Friday, October 24",
            items: [
                {
                    event: "Submission of Acquaintance Payment",
                    description: "Submit your payment form before the deadline.",
                    status: "Payment Due",
                    time: "11:59 PM",
                    details: {
                        location: "Dean's Office",
                        requirement: "Submit payment slip.",
                        note: "Late submissions will not be accepted."
                    }
                }
            ]
        },

        {
            date: "Monday, October 27",
            items: [
                {
                    event: "Engineering Orientation",
                    description: "All engineering students are required.",
                    status: "Upcoming",
                    time: "8:00 AM",
                    details: {
                        location: "Engineering AVR",
                        requirement: "Wear proper uniform.",
                        note: "Sit with your department."
                    }
                }
            ]
        },

        {
            date: "Wednesday, October 29",
            items: [
                {
                    event: "Basketball Tryout",
                    description: "Limited slots. Register now!",
                    status: "Pre-registration",
                    time: "1:31 PM",
                    details: {
                        location: "UC Gymnasium",
                        requirement: "Proper sports attire.",
                        note: "Slots are limited. Early arrival recommended."
                    }
                }
            ]
        },

        {
            date: "Thursday, October 30",
            items: [
                {
                    event: "Data Structures Study Group",
                    description: "Linked Lists and Hash Tables discussion.",
                    status: "Attended",
                    time: "7:00 AM",
                    details: {
                        location: "CPE Lab 2",
                        requirement: "Laptop required.",
                        note: "Snacks provided."
                    }
                }
            ]
        }
    ];

    const statusColor = {
        "Upcoming": "bg-blue-100 text-blue-700",
        "Payment Due": "bg-yellow-100 text-yellow-700",
        "Pre-registration": "bg-gray-100 text-gray-700",
        "Attended": "bg-green-100 text-green-700",
        "Missed": "bg-red-100 text-red-700",
    };

    return (
        <div className="min-h-screen p-10 bg-[#fafafa] text-gray-900">

            <h1 className="text-3xl font-bold mb-8 text-[#7b0000]">
                Events
            </h1>

            <div className="space-y-12">
                {events.map((group, i) => (
                    <div key={i}>
                        {/* DATE LABEL */}
                        <h2 className="text-lg font-semibold text-gray-700 mb-4">
                            {group.date}
                        </h2>

                        {/* EVENT CARDS */}
                        <div className="space-y-4">
                            {group.items.map((item, j) => {
                                const [open, setOpen] = useState(false);

                                return (
                                    <div
                                        key={j}
                                        className="bg-white border rounded-2xl shadow-sm hover:shadow-md transition p-5"
                                    >
                                        {/* TOP SECTION */}
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h3 className="text-lg font-semibold">{item.event}</h3>
                                                <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                                                <p className="text-xs text-gray-500 mt-2">
                                                    {group.date} • {item.time}
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                {/* STATUS CHIP */}
                                                <span
                                                    className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor[item.status]}`}
                                                >
                                                    {item.status}
                                                </span>

                                                {/* DROPDOWN BUTTON */}
                                                <button
                                                    className="p-1 rounded-full hover:bg-gray-200 transition"
                                                    onClick={() => setOpen(!open)}
                                                >
                                                    <span className="material-icons text-gray-600 text-lg">
                                                        {open ? "expand_less" : "expand_more"}
                                                    </span>
                                                </button>
                                            </div>
                                        </div>

                                        {/* DROPDOWN DETAILS */}
                                        {open && (
                                            <div className="mt-4 p-4 bg-gray-50 rounded-xl border text-sm space-y-1 animate-fadeIn">
                                                <p><span className="font-medium">Location:</span> {item.details.location}</p>
                                                <p><span className="font-medium">Requirement:</span> {item.details.requirement}</p>
                                                <p><span className="font-medium">Note:</span> {item.details.note}</p>

                                                {/* Register button only for pre-registration */}
                                                {item.status === "Pre-registration" && (
                                                    <button className="mt-3 bg-yellow-400 hover:bg-yellow-500 text-black font-semibold px-4 py-2 rounded-lg">
                                                        Register
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
