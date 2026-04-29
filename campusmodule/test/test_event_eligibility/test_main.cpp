#include <Arduino.h>
#include <unity.h>

#include <CampusEligibility.h>

namespace {

EventInfo makeBroadEvent(const String &course, const String &year,
                         const String &section = "") {
  EventInfo event;
  event.eventId = "evt-broad";
  event.title = "Broad Audience Event";
  event.targetMode = "broad";
  event.courseFilterLabel = course;
  event.yearLevelFilterLabel = year;
  event.sectionFilterLabel = section;
  return event;
}

EventInfo makeSpecificEvent() {
  EventInfo event;
  event.eventId = "evt-specific";
  event.title = "Specific Students Event";
  event.targetMode = "specificStudents";
  event.targetedStudentIds.push_back("student-001");
  return event;
}

EventInfo makeTargetStudentEvent(const String &targetStudent) {
  EventInfo event;
  event.eventId = "evt-target-student";
  event.title = "Target Student Event";
  event.targetMode = "specificStudents";
  event.targetStudent = targetStudent;
  return event;
}

StudentInfo makeStudent(const String &uid, const String &course,
                        const String &year, const String &section = "") {
  StudentInfo student;
  student.studentUid = uid;
  student.schoolId = "2026-" + uid;
  student.studentName = "Student " + uid;
  student.course = course;
  student.yearLevel = year;
  student.section = section;
  student.isActive = true;
  student.activeKnown = true;
  return student;
}

void test_broad_audience_matching_student_is_allowed() {
  const EventInfo event = makeBroadEvent("ME", "1st Year");
  const StudentInfo student =
      makeStudent("student-001", "Mechanical Engineering", "1");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_TRUE(decision.usedBroadAudienceFilters);
  TEST_ASSERT_EQUAL_STRING("matched_broad_audience_filters",
                           decision.finalReason.c_str());
}

void test_broad_audience_non_matching_course_is_rejected() {
  const EventInfo event = makeBroadEvent("ME", "1st Year");
  const StudentInfo student =
      makeStudent("student-002", "Computer Engineering", "1st");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_FALSE(decision.allowed);
  TEST_ASSERT_TRUE(decision.blockedByCourse);
  TEST_ASSERT_EQUAL_STRING("student_not_in_target_scope",
                           decision.finalReason.c_str());
}

void test_specific_students_mode_only_selected_students_are_allowed() {
  const EventInfo event = makeSpecificEvent();
  const StudentInfo allowedStudent =
      makeStudent("student-001", "Mechanical Engineering", "1");
  const StudentInfo rejectedStudent =
      makeStudent("student-999", "Mechanical Engineering", "1");

  const auto allowed =
      CampusEligibility::evaluateStudentForEvent(event, {}, allowedStudent);
  const auto rejected =
      CampusEligibility::evaluateStudentForEvent(event, {}, rejectedStudent);

  TEST_ASSERT_TRUE(allowed.allowed);
  TEST_ASSERT_FALSE(rejected.allowed);
  TEST_ASSERT_EQUAL_STRING("student_not_in_targeted_list",
                           rejected.finalReason.c_str());
}

void test_specific_students_mode_accepts_targeted_school_id() {
  EventInfo event = makeSpecificEvent();
  event.targetedStudentIds.clear();
  event.targetedSchoolIds.push_back("2026-student-777");
  const StudentInfo student =
      makeStudent("student-777", "Mechanical Engineering", "1");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_TRUE(decision.matchedTargetedSchoolId);
  TEST_ASSERT_EQUAL_STRING("matched_targeted_school_id",
                           decision.finalReason.c_str());
}

void test_filtered_event_with_selected_students_accepts_union_roster_student() {
  EventInfo event = makeBroadEvent("ME", "1st Year");
  event.targetedStudentIds.push_back("student-cpe-001");
  const StudentInfo mechanicalStudent =
      makeStudent("student-me-001", "Mechanical Engineering", "1st Year");

  const auto baseDecision = CampusEligibility::evaluateStudentForEvent(
      event, {mechanicalStudent}, mechanicalStudent);
  const auto decision = CampusEligibility::reconcileWithPairedRoster(
      event, mechanicalStudent, baseDecision, true, true);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_TRUE(decision.matchedPairedRoster);
  TEST_ASSERT_EQUAL_STRING("matched_paired_event_roster",
                           decision.finalReason.c_str());
}

void test_restricted_event_with_missing_audience_context_is_rejected() {
  EventInfo event;
  event.eventId = "evt-broad-empty";
  event.title = "Broken Event";
  event.targetMode = "broad";
  event.audienceRestricted = true;
  event.rosterRequired = true;
  const StudentInfo student =
      makeStudent("student-008", "Computer Engineering", "4th Year");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_FALSE(decision.allowed);
  TEST_ASSERT_TRUE(decision.stalePairedEventData);
  TEST_ASSERT_EQUAL_STRING("paired_event_audience_incomplete",
                           decision.finalReason.c_str());
}

void test_filtered_audience_does_not_normalize_to_broad() {
  EventInfo event;
  event.eventId = "evt-filtered";
  event.title = "Filtered Event";
  event.targetMode = "";
  event.courseFilters.push_back("Computer Engineering");
  event.yearLevelFilters.push_back("4th Year");

  CampusEligibility::normalizeEvent(event);

  TEST_ASSERT_EQUAL_STRING("filteredAudience", event.targetMode.c_str());
  TEST_ASSERT_TRUE(event.audienceRestricted);
  TEST_ASSERT_TRUE(event.rosterRequired);
}

void test_specific_student_evidence_overrides_broad_mode() {
  EventInfo event;
  event.eventId = "evt-specific-broad";
  event.title = "Specific Event";
  event.targetMode = "broad";
  event.targetedStudentIds.push_back("student-042");

  CampusEligibility::normalizeEvent(event);

  TEST_ASSERT_EQUAL_STRING("specificStudents", event.targetMode.c_str());
  TEST_ASSERT_TRUE(event.audienceRestricted);
  TEST_ASSERT_TRUE(event.rosterRequired);
}

void test_blank_restricted_audience_stays_unknown() {
  EventInfo event;
  event.eventId = "evt-blank-restricted";
  event.title = "Blank Restricted";
  event.targetMode = "";
  event.audienceRestricted = true;

  CampusEligibility::normalizeEvent(event);

  TEST_ASSERT_EQUAL_STRING("", event.targetMode.c_str());
  TEST_ASSERT_TRUE(event.rosterRequired);
}

void test_true_broad_event_without_filters_is_allowed() {
  EventInfo event;
  event.eventId = "evt-open";
  event.title = "All Students Event";
  event.targetMode = "broad";
  const StudentInfo student =
      makeStudent("student-030", "Computer Engineering", "4th Year");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_FALSE(decision.stalePairedEventData);
  TEST_ASSERT_EQUAL_STRING("matched_all_students_event",
                           decision.finalReason.c_str());
}

void test_empty_targeted_students_does_not_reject_broad_audience_event() {
  EventInfo event = makeBroadEvent("ME", "1st Year", "A");
  event.targetedStudentIds.clear();
  const StudentInfo student =
      makeStudent("student-003", "ME", "First Year", "a");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_EQUAL_STRING("matched_broad_audience_filters",
                           decision.finalReason.c_str());
}

void test_course_and_year_variants_match_after_normalization() {
  const EventInfo event = makeBroadEvent("Mechanical Engineering", "First Year");
  const StudentInfo student =
      makeStudent("student-004", "ME", "1st");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_EQUAL_STRING("me", decision.normalizedStudentCourse.c_str());
  TEST_ASSERT_EQUAL_STRING("1", decision.normalizedStudentYearLevel.c_str());
  TEST_ASSERT_EQUAL_STRING("me", decision.eventCourseFilter.c_str());
  TEST_ASSERT_EQUAL_STRING("1", decision.eventYearLevelFilter.c_str());
}

void test_specific_target_student_string_is_honored() {
  const EventInfo event =
      makeTargetStudentEvent("Student student-011 (2026-student-011)");
  const StudentInfo student =
      makeStudent("student-011", "Mechanical Engineering", "1");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_EQUAL_STRING("matched_target_student", decision.finalReason.c_str());
}

void test_authorized_paired_roster_overrides_stale_global_owner_filters() {
  const EventInfo event = makeBroadEvent("Mechanical Engineering", "4th Year");
  StudentInfo staleOwner =
      makeStudent("student-020", "Computer Engineering", "2nd Year");

  const auto baseDecision =
      CampusEligibility::evaluateStudentForEvent(event, {}, staleOwner);
  const auto decision = CampusEligibility::reconcileWithPairedRoster(
      event, staleOwner, baseDecision, true, true);

  TEST_ASSERT_TRUE(decision.allowed);
  TEST_ASSERT_TRUE(decision.matchedPairedRoster);
  TEST_ASSERT_EQUAL_STRING("matched_paired_event_roster",
                           decision.finalReason.c_str());
}

void test_authorized_roster_blocks_student_even_when_filters_match() {
  const EventInfo event = makeBroadEvent("Mechanical Engineering", "4th Year");
  const StudentInfo student =
      makeStudent("student-021", "Mechanical Engineering", "4th Year");

  const auto baseDecision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);
  const auto decision = CampusEligibility::reconcileWithPairedRoster(
      event, student, baseDecision, true, false);

