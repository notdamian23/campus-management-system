# CAMPUS Fingerprint Enrollment Workflow

This document describes the enrollment-session workflow implemented for:

`CAMPUS: IoT-Based Fingerprint Biometric Management System for the Engineering Council Organization at the University of Cebu - Lapu-Lapu and Mandaue`

## 1. Firestore Schema

### `profiles/{uid}`

Student profile source of truth for auth-facing fields.

Suggested fingerprint fields:

```ts
{
  role: "student" | "ec" | "admin" | "teacher";
  schoolId: string;
  name?: string;
  status?: "Active" | "Inactive";
  hasFingerprint?: boolean;
  fingerprintTemplateId?: number;
  fingerprintStatus?: "enrolled";
  fingerprintDeviceId?: string;
  fingerprintEnrolledAt?: Timestamp;
  latestEnrollmentSessionId?: string;
  updatedAt?: Timestamp;
}
```

### `students/{studentId}`

Portable-device projection for offline enrollment and attendance.

```ts
{
  uid: string;
  studentId: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  year?: string;
  status?: "Active" | "Inactive";
  hasFingerprint?: boolean;
  fingerprintTemplateId?: number;
  templateId?: number;
  fingerprintStatus?: "pending" | "enrolled";
  fingerprintDeviceId?: string;
  fingerprintEnrolledAt?: Timestamp;
  latestEnrollmentSessionId?: string;
  updatedAt?: Timestamp;
}
```

### `enrollmentSessions/{sessionId}`

Created by EC/Admin from `/ecmember/students`.

```ts
{
  sessionId: string;
  createdBy: string;
  createdByName?: string;
  createdBySchoolId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  status:
    | "pending"
    | "paired"
    | "downloading"
    | "enrolling"
    | "completed"
    | "partially-completed"
    | "closed";
  pairedDeviceId?: string;
  targetDeviceId?: string;
  totalStudents: number;
  pendingCount: number;
  downloadedCount: number;
  enrolledCount: number;
  syncedCount: number;
  failedCount: number;
  selectedStudentIds: string[];
  closedAt?: Timestamp | null;
  lastDownloadedAt?: Timestamp;
  lastEnrollmentSyncAt?: Timestamp;
  completedAt?: Timestamp | null;
}
```

### `enrollmentSessions/{sessionId}/students/{studentId}`

Session queue entries visible in the EC monitoring UI.

```ts
{
  enrollmentSessionId: string;
  studentId: string;
  studentUid?: string;
  schoolId: string;
  fullName: string;
  course: string;
  yearLevel: string;
  status: "pending" | "downloaded" | "enrolled" | "synced" | "failed";
  syncStatus: "pending" | "synced" | "failed";
  fingerprintTemplateId?: number;
  enrolledAt?: Timestamp;
  downloadedAt?: Timestamp;
  syncedAt?: Timestamp;
  enrolledByDevice?: string;
  assignedDeviceId?: string;
  remarks?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
```

### `devices/{deviceId}`

```ts
{
  label?: string;
  name?: string;
  enabled?: boolean;
  secretHash?: string;
  activeEnrollmentSessionId?: string;
  lastEnrollmentSessionPairedAt?: Timestamp;
  lastEnrollmentSyncAt?: Timestamp;
  updatedAt?: Timestamp;
}
```

### `devices/{deviceId}/syncLogs/{logId}`

Idempotency and audit trail for device syncs.

```ts
{
  recordId: string;
  sessionId?: string;
  studentId?: string;
  schoolId?: string;
  studentName?: string;
  deviceId: string;
  fingerprintTemplateId?: number | null;
  syncStatus: "uploaded" | "duplicate" | "failed";
  message: string;
  attemptedAt: Timestamp;
  processedAt: Timestamp;
  source: "portable-device";
}
```

## 2. Security Rules

Implemented in `firestore.rules`:

- `enrollmentSessions/*` and `enrollmentSessions/*/students/*` are readable and writable by `admin` and `ec`.
- `devices/{deviceId}/syncLogs/*` is readable by `admin` and `ec`, write-denied from clients.
- Device writes still go through Cloud Functions with Admin SDK validation, not direct client access.

## 3. Backend / Cloud Functions

Implemented in `portable-device-functions/src/index.ts`.

### Device session list

`GET /campusDeviceListEnrollmentSessions`

Response:

```json
{
  "sessions": [
    {
      "sessionId": "abc123",
      "createdBy": "uid123",
      "createdByName": "EC Member 01",
      "createdBySchoolId": "23210001",
      "status": "pending",
      "pairedDeviceId": "",
      "totalStudents": 4,
      "pendingCount": 4,
      "downloadedCount": 0,
      "enrolledCount": 0,
      "syncedCount": 0,
      "failedCount": 0,
      "createdAtMs": 1775180400000,
      "updatedAtMs": 1775180400000
    }
  ]
}
```

### Pair device to session

`POST /campusDevicePairEnrollmentSession`

```json
{
  "sessionId": "abc123"
}
```

### Download enrollment queue

`POST /campusDeviceDownloadEnrollmentSession`

```json
{
  "sessionId": "abc123"
}
```

Response:

