"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiPlus, FiCalendar } from "react-icons/fi";

import { db, auth } from "@/lib/firebase";
import {
    addDoc,
    collection,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    doc,
    getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

type Role = "teacher" | "student" | "ec";
type EventStatus = "upcoming" | "ongoing" | "completed";

type EventDoc = {
    id: string;
    title: string;
    location?: string;
    date: string;
    timeStart?: string;
    timeEnd?: string;
    yearLevel?: string;
    course?: string;
    details?: string;
    isPreReg?: boolean;
    withPayment?: boolean;


    preRegSlots?: number | null;
    preRegCount?: number;

    status?: EventStatus; // (stored value not required; we compute live status)
    createdBy?: string | null;
    createdAt?: any;
};



function pad2(n: number) {
    return String(n).padStart(2, "0");
}

function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
}

function clampWrap(val: number, min: number, max: number) {
    if (val < min) return max;
    if (val > max) return min;
    return val;
}

function parseTime12ToMinutes(t?: string) {
    if (!t) return null;
    const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;

    let hour = Number(m[1]);
    const min = Number(m[2]);
    const ap = m[3].toUpperCase();

    if (hour === 12) hour = 0;
    if (ap === "PM") hour += 12;

    return hour * 60 + min;
}

function computeStatus(ev: { date: string; timeStart?: string; timeEnd?: string }): EventStatus {
    const startM = parseTime12ToMinutes(ev.timeStart);
    const endM = parseTime12ToMinutes(ev.timeEnd);
    if (startM == null || endM == null) return "upcoming";

    const now = new Date();
    const [y, mo, d] = ev.date.split("-").map(Number);
    if (!y || !mo || !d) return "upcoming";

    const eventDate = new Date(y, mo - 1, d);

    const start = new Date(eventDate);
    start.setHours(Math.floor(startM / 60), startM % 60, 0, 0);

    const end = new Date(eventDate);
    end.setHours(Math.floor(endM / 60), endM % 60, 0, 0);

    if (now < start) return "upcoming";
    if (now >= start && now <= end) return "ongoing";
    return "completed";
}



type TimeParts = { hour: number; minute: number; ampm: "AM" | "PM" };


function to12hParts(time24: string): TimeParts {
    const [hStr, mStr] = (time24 || "07:00").split(":");
    const h = Number(hStr);
    const minute = Number(mStr);

    const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
    let hour = h % 12;
    if (hour === 0) hour = 12;

    return { hour, minute: clamp(minute || 0, 0, 59), ampm };
}


function to24hString(parts: TimeParts): string {
    let h = parts.hour % 12; // 12 -> 0
    if (parts.ampm === "PM") h += 12;
    if (parts.ampm === "AM" && parts.hour === 12) h = 0;
    return `${pad2(h)}:${pad2(parts.minute)}`;
}

function format12h(time24: string) {
    const p = to12hParts(time24);
    return `${p.hour}:${pad2(p.minute)} ${p.ampm}`;
}

