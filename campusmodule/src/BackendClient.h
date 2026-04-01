#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#include "AppTypes.h"

class BackendClient {
 public:
  bool fetchLatestEvent(EventInfo &event, String &error);
  bool confirmPairing(const EventInfo &event, String &error);
  bool fetchPendingEnrollments(std::vector<StudentInfo> &students, String &error);
  bool submitEnrollment(const StudentInfo &student, String &error);
  bool syncAttendance(const std::vector<AttendanceRecord> &records,
                      std::vector<SyncItemResult> &results, String &error);

 private:
  bool requestJson(const char *method, const String &path, const String *body,
                   DynamicJsonDocument &response, String &error);
};
