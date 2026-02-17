"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Checkbox } from "@heroui/checkbox";
import { Input, Textarea } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";

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

function format12h(time24: string) {
    const [hStr, mStr] = (time24 || "07:00").split(":");
    const hour24 = Number(hStr);
    const minute = Number(mStr);

    if (!Number.isFinite(hour24) || !Number.isFinite(minute)) {
        return "7:00 AM";
    }

    const ampm = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${pad2(Math.max(0, Math.min(minute, 59)))} ${ampm}`;
}

/* ------------------------------ Page Component ------------------------------ */
function StatMini({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-xl border border-border bg-surface-soft px-3 py-3 text-center transition-transform hover:-translate-y-0.5">
            <div className="text-xl font-extrabold leading-none text-primary-900">{value}</div>
            <div className="text-xs text-campus-text-secondary mt-1 leading-none">{label}</div>
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

    // Current authenticated user
    const [currentUser, setCurrentUser] = useState<any>(null);

    // ✅ Role check from profiles/{uid}
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            setRoleLoading(true);
            setCurrentUser(user);

            if (!user) {
                setIsECUser(false);
                setCurrentUser(null);
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
                timeStart: format12h(eventStart24),
                timeEnd: format12h(eventEnd24),

                yearLevel: isPreReg ? "All Years" : yearLevel,
                course: isPreReg ? "All Courses" : course,

                details: details.trim(),
                isPreReg,
                withPayment,

                preRegSlots: slots,
                preRegCount: isPreReg ? 0 : 0,
                preRegRemaining: isPreReg ? slots : 0, // ✅ remaining = slots

                createdBy: currentUser ? currentUser.uid : null,
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
        <div className="px-3 py-4 sm:p-6 space-y-5 sm:space-y-6">
            <Card className="campus-panel-strong overflow-hidden">
                <div className="campus-gradient-bar h-1.5 w-full" />
                <CardHeader className="flex flex-col items-start gap-1 pb-2">
                    <h1 className="text-xl sm:text-3xl font-extrabold text-primary-900 leading-tight">Campus Event Management</h1>
                    <p className="text-campus-text-secondary text-sm sm:text-base">
                        Organize, monitor, and publish events from one clean workspace.
                    </p>
                </CardHeader>
                <CardBody className="pt-0">
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <StatMini label="Total" value={summary.total} />
                        <StatMini label="Upcoming" value={summary.upcoming} />
                        <StatMini label="Ongoing" value={summary.ongoing} />
                        <StatMini label="Completed" value={summary.completed} />
                        <StatMini label="Participants" value={0} />
                    </div>
                </CardBody>
            </Card>

            <Card className="campus-panel">
                <CardBody className="space-y-3">
                <Input
                    type="text"
                    placeholder="Search events..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    variant="bordered"
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Select
                        label="Status"
                        labelPlacement="outside"
                        selectedKeys={[statusFilter]}
                        onChange={(e) => setStatusFilter(e.target.value as "all" | EventStatus)}
                        variant="bordered"
                        disallowEmptySelection
                    >
                        <SelectItem key="all">All Status</SelectItem>
                        <SelectItem key="upcoming">Upcoming</SelectItem>
                        <SelectItem key="ongoing">Ongoing</SelectItem>
                        <SelectItem key="completed">Completed</SelectItem>
                    </Select>

                    <Input type="date" label="Date" labelPlacement="outside" variant="bordered" />

                    <div className="grid grid-cols-2 gap-2 md:items-end">
                        <Button color="primary" variant="flat" onPress={() => setShowNotificationForm((v) => !v)}>
                            Notify
                        </Button>
                        <Button color="primary" onPress={() => setShowAddEventForm((v) => !v)}>
                            Add
                        </Button>
                    </div>
                </div>
                </CardBody>
            </Card>

            {showAddEventForm && (
                <Card className="campus-panel">
                    <CardHeader className="flex items-center justify-between">
                        <h2 className="text-lg sm:text-xl font-bold text-primary-900">Add New Event</h2>
                        <Button size="sm" variant="light" onPress={() => setShowAddEventForm(false)}>
                            Close
                        </Button>
                    </CardHeader>
                    <CardBody className="space-y-4">
                                <div className="flex flex-wrap gap-6">
                                    <Checkbox
                                        isSelected={isPreReg}
                                        onValueChange={(checked) => {
                                            setIsPreReg(checked);
                                            if (checked) {
                                                setYearLevel("All Years");
                                                setCourse("All Courses");
                                            }
                                        }}
                                    >
                                        Pre-Registration
                                    </Checkbox>

                                    <Checkbox isSelected={withPayment} onValueChange={setWithPayment}>
                                        With Payment
                                    </Checkbox>
                                </div>

                                <Input
                                    label="Title"
                                    labelPlacement="outside"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    variant="bordered"
                                />

                                <Input
                                    label="Location"
                                    labelPlacement="outside"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    variant="bordered"
                                />

                                <Input
                                    type="date"
                                    label="Date"
                                    labelPlacement="outside"
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    variant="bordered"
                                />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Input
                                        type="time"
                                        label="Time Start"
                                        labelPlacement="outside"
                                        value={eventStart24}
                                        onChange={(e) => setEventStart24(e.target.value)}
                                        variant="bordered"
                                    />

                                    <Input
                                        type="time"
                                        label="Time End"
                                        labelPlacement="outside"
                                        value={eventEnd24}
                                        onChange={(e) => setEventEnd24(e.target.value)}
                                        variant="bordered"
                                    />
                                </div>

                                <Select
                                    label="Year Level"
                                    labelPlacement="outside"
                                    selectedKeys={[yearLevel]}
                                    onChange={(e) => setYearLevel(e.target.value)}
                                    isDisabled={isPreReg}
                                    variant="bordered"
                                    disallowEmptySelection
                                >
                                    <SelectItem key="All Years">All Years</SelectItem>
                                    <SelectItem key="1st Year">1st Year</SelectItem>
                                    <SelectItem key="2nd Year">2nd Year</SelectItem>
                                    <SelectItem key="3rd Year">3rd Year</SelectItem>
                                    <SelectItem key="4th Year">4th Year</SelectItem>
                                </Select>

                                <Select
                                    label="Course"
                                    labelPlacement="outside"
                                    selectedKeys={[course]}
                                    onChange={(e) => setCourse(e.target.value)}
                                    isDisabled={isPreReg}
                                    variant="bordered"
                                    disallowEmptySelection
                                >
                                    <SelectItem key="All Courses">All Courses</SelectItem>
                                    <SelectItem key="Computer Engineering">Computer Engineering</SelectItem>
                                    <SelectItem key="Mechanical Engineering">Mechanical Engineering</SelectItem>
                                    <SelectItem key="Electrical Engineering">Electrical Engineering</SelectItem>
                                    <SelectItem key="Electronics Engineering">Electronics Engineering</SelectItem>
                                    <SelectItem key="Industrial Engineering">Industrial Engineering</SelectItem>
                                </Select>

                                {isPreReg && (
                                    <p className="text-xs text-campus-text-secondary">
                                        Pre-Registration events are open to all year levels and courses.
                                    </p>
                                )}

                                <Textarea
                                    label="Details"
                                    labelPlacement="outside"
                                    value={details}
                                    onChange={(e) => setDetails(e.target.value)}
                                    variant="bordered"
                                    minRows={4}
                                />

                                {isPreReg && (
                                    <Input
                                        type="number"
                                        min={1}
                                        label="Pre-Registration Slots"
                                        labelPlacement="outside"
                                        value={String(preRegSlots)}
                                        onChange={(e) => setPreRegSlots(Number(e.target.value))}
                                        variant="bordered"
                                        placeholder="e.g. 100"
                                    />
                                )}

                                {isPreReg && (
                                    <p className="text-xs text-campus-text-secondary">
                                        This is the maximum number of students allowed to pre-register.
                                    </p>
                                )}

                                {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
                                {saveMsg && <p className="text-green-600 text-sm">{saveMsg}</p>}

                                {!roleLoading && !isECUser && (
                                    <p className="text-xs text-campus-text-secondary">
                                        Your Firestore role is not <b>ec</b> in <code>profiles/{`{uid}`}</code>.
                                    </p>
                                )}
                                <div className="flex justify-end gap-2 pt-2">
                                    <Button variant="light" onPress={() => setShowAddEventForm(false)}>
                                        Cancel
                                    </Button>
                                    <Button
                                        color="primary"
                                        onPress={handleSaveEvent}
                                        isDisabled={saving || roleLoading || !isECUser}
                                        isLoading={saving}
                                    >
                                        {roleLoading ? "Checking role..." : "Save"}
                                    </Button>
                                </div>
                    </CardBody>
                </Card>
            )}

            {showNotificationForm && (
                <Card className="campus-panel">
                    <CardHeader className="flex items-center justify-between">
                        <h2 className="text-lg sm:text-xl font-bold text-primary-900">Create Notification</h2>
                        <Button size="sm" variant="light" onPress={() => setShowNotificationForm(false)}>
                            Close
                        </Button>
                    </CardHeader>
                    <CardBody className="space-y-4">
                                <Input
                                    label="Notification Title"
                                    labelPlacement="outside"
                                    value={notifTitle}
                                    onChange={(e) => setNotifTitle(e.target.value)}
                                    variant="bordered"
                                />

                                <Input
                                    type="date"
                                    label="Date"
                                    labelPlacement="outside"
                                    value={notifDate}
                                    onChange={(e) => setNotifDate(e.target.value)}
                                    variant="bordered"
                                />

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Input
                                        type="time"
                                        label="Start Time"
                                        labelPlacement="outside"
                                        value={notifStartTime}
                                        onChange={(e) => setNotifStartTime(e.target.value)}
                                        variant="bordered"
                                    />
                                    <Input
                                        type="time"
                                        label="End Time"
                                        labelPlacement="outside"
                                        value={notifEndTime}
                                        onChange={(e) => setNotifEndTime(e.target.value)}
                                        variant="bordered"
                                    />
                                </div>

                                <Select
                                    label="Send To"
                                    labelPlacement="outside"
                                    selectedKeys={[recipientType]}
                                    onChange={(e) => setRecipientType(e.target.value as "all" | "course" | "year")}
                                    variant="bordered"
                                    disallowEmptySelection
                                >
                                    <SelectItem key="all">All Students</SelectItem>
                                    <SelectItem key="course">By Course</SelectItem>
                                    <SelectItem key="year">By Year Level</SelectItem>
                                </Select>

                                {recipientType === "course" && (
                                    <Select
                                        label="Select Course"
                                        labelPlacement="outside"
                                        selectedKeys={[notifCourse]}
                                        onChange={(e) => setNotifCourse(e.target.value)}
                                        variant="bordered"
                                        disallowEmptySelection
                                    >
                                        <SelectItem key="Computer Engineering">Computer Engineering</SelectItem>
                                        <SelectItem key="Mechanical Engineering">Mechanical Engineering</SelectItem>
                                        <SelectItem key="Electrical Engineering">Electrical Engineering</SelectItem>
                                        <SelectItem key="Electronics Engineering">Electronics Engineering</SelectItem>
                                        <SelectItem key="Industrial Engineering">Industrial Engineering</SelectItem>
                                    </Select>
                                )}

                                {recipientType === "year" && (
                                    <Select
                                        label="Select Year Level"
                                        labelPlacement="outside"
                                        selectedKeys={[notifYear]}
                                        onChange={(e) => setNotifYear(e.target.value)}
                                        variant="bordered"
                                        disallowEmptySelection
                                    >
                                        <SelectItem key="1st Year">1st Year</SelectItem>
                                        <SelectItem key="2nd Year">2nd Year</SelectItem>
                                        <SelectItem key="3rd Year">3rd Year</SelectItem>
                                        <SelectItem key="4th Year">4th Year</SelectItem>
                                    </Select>
                                )}

                                <Textarea
                                    label="Message"
                                    labelPlacement="outside"
                                    value={notifMessage}
                                    onChange={(e) => setNotifMessage(e.target.value)}
                                    variant="bordered"
                                    minRows={4}
                                />
                                <div className="flex justify-end gap-2 pt-2">
                                <Button variant="light" onPress={() => setShowNotificationForm(false)}>
                                    Cancel
                                </Button>
                                <Button color="primary" onPress={() => setShowNotificationForm(false)}>
                                    Send Notification (later)
                                </Button>
                                </div>
                    </CardBody>
                </Card>
            )}

            {/* EVENT LIST */}
            <Card className="campus-panel">
                <CardHeader>
                    <h3 className="text-xl font-bold text-primary-900">Event List</h3>
                </CardHeader>
                <CardBody className="pt-0">

                {eventsLoading ? (
                    <p className="text-sm text-campus-text-secondary">Loading events...</p>
                ) : filteredEvents.length === 0 ? (
                    <p className="text-sm text-campus-text-secondary">No events match your filter/search.</p>
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
                                    className="border border-border rounded-xl p-3 sm:p-4 bg-surface-soft hover:bg-white transition cursor-pointer"
                                    onClick={() => setExpandedEventId(expandedEventId === ev.id ? null : ev.id)}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <h4 className="text-lg font-bold text-campus-text-primary">{ev.title}</h4>
                                            <span className={`px-3 py-1 text-xs rounded-full ${statusChip(liveStatus)}`}>{liveStatus}</span>

                                            {hasSlots && (
                                                <span className="px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                          Slots left: {left}
                        </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <Button size="sm" variant="flat" onPress={() => {}}>
                                                Info
                                            </Button>
                                            <Button size="sm" color="primary" onPress={() => {}}>
                                                Edit (later)
                                            </Button>
                                        </div>
                                    </div>

                                    {ev.details && <p className="text-sm text-campus-text-secondary mt-1">{ev.details}</p>}

                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-3 text-sm text-campus-text-secondary">
                                        <span>📅 {ev.date}</span>
                                        <span>
                      ⏰ {ev.timeStart ?? "—"} – {ev.timeEnd ?? "—"}
                    </span>
                                        <span>📍 {ev.location || "—"}</span>
                                    </div>

                                    {expandedEventId === ev.id && (
                                        <div className="mt-4 p-4 border border-border rounded-xl bg-white space-y-2">
                                            <p className="text-sm text-campus-text-primary">
                                                <b>Course:</b> {ev.course ?? "—"}
                                            </p>
                                            <p className="text-sm text-campus-text-primary">
                                                <b>Year Level:</b> {ev.yearLevel ?? "—"}
                                            </p>
                                            <p className="text-sm text-campus-text-primary">
                                                <b>Pre-Reg:</b> {ev.isPreReg ? "Yes" : "No"} | <b>With Payment:</b> {ev.withPayment ? "Yes" : "No"}
                                            </p>

                                            {ev.isPreReg && typeof ev.preRegSlots === "number" && (
                                                <p className="text-sm text-campus-text-primary">
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
                </CardBody>
            </Card>

        </div>
    );
}


