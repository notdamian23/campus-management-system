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

bool hasSpecificTargetStudentValue(const String &value) {
  const String compact = normalizeCompactToken(value);
  return !compact.isEmpty() && compact != "allstudents" &&
         compact != "allstudent";
}

size_t targetStudentLabelCount(const String &value) {
  if (!hasSpecificTargetStudentValue(value)) {
    return 0;
  }

  size_t count = 0;
  String remaining = trimAndCollapseWhitespace(value);
  int start = 0;
  while (start <= remaining.length()) {
    const int split = remaining.indexOf(';', start);
    const String part =
        split >= 0 ? remaining.substring(start, split) : remaining.substring(start);
    if (!trimAndCollapseWhitespace(part).isEmpty()) {
      ++count;
    }
    if (split < 0) {
      break;
    }
    start = split + 1;
  }

  return count > 0 ? count : 1U;
}

String normalizeLookupText(const String &value) {
  return trimAndLower(value);
}

bool matchesSpecificStudentTarget(const String &targetValue,
                                  const StudentInfo &student) {
  const String rawTarget = trimAndCollapseWhitespace(targetValue);
  if (!hasSpecificTargetStudentValue(rawTarget)) {
    return true;
  }

  const String normalizedSchoolId = normalizeLookupText(student.schoolId);
  const String normalizedStudentName = normalizeLookupText(student.studentName);
  if (normalizedSchoolId.isEmpty() && normalizedStudentName.isEmpty()) {
    return false;
  }

  const String candidateTarget = rawTarget;
  int start = 0;
  while (start <= candidateTarget.length()) {
    const int split = candidateTarget.indexOf(';', start);
    const String part =
        split >= 0 ? candidateTarget.substring(start, split)
                   : candidateTarget.substring(start);
    const String normalized = normalizeLookupText(part);
    String withoutParens = part;
    while (true) {
      const int open = withoutParens.indexOf('(');
      if (open < 0) {
        break;
      }
      const int close = withoutParens.indexOf(')', open);
      if (close < 0) {
        withoutParens.remove(open);
        break;
      }
      withoutParens.remove(open, close - open + 1);
    }
    withoutParens = normalizeLookupText(withoutParens);
    String insideParen;
    const int openParen = part.indexOf('(');
    const int closeParen = part.indexOf(')', openParen + 1);
    if (openParen >= 0 && closeParen > openParen) {
      insideParen =
          normalizeLookupText(part.substring(openParen + 1, closeParen));
    }

    if (!normalizedSchoolId.isEmpty()) {
      if (normalized == normalizedSchoolId || insideParen == normalizedSchoolId ||
          normalized.indexOf(normalizedSchoolId) >= 0) {
        return true;
      }
    }

    if (!normalizedStudentName.isEmpty()) {
      if (normalized == normalizedStudentName ||
          withoutParens == normalizedStudentName ||
          normalized.indexOf(normalizedStudentName) >= 0 ||
          (!withoutParens.isEmpty() &&
           (withoutParens.indexOf(normalizedStudentName) >= 0 ||
            normalizedStudentName.indexOf(withoutParens) >= 0))) {
        return true;
      }
    }

    if (split < 0) {
      break;
    }
    start = split + 1;
  }

  return false;
}