function TimePickerModal({
                             open,
                             label,
                             value24,
                             onClose,
                             onConfirm,
                         }: {
    open: boolean;
    label: string;
    value24: string;
    onClose: () => void;
    onConfirm: (newValue24: string) => void;
}) {
    const [parts, setParts] = useState<TimeParts>(() => to12hParts(value24));
    const hourRef = useRef<HTMLInputElement | null>(null);
    const minRef = useRef<HTMLInputElement | null>(null);

    // drafts (what you see in the input)
    const [hourDraft, setHourDraft] = useState("07");
    const [minDraft, setMinDraft] = useState("00");

    // ✅ digit buffer to avoid the "01" typing bug (works great on mobile)
    const hourBufRef = useRef<{ s: string; t: number }>({ s: "", t: 0 });
    const minBufRef = useRef<{ s: string; t: number }>({ s: "", t: 0 });

    useEffect(() => {
        if (!open) return;

        const p = to12hParts(value24);
        setParts(p);
        setHourDraft(pad2(p.hour));
        setMinDraft(pad2(p.minute));
        hourBufRef.current = { s: "", t: 0 };
        minBufRef.current = { s: "", t: 0 };

        setTimeout(() => {
            hourRef.current?.focus();
            hourRef.current?.select();
        }, 0);
    }, [open, value24]);

    if (!open) return null;

    const toggleAmPm = () => setParts((p) => ({ ...p, ampm: p.ampm === "AM" ? "PM" : "AM" }));

    const commitHour = (n: number) => {
        const next = clamp(n, 1, 12);

        // ✅ Auto-toggle when crossing 11 <-> 12
        setParts((p) => {
            const prev = p.hour;
            const crossedUp = prev === 11 && next === 12;
            const crossedDown = prev === 12 && next === 11;

            return {
                ...p,
                hour: next,
                ampm: crossedUp || crossedDown ? (p.ampm === "AM" ? "PM" : "AM") : p.ampm,
            };
        });

        setHourDraft(pad2(next));
    };

    const commitMinute = (n: number) => {
        const next = clamp(n, 0, 59);
        setParts((p) => ({ ...p, minute: next }));
        setMinDraft(pad2(next));
    };

    // ▲▼ hour should auto-toggle at 12
    const incHour = () =>
        setParts((p) => {
            const nextHour = clampWrap(p.hour + 1, 1, 12);
            const crossed = p.hour === 11 && nextHour === 12;
            const nextAmpm = crossed ? (p.ampm === "AM" ? "PM" : "AM") : p.ampm;

            setHourDraft(pad2(nextHour));
            hourBufRef.current = { s: "", t: 0 };
            return { ...p, hour: nextHour, ampm: nextAmpm };
        });

    const decHour = () =>
        setParts((p) => {
            const nextHour = clampWrap(p.hour - 1, 1, 12);
            const crossed = p.hour === 12 && nextHour === 11;
            const nextAmpm = crossed ? (p.ampm === "AM" ? "PM" : "AM") : p.ampm;

            setHourDraft(pad2(nextHour));
            hourBufRef.current = { s: "", t: 0 };
            return { ...p, hour: nextHour, ampm: nextAmpm };
        });

    const incMin = () =>
        setParts((p) => {
            const next = clampWrap(p.minute + 1, 0, 59);
            setMinDraft(pad2(next));
            minBufRef.current = { s: "", t: 0 };
            return { ...p, minute: next };
        });

    const decMin = () =>
        setParts((p) => {
            const next = clampWrap(p.minute - 1, 0, 59);
            setMinDraft(pad2(next));
            minBufRef.current = { s: "", t: 0 };
            return { ...p, minute: next };
        });

    const confirmNow = () => {
        const h = clamp(Number(hourDraft) || parts.hour, 1, 12);
        const m = clamp(Number(minDraft) || parts.minute, 0, 59);
        onConfirm(to24hString({ ...parts, hour: h, minute: m }));
    };

    const onKeyGlobal = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter") confirmNow();
    };

    const handleDigitBuffer = (which: "hour" | "min", digit: string, focusNext?: () => void) => {
        const ref = which === "hour" ? hourBufRef : minBufRef;
        const now = Date.now();

        let s = ref.current.s;
        if (now - ref.current.t > 900) s = "";
        s = (s + digit).slice(-2);

        ref.current = { s, t: now };

        if (which === "hour") {
            setHourDraft(s);
            if (s.length === 2) {
                commitHour(Number(s));
                focusNext?.();
            }
        } else {
            setMinDraft(s);
            if (s.length === 2) commitMinute(Number(s));
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            {/* Backdrop */}
            <button aria-label="Close time picker" onClick={onClose} className="absolute inset-0 bg-black/55" />

            {/* Modal */}
            <div className="relative w-[340px] rounded-xl bg-[#2b2b2b] text-white shadow-2xl border border-white/10">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <p className="font-semibold">{label}</p>
                    <button onClick={onClose} className="text-white/70 hover:text-white text-xl leading-none" aria-label="Close">
                        ×
                    </button>
                </div>

                <div className="px-6 py-5">
                    <div className="flex items-center justify-center gap-6">
                        {/* Hour */}
                        <div className="flex flex-col items-center">
                            <button onClick={incHour} className="text-[#1ee6c5] text-xl font-bold hover:opacity-80" aria-label="Increase hour">
                                ▲
                            </button>

                            <input
                                ref={hourRef}
                                type="text"
                                inputMode="numeric"
                                value={hourDraft}
                                onKeyDown={(e) => {
                                    onKeyGlobal(e);

                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        incHour();
                                        return;
                                    }
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        decHour();
                                        return;
                                    }

                                    if (/^\d$/.test(e.key)) {
                                        e.preventDefault();
                                        handleDigitBuffer("hour", e.key, () => {
                                            minRef.current?.focus();
                                            minRef.current?.select();
                                        });
                                        return;
                                    }

                                    if (e.key === "Backspace") {
                                        e.preventDefault();
                                        hourBufRef.current = { s: "", t: 0 };
                                        setHourDraft("");
                                        return;
                                    }

                                    if (e.key.length === 1) e.preventDefault();
                                }}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => {
                                    const n = Number(hourDraft);
                                    if (!Number.isFinite(n)) {
                                        setHourDraft(pad2(parts.hour));
                                        return;
                                    }
                                    commitHour(n);
                                }}
                                className="mt-2 mb-2 w-[70px] rounded-lg bg-white text-black text-3xl font-bold text-center py-2 outline-none"
                            />

                            <button onClick={decHour} className="text-[#1ee6c5] text-xl font-bold hover:opacity-80" aria-label="Decrease hour">
                                ▼
                            </button>
                        </div>

                        <div className="text-3xl font-bold">:</div>

                        {/* Minute */}
                        <div className="flex flex-col items-center">
                            <button onClick={incMin} className="text-[#1ee6c5] text-xl font-bold hover:opacity-80" aria-label="Increase minute">
                                ▲
                            </button>

                            <input
                                ref={minRef}
                                type="text"
                                inputMode="numeric"
                                value={minDraft}
                                onKeyDown={(e) => {
                                    onKeyGlobal(e);

                                    if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        incMin();
                                        return;
                                    }
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        decMin();
                                        return;
                                    }

                                    if (/^\d$/.test(e.key)) {
                                        e.preventDefault();
                                        handleDigitBuffer("min", e.key);
                                        return;
                                    }

                                    if (e.key === "Backspace") {
                                        e.preventDefault();
                                        minBufRef.current = { s: "", t: 0 };
                                        setMinDraft("");
                                        return;
                                    }

                                    if (e.key.length === 1) e.preventDefault();
                                }}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => {
                                    const n = Number(minDraft);
                                    if (!Number.isFinite(n)) {
                                        setMinDraft(pad2(parts.minute));
                                        return;
                                    }
                                    commitMinute(n);
                                }}
                                className="mt-2 mb-2 w-[70px] rounded-lg bg-white text-black text-3xl font-bold text-center py-2 outline-none"
                            />

                            <button onClick={decMin} className="text-[#1ee6c5] text-xl font-bold hover:opacity-80" aria-label="Decrease minute">
                                ▼
                            </button>
                        </div>

                        {/* AM/PM */}
                        <button
                            onClick={toggleAmPm}
                            className="h-[58px] px-4 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 font-semibold"
                            aria-label="Toggle AM/PM"
                        >
                            {parts.ampm}
                        </button>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button onClick={onClose} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15">
                            Cancel
                        </button>
                        <button onClick={confirmNow} className="px-4 py-2 rounded-lg bg-[#2f7dff] hover:opacity-90 font-semibold">
                            OK
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------ Page Component ------------------------------ */
function StatMini({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border bg-white px-2 py-2 text-center">
            <div className="text-base font-bold leading-none">{value}</div>
            <div className="text-[11px] text-gray-500 mt-1 leading-none">{label}</div>
        </div>
    );
}

