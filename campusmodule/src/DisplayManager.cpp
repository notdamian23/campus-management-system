#include "DisplayManager.h"

#include <LiquidCrystal_I2C.h>
#include <Wire.h>

#include "Config.h"

namespace {
constexpr uint8_t kCandidateAddresses[] = {0x27, 0x3F};
}  // namespace

DisplayManager::~DisplayManager() {
  delete lcd_;
}

bool DisplayManager::begin() {
  for (const uint8_t address : kCandidateAddresses) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      address_ = address;
      break;
    }
  }

  if (address_ == 0) {
    ready_ = false;
    return false;
  }

  delete lcd_;
  lcd_ = new LiquidCrystal_I2C(address_, CampusConfig::kLcdColumns,
                               CampusConfig::kLcdRows);
  lcd_->init();
  lcd_->backlight();
  lcd_->clear();
  ready_ = true;
  hasFrame_ = false;
  return true;
}

bool DisplayManager::isReady() const {
  return ready_;
}

void DisplayManager::clear() {
  if (ready_) {
    lcd_->clear();
    hasFrame_ = false;
    for (auto &row : lastRows_) {
      row = "";
    }
  }
}

void DisplayManager::show(const String &line1, const String &line2) {
  showLines(line1, line2, "", "");
}

void DisplayManager::showLines(const String &line1, const String &line2,
                               const String &line3, const String &line4) {
  if (!ready_) {
    return;
  }

  const String rows[] = {
      fit(line1),
      fit(line2),
      fit(line3),
      fit(line4),
  };

  if (!hasFrame_) {
    lcd_->clear();
  }

  for (uint8_t row = 0; row < CampusConfig::kLcdRows && row < 4; ++row) {
    if (!hasFrame_ || lastRows_[row] != rows[row]) {
      printRow(row, rows[row]);
      lastRows_[row] = rows[row];
    }
  }

  hasFrame_ = true;
}

void DisplayManager::showMenu(const String &title, const char *const items[],
                              int selectedIndex, int total) {
  if (!ready_) {
    return;
  }

  String header = title;
  if (total > 0) {
    header += " ";
    header += String(selectedIndex + 1);
    header += "/";
    header += String(total);
  }

  const int visibleItemRows = CampusConfig::kLcdRows > 1 ? CampusConfig::kLcdRows - 1 : 0;
  if (items == nullptr || total <= 0 || visibleItemRows <= 0) {
    showLines(center(header), "", "", "");
    return;
  }

  int windowStart = selectedIndex - (visibleItemRows / 2);
  if (windowStart < 0) {
    windowStart = 0;
  }

  const int maxWindowStart = total > visibleItemRows ? total - visibleItemRows : 0;
  if (windowStart > maxWindowStart) {
    windowStart = maxWindowStart;
  }

  String row1 = center(header);
  String row2 = "";
  String row3 = "";
  String row4 = "";

  for (int row = 0; row < visibleItemRows; ++row) {
    const int itemIndex = windowStart + row;
    String line = "";
    if (itemIndex >= total) {
      line = "";
    } else {
      line = itemIndex == selectedIndex ? ">" : " ";
      line += items[itemIndex];
    }

    if (row == 0) {
      row2 = line;
    } else if (row == 1) {
      row3 = line;
    } else if (row == 2) {
      row4 = line;
    }
  }

  showLines(row1, row2, row3, row4);
}

void DisplayManager::showEnrollmentSession(const EnrollmentSessionInfo &session,
                                           int index, int total) {
  String line1 = "Enroll Session";
  String line2 = session.sessionId;
  if (total > 0) {
    line2 += " ";
    line2 += String(index + 1);
    line2 += "/";
    line2 += String(total);
  }

  String line3 = "Stat:" + session.status + " Q:";
  line3 += String(session.totalStudents);
  line3 += " S:";
  line3 += String(session.syncedCount);
  String line4 = "UP/DN SEL BK";
  if (line4.length() < CampusConfig::kLcdColumns) {
    line4 += " ";
  }
  line4 += String(index + 1);
  line4 += "/";
  line4 += String(total);
  if (line4.length() > CampusConfig::kLcdColumns) {
    line4 = line4.substring(0, CampusConfig::kLcdColumns);
  }
  showLines(line1, line2, line3, line4);
}

String DisplayManager::center(const String &value) const {
  String output = value;
  output.trim();
  if (output.length() >= CampusConfig::kLcdColumns) {
    return fit(output);
  }

  const size_t totalPadding = CampusConfig::kLcdColumns - output.length();
  const size_t leftPadding = totalPadding / 2;
  const size_t rightPadding = totalPadding - leftPadding;

  String centered;
  centered.reserve(CampusConfig::kLcdColumns);
  for (size_t index = 0; index < leftPadding; ++index) {
    centered += ' ';
  }
  centered += output;
  for (size_t index = 0; index < rightPadding; ++index) {
    centered += ' ';
  }
  return centered;
}

void DisplayManager::showStudent(const StudentInfo &student, int index, int total) {
  String line1 = student.studentName.isEmpty() ? student.schoolId : student.studentName;
  String line2 = student.schoolId;
  if (total > 0) {
    line2 += " ";
    line2 += String(index + 1);
    line2 += "/";
    line2 += String(total);
  }

  String line3 = student.course;
  if (!student.yearLevel.isEmpty()) {
    if (!line3.isEmpty()) {
      line3 += " | ";
    }
    line3 += student.yearLevel;
  }

  String line4 = "SEL enroll BK exit";
  if (!student.syncStatus.isEmpty()) {
    line4 = "FP:";
    line4 += student.fingerprintStatus.isEmpty() ? "pending" : student.fingerprintStatus;
    line4 += " ";
    line4 += student.syncStatus;
  }
  showLines(line1, line2, line3, line4);
}

void DisplayManager::showAttendancePrompt(const EventInfo &event,
                                          size_t unsyncedCount) {
  const String header = event.isValid() ? event.title : "No Paired Event";
  String footer = event.isValid() ? "Scan finger..." : "Pair event first";
  if (event.isValid() && unsyncedCount > 0) {
    footer = "Unsynced:";
    footer += String(unsyncedCount);
  }
  showLines(header, event.date, event.location, footer);
}

void DisplayManager::showSyncProgress(size_t current, size_t total) {
  String line2 = "Batch ";
  line2 += String(current);
  line2 += "/";
  line2 += String(total);
  showLines("Sync Records", line2, "Uploading offline", "fingerprint data");
}

String DisplayManager::fit(const String &value) const {
  String output = value;
  output.trim();
  if (output.length() > CampusConfig::kLcdColumns) {
    output = output.substring(0, CampusConfig::kLcdColumns);
  }
  while (output.length() < CampusConfig::kLcdColumns) {
    output += ' ';
  }
  return output;
}

void DisplayManager::printRow(uint8_t row, const String &value) {
  if (!ready_ || row >= CampusConfig::kLcdRows || row >= 4) {
    return;
  }

  lcd_->setCursor(0, row);
  lcd_->print(value);
}