bool rosterContainsStudent(const std::vector<StudentInfo> &pairedStudents,
                           const String &studentUid, const String &schoolId) {
  if (studentUid.isEmpty() && schoolId.isEmpty()) {
    return false;
  }
  for (const auto &candidate : pairedStudents) {
    if ((!studentUid.isEmpty() && candidate.studentUid == studentUid) ||
        (!schoolId.isEmpty() && candidate.schoolId == schoolId)) {
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
  if (event.activeOnly && student.activeKnown && !student.isActive) {
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

void clearRejectionFlags(EventEligibilityDecision &decision) {
  decision.blockedByInactive = false;
  decision.blockedByPrereg = false;
  decision.blockedByPayment = false;
  decision.blockedByBodScope = false;
  decision.blockedByCourse = false;
  decision.blockedByYearLevel = false;
  decision.blockedBySection = false;
  decision.blockedByPairedRoster = false;
  decision.stalePairedEventData = false;
}

void setMatchedPairedRosterDecision(EventEligibilityDecision &decision) {
  clearRejectionFlags(decision);
  decision.allowed = true;
  decision.matchedPairedRoster = true;
  decision.usedPairedRosterFallback = true;
  if (decision.matchedTargetedStudent) {
    decision.finalReason = "matched_targeted_student";
  } else if (decision.matchedTargetedSchoolId) {
    decision.finalReason = "matched_targeted_school_id";
  } else {
    decision.finalReason = "matched_paired_event_roster";
  }
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
      compact == "selectedstudent" || compact == "explicit" ||
      compact == "explicitstudents" || compact == "explicitstudent") {
    return "specificStudents";
  }

  if (compact == "filtered" || compact == "filteredaudience" ||
      compact == "filters" || compact == "course" || compact == "courses" ||
      compact == "year" || compact == "years" || compact == "yearlevel" ||
      compact == "yearlevels" || compact == "courseyear" ||
      compact == "yearcourse" || compact == "scoped" ||
      compact == "restricted") {
    return "filteredAudience";
  }

  if (compact == "broad" || compact == "general" || compact == "allaudience" ||
      compact == "allstudents" || compact == "generalaudience") {
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
  const size_t explicitCount =
      event.targetedStudentIds.size() + event.targetedSchoolIds.size();
  if (explicitCount > 0) {
    return explicitCount;
  }
  return targetStudentLabelCount(event.targetStudent);
}

bool isSpecificStudentsMode(const EventInfo &event) {
  return normalizeTargetMode(event.targetMode) == "specificStudents" ||
         !event.targetedStudentIds.empty() || !event.targetedSchoolIds.empty() ||
         hasSpecificTargetStudentValue(event.targetStudent);
}

bool hasBroadAudienceFilters(const EventInfo &event) {
  return !event.courseFilters.empty() || !event.yearLevelFilters.empty() ||
         !event.sectionFilters.empty();
}

bool hasAudienceRestrictions(const EventInfo &event) {
  const String targetMode = normalizeTargetMode(event.targetMode);
  return isSpecificStudentsMode(event) || targetMode == "filteredAudience" ||
         hasBroadAudienceFilters(event) ||
         !event.bodScopeCanonical.isEmpty() || event.activeOnly ||
         event.preregistrationRequired || event.requiresRegistration ||
         event.paymentRequired || event.audienceRestricted;
}

bool requiresPairedStudentContext(const EventInfo &event) {
  return event.rosterRequired || hasAudienceRestrictions(event);
}

bool pairedAudienceContextIncomplete(const EventInfo &event,
                                     const std::vector<StudentInfo> &pairedStudents) {
  if (!requiresPairedStudentContext(event)) {
    return false;
  }
  if (!pairedStudents.empty()) {
    return false;
  }
  if (hasBroadAudienceFilters(event)) {
    return false;
  }
  if (isSpecificStudentsMode(event)) {
    return event.targetedStudentIds.empty() && event.targetedSchoolIds.empty() &&
           !hasSpecificTargetStudentValue(event.targetStudent);
  }
  return event.audienceRestricted || event.rosterRequired;
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
  event.targetStudent = trimAndCollapseWhitespace(event.targetStudent);
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
  normalizeStringVector(event.targetedSchoolIds, trimAndCollapseWhitespace);

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
  if (event.rosterRequired) {
    event.audienceRestricted = true;
  }
  if (hasAudienceRestrictions(event)) {
    event.audienceRestricted = true;
  }
  if (event.audienceRestricted) {
    event.rosterRequired = true;
  }

  const bool hasSpecificAudience =
      !event.targetedStudentIds.empty() || !event.targetedSchoolIds.empty() ||
      hasSpecificTargetStudentValue(event.targetStudent);
  const bool hasFilteredAudience = hasBroadAudienceFilters(event);
  if (hasSpecificAudience) {
    event.targetMode = "specificStudents";
  } else if (hasFilteredAudience) {
    event.targetMode = "filteredAudience";
  } else if (event.targetMode.isEmpty() && !event.audienceRestricted &&
             !event.rosterRequired) {
    event.targetMode = "broad";
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
  decision.rosterRequired = requiresPairedStudentContext(normalizedEvent);
  decision.rosterAvailable = !pairedStudents.empty();
  decision.normalizedStudentCourse = normalizedStudent.courseCanonical;
  decision.normalizedStudentYearLevel = normalizedStudent.yearLevelCanonical;
  decision.normalizedStudentSection = normalizedStudent.sectionCanonical;
  decision.eventCourseFilter = joinCanonicalList(normalizedEvent.courseFilters);
  decision.eventYearLevelFilter = joinCanonicalList(normalizedEvent.yearLevelFilters);
  decision.eventSectionFilter = joinCanonicalList(normalizedEvent.sectionFilters);
  decision.matchedPairedRoster =
      rosterContainsStudent(pairedStudents, normalizedStudent.studentUid,
                           normalizedStudent.schoolId);
  decision.matchedTargetedStudent =
      vectorContains(normalizedEvent.targetedStudentIds, normalizedStudent.studentUid);
  decision.matchedTargetedSchoolId =
      vectorContains(normalizedEvent.targetedSchoolIds, normalizedStudent.schoolId);

  if (pairedAudienceContextIncomplete(normalizedEvent, pairedStudents)) {
    decision.stalePairedEventData = true;
    decision.finalReason = "paired_event_audience_incomplete";
    return decision;
  }

  if (decision.targetModeSpecific) {
    if (normalizedEvent.targetedStudentIds.empty() &&
        normalizedEvent.targetedSchoolIds.empty() &&
        !hasSpecificTargetStudentValue(normalizedEvent.targetStudent) &&
        pairedStudents.empty()) {
      decision.stalePairedEventData = true;
      decision.finalReason = "paired_event_targeted_roster_missing";
      return decision;
    }

    if (!decision.matchedTargetedStudent && !decision.matchedTargetedSchoolId &&
        !decision.matchedPairedRoster &&
        !matchesSpecificStudentTarget(normalizedEvent.targetStudent,
                                     normalizedStudent)) {
      decision.finalReason = "student_not_in_targeted_list";
      return decision;
    }

    if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
      return decision;
    }

    decision.allowed = true;
    if (decision.finalReason.isEmpty()) {
      if (decision.matchedTargetedStudent) {
        decision.finalReason = "matched_targeted_student";
      } else if (decision.matchedTargetedSchoolId) {
        decision.finalReason = "matched_targeted_school_id";
      } else if (hasSpecificTargetStudentValue(normalizedEvent.targetStudent)) {
        decision.finalReason = "matched_target_student";
      } else {
        decision.finalReason = "matched_specific_roster";
      }
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

    if (!courseMatch || !yearMatch || !sectionMatch) {
      decision.finalReason = "student_not_in_target_scope";
      return decision;
    }

    if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
      return decision;
    }

    decision.allowed = true;
    decision.finalReason = "matched_broad_audience_filters";
    return decision;
  }

  if (!requiresPairedStudentContext(normalizedEvent)) {
    if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
      return decision;
    }

    decision.allowed = true;
    decision.finalReason = "matched_all_students_event";
    return decision;
  }

  if (!applyRestrictionChecks(normalizedEvent, normalizedStudent, decision)) {
    return decision;
  }

  decision.allowed = true;
  decision.finalReason = "matched_event_constraints";
  return decision;
}

EventEligibilityDecision reconcileWithPairedRoster(
    const EventInfo &event, const StudentInfo &student,
    const EventEligibilityDecision &baseDecision, bool rosterAvailable,
    bool matchedPairedRoster) {
  EventInfo normalizedEvent = event;
  StudentInfo normalizedStudent = student;
  normalizeEvent(normalizedEvent);
  normalizeStudent(normalizedStudent);

  EventEligibilityDecision decision = baseDecision;
  decision.rosterRequired = requiresPairedStudentContext(normalizedEvent);
  decision.rosterAvailable = rosterAvailable;

  if (matchedPairedRoster) {
    setMatchedPairedRosterDecision(decision);
    return decision;
  }

  if (!decision.rosterRequired) {
    return decision;
  }

  if (!decision.allowed && rosterAvailable &&
      (decision.finalReason == "paired_event_targeted_roster_missing" ||
       decision.finalReason == "paired_event_context_corrupt")) {
    clearRejectionFlags(decision);
    decision.allowed = true;
    decision.finalReason = "";
  }

  if (!decision.allowed) {
    return decision;
  }

  decision.allowed = false;
  decision.blockedByPairedRoster = true;

  if (!rosterAvailable) {
    decision.stalePairedEventData = true;
    decision.finalReason = "paired_event_authorized_roster_missing";
    return decision;
  }

  if (normalizedEvent.activeOnly && normalizedStudent.activeKnown &&
      !normalizedStudent.isActive) {
    decision.blockedByInactive = true;
    decision.finalReason = "student_inactive";
    return decision;
  }

  if (!normalizedEvent.bodScopeCanonical.isEmpty() &&
      (normalizedStudent.bodScopeCanonical.isEmpty() ||
       normalizedStudent.bodScopeCanonical != normalizedEvent.bodScopeCanonical)) {
    decision.blockedByBodScope = true;
    decision.finalReason = normalizedStudent.bodScopeCanonical.isEmpty()
                               ? "bod_scope_unknown"
                               : "bod_scope_mismatch";
    return decision;
  }

  if (normalizedEvent.preregistrationRequired || normalizedEvent.requiresRegistration) {
    decision.blockedByPrereg = true;
    decision.finalReason = "preregistration_required";
    return decision;
  }

  if (normalizedEvent.paymentRequired) {
    decision.blockedByPayment = true;
    decision.finalReason = "payment_required";
    return decision;
  }

  decision.finalReason = decision.targetModeSpecific
                             ? "student_not_in_targeted_list"
                             : "student_not_in_event_roster";
  return decision;
}

String rejectionTitle(const EventEligibilityDecision &decision) {
  if (decision.stalePairedEventData) {
    return "EVENT CONTEXT";
  }
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
  return "NOT ELIGIBLE";
}

String rejectionDetail(const EventEligibilityDecision &decision) {
  if (decision.finalReason == "student_not_in_targeted_list") {
    return "Not selected";
  }
  if (decision.finalReason == "student_not_authorized_for_event") {
    return "Not authorized";
  }
  if (decision.finalReason == "student_not_in_event_roster") {
    return "Not in event roster";
  }
  if (decision.finalReason == "matched_target_student") {
    return "Specific target matched";
  }
  if (decision.finalReason == "student_not_in_target_scope") {
    if (decision.blockedByCourse) {
      return "Course mismatch";
    }
    if (decision.blockedByYearLevel) {
      return "Year mismatch";
    }
    if (decision.blockedBySection) {
      return "Section mismatch";
    }
    return "Out of scope";
  }
  if (decision.finalReason == "paired_event_context_missing") {
    return "Re-pair event";
  }
  if (decision.finalReason == "paired_event_context_corrupt") {
    return "Context invalid";
  }
  if (decision.finalReason == "paired_event_context_legacy") {
    return "Re-pair event";
  }
  if (decision.finalReason == "paired_event_audience_incomplete") {
    return "Audience incomplete";
  }
  if (decision.finalReason == "paired_event_id_mismatch") {
    return "Pairing mismatch";
  }
  if (decision.finalReason == "paired_event_targeted_roster_missing") {
    return "Target list missing";
  }
  if (decision.finalReason == "paired_event_authorized_roster_missing") {
    return "Authorized roster missing";
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
    return "Re-pair event";
  }
  return "See operator";
}

}  // namespace CampusEligibility
