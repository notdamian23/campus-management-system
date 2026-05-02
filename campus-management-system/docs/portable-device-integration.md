# CAMPUS Portable Device Integration

This implementation connects the ESP32 attendance module to the CAMPUS Next.js + Firebase stack with:

- short-lived device session tokens
- event pairing
- paired-event roster download
- pending fingerprint enrollment queue sync
- idempotent attendance uploads
- offline attendance capture with later sync

## Files Added Or Updated

- `portable-device-functions/src/index.ts`
- `firestore.rules`
- `lib/portableDevice.ts`
- `scripts/hash-device-secret.mjs`
- `../campusmodule/src/*` and `../campusmodule/platformio.ini` for the firmware side

## Firestore Schema

### `profiles/{uid}`

Existing user profile source of truth. Student records may also carry:

```json
{
  "role": "student",
  "schoolId": "2023001234",
  "studentName": "Juan Dela Cruz",
  "course": "BSCE",
  "year": "3rd Year",
  "fingerprintTemplateId": 41,
  "fingerprintStatus": "enrolled",
  "fingerprintDeviceId": "campus-portable-01"
}
```

### `students/{studentId}`

Portable-device projection keyed by Firebase Auth UID.

```json
{
  "uid": "studentUid123",
  "studentId": "studentUid123",
  "schoolId": "2023001234",
  "studentName": "Juan Dela Cruz",
  "course": "BSCE",
  "yearLevel": "3rd Year",
  "fingerprintTemplateId": 41,
  "fingerprintStatus": "enrolled",
  "fingerprintDeviceId": "campus-portable-01"
}
```

### `events/{eventId}`

Existing event docs remain the source of truth. The device API reads:

- `title`
- `date`
- `scheduledTime` or `timeStart`
- `location`
- `status`
- `yearLevels`
- `courses`
- `targetStudent`
- `selectedStudentIds`
- `selectedSchoolIds`
- `isPreReg`

Audience resolution supports filtered audiences, specific students, and mixed
audiences. When an event has course/year/section filters plus manually selected
students, the paired roster is the union of the filtered students and selected
students.

### `events/{eventId}/attendance/{studentId}`

Idempotent attendance record keyed by student UID.

```json
{
  "eventId": "event123",
  "eventTitle": "General Assembly 2026",
  "studentId": "studentUid123",
  "uid": "studentUid123",
  "studentUid": "studentUid123",
  "schoolId": "2023001234",
  "studentName": "Juan Dela Cruz",
  "course": "BSCE",
  "yearLevel": "3rd Year",
  "year": "3rd Year",
  "status": "Present",
  "source": "portable-device",
  "deviceId": "campus-portable-01",
  "recordedByDevice": true,
  "recordedByDeviceId": "campus-portable-01",
  "deviceRecordId": "campus-portable-01-1712012400-0",
  "fingerprintTemplateId": 41,
  "templateId": 41,
  "deviceTimestampEpoch": 1712012400,
  "deviceTimestampIso": "2026-04-02T10:00:00Z",
  "timeSource": "rtc",
  "syncStatus": "synced"
}
```

### `devices/{deviceId}`

Store device auth and lifecycle metadata. Use a SHA-256 hash for the device secret.

```json
{
  "deviceId": "campus-portable-01",
  "label": "Portable Event Kit 01",
  "enabled": true,
  "sessionVersion": 1,
  "secretHash": "sha256hexvaluehere"
}
```

### `devicePairings/{deviceId}`

```json
{
  "deviceId": "campus-portable-01",
  "eventId": "event123",
  "eventTitle": "General Assembly 2026",
  "eventDate": "2026-04-15",
  "eventScheduledTime": "08:00 AM",
  "eventLocation": "UC Lapu-Lapu Gym",
  "status": "paired",
  "source": "portable-device",
  "rosterCount": 84,
  "attendanceCount": 41
}
```

### `enrollmentQueue/{queueId}`

```json
{
  "queueId": "studentUid123",
  "eventId": "event123",
  "studentId": "studentUid123",
  "schoolId": "2023001234",
  "studentName": "Juan Dela Cruz",
  "course": "BSCE",
  "yearLevel": "3rd Year",
  "status": "pending"
}
```

### `syncLogs/{recordId}`

```json
{
  "recordId": "campus-portable-01-1712012400-0",
  "eventId": "event123",
  "studentId": "studentUid123",
  "deviceId": "campus-portable-01",
  "syncStatus": "uploaded",
  "message": "Attendance saved.",
  "source": "portable-device"
}
```

## Security Rules

