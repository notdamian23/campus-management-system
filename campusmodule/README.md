# CAMPUS Portable Attendance Module

This firmware turns `campusmodule` into an Arduino-based ESP32 attendance device for the CAMPUS thesis project. It is designed to be offline-first: the AS608 matches fingerprints locally, attendance is stored locally first, and sync happens only when Wi-Fi is available.

## Final Pinout

| Component | Signal | ESP32 Pin | Notes |
|---|---|---:|---|
| AS608 fingerprint | VCC | 3.3V | Stable rail recommended |
| AS608 fingerprint | GND | GND | Common ground |
| AS608 fingerprint | WHITE | GPIO17 | ESP32 TX -> scanner RX |
| AS608 fingerprint | YELLOW | GPIO16 | ESP32 RX -> scanner TX |
| Button UP | Signal | GPIO32 | `INPUT_PULLUP`, other side to GND |
| Button DOWN | Signal | GPIO33 | `INPUT_PULLUP`, other side to GND |
| Button SELECT | Signal | GPIO25 | `INPUT_PULLUP`, other side to GND |
| Button BACK | Signal | GPIO26 | `INPUT_PULLUP`, other side to GND |
| Green LED | Anode | GPIO27 | 220 ohm resistor to GND |
| Red LED | Anode | GPIO14 | 220 ohm resistor to GND |
| Buzzer | Signal | GPIO13 | Active buzzer preferred |
| LCD 20x4 I2C | SDA | GPIO21 | Shared with RTC |
| LCD 20x4 I2C | SCL | GPIO22 | Shared with RTC |
| LCD 20x4 I2C | VCC | 5V | Typical I2C backpack setup |
| LCD 20x4 I2C | GND | GND | Common ground |
| DS3231 RTC | SDA | GPIO21 | Shared I2C bus |
| DS3231 RTC | SCL | GPIO22 | Shared I2C bus |
| DS3231 RTC | VCC | 3.3V or 5V | Module-dependent |
| DS3231 RTC | GND | GND | Common ground |
| MicroSD module | CS | GPIO5 | SPI CS |
| MicroSD module | SCK | GPIO18 | SPI clock |
| MicroSD module | MISO | GPIO19 | SPI MISO |
| MicroSD module | MOSI | GPIO23 | SPI MOSI |
| MicroSD module | VCC | 3.3V | Use a 3.3V-safe module |
| MicroSD module | GND | GND | Common ground |

### Conflict check

- No runtime GPIO conflict exists in this layout, but `GPIO5` is a boot strapping pin.
- LCD and DS3231 correctly share one I2C bus.
- AS608 stays isolated on UART2.
- MicroSD uses a clean SPI group, but some SD modules can hold `GPIO5` in a way that blocks flashing.
- If upload fails with `Wrong boot mode detected`, disconnect the MicroSD module during upload or move its CS pin to a non-strapping GPIO.

## Required Libraries

PlatformIO `lib_deps`:

- `bblanchon/ArduinoJson`
- `marcoschwartz/LiquidCrystal_I2C`
- `adafruit/Adafruit Fingerprint Sensor Library`
- `adafruit/RTClib`

Built-in ESP32/Arduino libraries used:

- `WiFi`
- `HTTPClient`
- `WiFiClientSecure`
- `Preferences`
- `LittleFS`
- `SPI`
- `SD`
- `Wire`

## Firmware Structure

- `src/main.cpp`: menu flow and app orchestration
- `src/ButtonInput.*`: debounced button handling
- `src/DisplayManager.*`: LCD output
- `src/FingerprintManager.*`: AS608 scan and enrollment
- `src/StorageManager.*`: `Preferences`, `LittleFS`, optional `MicroSD`
- `src/WifiManager.*`: Wi-Fi session control
- `src/TimeManager.*`: NTP plus optional DS3231 support
- `src/BackendClient.*`: HTTPS JSON requests
- `src/AttendanceManager.*`: duplicate guard and record creation

## Menu Flow

### Boot

1. Start LCD, buttons, LEDs, buzzer, storage, Wi-Fi manager, and time manager.
2. Initialize the AS608.
3. Load the paired event from `Preferences`.
4. Show the main menu.

### Main menu

- Pair Event
- Enroll Student
- Attendance Mode
- Sync Records
- Wi-Fi Setup

### Pair Event

