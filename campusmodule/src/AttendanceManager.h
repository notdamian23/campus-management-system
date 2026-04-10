#pragma once

#include <Arduino.h>

#include "AppTypes.h"

class StorageManager;
class TimeManager;

enum class AttendanceAction : uint8_t {
  TimeIn,
  TimeOut,
};

enum class AttendanceOutcome : uint8_t {
  TimeInRecorded,
  TimeOutRecorded,
  DuplicateTimeIn,
  DuplicateTimeOut,
  MissingTimeIn,
  NoPairedEvent,
  StorageError,
};

class AttendanceManager {
 public:
  AttendanceManager(StorageManager &storage, TimeManager &clock);

  bool canStudentTimeIn(const String &studentId, const String &eventId,
                        String &message) const;
  bool canStudentTimeOut(const String &studentId, const String &eventId,
                         String &message) const;
  AttendanceOutcome recordTimeIn(const EventInfo &event, const StudentInfo &student,
                                 int templateId, AttendanceRecord &record,
                                 String &message);
  AttendanceOutcome recordTimeOut(const EventInfo &event,
                                  const StudentInfo &student, int templateId,
                                  AttendanceRecord &record, String &message);
  void updateAttendanceStatus(AttendanceRecord &record) const;

 private:
  AttendanceOutcome saveAttendanceAction(AttendanceAction action,
                                         const EventInfo &event,
                                         const StudentInfo &student,
                                         int templateId,
                                         AttendanceRecord &record,
                                         String &message);
  String nextRecordId(const EventInfo &event, const StudentInfo &student) const;

  StorageManager &storage_;
  TimeManager &clock_;
};
