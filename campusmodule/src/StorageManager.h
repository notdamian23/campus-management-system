#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <vector>

#include "AppTypes.h"

class StorageManager {
 public:
  bool begin();

  EventInfo loadPairedEvent() const;
  bool savePairedEvent(const EventInfo &event);
  bool savePairedEventContext(const EventInfo &event,
                              const std::vector<StudentInfo> &students,
                              const std::vector<String> &recordedStudentIds);
  bool loadPairedEventContext(EventInfo &event,
                              std::vector<StudentInfo> &students,
                              std::vector<String> &recordedStudentIds) const;
  bool isStudentAuthorizedForEvent(const String &eventId,
                                   const String &studentUid) const;
  bool isRemoteAttendanceRecorded(const String &eventId,
                                  const String &studentUid) const;
  bool markRemoteAttendanceRecorded(const String &eventId,
                                    const String &studentUid);

  uint64_t getLastKnownEpoch() const;
  void setLastKnownEpoch(uint64_t epoch);
  String deviceId() const;

  std::vector<StudentInfo> loadPendingStudents() const;
  bool savePendingStudents(const std::vector<StudentInfo> &students);

  std::vector<StudentInfo> loadFingerprintMappings() const;
  bool upsertFingerprintMapping(const StudentInfo &student);
  bool findStudentByTemplate(int templateId, StudentInfo &outStudent) const;
  int nextFreeTemplateId(uint16_t startId, uint16_t endId) const;
  std::vector<StudentInfo> loadUnsyncedEnrollments() const;
  bool markEnrollmentSynced(const String &studentUid);

  std::vector<AttendanceRecord> loadAttendanceRecords() const;
  bool appendAttendanceRecord(const AttendanceRecord &record);
  bool isDuplicateAttendance(const String &eventId, const String &studentUid) const;
  size_t unsyncedAttendanceCount() const;
  bool applySyncResults(const std::vector<SyncItemResult> &results);

 private:
  bool writePendingStudents(const std::vector<StudentInfo> &students) const;
  bool writeFingerprintMappings(const std::vector<StudentInfo> &students) const;
  bool writeAttendanceRecords(const std::vector<AttendanceRecord> &records) const;
  bool writePairedEventContext(const EventInfo &event,
                               const std::vector<StudentInfo> &students,
                               const std::vector<String> &recordedStudentIds) const;
  bool backupAttendanceToSd(const AttendanceRecord &record);

  mutable Preferences prefs_;
  bool prefsReady_ = false;
  bool littleFsReady_ = false;
  bool sdReady_ = false;
};
