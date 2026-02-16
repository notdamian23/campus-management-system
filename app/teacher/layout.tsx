import { ReactNode } from "react";

export default function TeacherLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-screen flex bg-[#f2f2f2] text-gray-800">

            {/* SIDEBAR */}
            <aside className="w-64 bg-white shadow-xl border-r">
                <div className="w-full flex justify-center mt-6 mb-4">
                    <div className="flex flex-col items-center justify-center gap-3">
                        <img
                            src="/new campus-logo.jpg"
                            alt="Campus Logo"
                            className="w-24 h-24 rounded-full object-cover shadow-md"
                        />

                        <h2 className="leading-none">
                            <span className="text-[#7b0000] font-black text-5xl tracking-wide drop-shadow-sm">
                                CAMPUS
                            </span>
                        </h2>
                    </div>
                </div>

                <nav className="flex flex-col gap-2 px-4 mt-4">
                    <a
                        href="/teacher"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 text-gray-700"
                    >
                        <span className="material-icons">dashboard</span>
                        Dashboard
                    </a>

                    <a
                        href="/teacher/students"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 text-gray-700"
                    >
                        <span className="material-icons">group</span>
                        Students
                    </a>

                    <a
                        href="/teacher/events"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 text-gray-700"
                    >
                        <span className="material-icons">event</span>
                        Events
                    </a>
                </nav>
            </aside>

            {/* MAIN CONTENT SLOT */}
            <main className="flex-1 p-10">
                {children}
            </main>
        </div>
    );
}
