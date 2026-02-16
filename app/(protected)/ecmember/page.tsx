"use client";

export default function ECMemberDashboard() {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold text-[#7b0000] mb-6">
                EC Member Dashboard
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-xl p-6 shadow border">
                    <p className="text-gray-500 text-sm">Total Students</p>
                    <h2 className="text-3xl font-bold text-blue-600 mt-2">0</h2>
                </div>

                <div className="bg-white rounded-xl p-6 shadow border">
                    <p className="text-gray-500 text-sm">Upcoming Events</p>
                    <h2 className="text-3xl font-bold text-green-600 mt-2">0</h2>
                </div>

                <div className="bg-white rounded-xl p-6 shadow border">
                    <p className="text-gray-500 text-sm">Pending Payments</p>
                    <h2 className="text-3xl font-bold text-orange-600 mt-2">0</h2>
                </div>
            </div>
        </div>
    );
}
