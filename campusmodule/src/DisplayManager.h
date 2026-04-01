#pragma once

#include <Arduino.h>

#include "AppTypes.h"

class LiquidCrystal_I2C;

class DisplayManager {
 public:
  DisplayManager() = default;
  ~DisplayManager();

  bool begin();
  bool isReady() const;

  void clear();
  void show(const String &line1, const String &line2);
  void showMenu(const String &title, const char *const items[], int selectedIndex,
                int total);
  void showStudent(const StudentInfo &student, int index, int total);
  void showAttendancePrompt(const EventInfo &event, size_t unsyncedCount);
  void showSyncProgress(size_t current, size_t total);

 private:
  String center(const String &value) const;
  String fit(const String &value) const;

  LiquidCrystal_I2C *lcd_ = nullptr;
  uint8_t address_ = 0;
  bool ready_ = false;
};
