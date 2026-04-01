#include "WifiManager.h"

#include <DNSServer.h>
#include <WiFi.h>
#include <WebServer.h>

#include "ButtonInput.h"
#include "Config.h"
#include "DisplayManager.h"

namespace {
constexpr byte kDnsPort = 53;
IPAddress kPortalIp(192, 168, 4, 1);
IPAddress kPortalMask(255, 255, 255, 0);
constexpr char kWifiNamespace[] = "campuswifi";

String trimCopy(const String &value) {
  String output = value;
  output.trim();
  return output;
}
}  // namespace

WifiManager::~WifiManager() {
  stopPortal();
  if (prefsReady_) {
    prefs_.end();
    prefsReady_ = false;
  }
}

void WifiManager::begin() {
  prefsReady_ = prefs_.begin(kWifiNamespace, false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
}

bool WifiManager::connect(String &error, uint32_t timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  String ssid;
  String password;
  if (!loadCredentials(ssid, password)) {
    error = "Run Wi-Fi setup";
    return false;
  }

  stopPortal();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
  return connectUsing(ssid, password, error, timeoutMs);
}

void WifiManager::disconnect() {
  stopPortal();
  WiFi.disconnect(true, false);
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  WiFi.setSleep(true);
}

bool WifiManager::isConnected() const {
  return WiFi.status() == WL_CONNECTED;
}

bool WifiManager::hasCredentials() const {
  String ssid;
  String password;
  return loadCredentials(ssid, password);
}

String WifiManager::configuredSsid() const {
  String ssid;
  String password;
  if (!loadCredentials(ssid, password)) {
    return "";
  }
  return ssid;
}

WifiSetupResult WifiManager::runSetupPortal(DisplayManager &display,
                                            ButtonInput &buttons,
                                            String &message,
                                            uint32_t timeoutMs) {
  String error;
  if (!startPortal(error)) {
    message = error;
    return WifiSetupResult::Failed;
  }

  const uint32_t startedAt = millis();
  while ((millis() - startedAt) < timeoutMs) {
    if (dns_ != nullptr) {
      dns_->processNextRequest();
    }
    if (server_ != nullptr) {
      server_->handleClient();
    }

    if (portalSaved_) {
      message = configuredSsid();
      display.show("Wi-Fi Saved", message);
      delay(1200);
      stopPortal();
      return WifiSetupResult::Configured;
    }

    const ButtonAction action = buttons.poll();
    if (action == ButtonAction::Back) {
      message = "Setup cancelled";
      stopPortal();
      delay(120);
      return WifiSetupResult::Cancelled;
    }

    const uint32_t phase = ((millis() - startedAt) / 1800UL) % 3UL;
    if (phase == 0) {
      display.show("Wi-Fi Setup", portalApSsid_);
    } else if (phase == 1) {
      display.show("Open browser", portalApIp_);
    } else if (!portalStatus_.isEmpty()) {
      display.show("Portal Status", portalStatus_);
    } else {
      display.show("Join AP first", "BACK to close");
    }

    delay(20);
  }

  message = "Setup timeout";
  stopPortal();
  return WifiSetupResult::TimedOut;
}

bool WifiManager::loadCredentials(String &ssid, String &password) const {
  ssid = "";
  password = "";

  if (prefsReady_) {
    ssid = trimCopy(prefs_.getString("ssid", ""));
    password = prefs_.getString("pass", "");
    if (!ssid.isEmpty()) {
      return true;
    }
  }

  ssid = trimCopy(String(CampusConfig::kWifiSsid));
  password = String(CampusConfig::kWifiPassword);
  if (ssid.isEmpty() || ssid.startsWith("REPLACE_")) {
    ssid = "";
    password = "";
    return false;
  }
  return true;
}

bool WifiManager::saveCredentials(const String &ssid, const String &password) {
  if (!prefsReady_) {
    return false;
  }

  prefs_.putString("ssid", trimCopy(ssid).c_str());
  prefs_.putString("pass", password.c_str());
  return true;
}

bool WifiManager::connectUsing(const String &ssid, const String &password,
                               String &error, uint32_t timeoutMs) {
  WiFi.disconnect(false, false);
  delay(150);
  WiFi.begin(ssid.c_str(), password.c_str());

  const uint32_t startedAt = millis();
  while ((millis() - startedAt) < timeoutMs) {
    if (dns_ != nullptr) {
      dns_->processNextRequest();
    }

    const wl_status_t status = WiFi.status();
    if (status == WL_CONNECTED) {
      return true;
    }
    delay(250);
  }

  error = statusText(WiFi.status());
  WiFi.disconnect(false, false);
  return false;
}

bool WifiManager::startPortal(String &error) {
  stopPortal();

  dns_ = new DNSServer();
  server_ = new WebServer(80);

  portalSaved_ = false;
  portalStatus_ = "Submit Wi-Fi";
  portalApSsid_ = portalSsid();
  portalApIp_ = kPortalIp.toString();

  WiFi.disconnect(true, false);
  WiFi.softAPdisconnect(true);
  delay(100);

  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);

  if (!WiFi.softAPConfig(kPortalIp, kPortalIp, kPortalMask)) {
    error = "AP config failed";
    stopPortal();
    return false;
  }

  if (!WiFi.softAP(portalApSsid_.c_str())) {
    error = "AP start failed";
    stopPortal();
    return false;
  }

  portalApIp_ = WiFi.softAPIP().toString();
  configurePortalRoutes();
  dns_->start(kDnsPort, "*", WiFi.softAPIP());
  server_->begin();
  portalRunning_ = true;
  return true;
}

