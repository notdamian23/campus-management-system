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
  return true;
}

bool DisplayManager::isReady() const {
  return ready_;
}

void DisplayManager::clear() {
  if (ready_) {
    lcd_->clear();
  }
}

void DisplayManager::show(const String &line1, const String &line2) {
  if (!ready_) {
    return;
  }

  lcd_->clear();
  lcd_->setCursor(0, 0);
  lcd_->print(fit(line1));
  lcd_->setCursor(0, 1);
  lcd_->print(fit(line2));
}

void DisplayManager::showMenu(const String &title, const char *const items[],
                              int selectedIndex, int total) {
  if (!ready_) {
    return;
  }

  lcd_->clear();

  String header = title;
  if (total > 0) {
    header += " ";
    header += String(selectedIndex + 1);
    header += "/";
    header += String(total);
  }

  lcd_->setCursor(0, 0);
  lcd_->print(center(header));

  const int visibleItemRows = CampusConfig::kLcdRows > 1 ? CampusConfig::kLcdRows - 1 : 0;
  if (items == nullptr || total <= 0 || visibleItemRows <= 0) {
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

  for (int row = 0; row < visibleItemRows; ++row) {
    const int itemIndex = windowStart + row;
    lcd_->setCursor(0, row + 1);
    if (itemIndex >= total) {
      lcd_->print(fit(""));
      continue;
    }

    String line = itemIndex == selectedIndex ? ">" : " ";
    line += items[itemIndex];
    lcd_->print(fit(line));
  }
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
  show(line1, line2);
}

void DisplayManager::showAttendancePrompt(const EventInfo &event,
                                          size_t unsyncedCount) {
  const String header = event.isValid() ? event.title : "No Paired Event";
  String footer = event.isValid() ? "Scan finger..." : "Pair event first";
  if (event.isValid() && unsyncedCount > 0) {
    footer = "Unsynced:";
    footer += String(unsyncedCount);
  }
  show(header, footer);
}

void DisplayManager::showSyncProgress(size_t current, size_t total) {
  String footer = "Batch ";
  footer += String(current);
  footer += "/";
  footer += String(total);
  show("Sync Records", footer);
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
