"use client";

import { Card, CardBody } from "@heroui/card";

export default function ECMemberDashboard() {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-bold text-primary-900 mb-6">
                EC Member Dashboard
            </h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card shadow="sm">
                    <CardBody>
                        <p className="text-campus-text-secondary text-sm">Total Students</p>
                        <h2 className="text-3xl font-bold text-blue-600 mt-2">0</h2>
                    </CardBody>
                </Card>

                <Card shadow="sm">
                    <CardBody>
                        <p className="text-campus-text-secondary text-sm">Upcoming Events</p>
                        <h2 className="text-3xl font-bold text-green-600 mt-2">0</h2>
                    </CardBody>
                </Card>

                <Card shadow="sm">
                    <CardBody>
                        <p className="text-campus-text-secondary text-sm">Pending Payments</p>
                        <h2 className="text-3xl font-bold text-orange-600 mt-2">0</h2>
                    </CardBody>
                </Card>
            </div>
        </div>
    );
}