export default function EventDashboard() {
    const [showAddEventForm, setShowAddEventForm] = useState(false);
    const [showNotificationForm, setShowNotificationForm] = useState(false);

    // ✅ Search + filter
    const [searchText, setSearchText] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | EventStatus>("all");

    const [recipientType, setRecipientType] = useState<"all" | "course" | "year">("all");

    // Notification form fields (UI-only for now)
    const [notifTitle, setNotifTitle] = useState("");
    const [notifDate, setNotifDate] = useState("");
    const [notifMessage, setNotifMessage] = useState("");
    const [notifCourse, setNotifCourse] = useState("Computer Engineering");
    const [notifYear, setNotifYear] = useState("1st Year");
    const [notifStartTime, setNotifStartTime] = useState("07:00");
    const [notifEndTime, setNotifEndTime] = useState("08:00");
    const [timePickerOpen, setTimePickerOpen] = useState<null | "start" | "end">(null);

    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

    // Add Event form fields
    const [title, setTitle] = useState("");
    const [location, setLocation] = useState("");
    const [date, setDate] = useState("");
    const [yearLevel, setYearLevel] = useState("All Years");
    const [course, setCourse] = useState("All Courses");
    const [details, setDetails] = useState("");
    const [isPreReg, setIsPreReg] = useState(false);
    const [withPayment, setWithPayment] = useState(false);

    // ✅ Add Event Time Picker (same modal)
    const [eventStart24, setEventStart24] = useState("07:00");
    const [eventEnd24, setEventEnd24] = useState("08:00");
    const [eventTimePickerOpen, setEventTimePickerOpen] = useState<null | "start" | "end">(null);

    // ✅ New: pre-reg slots
    const [preRegSlots, setPreRegSlots] = useState<number>(50);

    // Save UI
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [saveMsg, setSaveMsg] = useState("");

    // Role check
    const [isECUser, setIsECUser] = useState(false);
    const [roleLoading, setRoleLoading] = useState(true);

    // Events
    const [events, setEvents] = useState<EventDoc[]>([]);
    const [eventsLoading, setEventsLoading] = useState(true);

    // ✅ Role check from profiles/{uid}
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            setRoleLoading(true);

            if (!user) {
                setIsECUser(false);
                setRoleLoading(false);
                return;
            }

            try {
                const snap = await getDoc(doc(db, "profiles", user.uid));
                const role = snap.exists() ? (snap.data()?.role as Role | undefined) : undefined;
                setIsECUser(role === "ec");
            } catch {
                setIsECUser(false);
            } finally {
                setRoleLoading(false);
            }
        });

        return () => unsub();
    }, []);

    // ✅ Live events list
    useEffect(() => {
        const q = query(collection(db, "events"), orderBy("createdAt", "desc"));
        const unsub = onSnapshot(
            q,
            (snap) => {
                const list: EventDoc[] = snap.docs.map((d) => {
                    const data = d.data() as Omit<EventDoc, "id">;
                    return { id: d.id, ...data };
                });
                setEvents(list);
                setEventsLoading(false);
            },
            () => {
                setEvents([]);
                setEventsLoading(false);
            }
        );
        return () => unsub();
    }, []);

    // ✅ Filtered events (search + status)
    const filteredEvents = useMemo(() => {
        const s = searchText.trim().toLowerCase();

        return events.filter((ev) => {
            const liveStatus = computeStatus(ev);
            const matchesStatus = statusFilter === "all" || liveStatus === statusFilter;

            const matchesSearch =
                !s ||
                ev.title.toLowerCase().includes(s) ||
                (ev.location ?? "").toLowerCase().includes(s) ||
                (ev.details ?? "").toLowerCase().includes(s);

            return matchesStatus && matchesSearch;
        });
    }, [events, searchText, statusFilter]);

    // ✅ Summary counts based on live status
    const summary = useMemo(() => {
        const total = events.length;
        const upcoming = events.filter((e) => computeStatus(e) === "upcoming").length;
        const ongoing = events.filter((e) => computeStatus(e) === "ongoing").length;
        const completed = events.filter((e) => computeStatus(e) === "completed").length;
        return { total, upcoming, ongoing, completed };
    }, [events]);

    const statusChip = (status: EventStatus) => {
        if (status === "completed") return "bg-green-100 text-green-700";
        if (status === "ongoing") return "bg-orange-100 text-orange-700";
        return "bg-blue-100 text-blue-700";
    };

    const handleSaveEvent = async () => {
        setSaveError("");
        setSaveMsg("");

        if (roleLoading) return setSaveError("Checking your role, please wait...");
        if (!isECUser) return setSaveError("Only EC members can create events.");
        if (!title.trim()) return setSaveError("Title is required.");
        if (!date) return setSaveError("Date is required.");
        if (isPreReg && (!preRegSlots || preRegSlots < 1)) return setSaveError("Pre-reg slots must be at least 1.");

        try {
            setSaving(true);
            const slots = isPreReg ? preRegSlots : null;

            await addDoc(collection(db, "events"), {
                title: title.trim(),
                location: location.trim(),
                date,

                // ✅ if you already moved Add Event time to 24h strings:
                // timeStart: format12h(eventStart24),
                // timeEnd: format12h(eventEnd24),

                // ✅ if still using old strings:
                timeStart,
                timeEnd,

                yearLevel: isPreReg ? "All Years" : yearLevel,
                course: isPreReg ? "All Courses" : course,

                details: details.trim(),
                isPreReg,
                withPayment,

                preRegSlots: slots,
                preRegCount: isPreReg ? 0 : 0,
                preRegRemaining: isPreReg ? slots : 0, // ✅ remaining = slots

                createdBy: user ? user.uid : null,
                createdAt: serverTimestamp(),
                status: "upcoming",
            });

            setSaveMsg("Event saved!");

            // reset form
            setTitle("");
            setLocation("");
            setDate("");
            setYearLevel("All Years");
            setCourse("All Courses");
            setDetails("");
            setIsPreReg(false);
            setWithPayment(false);
            setPreRegSlots(50);

            setEventStart24("07:00");
            setEventEnd24("08:00");

            setShowAddEventForm(false);
        } catch (err: any) {
            setSaveError(err?.message || "Failed to save event.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="px-3 py-4 sm:p-6 space-y-4 sm:space-y-6">
            {/* HEADER */}
            <div className="bg-white sm:bg-transparent border sm:border-0 rounded-xl sm:rounded-none shadow-sm sm:shadow-none p-4 sm:p-0">
                <h1 className="text-lg sm:text-2xl font-bold text-[#7b0000] leading-tight">Campus Event Management System</h1>
                <p className="text-gray-600 text-xs sm:text-sm mt-1">
                    Organize, manage, and track all campus events in one centralized dashboard.
                </p>
            </div>

            {/* SUMMARY */}
            <div className="bg-white border rounded-xl shadow-sm p-3">
                <div className="grid grid-cols-3 gap-2">
                    <StatMini label="Total" value={summary.total} />
                    <StatMini label="Upcoming" value={summary.upcoming} />
                    <StatMini label="Ongoing" value={summary.ongoing} />
                    <StatMini label="Completed" value={summary.completed} />
                    <StatMini label="Participants" value={0} />
                    <div className="hidden sm:block" />
                </div>
            </div>

            {/* ACTIONS */}
            <div className="bg-white border rounded-xl shadow-sm p-3 space-y-3">
                <input
                    type="text"
                    placeholder="Search events..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                />

                <div className="grid grid-cols-1 gap-2">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                        <option value="all">All Status</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="ongoing">Ongoing</option>
                        <option value="completed">Completed</option>
                    </select>

                    <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-white text-sm">
                        <FiCalendar />
                        <input type="date" className="outline-none w-full" />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setShowNotificationForm((v) => !v)} className="py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold">
                            Notify
                        </button>

                        <button onClick={() => setShowAddEventForm((v) => !v)} className="py-2 rounded-lg bg-[#7b0000] text-white text-sm font-semibold">
                            Add
                        </button>
                    </div>
                </div>
            </div>

            {/* ADD EVENT FORM */}
            {showAddEventForm && (
                <div className="bg-white p-6 border rounded-xl shadow space-y-4 animate-slideDown">
                    <div className="flex items-start justify-between">
                        <h2 className="text-xl font-semibold text-[#7b0000]">Add New Event</h2>

                        <div className="flex flex-col items-end space-y-3">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={isPreReg}
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setIsPreReg(checked);
                                        if (checked) {
                                            setYearLevel("All Years");
                                            setCourse("All Courses");
                                        }
                                    }}
                                    className="w-5 h-5"
                                />
                                <span>Pre-Registration</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input type="checkbox" checked={withPayment} onChange={(e) => setWithPayment(e.target.checked)} className="w-5 h-5" />
                                <span>With Payment</span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium">Title</label>
                        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    <div>
                        <label className="text-sm font-medium">Location</label>
                        <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    <div>
                        <label className="text-sm font-medium">Date</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    {/* ✅ Add Event: same time picker as notification */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium">Time Start</label>
                            <button
                                type="button"
                                onClick={() => setEventTimePickerOpen("start")}
                                className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm bg-white text-left hover:bg-gray-50"
                            >
                                {format12h(eventStart24)}
                            </button>
                        </div>

                        <div>
                            <label className="text-sm font-medium">Time End</label>
                            <button
                                type="button"
                                onClick={() => setEventTimePickerOpen("end")}
                                className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm bg-white text-left hover:bg-gray-50"
                            >
                                {format12h(eventEnd24)}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium">Year Level</label>
                        <select
                            value={yearLevel}
                            onChange={(e) => setYearLevel(e.target.value)}
                            disabled={isPreReg}
                            className={`w-full mt-1 px-4 py-3 border rounded-lg shadow-sm ${isPreReg ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}`}
                        >
                            <option>All Years</option>
                            <option>1st Year</option>
                            <option>2nd Year</option>
                            <option>3rd Year</option>
                            <option>4th Year</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium">Course</label>
                        <select
                            value={course}
                            onChange={(e) => setCourse(e.target.value)}
                            disabled={isPreReg}
                            className={`w-full mt-1 px-4 py-3 border rounded-lg shadow-sm ${isPreReg ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}`}
                        >
                            <option>All Courses</option>
                            <option>Computer Engineering</option>
                            <option>Mechanical Engineering</option>
                            <option>Electrical Engineering</option>
                            <option>Electronics Engineering</option>
                            <option>Industrial Engineering</option>
                        </select>

                        {isPreReg && <p className="text-xs text-gray-500 mt-1">Pre-Registration events are open to all year levels and courses.</p>}
                    </div>

                    <div>
                        <label className="text-sm font-medium">Details</label>
                        <textarea value={details} onChange={(e) => setDetails(e.target.value)} className="w-full h-28 mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    {isPreReg && (
                        <div>
                            <label className="text-sm font-medium">Pre-Registration Slots</label>
                            <input
                                type="number"
                                min={1}
                                value={preRegSlots}
                                onChange={(e) => setPreRegSlots(Number(e.target.value))}
                                className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
                                placeholder="e.g. 100"
                            />
                            <p className="text-xs text-gray-500 mt-1">This is the maximum number of students allowed to pre-register.</p>
                        </div>
                    )}

                    {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
                    {saveMsg && <p className="text-green-600 text-sm">{saveMsg}</p>}

                    <button
                        onClick={handleSaveEvent}
                        disabled={saving || roleLoading || !isECUser}
                        className="w-full px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-60"
                    >
                        {roleLoading ? "Checking role..." : saving ? "Saving..." : "Save"}
                    </button>

                    {!roleLoading && !isECUser && (
                        <p className="text-xs text-gray-500">
                            Your Firestore role is not <b>ec</b> in <code>profiles/{`{uid}`}</code>.
                        </p>
                    )}
                </div>
            )}

            {/* NOTIFICATION FORM (UI only for now) */}
            {showNotificationForm && (
                <div className="bg-white p-6 border rounded-xl shadow space-y-4 animate-slideDown">
                    <h2 className="text-xl font-semibold text-blue-600">Create Notification</h2>

                    <div>
                        <label className="text-sm font-medium">Notification Title</label>
                        <input value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} type="text" className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    <div>
                        <label className="text-sm font-medium">Date</label>
                        <input value={notifDate} onChange={(e) => setNotifDate(e.target.value)} type="date" className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-sm font-medium">Start Time</label>
                            <button
                                type="button"
                                onClick={() => setTimePickerOpen("start")}
                                className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm bg-white text-left hover:bg-gray-50"
                            >
                                {format12h(notifStartTime)}
                            </button>
                        </div>

                        <div>
                            <label className="text-sm font-medium">End Time</label>
                            <button
                                type="button"
                                onClick={() => setTimePickerOpen("end")}
                                className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm bg-white text-left hover:bg-gray-50"
                            >
                                {format12h(notifEndTime)}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm font-medium">Send To</label>
                        <select className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" value={recipientType} onChange={(e) => setRecipientType(e.target.value as any)}>
                            <option value="all">All Students</option>
                            <option value="course">By Course</option>
                            <option value="year">By Year Level</option>
                        </select>
                    </div>

                    {recipientType === "course" && (
                        <div>
                            <label className="text-sm font-medium">Select Course</label>
                            <select value={notifCourse} onChange={(e) => setNotifCourse(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm">
                                <option>Computer Engineering</option>
                                <option>Mechanical Engineering</option>
                                <option>Electrical Engineering</option>
                                <option>Electronics Engineering</option>
                                <option>Industrial Engineering</option>
                            </select>
                        </div>
                    )}

                    {recipientType === "year" && (
                        <div>
                            <label className="text-sm font-medium">Select Year Level</label>
                            <select value={notifYear} onChange={(e) => setNotifYear(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm">
                                <option>1st Year</option>
                                <option>2nd Year</option>
                                <option>3rd Year</option>
                                <option>4th Year</option>
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="text-sm font-medium">Message</label>
                        <textarea value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} className="w-full h-28 mt-1 px-4 py-3 border rounded-lg shadow-sm" />
                    </div>

                    <button className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Send Notification (later)</button>
                </div>
            )}

            {/* EVENT LIST */}
            <div className="bg-white border rounded-xl shadow-sm p-4 sm:p-6">
                <h3 className="text-lg font-semibold mb-4">Event List</h3>

                {eventsLoading ? (
                    <p className="text-sm text-gray-500">Loading events...</p>
                ) : filteredEvents.length === 0 ? (
                    <p className="text-sm text-gray-500">No events match your filter/search.</p>
                ) : (
                    <div className="space-y-3">
                        {filteredEvents.map((ev) => {
                            const liveStatus = computeStatus(ev);

                            const hasSlots = ev.isPreReg && typeof ev.preRegSlots === "number";
                            const used = typeof ev.preRegCount === "number" ? ev.preRegCount : 0;
                            const total = typeof ev.preRegSlots === "number" ? ev.preRegSlots : 0;
                            const left = hasSlots ? Math.max(0, total - used) : null;

                            return (
                                <div
                                    key={ev.id}
                                    className="border rounded-lg p-3 sm:p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                                    onClick={() => setExpandedEventId(expandedEventId === ev.id ? null : ev.id)}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <h4 className="font-semibold text-gray-800">{ev.title}</h4>
                                            <span className={`px-3 py-1 text-xs rounded-full ${statusChip(liveStatus)}`}>{liveStatus}</span>

                                            {hasSlots && (
                                                <span className="px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                          Slots left: {left}
                        </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button type="button" className="px-4 py-1 bg-gray-200 text-gray-800 text-xs rounded-lg" onClick={(e) => e.stopPropagation()}>
                                                Info ▼
                                            </button>
                                            <button type="button" className="px-4 py-1 bg-blue-500 text-white text-xs rounded-lg" onClick={(e) => e.stopPropagation()}>
                                                Edit (later)
                                            </button>
                                        </div>
                                    </div>

                                    {ev.details && <p className="text-sm text-gray-500 mt-1">{ev.details}</p>}

                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-3 text-sm text-gray-600">
                                        <span>📅 {ev.date}</span>
                                        <span>
                      ⏰ {ev.timeStart ?? "—"} – {ev.timeEnd ?? "—"}
                    </span>
                                        <span>📍 {ev.location || "—"}</span>
                                    </div>

                                    {expandedEventId === ev.id && (
                                        <div className="mt-4 p-4 border rounded-lg bg-gray-50 space-y-2">
                                            <p className="text-sm text-gray-700">
                                                <b>Course:</b> {ev.course ?? "—"}
                                            </p>
                                            <p className="text-sm text-gray-700">
                                                <b>Year Level:</b> {ev.yearLevel ?? "—"}
                                            </p>
                                            <p className="text-sm text-gray-700">
                                                <b>Pre-Reg:</b> {ev.isPreReg ? "Yes" : "No"} | <b>With Payment:</b> {ev.withPayment ? "Yes" : "No"}
                                            </p>

                                            {ev.isPreReg && typeof ev.preRegSlots === "number" && (
                                                <p className="text-sm text-gray-700">
                                                    <b>Slots:</b> {ev.preRegCount ?? 0} / {ev.preRegSlots} (left: {Math.max(0, ev.preRegSlots - (ev.preRegCount ?? 0))})
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Time picker modals (Notification) */}
            <TimePickerModal
                open={timePickerOpen === "start"}
                label="Start Time:"
                value24={notifStartTime}
                onClose={() => setTimePickerOpen(null)}
                onConfirm={(val) => {
                    setNotifStartTime(val);
                    setTimePickerOpen(null);
                }}
            />

            <TimePickerModal
                open={timePickerOpen === "end"}
                label="End Time:"
                value24={notifEndTime}
                onClose={() => setTimePickerOpen(null)}
                onConfirm={(val) => {
                    setNotifEndTime(val);
                    setTimePickerOpen(null);
                }}
            />

            {/* ✅ Time picker modals (Add Event) */}
            <TimePickerModal
                open={eventTimePickerOpen === "start"}
                label="Start Time:"
                value24={eventStart24}
                onClose={() => setEventTimePickerOpen(null)}
                onConfirm={(val) => {
                    setEventStart24(val);
                    setEventTimePickerOpen(null);
                }}
            />

            <TimePickerModal
                open={eventTimePickerOpen === "end"}
                label="End Time:"
                value24={eventEnd24}
                onClose={() => setEventTimePickerOpen(null)}
                onConfirm={(val) => {
                    setEventEnd24(val);
                    setEventTimePickerOpen(null);
                }}
            />
        </div>
    );
}
