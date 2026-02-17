"use client";

import { Card, CardBody } from "@heroui/card";

export default function DocumentsPage() {
    return (
        <div className="p-6 space-y-6">

            {/* HEADER */}
            <div className="bg-white p-6 rounded-xl shadow border">
                <h1 className="text-2xl font-bold text-primary-900">Manage and Access Documents</h1>
                <p className="text-campus-text-secondary text-sm mt-1">
                    Upload, organize, and review documents. Everything stored securely in one place.
                </p>
            </div>

            {/* STATS ROW */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <div className="bg-white border shadow rounded-xl p-5">
                    <p className="text-campus-text-secondary text-sm">Total Documents</p>
                    <h2 className="text-3xl font-bold text-blue-600 mt-2">0</h2>
                </div>

                <div className="bg-white border shadow rounded-xl p-5">
                    <p className="text-campus-text-secondary text-sm">Recent Uploads</p>
                    <h2 className="text-3xl font-bold text-green-600 mt-2">0</h2>
                </div>

                <div className="bg-white border shadow rounded-xl p-5">
                    <p className="text-campus-text-secondary text-sm">Storage Used</p>
                    <h2 className="text-3xl font-bold text-orange-600 mt-2">0 MB</h2>
                </div>
            </div>

            {/* SEARCH + FILTER + UPLOAD */}
            <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-4 border shadow rounded-xl">

                <input
                    type="text"
                    placeholder="Search documents..."
                    className="flex-1 px-4 py-2 border rounded-lg shadow-sm"
                />

                <select className="px-3 py-2 border rounded-lg shadow-sm">
                    <option>All Types</option>
                    <option>PDF</option>
                    <option>Images</option>
                    <option>Word Files</option>
                    <option>Spreadsheets</option>
                </select>

                <select className="px-3 py-2 border rounded-lg shadow-sm">
                    <option>All Categories</option>
                    <option>Events</option>
                    <option>Payments</option>
                    <option>Clearance</option>
                </select>

                <input
                    type="date"
                    className="px-3 py-2 border rounded-lg shadow-sm"
                />

                <button className="px-4 py-2 bg-primary-600 text-white rounded-lg shadow hover:bg-primary-700 transition">
                    Upload Document
                </button>
            </div>

            {/* DOCUMENT LIBRARY + DETAILS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* DOCUMENT LIST */}
                <div className="bg-white border shadow rounded-xl p-6">
                    <h2 className="font-semibold text-gray-700 mb-3">Document Library</h2>

                    <div className="border border-dashed rounded-lg h-72 flex items-center justify-center text-campus-text-secondary">
                        No documents uploaded yet.
                    </div>
                </div>

                {/* DOCUMENT DETAILS */}
                <div className="bg-white border shadow rounded-xl p-6">
                    <h2 className="font-semibold text-gray-700 mb-3">Document Details</h2>

                    <div className="border border-dashed rounded-lg h-72 flex flex-col items-center justify-center text-campus-text-secondary">
                        <span className="text-4xl">📄</span>
                        <p>Select a document to view details</p>
                    </div>
                </div>
            </div>

            {/* STORAGE ANALYTICS */}
            <div className="bg-white border shadow rounded-xl p-6">
                <h2 className="font-semibold text-gray-700 mb-3">Storage Analytics</h2>

                <div className="w-full bg-gray-200 rounded-full h-3">
                    <div className="bg-blue-600 h-3 rounded-full" style={{ width: "0%" }}></div>
                </div>

                <p className="text-campus-text-secondary text-sm mt-2">0 MB of 1000 MB used</p>
            </div>
        </div>
    );
}
