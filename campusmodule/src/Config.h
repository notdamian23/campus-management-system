#pragma once

#ifndef CAMPUS_USE_RTC
#define CAMPUS_USE_RTC 1
#endif

#ifndef CAMPUS_USE_SD
#define CAMPUS_USE_SD 1
#endif

namespace CampusConfig {
inline constexpr uint8_t kLcdColumns = 20;
inline constexpr uint8_t kLcdRows = 4;

inline constexpr char kWifiSsid[] = "REPLACE_WITH_WIFI_SSID";
inline constexpr char kWifiPassword[] = "REPLACE_WITH_WIFI_PASSWORD";
inline constexpr char kSetupApPrefix[] = "CAMPUS-Setup";

inline constexpr char kApiBaseUrl[] =
    "https://asia-southeast1-campus-27dd9.cloudfunctions.net";
inline constexpr char kDeviceId[] = "campus-portable-01";
inline constexpr char kDeviceSecret[] = "portable01_secret_2026";

inline constexpr char kNtpServerPrimary[] = "time.google.com";
inline constexpr char kNtpServerSecondary[] = "pool.ntp.org";

inline constexpr uint32_t kWifiTimeoutMs = 15000;
inline constexpr uint32_t kHttpTimeoutMs = 15000;
inline constexpr uint32_t kEnrollmentTimeoutMs = 20000;
inline constexpr uint32_t kAttendancePollMs = 180;
inline constexpr uint32_t kMessageHoldMs = 1200;
inline constexpr uint32_t kSetupPortalTimeoutMs = 5UL * 60UL * 1000UL;
inline constexpr uint16_t kPendingEnrollmentLimit = 20;
inline constexpr uint16_t kSyncBatchSize = 20;
inline constexpr uint16_t kFingerprintFirstTemplateId = 1;
inline constexpr uint16_t kFingerprintLastTemplateId = 127;
inline constexpr long kUtcOffsetSeconds = 8L * 60L * 60L;

inline constexpr bool kUseRtc = CAMPUS_USE_RTC == 1;
inline constexpr bool kUseSd = CAMPUS_USE_SD == 1;
}  // namespace CampusConfig
