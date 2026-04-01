#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>

class ButtonInput;
class DisplayManager;
class DNSServer;
class WebServer;

enum class WifiSetupResult : uint8_t {
  Configured,
  Cancelled,
  TimedOut,
  Failed,
};

class WifiManager {
 public:
  ~WifiManager();

  void begin();
  bool connect(String &error, uint32_t timeoutMs);
  void disconnect();
  bool isConnected() const;
  bool hasCredentials() const;
  String configuredSsid() const;
  WifiSetupResult runSetupPortal(DisplayManager &display, ButtonInput &buttons,
                                 String &message, uint32_t timeoutMs);

 private:
  bool loadCredentials(String &ssid, String &password) const;
  bool saveCredentials(const String &ssid, const String &password);
  bool connectUsing(const String &ssid, const String &password, String &error,
                    uint32_t timeoutMs);
  bool startPortal(String &error);
  void stopPortal();
  void configurePortalRoutes();
  void handlePortalRoot();
  void handlePortalSave();
  void handlePortalRedirect();
  String portalSsid() const;
  String buildPortalHtml(const String &title, const String &body) const;
  String htmlEscape(const String &value) const;
  String statusText(wl_status_t status) const;

  mutable Preferences prefs_;
  bool prefsReady_ = false;
  DNSServer *dns_ = nullptr;
  WebServer *server_ = nullptr;
  bool portalRunning_ = false;
  bool portalSaved_ = false;
  String portalStatus_;
  String portalApSsid_;
  String portalApIp_;
};
