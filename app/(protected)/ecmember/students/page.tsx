"use client";
import React, { useState } from "react";
import { FiChevronDown, FiChevronUp, FiPlus } from "react-icons/fi";
import { Card, CardBody } from "@heroui/card";
import { CampusInput, CampusBadge } from "@/components/heroui";
import { Select, SelectItem } from "@heroui/select";

interface Student {
    id: string;
    name: string;
    course: string;
    year: string;
    status: string;
}

export default function ECStudentLookup() {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [query, setQuery] = useState<string>("");
    const [course, setCourse] = useState<string>("");
    const [year, setYear] = useState<string>("");

    const students: Student[] = [
        {
            id: "23200455",
            name: "Rhodiel B. Badiongo",
            course: "Computer Engineering",
            year: "2",
            status: "Active",
        },
    ];

    const toggleExpand = (id: string) => {
        setExpandedId(expandedId === id ? null : id);
    };

    const filtered = students.filter((s) => {
        const matchQuery =
            s.name.toLowerCase().includes(query.toLowerCase()) ||
            s.id.includes(query);

        const matchCourse = course ? s.course === course : true;
        const matchYear = year ? s.year === year : true;

        return matchQuery && matchCourse && matchYear;
    });

    return (
        <div className="p-6 space-y-6">

            {/* HEADER */}
            <Card shadow="sm">
                <CardBody className="flex flex-row justify-between items-center px-6 py-4">
                    <h1 className="text-xl font-bold text-[#7b0000]">
                        Engineering Student Management System
                    </h1>
                </CardBody>
            </Card>

            {/* TOP SUMMARY CARDS */}
            <div className="grid grid-cols-6 gap-4">
                {[
                    { label: "Total Students", count: 1 },
                    { label: "Mechanical", count: 0 },
                    { label: "Electrical", count: 0 },
                    { label: "Electronics", count: 0 },
                    { label: "Computer", count: 1 },
                    { label: "Industrial", count: 0 },
                ].map((item, i) => (
                    <div
                        key={i}
                        className="bg-white rounded-lg shadow p-4 text-center border"
                    >
                        <div className="text-2xl font-bold">{item.count}</div>
                        <p className="text-sm text-gray-500">{item.label}</p>
                    </div>
                ))}
            </div>

            {/* SEARCH + FILTERS */}
            <div className="flex gap-4 items-center">

                {/* Search Bar */}
                <input
                    type="text"
                    placeholder="Search student name or student ID..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1 px-4 py-3 border rounded-lg shadow-sm"
                />

                {/* Course Filter */}
                <select
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    className="px-4 py-3 border rounded-lg shadow-sm"
                >
                    <option value="">All Courses</option>
                    <option value="Computer Engineering">Computer Engineering</option>
                    <option value="Mechanical Engineering">Mechanical Engineering</option>
                    <option value="Electrical Engineering">Electrical Engineering</option>
                    <option value="Electronics Engineering">Electronics Engineering</option>
                    <option value="Industrial Engineering">Industrial Engineering</option>
                </select>

                {/* Year Filter */}
                <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="px-4 py-3 border rounded-lg shadow-sm"
                >
                    <option value="">All Years</option>
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                </select>

                {/* ⭐ MOVED ADD STUDENT BUTTON HERE ⭐ */}
                <button className="flex items-center gap-2 bg-[#7b0000] text-white px-4 py-2 rounded-lg shadow hover:bg-red-800 transition">
                    <FiPlus />
                    Add Student
                </button>
            </div>


            {/* STUDENT TABLE */}
            <div className="bg-white rounded-lg shadow border">
                <table className="w-full text-left">
                    <thead>
                    <tr className="border-b bg-gray-50 text-sm text-gray-600">
                        <th className="p-3">Student ID</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Course</th>
                        <th className="p-3">Year Level</th>
                        <th className="p-3">Status</th>
                        <th className="p-3"></th>
                    </tr>
                    </thead>

                    <tbody>
                    {filtered.map((student) => (
                        <React.Fragment key={student.id}>
                            <tr className="border-b hover:bg-gray-50">
                                <td className="p-3">{student.id}</td>
                                <td className="p-3">{student.name}</td>
                                <td className="p-3">
                                        <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-600">
                                            {student.course}
                                        </span>
                                </td>
                                <td className="p-3">{student.year} </td>
                                <td className="p-3">
                                        <span className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded-full">
                                            {student.status}
                                        </span>
                                </td>
                                <td className="p-3 text-right">
                                    <button onClick={() => toggleExpand(student.id)}>
                                        {expandedId === student.id ? (
                                            <FiChevronUp size={20} />
                                        ) : (
                                            <FiChevronDown size={20} />
                                        )}
                                    </button>
                                </td>
                            </tr>

                            {expandedId === student.id && (
                                <tr>
                                    <td colSpan={7} className="bg-gray-50 p-6">
                                        <div className="space-y-6">

                                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                                    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-[#7b0000] text-white font-bold">
                                                        SR
                                                    </span>
                                                Student Record Overview
                                            </h3>

                                            {/* EVENTS ATTENDED */}
                                            <div>
                                                <h4 className="font-semibold text-sm mb-2">
                                                    ✔ EVENTS ATTENDED
                                                </h4>

                                                <div className="grid grid-cols-2 gap-4">

                                                    <div className="bg-white border rounded-lg p-3 relative">
                                                        <button className="absolute right-3 top-3 text-blue-600 text-sm hover:underline">
                                                            Edit
                                                        </button>
                                                        <p className="font-medium">Graduation Orientation</p>
                                                        <p className="text-sm text-gray-500">
                                                            March 15, 2024 | 9:00 AM – 5:00 PM <br /> Fab Lab
                                                        </p>
                                                    </div>

                                                    <div className="bg-white border rounded-lg p-3 relative">
                                                        <button className="absolute right-3 top-3 text-blue-600 text-sm hover:underline">
                                                            Edit
                                                        </button>
                                                        <p className="font-medium">Programming Tutorial</p>
                                                        <p className="text-sm text-gray-500">
                                                            Feb 28, 2024 | 1:00 PM – 6:00 PM <br /> CBE 901
                                                        </p>
                                                    </div>

                                                </div>
                                            </div>

                                            {/* EVENTS MISSED */}
                                            <div>
                                                <h4 className="font-semibold text-sm mb-2">
                                                    ❌ EVENTS MISSED
                                                </h4>

                                                <div className="bg-red-50 border border-red-200 rounded-lg p-3 relative">
                                                    <button className="absolute right-3 top-3 text-blue-600 text-sm hover:underline">
                                                        Edit
                                                    </button>
                                                    <p className="font-medium text-red-600">General Assembly</p>
                                                    <p className="text-sm text-red-500">
                                                        Jan 15, 2024 | 10:00 AM – 12:00 PM <br /> Maritime AVR
                                                    </p>
                                                </div>
                                            </div>

                                            {/* OTHER REQUIREMENTS */}
                                            <div className="space-y-3">

                                                <div className="flex justify-between items-center bg-green-50 border border-green-200 rounded-lg p-3">
                                                    <span>Acquaintance Fee</span>
                                                    <div className="flex items-center gap-3">
                                                            <span className="px-3 py-1 rounded-full bg-green-500 text-white text-xs">
                                                                PAID
                                                            </span>
                                                        <button className="text-blue-600 text-sm hover:underline">
                                                            Edit
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="flex justify-between items-center bg-green-50 border border-green-200 rounded-lg p-3">
                                                    <span>Membership Fee</span>
                                                    <div className="flex items-center gap-3">
                                                            <span className="px-3 py-1 rounded-full bg-green-500 text-white text-xs">
                                                                PAID
                                                            </span>
                                                        <button className="text-blue-600 text-sm hover:underline">
                                                            Edit
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="flex justify-between items-center bg-red-50 border border-red-200 rounded-lg p-3">
                                                    <span>Engineering Merch</span>
                                                    <div className="flex items-center gap-3">
                                                            <span className="px-3 py-1 rounded-full bg-red-500 text-white text-xs">
                                                                UNPAID
                                                            </span>
                                                        <button className="text-blue-600 text-sm hover:underline">
                                                            Edit
                                                        </button>
                                                    </div>
                                                </div>

                                            </div>

                                        </div>
                                    </td>
                                </tr>
                            )}

                        </React.Fragment>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
