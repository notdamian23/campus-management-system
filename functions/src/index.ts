import * as admin from "firebase-admin";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";

admin.initializeApp();

type Role = "admin" | "ec" | "teacher" | "student";

const REGION = "asia-southeast1";
const ALLOWED_ROLES: Role[] = ["admin", "ec", "teacher", "student"];

/**
 * Maps internal/admin SDK errors to safe callable HTTPS errors.
 * @param {unknown} error The original thrown error.
 * @param {string} fallbackMessage The fallback message to expose.
 * @return {HttpsError} A sanitized callable error.
 */
function toHttpsError(
  error: unknown,
  fallbackMessage: string
): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }

  const code = typeof (error as {code?: unknown})?.code === "string" ?
    String((error as {code?: string}).code) :
    "";
  const message = typeof (error as {message?: unknown})?.message === "string" ?
    String((error as {message?: string}).message) :
    fallbackMessage;

  if (
    code === "auth/email-already-exists" ||
    code === "auth/uid-already-exists"
  ) {
    return new HttpsError("already-exists", message);
  }
  if (
    code === "auth/invalid-email" ||
    code === "auth/invalid-password" ||
    code === "auth/invalid-uid"
  ) {
    return new HttpsError("invalid-argument", message);
  }
  if (code === "auth/user-not-found") {
    return new HttpsError("not-found", message);
  }
  return new HttpsError("internal", message);
}

/**
 * Ensures the caller is authenticated and has admin role.
 * @param {CallableRequest} request Callable request context.
 * @return {Promise<Object>} The admin profile data used in logs.
 */
async function assertAdmin(
  request: CallableRequest<unknown>
): Promise<{schoolId?: string}> {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in."
    );
  }

  const snap = await admin
    .firestore()
    .doc(`profiles/${request.auth.uid}`)
    .get();
  const data = snap.data() ?? {};
  const role = data.role;

  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }

  return {schoolId: data.schoolId};
}

type CreateUserData = {
  schoolId?: string;
  role?: string;
  email?: string | null;
};

type DeleteUserData = {
  uid?: string;
};

export const adminCreateUser = onCall<CreateUserData>(
  {region: REGION},
  async (request) => {
    const adminProfile = await assertAdmin(request);
    const data = request.data;

    const schoolId = String(data?.schoolId ?? "").trim();
    const role = String(data?.role ?? "").trim() as Role;
    const emailInput = String(data?.email ?? "").trim();
    const email = emailInput || `${schoolId}@campus.local`;

    if (!schoolId) {
      throw new HttpsError(
        "invalid-argument",
        "schoolId is required"
      );
    }

    if (schoolId.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "schoolId must be at least 6 characters."
      );
    }

    if (!ALLOWED_ROLES.includes(role)) {
      throw new HttpsError("invalid-argument", "Invalid role.");
    }

    try {
      const user = await admin.auth().createUser({
        email,
        password: schoolId,
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
        actorUid: request.auth?.uid ?? null,
        actorSchoolId: adminProfile.schoolId ?? null,
        targetUid: user.uid,
        targetSchoolId: schoolId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {uid: user.uid};
    } catch (error) {
      throw toHttpsError(error, "Failed to create account.");
    }
  }
);

export const adminDeleteUser = onCall<DeleteUserData>(
  {region: REGION},
  async (request) => {
    const adminProfile = await assertAdmin(request);
    const data = request.data;

    const uid = String(data?.uid ?? "").trim();

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid required.");
    }
    if (uid === request.auth?.uid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot delete yourself."
      );
    }

    try {
      const profileSnap = await admin.firestore().doc(`profiles/${uid}`).get();
      const schoolId = profileSnap.data()?.schoolId ?? null;

      await admin.auth().deleteUser(uid);
      await admin.firestore().doc(`profiles/${uid}`).delete().catch(() => null);

      await admin.firestore().collection("logs").add({
        action: "DELETE_USER",
        actorUid: request.auth?.uid ?? null,
        actorSchoolId: adminProfile.schoolId ?? null,
        targetUid: uid,
        targetSchoolId: schoolId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {success: true};
    } catch (error) {
      throw toHttpsError(error, "Failed to remove account.");
    }
  }
);