1. Turn on Wi-Fi.
2. Sync time by NTP if possible.
3. Fetch the latest pairable event from the backend.
4. Show the event title on the LCD.
5. Confirm with `SELECT`.
6. Save the event locally.
7. Keep the previous event if the fetch fails.

### Wi-Fi Setup

1. Open `Wi-Fi Setup` from the device menu.
2. Join the temporary AP shown on the LCD.
3. A captive portal should open automatically.
4. If it does not, browse to `http://192.168.4.1`.
5. Enter the Wi-Fi SSID and password.
6. The module saves the credentials and closes the AP after a successful connection.

### Enroll Student

1. Turn on Wi-Fi.
2. Fetch pending fingerprint enrollments.
3. Browse students with `UP` and `DOWN`.
4. Press `SELECT` to enroll.
5. Capture two scans on the AS608.
6. Store the template in the sensor.
7. Save the mapping locally.
8. Try to upload the enrollment immediately.
9. If upload fails, keep the mapping locally and retry on the next sync.

### Attendance Mode

1. Works even without Wi-Fi.
2. Device polls the AS608 continuously.
3. On a match, find the student from the local template map.
4. Block duplicate attendance for the same `eventId + studentUid`.
5. Save a local attendance record.
6. Success uses green LED plus success buzzer.
7. Duplicate uses warning buzzer.
8. Unknown fingerprint uses red LED plus error buzzer.

### Sync Records

1. Turn on Wi-Fi.
2. Sync time via NTP.
3. Upload unsynced enrollments first.
4. Upload unsynced attendance in batches.
5. Mark uploaded or remote-duplicate records as synced.
6. Keep failed records for later retry.

## Duplicate Attendance Prevention

The firmware prevents duplicates in two layers:

### Local

- Before saving a new attendance record, the firmware checks local storage for the same `eventId` and `studentUid`.
- If found, it shows `Already Recorded` and does not save another record.

### Remote

- On sync, attendance should be written to `events/{eventId}/attendance/{studentUid}`.
- Because the document ID is the student UID, the backend can easily reject duplicates.
- When the backend responds with `duplicate`, the device marks the local record as synced so it stops retrying.

## Offline Sync Logic

### Local storage

- `Preferences`
  - paired event details
  - last known valid epoch time
- `LittleFS`
  - pending students cache
  - fingerprint template mappings
  - attendance queue
- `MicroSD` optional
  - CSV audit backup

### Offline attendance

- Fingerprint matching still works because templates live in the AS608.
- Student identity is resolved from the local template map.
- Attendance is queued locally in `LittleFS`.
- If `DS3231` exists, timestamps use RTC time.
- If RTC is absent, the device uses the last known NTP time and estimates forward.

## Recommended Firebase / Firestore Structure

Existing web app collections already used:

- `profiles/{uid}`
- `events/{eventId}`
- `events/{eventId}/attendance/{studentUid}`

Recommended device-side additions:

### `devices/{deviceId}`

```json
{
  "name": "Portable Attendance 01",
  "enabled": true,
  "secret": "LONG_RANDOM_DEVICE_SECRET",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "lastSeenAt": "serverTimestamp"
}
```

### `devicePairings/{deviceId}`

