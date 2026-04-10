#include "AttendanceManager.h"

#include "StorageManager.h"
#include "TimeManager.h"

namespace {
String sanitizeIdComponent(const String &value) {
  String output = value;
  output.replace(" ", "_");
  output.replace("/", "_");
  output.replace("\\", "_");
  output.replace(":", "_");
  output.replace("|", "_");
  return output;
}
}  // namespace

AttendanceManager::AttendanceManager(StorageManager &storage, TimeManager &clock)
    : storage_(storage), clock_(clock) {}

bool AttendanceManager::canStudentTimeIn(const String &studentId,
                                         const String &eventId,
                                         String &message) const {
  AttendanceRecord existing;
  if (!storage_.findAttendanceRecord(eventId, studentId, existing)) {
    return true;
  }

  if (existing.hasTimeIn()) {
    message = "Duplicate Time in";
    return false;
  }

  return true;
}

bool AttendanceManager::canStudentTimeOut(const String &studentId,
                                          const String &eventId,
                                          String &message) const {
  AttendanceRecord existing;
  if (!storage_.findAttendanceRecord(eventId, studentId, existing) ||
      !existing.hasTimeIn()) {
    message = "No Time in record. Cannot Time out.";
    return false;
  }

  if (existing.hasTimeOut()) {
    message = "Duplicate Time out";
    return false;
  }

  return true;
}

AttendanceOutcome AttendanceManager::recordTimeIn(const EventInfo &event,
                                                  const StudentInfo &student,
                                                  int templateId,
                                                  AttendanceRecord &record,
                                                  String &message) {
  return saveAttendanceAction(AttendanceAction::TimeIn, event, student, templateId,
                              record, message);
}

AttendanceOutcome AttendanceManager::recordTimeOut(const EventInfo &event,
                                                   const StudentInfo &student,
                                                   int templateId,
                                                   AttendanceRecord &record,
                                                   String &message) {
  return saveAttendanceAction(AttendanceAction::TimeOut, event, student, templateId,
                              record, message);
}

void AttendanceManager::updateAttendanceStatus(AttendanceRecord &record) const {
  if (record.hasTimeIn() && record.hasTimeOut()) {
    record.attendanceStatus = "Present";
    return;
  }

  if (record.hasTimeIn()) {
    record.attendanceStatus = "Timed In";
    return;
  }

  record.attendanceStatus = "";
}

AttendanceOutcome AttendanceManager::saveAttendanceAction(
    AttendanceAction action, const EventInfo &event, const StudentInfo &student,
    int templateId, AttendanceRecord &record, String &message) {
  if (!event.isValid()) {
    message = "No paired event";
    return AttendanceOutcome::NoPairedEvent;
  }

  String validationMessage;
  if (action == AttendanceAction::TimeIn &&
      !canStudentTimeIn(student.studentUid, event.eventId, validationMessage)) {
    message = validationMessage;
    return AttendanceOutcome::DuplicateTimeIn;
  }

  if (action == AttendanceAction::TimeOut &&
      !canStudentTimeOut(student.studentUid, event.eventId, validationMessage)) {
    message = validationMessage;
    return validationMessage.startsWith("No Time in")
               ? AttendanceOutcome::MissingTimeIn
               : AttendanceOutcome::DuplicateTimeOut;
  }

  AttendanceRecord existing;
  const bool foundExisting =
      storage_.findAttendanceRecord(event.eventId, student.studentUid, existing);
  record = foundExisting ? existing : AttendanceRecord{};

  const TimeSnapshot timestamp = clock_.now();
  if (record.recordId.isEmpty()) {
    record.recordId = nextRecordId(event, student);
  }

  record.eventId = event.eventId;
  record.eventTitle = event.title;
  record.eventDate = event.date;
  record.scheduledTimeStart = event.scheduledTime;
  record.scheduledTimeEnd = event.scheduledTimeEnd;
  record.eventLocation = event.location;
  record.studentUid = student.studentUid;
  record.schoolId = student.schoolId;
  record.studentName = student.studentName;
  record.course = student.course;
  record.yearLevel = student.yearLevel;
  record.templateId = templateId;
  record.deviceId = storage_.deviceId();
  record.capturedAtEpoch = timestamp.epoch;
  record.capturedAtIso = timestamp.iso8601;
  record.timeSource = timestamp.source;
  record.source = "portable-device";
  record.synced = false;
  record.remoteDuplicate = false;
  record.syncError = "";
  record.retryCount = 0;

  if (action == AttendanceAction::TimeIn) {
    record.timeInEpoch = timestamp.epoch;
    record.timeInIso = timestamp.iso8601;
    record.timeInSource = timestamp.source;
  } else {
    record.timeOutEpoch = timestamp.epoch;
    record.timeOutIso = timestamp.iso8601;
    record.timeOutSource = timestamp.source;
  }

  updateAttendanceStatus(record);

  if (!storage_.upsertAttendanceRecord(record)) {
    message = "Storage failed";
    return AttendanceOutcome::StorageError;
  }

  if (action == AttendanceAction::TimeIn) {
    message = "Time In recorded";
    return AttendanceOutcome::TimeInRecorded;
  }

  message = record.attendanceStatus == "Present" ? "Present" : "Time Out recorded";
  return AttendanceOutcome::TimeOutRecorded;
}

String AttendanceManager::nextRecordId(const EventInfo &event,
                                       const StudentInfo &student) const {
  String recordId = sanitizeIdComponent(storage_.deviceId());
  recordId += "-";
  recordId += sanitizeIdComponent(event.eventId);
  recordId += "-";
  recordId += sanitizeIdComponent(student.studentUid);
  return recordId;
}
