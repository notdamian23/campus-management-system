#pragma once

#include <Arduino.h>

#include "AppTypes.h"

class StorageManager;
class TimeManager;

enum class AttendanceOutcome : uint8_t {
  Recorded,
  Duplicate,
  NoPairedEvent,
  StorageError,
};

class AttendanceManager {
 public:
  AttendanceManager(StorageManager &storage, TimeManager &clock);

  AttendanceOutcome recordAttendance(const EventInfo &event,
                                     const StudentInfo &student, int templateId,
                                     AttendanceRecord &record, String &message);

 private:
  String nextRecordId(uint64_t epoch);

  StorageManager &storage_;
  TimeManager &clock_;
  uint32_t sequence_ = 0;
};
