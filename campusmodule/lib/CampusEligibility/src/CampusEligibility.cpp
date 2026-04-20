#include "CampusEligibility.h"

#include <ctype.h>

#include <algorithm>

namespace CampusEligibility {
namespace {

String trimAndLower(const String &value) {
  String output = trimAndCollapseWhitespace(value);
  output.toLowerCase();
  return output;
}

String normalizeCompactToken(const String &value) {
  String output = trimAndLower(value);
  String compact;
  compact.reserve(output.length());
  for (size_t i = 0; i < output.length(); ++i) {
    const char current = output[i];
    if (isalnum(static_cast<unsigned char>(current))) {
      compact += current;
    }
  }
  return compact;
}

void addUnique(std::vector<String> &values, const String &value) {
  if (value.isEmpty()) {
    return;
  }
  for (const auto &entry : values) {
    if (entry == value) {
      return;
    }
  }
  values.push_back(value);
}

void splitCanonicalTokens(const String &rawValue,
                          String (*normalizer)(const String &),
                          std::vector<String> &outValues) {
  String remaining = rawValue;
  remaining.replace("|", ",");
  remaining.replace(";", ",");
  int start = 0;
  while (start <= remaining.length()) {
    const int comma = remaining.indexOf(',', start);
    const String part =
        comma >= 0 ? remaining.substring(start, comma) : remaining.substring(start);
    addUnique(outValues, normalizer(part));
    if (comma < 0) {
      break;
    }
    start = comma + 1;
  }
}

bool vectorContains(const std::vector<String> &values, const String &target) {
  if (target.isEmpty()) {
    return false;
  }
  for (const auto &value : values) {
    if (value == target) {
      return true;
    }
  }
  return false;
}

bool rosterContainsStudent(const std::vector<StudentInfo> &pairedStudents,
                           const String &studentUid) {
  if (studentUid.isEmpty()) {
    return false;
  }
  for (const auto &candidate : pairedStudents) {
    if (candidate.studentUid == studentUid) {
      return true;
    }
  }
  return false;
}

bool matchesFilterList(const std::vector<String> &filters, const String &value) {
  if (filters.empty()) {
    return true;
  }
  if (value.isEmpty()) {
    return false;
  }
  return vectorContains(filters, value);
}

bool isTruthyToken(const String &value) {
  const String token = normalizeCompactToken(value);
  return token == "1" || token == "true" || token == "yes" || token == "y" ||
         token == "allowed" || token == "active" || token == "paid" ||
         token == "complete" || token == "completed" || token == "approved" ||
         token == "registered" || token == "enrolled";
}

bool isFalsyToken(const String &value) {
  const String token = normalizeCompactToken(value);
  return token == "0" || token == "false" || token == "no" || token == "n" ||
         token == "inactive" || token == "blocked" || token == "rejected" ||
         token == "unpaid" || token == "pending" || token == "declined" ||
         token == "disabled";
}

void normalizeStringVector(std::vector<String> &values,
                           String (*normalizer)(const String &)) {
  std::vector<String> normalized;
  normalized.reserve(values.size());
  for (const auto &value : values) {
    addUnique(normalized, normalizer(value));
  }
  values = normalized;
}

bool applyRestrictionChecks(const EventInfo &event, const StudentInfo &student,
                            EventEligibilityDecision &decision) {
  if (student.activeKnown && !student.isActive) {
    decision.blockedByInactive = true;
    decision.finalReason = "student_inactive";
    return false;
  }

  if (!event.bodScopeCanonical.isEmpty()) {
    if (student.bodScopeCanonical.isEmpty()) {
      decision.blockedByBodScope = true;
      decision.finalReason = "bod_scope_unknown";
      return false;
    }
    if (student.bodScopeCanonical != event.bodScopeCanonical) {
      decision.blockedByBodScope = true;
      decision.finalReason = "bod_scope_mismatch";
      return false;
    }
  }

  if (event.preregistrationRequired) {
    if (!student.preregisteredKnown) {
      decision.blockedByPrereg = true;
      decision.finalReason = "preregistration_status_unknown";
      return false;
    }
    if (!student.preregistered) {
      decision.blockedByPrereg = true;
      decision.finalReason = "preregistration_required";
      return false;
    }
  }

  if (event.paymentRequired) {
    if (!student.paymentKnown) {
      decision.blockedByPayment = true;
      decision.finalReason = "payment_status_unknown";
      return false;
    }
    if (!student.paymentSatisfied) {
      decision.blockedByPayment = true;
      decision.finalReason = "payment_required";
      return false;
    }
  }

  return true;
}

}  // namespace

String trimAndCollapseWhitespace(const String &value) {
  String output;
  output.reserve(value.length());
  bool previousWasWhitespace = true;
  for (size_t i = 0; i < value.length(); ++i) {
    const char current = value[i];
    const bool isWhitespace =
        current == ' ' || current == '\t' || current == '\n' || current == '\r';
    if (isWhitespace) {
      if (!previousWasWhitespace) {
        output += ' ';
      }
    } else {
      output += current;
    }
    previousWasWhitespace = isWhitespace;
  }
  output.trim();
  return output;
}

String normalizeCourse(const String &value) {
  const String compact = normalizeCompactToken(value);
  if (compact.isEmpty()) {
    return "";
  }

  if (compact == "cpe" || compact == "cpeng" || compact == "bscpe" ||
      compact == "computerengineering" || compact == "bscomputerengineering") {
    return "cpe";
  }

  if (compact == "me" || compact == "bsme" ||
      compact == "mechanicalengineering" || compact == "bsmechanicalengineering") {
    return "me";
  }

  if (compact == "ee" || compact == "bsee" ||
      compact == "electricalengineering" || compact == "bselectricalengineering") {
    return "ee";
  }

  if (compact == "ece" || compact == "bsece" ||
      compact == "electronicsengineering" ||
      compact == "bselectronicsengineering") {
    return "ece";
  }

  if (compact == "ce" || compact == "bsce" || compact == "civilengineering" ||
      compact == "bscivilengineering") {
    return "ce";
  }

  if (compact == "cs" || compact == "bscs" || compact == "computerscience" ||
      compact == "bscomputerscience") {
    return "cs";
  }

  if (compact == "it" || compact == "bsit" || compact == "informationtechnology" ||
      compact == "bsinformationtechnology") {
    return "it";
  }

  return compact;
}

String normalizeYearLevel(const String &value) {
  String compact = normalizeCompactToken(value);
  if (compact.isEmpty()) {
    return "";
  }

  if (compact.indexOf("first") >= 0 || compact == "freshman") {
    compact = "1";
  } else if (compact.indexOf("second") >= 0 || compact == "sophomore") {
    compact = "2";
  } else if (compact.indexOf("third") >= 0 || compact == "junior") {
    compact = "3";
  } else if (compact.indexOf("fourth") >= 0 || compact == "senior") {
    compact = "4";
  } else if (compact.indexOf("fifth") >= 0) {
    compact = "5";
  } else if (compact.indexOf("sixth") >= 0) {
    compact = "6";
  }

  String digits;
  digits.reserve(compact.length());
  for (size_t i = 0; i < compact.length(); ++i) {
    const char current = compact[i];
    if (isdigit(static_cast<unsigned char>(current))) {
      digits += current;
    }
  }

  return digits.isEmpty() ? compact : digits;
}

String normalizeSection(const String &value) {
  String output = trimAndCollapseWhitespace(value);
  output.toUpperCase();
  return output;
}

String normalizeScope(const String &value) {
  return normalizeCompactToken(value);
}

String normalizeTargetMode(const String &value) {
  const String compact = normalizeCompactToken(value);
  if (compact.isEmpty()) {
    return "";
  }

  if (compact == "specificstudents" || compact == "specificstudent" ||
      compact == "specific" || compact == "selectedstudents" ||
      compact == "selectedstudent") {
    return "specificStudents";
  }

  if (compact == "broad" || compact == "general" || compact == "allaudience" ||
      compact == "allstudents" || compact == "filters" ||
      compact == "generalaudience") {
    return "broad";
  }

  return compact;
}

String joinCanonicalList(const std::vector<String> &values) {
  String output;
  for (size_t i = 0; i < values.size(); ++i) {
    if (i > 0) {
      output += ",";
    }
    output += values[i];
  }
  return output;
}

size_t targetedStudentCount(const EventInfo &event) {
  return event.targetedStudentIds.size();
}

bool isSpecificStudentsMode(const EventInfo &event) {
  return normalizeTargetMode(event.targetMode) == "specificStudents" ||
         !event.targetedStudentIds.empty();
}

bool hasBroadAudienceFilters(const EventInfo &event) {
  return !event.courseFilters.empty() || !event.yearLevelFilters.empty() ||
         !event.sectionFilters.empty();
}

void normalizeStudent(StudentInfo &student) {
  student.studentUid = trimAndCollapseWhitespace(student.studentUid);
  student.schoolId = trimAndCollapseWhitespace(student.schoolId);
  student.studentName = trimAndCollapseWhitespace(student.studentName);
  student.course = trimAndCollapseWhitespace(student.course);
  student.yearLevel = trimAndCollapseWhitespace(student.yearLevel);
  student.section = trimAndCollapseWhitespace(student.section);
  student.bodScope = trimAndCollapseWhitespace(student.bodScope);

  const String sourceCourse =
      !student.courseCanonical.isEmpty() ? student.courseCanonical : student.course;
  const String sourceYear = !student.yearLevelCanonical.isEmpty()
                                ? student.yearLevelCanonical
                                : student.yearLevel;
  const String sourceSection =
      !student.sectionCanonical.isEmpty() ? student.sectionCanonical : student.section;
  const String sourceBod =
      !student.bodScopeCanonical.isEmpty() ? student.bodScopeCanonical : student.bodScope;

  student.courseCanonical = normalizeCourse(sourceCourse);
  student.yearLevelCanonical = normalizeYearLevel(sourceYear);
  student.sectionCanonical = normalizeSection(sourceSection);
  student.bodScopeCanonical = normalizeScope(sourceBod);
}

void normalizeEvent(EventInfo &event) {
  event.eventId = trimAndCollapseWhitespace(event.eventId);
  event.title = trimAndCollapseWhitespace(event.title);
  event.location = trimAndCollapseWhitespace(event.location);
  event.targetMode = normalizeTargetMode(event.targetMode);
  event.courseFilterLabel = trimAndCollapseWhitespace(event.courseFilterLabel);
  event.yearLevelFilterLabel = trimAndCollapseWhitespace(event.yearLevelFilterLabel);
  event.sectionFilterLabel = trimAndCollapseWhitespace(event.sectionFilterLabel);
  event.bodScope = trimAndCollapseWhitespace(event.bodScope);

  if (!event.courseFilterLabel.isEmpty()) {
    splitCanonicalTokens(event.courseFilterLabel, normalizeCourse, event.courseFilters);
  }
  if (!event.yearLevelFilterLabel.isEmpty()) {
    splitCanonicalTokens(event.yearLevelFilterLabel, normalizeYearLevel,
                         event.yearLevelFilters);
  }
  if (!event.sectionFilterLabel.isEmpty()) {
    splitCanonicalTokens(event.sectionFilterLabel, normalizeSection,
                         event.sectionFilters);
  }

  normalizeStringVector(event.courseFilters, normalizeCourse);
  normalizeStringVector(event.yearLevelFilters, normalizeYearLevel);
  normalizeStringVector(event.sectionFilters, normalizeSection);
  normalizeStringVector(event.targetedStudentIds, trimAndCollapseWhitespace);

  if (!event.bodScopeCanonical.isEmpty()) {
    event.bodScopeCanonical = normalizeScope(event.bodScopeCanonical);
  } else {
    event.bodScopeCanonical = normalizeScope(event.bodScope);
  }

  if (event.preregistrationRequired) {
    event.requiresRegistration = true;
  }
  if (event.requiresRegistration) {
    event.preregistrationRequired = true;
  }

  if (event.targetMode.isEmpty()) {
    if (!event.targetedStudentIds.empty()) {
      event.targetMode = "specificStudents";
    } else if (hasBroadAudienceFilters(event)) {
      event.targetMode = "broad";
    }
  }
}

EventEligibilityDecision evaluateStudentForEvent(
    const EventInfo &event, const std::vector<StudentInfo> &pairedStudents,
    const StudentInfo &student) {
  EventInfo normalizedEvent = event;
  StudentInfo normalizedStudent = student;
  normalizeEvent(normalizedEvent);
  normalizeStudent(normalizedStudent);

  EventEligibilityDecision decision;
  decision.targetModeSpecific = isSpecificStudentsMode(normalizedEvent);
  decision.broadAudienceMode = !decision.targetModeSpecific;
  decision.normalizedStudentCourse = normalizedStudent.courseCanonical;
  decision.normalizedStudentYearLevel = normalizedStudent.yearLevelCanonical;
  decision.normalizedStudentSection = normalizedStudent.sectionCanonical;
  decision.eventCourseFilter = joinCanonicalList(normalizedEvent.courseFilters);
  decision.eventYearLevelFilter = joinCanonicalList(normalizedEvent.yearLevelFilters);
  decision.eventSectionFilter = joinCanonicalList(normalizedEvent.sectionFilters);
  decision.matchedPairedRoster =
      rosterContainsStudent(pairedStudents, normalizedStudent.studentUid);
  decision.matchedTargetedStudent =
      vectorContains(normalizedEvent.targetedStudentIds, normalizedStudent.studentUid);

  if (decision.targetModeSpecific) {
    if (!decision.matchedTargetedStudent && !decision.matchedPairedRoster) {
      decision.finalReason = "student_not_in_targeted_students";
      return decision;
    }

    if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
      return decision;
    }

    decision.allowed = true;
    if (decision.finalReason.isEmpty()) {
      decision.finalReason =
          decision.matchedTargetedStudent ? "matched_targeted_student"
                                          : "matched_specific_roster";
    }
    return decision;
  }