The updated `firestore.rules` now:

- keeps `events` writable only by Admin or EC
- adds `students`, `devicePairings`, `enrollmentQueue`, `syncLogs`, and `devices`
- keeps `devices` admin-only because it stores auth material
- keeps `syncLogs` Admin SDK-only for writes

## Cloud Functions Contract

Implemented in `portable-device-functions/src/index.ts`.

### `campusDeviceCreateSession`

- method: `POST`
- auth: `X-Device-Id` + `X-Device-Secret`
- returns: short-lived bearer token

### `campusDeviceListEvents`

- method: `GET`
- auth: bearer token or legacy headers
- returns: active/upcoming events for Pair Event

### `campusDevicePairEvent`

- method: `POST`
- auth: bearer token or legacy headers
- body: `{ "eventId": "..." }`
- returns: paired event + roster + already recorded student IDs

### `campusDevicePairedEventContext`

- method: `GET`
- auth: bearer token or legacy headers
- returns: paired event snapshot + authorized students + already recorded IDs
- mixed filtered + manually selected audiences are preserved as one authorized roster

### `campusDevicePairedEventAttendanceState`

- method: `GET`
- auth: bearer token or legacy headers
- query: `offset`, `limit`
- returns: paginated existing attendance docs for the device's currently paired event only
- reads only `devicePairings/{deviceId}.eventId`; callers cannot request arbitrary events
- does not create or modify `events/{eventId}/attendance/*`
- empty attendance returns HTTP 200 with `attendance: []`

```json
{
  "ok": true,
  "eventId": "event123",
  "offset": 0,
  "limit": 25,
  "count": 0,
  "hasMore": false,
  "nextOffset": null,
  "attendance": []
}
```

### `campusDevicePendingEnrollments`

- method: `GET`
- auth: bearer token or legacy headers
- returns: pending queue items or fallback students missing fingerprints for the paired event

### `campusDeviceSubmitEnrollment`

- method: `POST`
- auth: bearer token or legacy headers
- body:

```json
{
  "studentId": "studentUid123",
  "queueId": "studentUid123",
  "fingerprintTemplateId": 41
}
```

### `campusDeviceSyncAttendance`

- method: `POST`
- auth: bearer token or legacy headers
- idempotent by `syncLogs/{recordId}` and `events/{eventId}/attendance/{studentId}`

## Web App Changes Needed

1. Keep event creation on `events/{eventId}` exactly as it already works.
2. When EC wants a student enrolled on the portable device, write a pending doc to `enrollmentQueue/{studentId}`.
3. Optionally show device status on an EC page by reading `devicePairings/{deviceId}`.
4. Use [`lib/portableDevice.ts`](/f:/campus-management-system/campus-management-system/lib/portableDevice.ts) for shared types and helper builders.
5. Attendance dashboards already work because device uploads write directly to `events/{eventId}/attendance/{studentId}`.

## Helper Utilities

### Hash a device secret

Run:

```bash
node scripts/hash-device-secret.mjs campus-portable-01 portable01_secret_2026
```

Paste the output into `devices/{deviceId}`.

### Required environment variable

Set this for the `portable-device-functions` codebase before deployment:

```text
CAMPUS_DEVICE_SESSION_SECRET=<long-random-server-secret>
```

## Error Handling Strategy

- Device auth failures return `401` or `403`
- Invalid payloads return `400`
- Missing events return `404`
- Sync retries are safe because:
  - the device only syncs to its paired event
  - each upload is logged in `syncLogs/{recordId}`
  - attendance docs are keyed by `studentId` under the paired event
- Offline timestamps use RTC or last-known time and are preserved in:
  - `timestamp`
  - `deviceTimestampEpoch`
  - `deviceTimestampIso`
  - `timeSource`

## Implementation Order

1. Deploy updated Firestore rules.
2. Add `devices/{deviceId}` docs using hashed secrets.
3. Set `CAMPUS_DEVICE_SESSION_SECRET` for `portable-device-functions`.
4. Deploy `portable-device-functions`.
5. Add or expose EC UI for writing `enrollmentQueue` docs.
6. Flash the updated ESP32 firmware.
7. Pair the device to an event.
8. Test enroll -> attendance offline -> reconnect -> auto sync.

## Important Hardware Limitation

This implementation syncs fingerprint metadata, not raw biometric templates. The AS608 template itself still lives inside the physical scanner. That means attendance validation assumes the same portable module that enrolled the fingerprint still has that template stored locally. If you need true cross-device fingerprint template transfer later, add an AS608 template upload/download workflow as a separate phase.