```json
{
  "session": {
    "sessionId": "abc123",
    "status": "downloading",
    "pairedDeviceId": "campus-portable-01",
    "totalStudents": 4,
    "pendingCount": 0,
    "downloadedCount": 4,
    "enrolledCount": 0,
    "syncedCount": 0,
    "failedCount": 0
  },
  "students": [
    {
      "sessionId": "abc123",
      "studentId": "uid001",
      "studentUid": "uid001",
      "schoolId": "23210999",
      "studentName": "Juan Dela Cruz",
      "course": "Computer Engineering",
      "yearLevel": "4th Year",
      "fingerprintTemplateId": -1,
      "enrollmentStatus": "downloaded",
      "syncStatus": "pending",
      "remarks": ""
    }
  ]
}
```

### Sync enrolled fingerprints

`POST /campusDeviceSyncEnrollmentResults`

```json
{
  "sessionId": "abc123",
  "results": [
    {
      "recordId": "enrollment:abc123:uid001",
      "sessionId": "abc123",
      "studentId": "uid001",
      "schoolId": "23210999",
      "studentName": "Juan Dela Cruz",
      "course": "Computer Engineering",
      "yearLevel": "4th Year",
      "fingerprintTemplateId": 18,
      "status": "enrolled",
      "syncStatus": "synced",
      "timestampIso": "2026-04-03T12:10:33Z",
      "remarks": ""
    }
  ]
}
```

### Website session creation

Current implementation uses direct Firestore batch writes from the authenticated EC/Admin client under Firestore security rules instead of a separate callable function. This keeps the EC web flow simple while the sensitive device operations remain server-side.

## 4. Frontend Structure

Implemented in:

- `app/(protected)/ecmember/students/page.tsx`
- `components/ecmember/FingerprintEnrollmentManager.tsx`

Behavior:

- Adds an `Enroll Fingerprint` button beside `Add Student`.
- Opens a HeroUI modal instead of a separate website.
- Lists students without fingerprints.
- Supports multi-select session creation.
- Prevents duplicate queueing by reserving students already included in active sessions.
- Monitors live session state and per-student progress.
- Allows EC/Admin to manually mark a session closed.

## 5. ESP32 Firmware Structure

Implemented/extended in:

- `campusmodule/src/AppTypes.h`
- `campusmodule/src/BackendClient.h`
- `campusmodule/src/BackendClient.cpp`
- `campusmodule/src/StorageManager.h`
- `campusmodule/src/StorageManager.cpp`
- `campusmodule/src/DisplayManager.h`
- `campusmodule/src/DisplayManager.cpp`
- `campusmodule/src/main.cpp`

Main firmware flow:

1. Open `Enroll Student`.
2. Connect Wi-Fi if available.
3. Fetch open enrollment sessions.
4. Pair one session to the module.
5. Download the student queue.
6. Save the queue and current session locally.
7. Continue fingerprint enrollment even when Wi-Fi is gone.
8. Save fingerprint mappings locally.
9. Keep unsynced fingerprint results in the local sync queue.
10. Sync later through the existing sync flow.

## 6. Local SD / LittleFS File Layout

Current local structure:

```text
/config/device.json
/sessions/current_enrollment_session.json
/students/enrollment_queue.json
/logs/enrollment_logs.json
/logs/sync_queue.json
/fingerprint_map.json
/attendance_records.json
/paired_event_context.json
```

Purpose:

- `device.json`: local device metadata snapshot.
- `current_enrollment_session.json`: paired enrollment session metadata.
- `enrollment_queue.json`: downloaded student queue for offline enrollment.
- `enrollment_logs.json`: local audit log of enrollment captures.
- `sync_queue.json`: unsynced fingerprint results waiting for upload.
- `fingerprint_map.json`: template-to-student map for offline recognition.

## 7. 20x4 LCD Layout

Display updates now use the whole `20x4` screen.

### Session picker

```text
Enroll Session
abc123 1/3
Status: pending
Queue:4 Sync:0
```

### Student enrollment screen

```text
Juan Dela Cruz
23210999
Computer Eng | 4th
FP:pending Sync:0
```

## 8. Recommended Implementation Order

1. Deploy updated Firestore rules.
2. Deploy `portable-device-functions`.
3. Open `/ecmember/students` and create a test enrollment session.
4. Update the ESP32 firmware and flash the CAMPUS module.
5. Pair the module to the session.
6. Download the queue and test offline enrollment.
7. Reconnect Wi-Fi and test sync retry.
8. Validate student docs, profile docs, and session counters.

## 9. Error Handling Strategy

- Device auth failures: reject request immediately with `401` or `403`.
- Session conflicts: reject pairing when a different device already owns the session.
- Offline capture failures: keep enrollment local and do not block the rest of the queue.
- Duplicate uploads: detect using `devices/{deviceId}/syncLogs/{recordId}` and return `duplicate`.
- Partial completion: keep session in `enrolling` until synced results or failures are known; EC can close the session when appropriate.
- Idempotency: use stable `recordId` values such as `enrollment:{sessionId}:{studentId}`.

## 10. Practical Notes

- Fingerprint templates remain local on the CAMPUS module and template map for offline attendance stays on-device.
- The web session is only the coordination layer, not the source of truth for offline fingerprint capture.
- Device credentials are never exposed in the browser.
- The portable device continues to use server-side validated HTTP functions for pairing and sync.