void WifiManager::stopPortal() {
  portalRunning_ = false;
  portalSaved_ = false;
  portalStatus_ = "";

  if (server_ != nullptr) {
    server_->stop();
    delete server_;
    server_ = nullptr;
  }

  if (dns_ != nullptr) {
    dns_->stop();
    delete dns_;
    dns_ = nullptr;
  }

  WiFi.softAPdisconnect(true);
}

void WifiManager::configurePortalRoutes() {
  if (server_ == nullptr) {
    return;
  }

  server_->on("/", HTTP_GET, [this]() { handlePortalRoot(); });
  server_->on("/save", HTTP_POST, [this]() { handlePortalSave(); });
  server_->on("/generate_204", HTTP_GET, [this]() { handlePortalRedirect(); });
  server_->on("/fwlink", HTTP_GET, [this]() { handlePortalRedirect(); });
  server_->on("/hotspot-detect.html", HTTP_GET, [this]() { handlePortalRedirect(); });
  server_->on("/connecttest.txt", HTTP_GET, [this]() { handlePortalRedirect(); });
  server_->on("/ncsi.txt", HTTP_GET, [this]() { handlePortalRedirect(); });
  server_->on("/redirect", HTTP_GET, [this]() { handlePortalRedirect(); });
  server_->onNotFound([this]() { handlePortalRedirect(); });
}

void WifiManager::handlePortalRoot() {
  if (server_ == nullptr) {
    return;
  }

  String body;
  body += "<h1>CAMPUS Wi-Fi Setup</h1>";
  body += "<p>Join this temporary access point, then submit your Wi-Fi details.</p>";
  body += "<p><strong>AP:</strong> ";
  body += htmlEscape(portalApSsid_);
  body += "<br><strong>Portal:</strong> http://";
  body += htmlEscape(portalApIp_);
  body += "</p>";

  const String currentSsid = configuredSsid();
  if (!currentSsid.isEmpty()) {
    body += "<p><strong>Current SSID:</strong> ";
    body += htmlEscape(currentSsid);
    body += "</p>";
  }

  if (!portalStatus_.isEmpty()) {
    body += "<p class=\"note\">";
    body += htmlEscape(portalStatus_);
    body += "</p>";
  }

  body += "<form action=\"/save\" method=\"POST\">";
  body += "<label for=\"ssid\">Wi-Fi name (SSID)</label>";
  body += "<input id=\"ssid\" name=\"ssid\" maxlength=\"32\" placeholder=\"Campus Wi-Fi\"";
  if (!currentSsid.isEmpty()) {
    body += " value=\"";
    body += htmlEscape(currentSsid);
    body += "\"";
  }
  body += " required>";
  body += "<label for=\"password\">Password</label>";
  body += "<input id=\"password\" name=\"password\" type=\"password\" maxlength=\"64\" ";
  body += "placeholder=\"Leave blank for open Wi-Fi\">";
  body += "<button type=\"submit\">Save and Connect</button>";
  body += "</form>";
  body += "<p class=\"hint\">The setup AP closes after a successful save or when you press BACK on the device.</p>";

  server_->send(200, "text/html", buildPortalHtml("CAMPUS Wi-Fi Setup", body));
}