  const bool hasFilters = hasBroadAudienceFilters(normalizedEvent);
  if (hasFilters) {
    decision.usedBroadAudienceFilters = true;
    const bool courseMatch =
        matchesFilterList(normalizedEvent.courseFilters, normalizedStudent.courseCanonical);
    const bool yearMatch = matchesFilterList(normalizedEvent.yearLevelFilters,
                                             normalizedStudent.yearLevelCanonical);
    const bool sectionMatch = matchesFilterList(normalizedEvent.sectionFilters,
                                                normalizedStudent.sectionCanonical);

    decision.blockedByCourse = !courseMatch;
    decision.blockedByYearLevel = !yearMatch;
    decision.blockedBySection = !sectionMatch;

    if (!courseMatch) {
      decision.finalReason = "course_mismatch";
      return decision;
    }
    if (!yearMatch) {
      decision.finalReason = "year_level_mismatch";
      return decision;
    }
    if (!sectionMatch) {
      decision.finalReason = "section_mismatch";
      return decision;
    }

    if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
      return decision;
    }

    decision.allowed = true;
    decision.finalReason = "matched_broad_audience_filters";
    return decision;
  }

  if (decision.matchedPairedRoster) {
    if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
      return decision;
    }

    decision.allowed = true;
    decision.usedPairedRosterFallback = true;
    decision.finalReason = "matched_paired_roster_fallback";
    return decision;
  }

  decision.stalePairedEventData = true;
  decision.finalReason = "student_missing_from_broad_audience_roster";
  return decision;
}

