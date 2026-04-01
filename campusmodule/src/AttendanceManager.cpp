#include "AttendanceManager.h"

#include "StorageManager.h"
#include "TimeManager.h"

AttendanceManager::AttendanceManager(StorageManager &storage, TimeManager &clock)
    : storage_(storage), clock_(clock) {}

AttendanceOutcome AttendanceManager::recordAttendance(
    const EventInfo &event, const StudentInfo &student, int templateId,
    AttendanceRecord &record, String &message) {
  if (!event.isValid()) {
    message = "No paired event";
    return AttendanceOutcome::NoPairedEvent;
  }

  if (storage_.isDuplicateAttendance(event.eventId, student.studentUid)) {
    message = "Already recorded";
    return AttendanceOutcome::Duplicate;
  }

  const TimeSnapshot timestamp = clock_.now();
  record.recordId = nextRecordId(timestamp.epoch);
  record.eventId = event.eventId;
  record.eventTitle = event.title;
  record.studentUid = student.studentUid;
  record.schoolId = student.schoolId;
  record.studentName = student.studentName;
  record.course = student.course;
  record.year = student.year;
  record.templateId = templateId;
  record.deviceId = storage_.deviceId();
  record.capturedAtEpoch = timestamp.epoch;
  record.capturedAtIso = timestamp.iso8601;
  record.timeSource = timestamp.source;
  record.synced = false;
  record.remoteDuplicate = false;
  record.syncError = "";
  record.retryCount = 0;

  if (!storage_.appendAttendanceRecord(record)) {
    message = "Storage failed";
    return AttendanceOutcome::StorageError;
  }

  message = "Attendance saved";
  return AttendanceOutcome::Recorded;
}

String AttendanceManager::nextRecordId(uint64_t epoch) {
  String recordId = storage_.deviceId();
  recordId += "-";
  recordId += String(epoch > 0 ? epoch : (millis() / 1000UL));
  recordId += "-";
  recordId += String(sequence_++);
  return recordId;
}
