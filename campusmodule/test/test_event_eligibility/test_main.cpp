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

void test_broad_event_without_filters_or_roster_requires_valid_context() {
  EventInfo event;
  event.eventId = "evt-broad-empty";
  event.title = "Broken Event";
  event.targetMode = "broad";
  const StudentInfo student =
      makeStudent("student-008", "Computer Engineering", "4th Year");

  const auto decision =
      CampusEligibility::evaluateStudentForEvent(event, {}, student);

  TEST_ASSERT_FALSE(decision.allowed);
  TEST_ASSERT_TRUE(decision.stalePairedEventData);
  TEST_ASSERT_EQUAL_STRING("paired_event_context_corrupt",
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

}  // namespace

void setup() {
  delay(2000);

  UNITY_BEGIN();
  RUN_TEST(test_broad_audience_matching_student_is_allowed);
  RUN_TEST(test_broad_audience_non_matching_course_is_rejected);
  RUN_TEST(test_specific_students_mode_only_selected_students_are_allowed);
  RUN_TEST(test_specific_students_mode_accepts_targeted_school_id);
  RUN_TEST(test_empty_targeted_students_does_not_reject_broad_audience_event);
  RUN_TEST(test_course_and_year_variants_match_after_normalization);
  RUN_TEST(test_broad_event_without_filters_or_roster_requires_valid_context);
  UNITY_END();
}

void loop() {}
