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
  bool clearPairedEvent();
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

  EnrollmentSessionInfo loadCurrentEnrollmentSession() const;
  bool saveCurrentEnrollmentSession(const EnrollmentSessionInfo &session);
  bool clearCurrentEnrollmentSession();

  std::vector<StudentInfo> loadPendingStudents() const;
  bool savePendingStudents(const std::vector<StudentInfo> &students);

  std::vector<StudentInfo> loadFingerprintMappings() const;
  bool upsertFingerprintMapping(const StudentInfo &student);
  bool findStudentByTemplate(int templateId, StudentInfo &outStudent) const;
  FingerprintTemplateOwnership resolveTemplateOwnership(int templateId) const;
  bool applyCleanupQueueItem(const CleanupQueueItem &item, String &error);
  int nextFreeTemplateId(uint16_t startId, uint16_t endId) const;
  std::vector<StudentInfo> loadUnsyncedEnrollments() const;
  size_t unsyncedEnrollmentCount() const;
  bool markEnrollmentSynced(const String &studentUid);

  std::vector<AttendanceRecord> loadAttendanceRecords() const;
  std::vector<AttendanceRecord> loadUnsyncedAttendanceBatch(size_t limit) const;
  bool appendAttendanceRecord(const AttendanceRecord &record);
  bool upsertAttendanceRecord(const AttendanceRecord &record);
  bool findAttendanceRecord(const String &eventId, const String &studentUid,
                            AttendanceRecord &outRecord) const;
  bool isDuplicateAttendance(const String &eventId, const String &studentUid) const;
  bool hasUnsyncedAttendanceForEvent(const String &eventId) const;
  size_t unsyncedAttendanceCount() const;
  bool applySyncResults(const std::vector<SyncItemResult> &results);
  bool exportAttendanceCsv(const EventInfo &event, const TimeSnapshot &generatedAt,
                           String &path) const;

  bool ensureSdReady();
  bool isSdReady() const;
  bool lastSdWriteSucceeded() const;

 private:
  bool ensurePairedEventContextLoaded() const;
  bool ensurePendingStudentsLoaded() const;
  bool ensureFingerprintMappingsLoaded() const;
  bool ensureEnrollmentSyncQueueLoaded() const;
  bool ensureAttendanceLoaded() const;
  void refreshUnsyncedAttendanceCount() const;
  bool writePendingStudents(const std::vector<StudentInfo> &students) const;
  bool writeFingerprintMappings(const std::vector<StudentInfo> &students) const;
  bool writeStudentList(const char *path, const std::vector<StudentInfo> &students) const;
  bool writeAttendanceRecords(const std::vector<AttendanceRecord> &records) const;
  bool writeCurrentEnrollmentSession(const EnrollmentSessionInfo &session) const;
  bool writePairedEventContext(const EventInfo &event,
                               const std::vector<StudentInfo> &students,
                               const std::vector<String> &recordedStudentIds) const;
  String attendanceExportPath(const String &eventId) const;
  bool updateEnrollmentArtifacts(const StudentInfo &student);
  bool removeFromSyncQueue(const String &studentUid);
  bool saveDeviceConfigSnapshot() const;
  bool backupAttendanceToSd(const AttendanceRecord &record);
  bool mountSdCard();

  mutable Preferences prefs_;
  bool prefsReady_ = false;
  bool littleFsReady_ = false;
  bool sdReady_ = false;
  bool lastSdWriteSucceeded_ = false;

  mutable bool pairedEventContextLoaded_ = false;
  mutable EventInfo pairedEventCache_;
  mutable std::vector<StudentInfo> pairedStudentsCache_;
  mutable std::vector<String> remoteRecordedStudentIdsCache_;

  mutable bool pendingStudentsLoaded_ = false;
  mutable std::vector<StudentInfo> pendingStudentsCache_;

  mutable bool fingerprintMappingsLoaded_ = false;
  mutable std::vector<StudentInfo> fingerprintMappingsCache_;

  mutable bool enrollmentSyncQueueLoaded_ = false;
  mutable std::vector<StudentInfo> enrollmentSyncQueueCache_;

  mutable bool attendanceLoaded_ = false;
  mutable std::vector<AttendanceRecord> attendanceRecordsCache_;
  mutable size_t unsyncedAttendanceCountCache_ = 0;
};