String rejectionTitle(const EventEligibilityDecision &decision) {
  if (decision.blockedByInactive) {
    return "INACTIVE";
  }
  if (decision.blockedByPrereg) {
    return "PREREG REQUIRED";
  }
  if (decision.blockedByPayment) {
    return "PAYMENT REQUIRED";
  }
  if (decision.blockedByBodScope) {
    return "BOD RESTRICTED";
  }
  if (decision.blockedBySection) {
    return "SECTION MISMATCH";
  }
  return "NOT INCLUDED";
}

String rejectionDetail(const EventEligibilityDecision &decision) {
  if (decision.finalReason == "course_mismatch") {
    return "Course mismatch";
  }
  if (decision.finalReason == "year_level_mismatch") {
    return "Year mismatch";
  }
  if (decision.finalReason == "section_mismatch") {
    return "Section mismatch";
  }
  if (decision.finalReason == "student_not_in_targeted_students") {
    return "Not targeted";
  }
  if (decision.finalReason == "student_inactive") {
    return "Account inactive";
  }
  if (decision.finalReason == "preregistration_required") {
    return "Pre-reg required";
  }
  if (decision.finalReason == "preregistration_status_unknown") {
    return "Pre-reg unknown";
  }
  if (decision.finalReason == "payment_required") {
    return "Payment required";
  }
  if (decision.finalReason == "payment_status_unknown") {
    return "Payment unknown";
  }
  if (decision.finalReason == "bod_scope_mismatch") {
    return "Scope mismatch";
  }
  if (decision.finalReason == "bod_scope_unknown") {
    return "Scope unknown";
  }
  if (decision.stalePairedEventData) {
    return "Refresh event";
  }
  return "See operator";
}

}  // namespace CampusEligibility
