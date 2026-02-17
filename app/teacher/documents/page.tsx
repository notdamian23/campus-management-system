"use client";

import { Card, CardBody } from "@heroui/card";
import { CampusInput, CampusButton } from "@/components/heroui";
import { Select, SelectItem } from "@heroui/select";

export default function DocumentsPage() {
    return (
        <div className="w-full p-10 bg-gray-50 min-h-screen">

            {/* HEADER */}
            <Card shadow="lg" className="mb-10">
                <CardBody className="p-8">
                    <h1 className="text-3xl font-extrabold text-gray-800">
                        Manage and Access Your Documents
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Upload, organize, and share documents with your team. Keep all your resources in one secure location.
                    </p>
                </CardBody>
            </Card>

            {/* TOP STATS */}
            <div className="grid grid-cols-3 gap-4 mb-10">

                {/* Total Documents */}
                <Card shadow="sm">
                    <CardBody className="flex flex-row items-center gap-4 p-5">
                    <div className="bg-blue-100 p-3 rounded-full">
                        <span className="material-icons text-blue-700">description</span>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">0</h3>
                        <p className="text-gray-500 text-sm">Total Documents</p>
                    </div>
                    </CardBody>
                </Card>

                {/* Recent Uploads */}
                <Card shadow="sm">
                    <CardBody className="flex flex-row items-center gap-4 p-5">
                    <div className="bg-green-100 p-3 rounded-full">
                        <span className="material-icons text-green-700">file_upload</span>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">0</h3>
                        <p className="text-gray-500 text-sm">Recent Uploads</p>
                    </div>
                    </CardBody>
                </Card>

                {/* Storage Used */}
                <Card shadow="sm">
                    <CardBody className="flex flex-row items-center gap-4 p-5">
                    <div className="bg-orange-100 p-3 rounded-full">
                        <span className="material-icons text-orange-700">storage</span>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">0 MB</h3>
                        <p className="text-gray-500 text-sm">Storage Used</p>
                    </div>
                    </CardBody>
                </Card>
            </div>

            {/* FILTERS + UPLOAD BUTTON */}
            <Card shadow="sm" className="mb-10">
                <CardBody className="flex flex-row items-center justify-between p-4">
                    <CampusInput
                        placeholder="Search documents..."
                        className="w-[350px]"
                    />

                    <div className="flex items-center gap-3">
                        <Select size="sm" label="Type" className="w-[150px]">
                            <SelectItem key="all">All Types</SelectItem>
                        </Select>

                        <Select size="sm" label="Category" className="w-[150px]">
                            <SelectItem key="all">All Categories</SelectItem>
                        </Select>

                        <CampusInput type="date" className="w-[150px]" />

                        <CampusButton variant="secondary" className="flex items-center gap-2">
                            <span className="material-icons text-sm">upload</span>
                            Upload Document
                        </CampusButton>
                    </div>
                </CardBody>
            </Card>

            {/* DOCUMENTS MAIN GRID */}
            <div className="grid grid-cols-3 gap-6">

                {/* DOCUMENT LIBRARY */}
                <Card shadow="sm" className="col-span-2">
                    <CardBody className="p-5">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">Document Library</h2>

                    <div className="w-full h-[350px] bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center text-gray-400">
                        No documents uploaded yet.
                    </div>
                    </CardBody>
                </Card>

                {/* DOCUMENT DETAILS */}
                <Card shadow="sm">
                    <CardBody className="p-5">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">Document Details</h2>

                    <div className="w-full h-[350px] flex flex-col items-center justify-center text-gray-400">
                        <span className="material-icons text-5xl mb-3">insert_drive_file</span>
                        Select a document to view details
                    </div>
                    </CardBody>
                </Card>

            </div>

            {/* STORAGE ANALYTICS */}
            <Card shadow="sm" className="mt-10">
                <CardBody className="p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Storage Analytics</h2>

                <div className="w-full bg-gray-200 h-3 rounded-full mb-2">
                    <div className="bg-blue-600 h-3 rounded-full" style={{ width: "0%" }}></div>
                </div>

                <div className="flex justify-between text-sm text-gray-500">
                    <span>0 MB of 1000 MB used</span>
                    <span>File Type Distribution</span>
                </div>
                </CardBody>
            </Card>

        </div>
    );
}