void WifiManager::handlePortalSave() {
  if (server_ == nullptr) {
    return;
  }

  const String ssid = trimCopy(server_->arg("ssid"));
  const String password = server_->arg("password");

  if (ssid.isEmpty()) {
    portalStatus_ = "SSID is required";
    handlePortalRoot();
    return;
  }

  portalStatus_ = "Connecting to " + ssid;
  WiFi.mode(WIFI_AP_STA);

  String error;
  if (!connectUsing(ssid, password, error, CampusConfig::kWifiTimeoutMs)) {
    portalStatus_ = error;

    String body;
    body += "<h1>Connection failed</h1>";
    body += "<p>";
    body += htmlEscape(error);
    body += "</p>";
    body += "<p><a href=\"/\">Try again</a></p>";
    server_->send(200, "text/html", buildPortalHtml("Wi-Fi Failed", body));
    return;
  }

  if (!saveCredentials(ssid, password)) {
    portalStatus_ = "Save failed";
    WiFi.disconnect(false, false);

    String body;
    body += "<h1>Save failed</h1>";
    body += "<p>Wi-Fi connected once, but the device could not store the credentials.</p>";
    body += "<p><a href=\"/\">Return</a></p>";
    server_->send(200, "text/html", buildPortalHtml("Save Failed", body));
    return;
  }

  portalSaved_ = true;
  portalStatus_ = "Saved " + ssid;

  String body;
  body += "<h1>Wi-Fi saved</h1>";
  body += "<p>The device connected to <strong>";
  body += htmlEscape(ssid);
  body += "</strong>.</p>";
  body += "<p>You can return to the CAMPUS menu now.</p>";
  server_->send(200, "text/html", buildPortalHtml("Wi-Fi Saved", body));
}

void WifiManager::handlePortalRedirect() {
  if (server_ == nullptr) {
    return;
  }

  String location = "http://";
  location += portalApIp_;
  location += "/";
  server_->sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  server_->sendHeader("Location", location, true);
  server_->send(302, "text/plain", "");
}

String WifiManager::portalSsid() const {
  String suffix = String(CampusConfig::kDeviceId);
  suffix.replace(" ", "");
  suffix.replace("-", "");
  suffix.replace("_", "");
  if (suffix.length() > 4) {
    suffix = suffix.substring(suffix.length() - 4);
  }

  String ssid = String(CampusConfig::kSetupApPrefix);
  if (!suffix.isEmpty()) {
    ssid += "-";
    ssid += suffix;
  }
  return ssid;
}

String WifiManager::buildPortalHtml(const String &title, const String &body) const {
  String html;
  html += "<!doctype html><html><head><meta charset=\"utf-8\">";
  html += "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">";
  html += "<title>";
  html += htmlEscape(title);
  html += "</title>";
  html += "<style>";
  html += "body{font-family:Verdana,sans-serif;background:#f4efe4;color:#1f2a36;";
  html += "margin:0;padding:24px;}main{max-width:520px;margin:0 auto;background:#fff;";
  html += "padding:24px;border-radius:18px;box-shadow:0 16px 40px rgba(0,0,0,.12);}";
  html += "h1{margin-top:0;color:#0c5c5c;}label{display:block;margin:16px 0 8px;font-weight:700;}";
  html += "input{width:100%;padding:12px 14px;border:1px solid #b9c3cf;border-radius:12px;";
  html += "font-size:16px;box-sizing:border-box;}button{width:100%;margin-top:18px;padding:13px 16px;";
  html += "border:0;border-radius:999px;background:#0c5c5c;color:#fff;font-size:16px;font-weight:700;}";
  html += ".note{background:#eef7ff;padding:12px 14px;border-radius:12px;}";
  html += ".hint{font-size:14px;color:#4f6272;}a{color:#0c5c5c;font-weight:700;}";
  html += "</style></head><body><main>";
  html += body;
  html += "</main></body></html>";
  return html;
}

String WifiManager::htmlEscape(const String &value) const {
  String output = value;
  output.replace("&", "&amp;");
  output.replace("\"", "&quot;");
  output.replace("'", "&#39;");
  output.replace("<", "&lt;");
  output.replace(">", "&gt;");
  return output;
}

String WifiManager::statusText(wl_status_t status) const {
  switch (status) {
    case WL_NO_SSID_AVAIL:
      return "SSID not found";
    case WL_CONNECT_FAILED:
      return "Wrong password";
    case WL_CONNECTION_LOST:
      return "Wi-Fi lost";
    case WL_IDLE_STATUS:
      return "Still connecting";
    default:
      return "Wi-Fi timeout";
  }
}
