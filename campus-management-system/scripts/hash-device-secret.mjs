import {createHash} from "crypto";

const [deviceId, secret] = process.argv.slice(2);

if (!deviceId || !secret) {
  console.error("Usage: node scripts/hash-device-secret.mjs <deviceId> <deviceSecret>");
  process.exit(1);
}

const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");

console.log(JSON.stringify({
  deviceId,
  label: deviceId,
  enabled: true,
  sessionVersion: 1,
  secretHash,
}, null, 2));
