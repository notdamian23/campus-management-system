"use client";
import { useState } from "react";
import { FiCalendar } from "react-icons/fi";

export default function PaymentDashboard() {
    const [expandedPayment, setExpandedPayment] = useState(null);
    const [showAddPaymentForm, setShowAddPaymentForm] = useState(false);

    // UPDATED STUDENT DATA WITH COURSE FIELD
    const paymentData = [
        {
            id: 1,
            title: "Acquaintance Party",
            ref: "PMT-AQ-001",
            amount: "₱300",
            status: "",
            date: "12/04/2025",
            students: [
                {
                    id: "2023001",
                    name: "Pino, Marco S.",
                    year: 4,
                    section: "A",
                    course: "Computer Engineering",
                    status: "Paid"
                },
                {
                    id: "2023002",
                    name: "Curry, Steph P.",
                    year: 4,
                    section: "A",
                    course: "Computer Engineering",
                    status: "Paid"
                },
                {
                    id: "2023003",
                    name: "Ramos, Dwight H.",
                    year: 4,
                    section: "B",
                    course: "Mechanical Engineering",
                    status: "Unpaid"
                },
            ],
        },
        {
            id: 2,
            title: "Membership Fee",
            ref: "PMT-MF-002",
            amount: "₱150",
            status: "",
            date: "12/04/2025",
            students: [
                {
                    id: "2023002",
                    name: "Curry, Steph P.",
                    year: 4,
                    section: "A",
                    course: "Computer Engineering",
                    status: "Paid"
                },
            ],
        },
        {
            id: 3,
            title: "Engineering Merch",
            ref: "PMT-MERCH-003",
            amount: "₱450",
            status: "",
            date: "12/05/2025",
            students: [
                {
                    id: "2023003",
                    name: "Ramos, Dwight H.",
                    year: 4,
                    section: "B",
                    course: "Electrical Engineering",
                    status: "Paid"
                },
            ],
        }
    ];

    return (
        <div className="p-6 space-y-6">

            {/* HEADER */}
            <div className="bg-white p-6 shadow rounded-xl border">
                <h1 className="text-2xl font-bold text-[#7b0000]">
                    Campus Payment Management
                </h1>
                <p className="text-gray-600 text-sm mt-1">
                    Track, verify, and manage student payments.
                </p>
            </div>

            {/* SEARCH + ADD PAYMENT */}
            <div className="flex items-center justify-between gap-4">
                <input
                    type="text"
                    placeholder="Search payments by student, reference number..."
                    className="flex-1 px-4 py-3 border rounded-lg shadow-sm"
                />

                <div className="flex items-center gap-2 px-4 py-3 border rounded-lg shadow-sm bg-white">
                    <FiCalendar />
                    <input type="date" className="outline-none" />
                </div>

                {/* BUTTON TRIGGER */}
                <button
                    onClick={() => setShowAddPaymentForm(true)}
                    className="bg-blue-500 text-white px-4 py-3 rounded-lg shadow hover:bg-blue-600 transition"
                >
                    + Add Payment
                </button>
            </div>

            {/* ✅ ADD PAYMENT TILE INSERTED HERE */}
            {showAddPaymentForm && (
                <div className="bg-white p-6 border rounded-xl shadow space-y-4 animate-slideDown">

                    <div className="flex items-start justify-between">
                        <h2 className="text-xl font-semibold text-[#7b0000]">Add New Payment</h2>

                        <button
                            onClick={() => setShowAddPaymentForm(false)}
                            className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm"
                        >
                            Close
                        </button>
                    </div>

                    {/* Payment Title */}
                    <div>
                        <label className="text-sm font-medium">Payment Title</label>
                        <input
                            type="text"
                            className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
                            placeholder="e.g., Acquaintance Party"
                        />
                    </div>

                    {/* Amount */}
                    <div>
                        <label className="text-sm font-medium">Amount</label>
                        <input
                            type="number"
                            className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
                            placeholder="Enter amount"
                        />
                    </div>

                    {/* Date */}
                    <div>
                        <label className="text-sm font-medium">Date</label>
                        <input
                            type="date"
                            className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
                        />
                    </div>

                    {/* Year Level */}
                    <div>
                        <label className="text-sm font-medium">Year Level</label>
                        <select className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm">
                            <option value="">All Years</option>
                            <option value="1">1st Year</option>
                            <option value="2">2nd Year</option>
                            <option value="3">3rd Year</option>
                            <option value="4">4th Year</option>
                        </select>
                    </div>

                    {/* Course */}
                    <div>
                        <label className="text-sm font-medium">Course</label>
                        <select className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm">
                            <option value="">All Courses</option>
                            <option>Computer Engineering</option>
                            <option>Mechanical Engineering</option>
                            <option>Electrical Engineering</option>
                            <option>Electronics Engineering</option>
                            <option>Industrial Engineering</option>
                        </select>
                    </div>

                    {/* Details */}
                    <div>
                        <label className="text-sm font-medium">Details</label>
                        <textarea
                            className="w-full h-28 mt-1 px-4 py-3 border rounded-lg shadow-sm"
                            placeholder="Additional notes..."
                        ></textarea>
                    </div>

                    {/* Save Button */}
                    <button className="w-full px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                        Save Payment
                    </button>
                </div>
            )}

            {/* PAYMENT LIST */}
            <div className="bg-white border shadow rounded-lg p-6">
                <h3 className="text-lg font-semibold mb-4">Payment List</h3>

                {paymentData.map((p) => (
                    <div
                        key={p.id}
                        className="border rounded-lg p-4 shadow-sm hover:bg-gray-50 transition mb-4"
                    >
                        <div className="flex justify-between items-center">

                            {/* LEFT */}
                            <div>
                                <h4 className="font-semibold text-gray-800">{p.title}</h4>
                                <p className="text-sm text-gray-500">Reference: {p.ref}</p>

                                <div className="flex gap-4 items-center mt-2 text-sm text-gray-600">
                                    <span>📅 {p.date}</span>
                                    <span>💰 {p.amount}</span>
                                </div>
                            </div>

                            {/* RIGHT */}
                            <div className="flex flex-col items-end gap-2">
                                <span className="px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                                    {p.status}
                                </span>

                                <button
                                    onClick={() =>
                                        setExpandedPayment(expandedPayment === p.id ? null : p.id)
                                    }
                                    className="px-4 py-1 bg-gray-200 text-gray-800 text-xs rounded-lg hover:bg-gray-300 transition"
                                >
                                    Info ▼
                                </button>

                                <button className="px-4 py-1 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600 transition">
                                    Edit
                                </button>
                            </div>
                        </div>

                        {/* STUDENT DROPDOWN */}
                        {expandedPayment === p.id && (
                            <div className="mt-4 border-t pt-3">

                                {/* EXPORT BUTTON */}
                                <div className="flex justify-end mb-3">
                                    <button className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-black font-semibold rounded-lg shadow">
                                        Export Report
                                    </button>
                                </div>

                                {/* PAID / UNPAID SUMMARY */}
                                <div className="flex gap-4 mb-4">
                                    <span className="px-4 py-1 bg-green-100 text-green-700 rounded-full font-semibold text-sm">
                                        Paid: {p.students.filter(s => s.status === "Paid").length}
                                    </span>

                                    <span className="px-4 py-1 bg-red-100 text-red-700 rounded-full font-semibold text-sm">
                                        Unpaid: {p.students.filter(s => s.status === "Unpaid").length}
                                    </span>
                                </div>

                                <h4 className="font-semibold text-gray-700 mb-2">Students</h4>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-100 text-gray-600">
                                        <tr>
                                            <th className="p-2 text-left">Student ID</th>
                                            <th className="p-2 text-left">Name</th>
                                            <th className="p-2 text-left">Course</th>
                                            <th className="p-2 text-left">Year Level</th>
                                            <th className="p-2 text-left">Section</th>
                                            <th className="p-2 text-left">Status</th>
                                            <th className="p-2 text-left">Action</th>
                                            <th className="p-2 text-right">
                                                <button className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-xs rounded">
                                                    Sort
                                                </button>
                                            </th>
                                        </tr>
                                        </thead>

                                        <tbody>
                                        {p.students.map((s, index) => (
                                            <tr key={index} className="border-b hover:bg-gray-50">
                                                <td className="p-2">{s.id}</td>
                                                <td className="p-2">{s.name}</td>
                                                <td className="p-2">{s.course}</td>
                                                <td className="p-2">{s.year}</td>
                                                <td className="p-2">{s.section}</td>

                                                <td className="p-2">
                                                    <span className={`
                                                        px-2 py-1 rounded-lg text-xs
                                                        ${s.status === "Paid"
                                                        ? "bg-green-100 text-green-700"
                                                        : "bg-red-100 text-red-700"}
                                                    `}>
                                                        {s.status}
                                                    </span>
                                                </td>

                                                <td className="p-2">
                                                    <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs">
                                                        Edit
                                                    </button>
                                                </td>

                                                <td className="p-2 text-right"></td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                </div>

                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
