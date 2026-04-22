#pragma once

#include <Arduino.h>

#include <vector>

#include "../../../src/AppTypes.h"

namespace CampusEligibility {

struct EventEligibilityDecision {
  bool allowed = false;
  bool targetModeSpecific = false;
  bool broadAudienceMode = false;
  bool matchedTargetedStudent = false;
  bool matchedTargetedSchoolId = false;
  bool matchedPairedRoster = false;
  bool usedBroadAudienceFilters = false;
  bool usedPairedRosterFallback = false;
  bool blockedByInactive = false;
  bool blockedByPrereg = false;
  bool blockedByPayment = false;
  bool blockedByBodScope = false;
  bool blockedByCourse = false;
  bool blockedByYearLevel = false;
  bool blockedBySection = false;
  bool stalePairedEventData = false;
  String normalizedStudentCourse;
  String normalizedStudentYearLevel;
  String normalizedStudentSection;
  String eventCourseFilter;
  String eventYearLevelFilter;
  String eventSectionFilter;
  String finalReason;
};

String trimAndCollapseWhitespace(const String &value);
String normalizeCourse(const String &value);
String normalizeYearLevel(const String &value);
String normalizeSection(const String &value);
String normalizeScope(const String &value);
String normalizeTargetMode(const String &value);
String joinCanonicalList(const std::vector<String> &values);
size_t targetedStudentCount(const EventInfo &event);
bool isSpecificStudentsMode(const EventInfo &event);
bool hasBroadAudienceFilters(const EventInfo &event);
bool requiresPairedStudentContext(const EventInfo &event);
void normalizeStudent(StudentInfo &student);
void normalizeEvent(EventInfo &event);
EventEligibilityDecision evaluateStudentForEvent(
    const EventInfo &event, const std::vector<StudentInfo> &pairedStudents,
    const StudentInfo &student);
String rejectionTitle(const EventEligibilityDecision &decision);
String rejectionDetail(const EventEligibilityDecision &decision);

}  // namespace CampusEligibility