  TEST_ASSERT_FALSE(decision.allowed);
  TEST_ASSERT_TRUE(decision.blockedByPairedRoster);
  TEST_ASSERT_EQUAL_STRING("student_not_in_event_roster",
                           decision.finalReason.c_str());
}

void test_preregistration_event_reports_missing_prereg_when_roster_rejects() {
  EventInfo event = makeBroadEvent("", "");
  event.preregistrationRequired = true;
  StudentInfo student =
      makeStudent("student-022", "Mechanical Engineering", "4th Year");
  student.preregisteredKnown = true;
  student.preregistered = true;

  const auto baseDecision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);
  const auto decision = CampusEligibility::reconcileWithPairedRoster(
      event, student, baseDecision, true, false);

  TEST_ASSERT_FALSE(decision.allowed);
  TEST_ASSERT_TRUE(decision.blockedByPrereg);
  TEST_ASSERT_EQUAL_STRING("preregistration_required",
                           decision.finalReason.c_str());
}

}  // namespace

void setup() {
  delay(2000);

  UNITY_BEGIN();
  RUN_TEST(test_broad_audience_matching_student_is_allowed);
  RUN_TEST(test_broad_audience_non_matching_course_is_rejected);
  RUN_TEST(test_specific_students_mode_only_selected_students_are_allowed);
  RUN_TEST(test_specific_students_mode_accepts_targeted_school_id);
  RUN_TEST(test_filtered_event_with_selected_students_accepts_union_roster_student);
  RUN_TEST(test_empty_targeted_students_does_not_reject_broad_audience_event);
  RUN_TEST(test_course_and_year_variants_match_after_normalization);
  RUN_TEST(test_specific_target_student_string_is_honored);
  RUN_TEST(test_authorized_paired_roster_overrides_stale_global_owner_filters);
  RUN_TEST(test_authorized_roster_blocks_student_even_when_filters_match);
  RUN_TEST(test_preregistration_event_reports_missing_prereg_when_roster_rejects);
  RUN_TEST(test_restricted_event_with_missing_audience_context_is_rejected);
  RUN_TEST(test_filtered_audience_does_not_normalize_to_broad);
  RUN_TEST(test_specific_student_evidence_overrides_broad_mode);
  RUN_TEST(test_blank_restricted_audience_stays_unknown);
  RUN_TEST(test_true_broad_event_without_filters_is_allowed);
  UNITY_END();
}

void loop() {}
