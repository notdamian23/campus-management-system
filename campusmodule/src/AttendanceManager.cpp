#include "AttendanceManager.h"

#include "Config.h"
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

bool parseTimeText(const String &value, int &hour, int &minute) {
  String text = value;
  text.trim();
  if (text.isEmpty()) {
    return false;
  }

  String upper = text;
  upper.toUpperCase();
  const bool isPm = upper.endsWith("PM");
  const bool isAm = upper.endsWith("AM");
  if (isPm || isAm) {
    upper = upper.substring(0, upper.length() - 2);
    upper.trim();
  }

  const int colonIndex = upper.indexOf(':');
  if (colonIndex < 0) {
    return false;
  }

  hour = upper.substring(0, colonIndex).toInt();
  minute = upper.substring(colonIndex + 1).toInt();
  if (minute < 0 || minute > 59) {
    return false;
  }

  if (isAm || isPm) {
    if (hour < 1 || hour > 12) {
      return false;
    }
    if (isPm && hour < 12) {
      hour += 12;
    }
    if (isAm && hour == 12) {
      hour = 0;
    }
  } else if (hour < 0 || hour > 23) {
    return false;
  }

  return true;
}

bool parseEventDateTime(const String &date, const String &timeText,
                        uint64_t &epoch) {
  int year = 0;
  int month = 0;
  int day = 0;
  if (sscanf(date.c_str(), "%d-%d-%d", &year, &month, &day) != 3) {
    return false;
  }

  int hour = 0;
  int minute = 0;
  if (!parseTimeText(timeText, hour, minute)) {
    return false;
  }

  struct tm tmValue = {};
  tmValue.tm_year = year - 1900;
  tmValue.tm_mon = month - 1;
  tmValue.tm_mday = day;
  tmValue.tm_hour = hour;
  tmValue.tm_min = minute;
  tmValue.tm_sec = 0;

  const time_t localEpoch = mktime(&tmValue);
  if (localEpoch < 0) {
    return false;
  }

  epoch = static_cast<uint64_t>(localEpoch) - CampusConfig::kUtcOffsetSeconds;
  return true;
}
}  // namespace

AttendanceManager::AttendanceManager(StorageManager &storage, TimeManager &clock)
    : storage_(storage), clock_(clock) {}

bool AttendanceManager::canStartTimeIn(const EventInfo &event) const {
  if (!event.isValid() || event.date.isEmpty() || event.scheduledTime.isEmpty()) {
    return true;
  }

  const TimeSnapshot now = clock_.now();
  if (!now.valid) {
    return true;
  }

  uint64_t eventStartEpoch = 0;
  if (!parseEventDateTime(event.date, event.scheduledTime, eventStartEpoch)) {
    return true;
  }

  return now.epoch >= eventStartEpoch;
}

bool AttendanceManager::hasEventEnded(const EventInfo &event) const {
  if (!event.isValid() || event.date.isEmpty() || event.scheduledTimeEnd.isEmpty()) {
    return false;
  }

  const TimeSnapshot now = clock_.now();
  if (!now.valid) {
    return false;
  }

  uint64_t eventEndEpoch = 0;
  if (!parseEventDateTime(event.date, event.scheduledTimeEnd, eventEndEpoch)) {
    return false;
  }

  return now.epoch >= eventEndEpoch;
}

bool AttendanceManager::canStudentTimeIn(const String &studentId,
                                         const String &eventId,
                                         String &message) const {
  AttendanceRecord existing;
  if (!storage_.findAttendanceRecord(eventId, studentId, existing)) {
    return true;
  }

  if (existing.hasTimeOut()) {
    message = "TIME OUT already done. Cannot return to TIME IN";
    return false;
  }

  if (existing.hasTimeIn()) {
    message = "TIME IN already recorded";
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
    message = "No TIME IN record found. Cannot TIME OUT";
    return false;
  }

  if (existing.hasTimeOut()) {
    message = "TIME OUT already recorded";
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

  if (action == AttendanceAction::TimeIn && !canStartTimeIn(event)) {
    message = "TIME IN not allowed yet";
    return AttendanceOutcome::TimeInTooEarly;
  }

  String validationMessage;
  if (action == AttendanceAction::TimeIn &&
      !canStudentTimeIn(student.studentUid, event.eventId, validationMessage)) {
    message = validationMessage;
    return validationMessage.startsWith("TIME OUT already done")
               ? AttendanceOutcome::TimeOutAlreadyDone
               : AttendanceOutcome::DuplicateTimeIn;
  }

  if (action == AttendanceAction::TimeOut &&
      !canStudentTimeOut(student.studentUid, event.eventId, validationMessage)) {
    message = validationMessage;
    return validationMessage.startsWith("No TIME IN")
               ? AttendanceOutcome::MissingTimeIn
               : AttendanceOutcome::DuplicateTimeOut;
  }

  AttendanceRecord existing;
  const bool foundExisting =
      storage_.findAttendanceRecord(event.eventId, student.studentUid, existing);
  if (action == AttendanceAction::TimeIn &&
      (!foundExisting || !existing.hasTimeIn()) && hasEventEnded(event)) {
    message = "TIME IN closed";
    return AttendanceOutcome::TimeInClosed;
  }
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
  record.syncRejected = false;
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
