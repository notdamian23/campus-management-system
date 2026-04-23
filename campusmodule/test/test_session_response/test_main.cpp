#include <Arduino.h>
#include <ArduinoJson.h>
#include <unity.h>

#include "BackendClient.h"

namespace {

String makeDummyToken(size_t length) {
  String token;
  token.reserve(length);
  for (size_t i = 0; i < length; ++i) {
    token += static_cast<char>('a' + (i % 26));
  }
  return token;
}

void test_session_response_near_old_failure_size_parses() {
  const String token = makeDummyToken(300);
  String response;
  response.reserve(512);
  response = "{\"ok\":true,\"sessionToken\":\"";
  response += token;
  response +=
      "\",\"expiresAtMs\":1770000000000,\"deviceId\":\"campus-device-001\","
      "\"sessionVersion\":3,\"futureField\":\"firmware should ignore this "
      "harmless extra metadata\"}";

  TEST_ASSERT_TRUE(response.length() >= 425);

  DynamicJsonDocument doc(BackendClient::kSessionResponseJsonCapacity);
  const DeserializationError error = deserializeJson(doc, response);

  TEST_ASSERT_FALSE_MESSAGE(error, error.c_str());
  TEST_ASSERT_EQUAL_STRING(token.c_str(), doc["sessionToken"] | "");
  TEST_ASSERT_TRUE(doc["ok"] | false);
  TEST_ASSERT_EQUAL_INT(3, doc["sessionVersion"] | 0);
}

}  // namespace

void setup() {
  delay(2000);

  UNITY_BEGIN();
  RUN_TEST(test_session_response_near_old_failure_size_parses);
  UNITY_END();
}

void loop() {}
