const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

async function assertAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be signed in."
    );
  }

  const snap = await admin
    .firestore()
    .doc(`profiles/${context.auth.uid}`)
    .get();

  const role = snap.data()?.role;

  if (role !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin only."
    );
  }
}

// -------------------------
// CREATE USER
// -------------------------
exports.adminCreateUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const schoolId = String(data.schoolId || "").trim();
  const role = String(data.role || "").trim();
  const email = data.email
    ? String(data.email).trim()
    : `${schoolId}@campus.local`;

  if (!schoolId)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "schoolId is required"
    );

  if (!["admin", "ec", "teacher", "student"].includes(role))
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid role"
    );

  const user = await admin.auth().createUser({
    email,
    password: schoolId, // default password = school ID
  });

  await admin.firestore().doc(`profiles/${user.uid}`).set({
    schoolId,
    role,
    email,
    mustChangePassword: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await admin.firestore().collection("logs").add({
    action: "CREATE_USER",
    actorUid: context.auth.uid,
    targetUid: user.uid,
    targetSchoolId: schoolId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { uid: user.uid };
});

// -------------------------
// DELETE USER
// -------------------------
exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const uid = String(data.uid || "").trim();

  if (!uid)
    throw new functions.https.HttpsError(
      "invalid-argument",
      "uid required"
    );

  if (uid === context.auth.uid)
    throw new functions.https.HttpsError(
      "failed-precondition",
      "You cannot delete yourself."
    );

  const profileSnap = await admin
    .firestore()
    .doc(`profiles/${uid}`)
    .get();

  const schoolId = profileSnap.data()?.schoolId || null;

  await admin.auth().deleteUser(uid);
  await admin.firestore().doc(`profiles/${uid}`).delete().catch(() => {});

  await admin.firestore().collection("logs").add({
    action: "DELETE_USER",
    actorUid: context.auth.uid,
    targetUid: uid,
    targetSchoolId: schoolId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
