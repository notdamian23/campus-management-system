#include "DisplayManager.h"

#include <algorithm>

#include <LiquidCrystal_I2C.h>
#include <Wire.h>

#include "Config.h"

namespace {
constexpr uint8_t kCandidateAddresses[] = {0x27, 0x3F};

struct Utf8Replacement {
  const char *utf8;
  const char *ascii;
};

String sanitizeForLcd(const String &input) {
  String output = input;
  bool changed = false;

  static const Utf8Replacement kReplacements[] = {
      {"\xC3\xB1", "n"}, {"\xC3\x91", "N"}, {"\xC3\xA1", "a"},
      {"\xC3\xA0", "a"}, {"\xC3\xA2", "a"}, {"\xC3\xA4", "a"},
      {"\xC3\xA9", "e"}, {"\xC3\xA8", "e"}, {"\xC3\xAA", "e"},
      {"\xC3\xAB", "e"}, {"\xC3\xAD", "i"}, {"\xC3\xAC", "i"},
      {"\xC3\xAE", "i"}, {"\xC3\xAF", "i"}, {"\xC3\xB3", "o"},
      {"\xC3\xB2", "o"}, {"\xC3\xB4", "o"}, {"\xC3\xB6", "o"},
      {"\xC3\xBA", "u"}, {"\xC3\xB9", "u"}, {"\xC3\xBB", "u"},
      {"\xC3\xBC", "u"}, {"\xC3\x81", "A"}, {"\xC3\x80", "A"},
      {"\xC3\x82", "A"}, {"\xC3\x84", "A"}, {"\xC3\x89", "E"},
      {"\xC3\x88", "E"}, {"\xC3\x8A", "E"}, {"\xC3\x8B", "E"},
      {"\xC3\x8D", "I"}, {"\xC3\x8C", "I"}, {"\xC3\x8E", "I"},
      {"\xC3\x8F", "I"}, {"\xC3\x93", "O"}, {"\xC3\x92", "O"},
      {"\xC3\x94", "O"}, {"\xC3\x96", "O"}, {"\xC3\x9A", "U"},
      {"\xC3\x99", "U"}, {"\xC3\x9B", "U"}, {"\xC3\x9C", "U"},
  };

  for (const auto &replacement : kReplacements) {
    if (output.indexOf(replacement.utf8) >= 0) {
      output.replace(replacement.utf8, replacement.ascii);
      changed = true;
    }
  }

  String ascii;
  ascii.reserve(output.length());
  for (size_t index = 0; index < output.length();) {
    const uint8_t current =
        static_cast<uint8_t>(output.charAt(static_cast<unsigned int>(index)));
    if (current < 0x80) {
      ascii += static_cast<char>(current);
      ++index;
      continue;
    }

    changed = true;
    size_t advance = 1;
    if ((current & 0xE0U) == 0xC0U) {
      advance = 2;
    } else if ((current & 0xF0U) == 0xE0U) {
      advance = 3;
    } else if ((current & 0xF8U) == 0xF0U) {
      advance = 4;
    }
    if (ascii.isEmpty() || ascii.charAt(ascii.length() - 1) != '?') {
      ascii += '?';
    }
    index += std::min(advance, output.length() - index);
  }

  if (changed && ascii != input) {
    Serial.printf("[LCD] sanitized original=\"%s\" display=\"%s\"\n",
                  input.c_str(), ascii.c_str());
  }
  return ascii;
}
}  // namespace

DisplayManager::~DisplayManager() {
  delete lcd_;
}

bool DisplayManager::begin() {
  for (const uint8_t address : kCandidateAddresses) {
    yield();
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      address_ = address;
      break;
    }
    delay(1);
  }

  if (address_ == 0) {
    ready_ = false;
    return false;
  }

  delete lcd_;
  lcd_ = new LiquidCrystal_I2C(address_, CampusConfig::kLcdColumns,
                               CampusConfig::kLcdRows);
  yield();
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
  String output = sanitizeForLcd(value);
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
