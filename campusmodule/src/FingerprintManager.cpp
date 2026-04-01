#include "FingerprintManager.h"

#include "Config.h"
#include "Pins.h"

FingerprintManager::FingerprintManager() : serial_(2), finger_(&serial_) {}

bool FingerprintManager::begin(String &error) {
  serial_.begin(57600, SERIAL_8N1, Pins::kFingerprintRx, Pins::kFingerprintTx);
  finger_.begin(57600);
  delay(120);

  if (!finger_.verifyPassword()) {
    error = "AS608 not found";
    ready_ = false;
    return false;
  }

  finger_.getParameters();
  ready_ = true;
  return true;
}

bool FingerprintManager::isReady() const {
  return ready_;
}

FingerprintMatch FingerprintManager::scanOnce() {
  FingerprintMatch result;
  if (!ready_) {
    result.status = FingerprintScanStatus::Error;
    result.message = "Scanner offline";
    return result;
  }

  const uint8_t imageStatus = finger_.getImage();
  if (imageStatus == FINGERPRINT_NOFINGER) {
    result.status = FingerprintScanStatus::NoFinger;
    return result;
  }
  if (imageStatus != FINGERPRINT_OK) {
    result.status = FingerprintScanStatus::Error;
    result.message = decodeError(imageStatus);
    return result;
  }

  const uint8_t convertStatus = finger_.image2Tz();
  if (convertStatus != FINGERPRINT_OK) {
    result.status = FingerprintScanStatus::Error;
    result.message = decodeError(convertStatus);
    return result;
  }

  const uint8_t searchStatus = finger_.fingerFastSearch();
  if (searchStatus == FINGERPRINT_OK) {
    result.status = FingerprintScanStatus::Matched;
    result.templateId = finger_.fingerID;
    result.confidence = finger_.confidence;
    return result;
  }

  if (searchStatus == FINGERPRINT_NOTFOUND) {
    result.status = FingerprintScanStatus::NotFound;
    result.message = "Not registered";
    return result;
  }

  result.status = FingerprintScanStatus::Error;
  result.message = decodeError(searchStatus);
  return result;
}

bool FingerprintManager::enrollTemplate(uint16_t templateId, String &error) {
  if (!ready_) {
    error = "Scanner offline";
    return false;
  }

  if (!captureToSlot(1, CampusConfig::kEnrollmentTimeoutMs, error)) {
    return false;
  }

  waitForFingerRemoval(4000);
  delay(250);

  if (!captureToSlot(2, CampusConfig::kEnrollmentTimeoutMs, error)) {
    return false;
  }

  const uint8_t modelStatus = finger_.createModel();
  if (modelStatus != FINGERPRINT_OK) {
    error = decodeError(modelStatus);
    return false;
  }

  const uint8_t storeStatus = finger_.storeModel(templateId);
  if (storeStatus != FINGERPRINT_OK) {
    error = decodeError(storeStatus);
    return false;
  }

  return true;
}

bool FingerprintManager::deleteTemplate(uint16_t templateId, String &error) {
  if (!ready_) {
    error = "Scanner offline";
    return false;
  }

  const uint8_t status = finger_.deleteModel(templateId);
  if (status != FINGERPRINT_OK) {
    error = decodeError(status);
    return false;
  }

  return true;
}

void FingerprintManager::waitForFingerRemoval(uint32_t timeoutMs) {
  const uint32_t startedAt = millis();
  while ((millis() - startedAt) < timeoutMs) {
    if (finger_.getImage() == FINGERPRINT_NOFINGER) {
      return;
    }
    delay(80);
  }
}

bool FingerprintManager::captureToSlot(uint8_t slot, uint32_t timeoutMs,
                                       String &error) {
  const uint32_t startedAt = millis();

  while ((millis() - startedAt) < timeoutMs) {
    const uint8_t imageStatus = finger_.getImage();
    if (imageStatus == FINGERPRINT_NOFINGER) {
      delay(90);
      continue;
    }
    if (imageStatus != FINGERPRINT_OK) {
      error = decodeError(imageStatus);
      return false;
    }

    const uint8_t convertStatus = finger_.image2Tz(slot);
    if (convertStatus != FINGERPRINT_OK) {
      error = decodeError(convertStatus);
      return false;
    }

    return true;
  }

  error = "Enroll timeout";
  return false;
}

String FingerprintManager::decodeError(uint8_t code) const {
  switch (code) {
    case FINGERPRINT_PACKETRECIEVEERR:
      return "Sensor packet err";
    case FINGERPRINT_IMAGEFAIL:
      return "Image capture fail";
    case FINGERPRINT_IMAGEMESS:
      return "Image too messy";
    case FINGERPRINT_FEATUREFAIL:
    case FINGERPRINT_INVALIDIMAGE:
      return "Poor fingerprint";
    case FINGERPRINT_ENROLLMISMATCH:
      return "Finger mismatch";
    case FINGERPRINT_BADLOCATION:
      return "Bad template slot";
    case FINGERPRINT_FLASHERR:
      return "Sensor flash err";
    default:
      return "Fingerprint error";
  }
}
