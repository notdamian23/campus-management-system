export default function StudentLayout({ children }) {
    return (
        <div className="min-h-screen flex bg-[#f2f2f2] text-gray-800">

            {/* SIDEBAR */}
            <aside className="w-64 bg-white shadow-xl border-r">
                <div className="w-full flex justify-center mt-6 mb-4">
                    <div className="flex flex-col items-center gap-3">
                        <img
                            src="/new campus-logo.jpg"
                            className="w-24 h-24 rounded-full object-cover shadow-md"
                        />
                        <h2 className="text-[#7b0000] font-black text-5xl">CAMPUS</h2>
                    </div>
                </div>

                <nav className="flex flex-col gap-2 px-4 mt-4">

                    <a href="/student" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100">
                        <span className="material-icons">dashboard</span>
                        Dashboard
                    </a>

                    <a href="/student/status" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100">
                        <span className="material-icons">check</span>
                        Status
                    </a>

                    <a href="/student/event" className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100">
                        <span className="material-icons">event</span>
                        Events
                    </a>

                    {/* 🔔 Notifications with red badge */}
                    <a
                        href="/student/notifications"
                        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-100 relative"
                    >
                        <span className="material-icons">notifications</span>
                        Notifications

                        {/* 🔴 RED BADGE */}
                        <span className="absolute right-4 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                            8
                        </span>
                    </a>

                </nav>
            </aside>

            {/* MAIN CONTENT (dynamic pages go here) */}
            <main className="flex-1 p-10">
                {children}
            </main>
        </div>
    );
}
