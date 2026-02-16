"use client";

export default function DocumentsPage() {
    return (
        <div className="w-full p-10 bg-gray-50 min-h-screen">

            {/* HEADER */}
            <div className="bg-white shadow-xl rounded-2xl p-8 mb-10 border border-gray-200">
                <h1 className="text-3xl font-extrabold text-gray-800">
                    Manage and Access Your Documents
                </h1>
                <p className="text-gray-600 mt-1">
                    Upload, organize, and share documents with your team. Keep all your resources in one secure location.
                </p>
            </div>

            {/* TOP STATS */}
            <div className="grid grid-cols-3 gap-4 mb-10">

                {/* Total Documents */}
                <div className="bg-white flex items-center gap-4 rounded-xl p-5 shadow-md border border-gray-100">
                    <div className="bg-blue-100 p-3 rounded-full">
                        <span className="material-icons text-blue-700">description</span>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">0</h3>
                        <p className="text-gray-500 text-sm">Total Documents</p>
                    </div>
                </div>

                {/* Recent Uploads */}
                <div className="bg-white flex items-center gap-4 rounded-xl p-5 shadow-md border border-gray-100">
                    <div className="bg-green-100 p-3 rounded-full">
                        <span className="material-icons text-green-700">file_upload</span>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">0</h3>
                        <p className="text-gray-500 text-sm">Recent Uploads</p>
                    </div>
                </div>

                {/* Storage Used */}
                <div className="bg-white flex items-center gap-4 rounded-xl p-5 shadow-md border border-gray-100">
                    <div className="bg-orange-100 p-3 rounded-full">
                        <span className="material-icons text-orange-700">storage</span>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800">0 MB</h3>
                        <p className="text-gray-500 text-sm">Storage Used</p>
                    </div>
                </div>
            </div>

            {/* FILTERS + UPLOAD BUTTON */}
            <div className="bg-white p-4 rounded-xl shadow-md border border-gray-100 flex items-center justify-between mb-10">

                <input
                    placeholder="Search documents..."
                    className="w-[350px] px-4 py-2 rounded-lg border border-gray-300 shadow-sm
                    text-gray-700 placeholder-gray-500"
                />

                <div className="flex items-center gap-3">

                    <select className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700">
                        <option>All Types</option>
                    </select>

                    <select className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700">
                        <option>All Categories</option>
                    </select>

                    <input
                        type="date"
                        className="px-4 py-2 rounded-lg border border-gray-300 shadow-sm text-gray-700"
                    />

                    <button className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-md text-sm font-medium flex items-center gap-2">
                        <span className="material-icons text-sm">upload</span>
                        Upload Document
                    </button>

                </div>
            </div>

            {/* DOCUMENTS MAIN GRID */}
            <div className="grid grid-cols-3 gap-6">

                {/* DOCUMENT LIBRARY */}
                <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5 col-span-2">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">Document Library</h2>

                    <div className="w-full h-[350px] bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center text-gray-400">
                        No documents uploaded yet.
                    </div>
                </div>

                {/* DOCUMENT DETAILS */}
                <div className="bg-white rounded-xl shadow-md border border-gray-200 p-5">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">Document Details</h2>

                    <div className="w-full h-[350px] flex flex-col items-center justify-center text-gray-400">
                        <span className="material-icons text-5xl mb-3">insert_drive_file</span>
                        Select a document to view details
                    </div>
                </div>

            </div>

            {/* STORAGE ANALYTICS */}
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-10">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Storage Analytics</h2>

                <div className="w-full bg-gray-200 h-3 rounded-full mb-2">
                    <div className="bg-blue-600 h-3 rounded-full" style={{ width: "0%" }}></div>
                </div>

                <div className="flex justify-between text-sm text-gray-500">
                    <span>0 MB of 1000 MB used</span>
                    <span>File Type Distribution</span>
                </div>
            </div>

        </div>
    );
}
