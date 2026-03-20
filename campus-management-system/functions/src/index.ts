import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

admin.initializeApp();

type Role = "admin" | "ec" | "teacher" | "student";

export const adminCreateUser = functions
  .region("asia-southeast1")
  .https.onCall(async (data, context) => {
    // must be logged in
    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Login required.");
    }

    const callerUid = context.auth.uid;

    // caller must be admin (check Firestore profile)
    const callerProfileSnap = await admin.firestore().doc(`profiles/${callerUid}`).get();
    const callerRole = callerProfileSnap.exists ? callerProfileSnap.data()?.role : null;

    if (callerRole !== "admin") {
      throw new functions.https.HttpsError("permission-denied", "Admin only.");
    }

    const schoolId = String(data?.schoolId ?? "").trim();
    const role = String(data?.role ?? "").trim() as Role;
    const emailRaw = data?.email ? String(data.email).trim() : "";

    if (!schoolId) {
      throw new functions.https.HttpsError("invalid-argument", "School ID is required.");
    }

    if (!["admin", "ec", "teacher", "student"].includes(role)) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid role.");
    }

    // default email if none provided (matches your table style)
    const email = emailRaw || `${schoolId}@campus.local`;

    try {
      // Create Auth user with default password = schoolId
      const userRecord = await admin.auth().createUser({
        email,
        password: schoolId,
        disabled: false,
      });

      const uid = userRecord.uid;

      // Create Firestore profile
      await admin.firestore().doc(`profiles/${uid}`).set(
        {
          schoolId,
          email,
          role,
          mustChangePassword: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // optional: log
      await admin.firestore().collection("logs").add({
        action: "admin_create_user",
        actorUid: callerUid,
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { uid };
    } catch (err: any) {
      // common error: email already exists
      if (err?.code === "auth/email-already-exists") {
        throw new functions.https.HttpsError("already-exists", "Account already exists.");
      }

      throw new functions.https.HttpsError("internal", err?.message || "Failed to create user.");
    }
  });