```json
{
  "deviceId": "campus-portable-01",
  "eventId": "abc123",
  "eventTitle": "Engineering Council Assembly",
  "status": "paired",
  "pairedAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### `fingerprintEnrollments/{studentUid}`

Pending:

```json
{
  "studentUid": "uid123",
  "schoolId": "23209455",
  "studentName": "Juan Dela Cruz",
  "course": "Computer Engineering",
  "year": "3rd Year",
  "status": "pending",
  "templateId": null,
  "deviceId": null,
  "enrolledAt": null,
  "updatedAt": "serverTimestamp"
}
```

After enrollment:

```json
{
  "studentUid": "uid123",
  "schoolId": "23209455",
  "studentName": "Juan Dela Cruz",
  "course": "Computer Engineering",
  "year": "3rd Year",
  "status": "enrolled",
  "templateId": 12,
  "deviceId": "campus-portable-01",
  "enrolledAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### `events/{eventId}/attendance/{studentUid}`

Suggested fields written by the portable module:

```json
{
  "uid": "uid123",
  "studentUid": "uid123",
  "schoolId": "23209455",
  "studentName": "Juan Dela Cruz",
  "course": "Computer Engineering",
  "year": "3rd Year",
  "status": "Present",
  "source": "portableModule",
  "deviceId": "campus-portable-01",
  "templateId": 12,
  "capturedAtEpoch": 1775012345,
  "capturedAtIso": "2026-04-01T03:12:25Z",
  "timeSource": "rtc",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## Backend Contract Expected by the Firmware

The firmware expects device-scoped HTTPS endpoints instead of direct Firestore access from the ESP32. This keeps the module limited to only the reads and writes it needs.

Expected endpoints:

- `GET /campusDeviceLatestEvent`
- `POST /campusDeviceConfirmPairing`
- `GET /campusDevicePendingEnrollments?limit=20`
- `POST /campusDeviceSubmitEnrollment`
- `POST /campusDeviceSyncAttendance`

Required headers:

- `X-Device-Id`
- `X-Device-Secret`

Example latest event response:

```json
{
  "event": {
    "eventId": "abc123",
    "title": "Engineering Council Assembly",
    "date": "2026-04-12",
    "scheduledTime": "1:00 PM",
    "location": "UC LLM Gym",
    "status": "upcoming"
  }
}
```

Example pending enrollments response:

```json
{
  "students": [
    {
      "studentUid": "uid123",
      "schoolId": "23209455",
      "studentName": "Juan Dela Cruz",
      "course": "Computer Engineering",
      "year": "3rd Year"
    }
  ]
}
```

Example attendance sync request:

```json
{
  "records": [
    {
      "recordId": "campus-portable-01-1775012345-0",
      "eventId": "abc123",
      "eventTitle": "Engineering Council Assembly",
      "studentUid": "uid123",
      "schoolId": "23209455",
      "studentName": "Juan Dela Cruz",
      "course": "Computer Engineering",
      "year": "3rd Year",
      "templateId": 12,
      "deviceId": "campus-portable-01",
      "capturedAtEpoch": 1775012345,
      "capturedAtIso": "2026-04-01T03:12:25Z",
      "timeSource": "rtc"
    }
  ]
}
```

Possible result statuses:

- `uploaded`
- `duplicate`
- `failed`

## Setup Instructions

1. Open `src/Config.h`.
2. Replace:
   - `kDeviceId`
   - `kDeviceSecret`
3. Optional:
   - keep `kWifiSsid` and `kWifiPassword` as fallback defaults, or
   - leave them as placeholders and use `Wi-Fi Setup` on the device.
4. Wire the ESP32 using the final pinout above.
5. Register the device in Firestore as `devices/{deviceId}` with fields:
   - `name`
   - `enabled: true`
   - `secret`
6. Build with the `esp32dev` environment in PlatformIO.
7. Upload and monitor at `115200`.

For this repo's Firebase project, `kApiBaseUrl` already points to:

```txt
https://asia-southeast1-campus-27dd9.cloudfunctions.net
```

Cloud Functions to deploy from the web app project:

- `campusDeviceLatestEvent`
- `campusDeviceConfirmPairing`
- `campusDevicePendingEnrollments`
- `campusDeviceSubmitEnrollment`
- `campusDeviceSyncAttendance`

If the ESP32 does not enter download mode automatically:

1. Disconnect the MicroSD module first if it is wired to `GPIO5`.
2. Hold the `BOOT` button on the ESP32.
3. Start the upload from PlatformIO.
4. Release `BOOT` when the console shows `Connecting...`.
5. If it still fails, press `EN` once while still holding `BOOT`, then release `BOOT` after the connection starts.

## RTC and MicroSD Notes

### If you use DS3231

- Recommended for the thesis module.
- Best for accurate offline timestamps.
- The firmware automatically prefers RTC time.

### If you skip DS3231

- Attendance still works.
- Time depends on the last successful NTP sync.
- Long power losses can reduce timestamp accuracy.
- Set `-D CAMPUS_USE_RTC=0` in `platformio.ini` if you want RTC support compiled out.

### If you use MicroSD

- Recommended for extra audit protection.
- Every saved attendance record can also be appended to CSV.
- Helpful for recovery and thesis demonstration.

### If you skip MicroSD

- The module still works fully with `LittleFS`.
- Simpler wiring and lower power draw.
- Set `-D CAMPUS_USE_SD=0` in `platformio.ini` if you want SD support compiled out.

## Stability and Power Notes

- Use a reliable 5V power bank or regulator.
- Keep all grounds common.
- If the buzzer is strong or noisy, drive it through a transistor.
- If you see brownouts during Wi-Fi or fingerprint capture, add bulk capacitance near the ESP32.
- Secure the AS608 UART wires well because loose serial lines create intermittent failures.
