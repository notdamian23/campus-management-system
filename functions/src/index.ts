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
 * Ensures the caller is authenticated and has one of allowed roles.
 * @param {CallableRequest} request Callable request context.
 * @param {Role[]} allowedRoles Allowed roles for this action.
 * @param {string} permissionMessage Error message for denied access.
 * @return {Promise<Object>} The profile data used in logs.
 */
async function assertRole(
  request: CallableRequest<unknown>,
  allowedRoles: Role[],
  permissionMessage: string
): Promise<{schoolId?: string; role?: Role}> {
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
  const role = String(data.role ?? "").trim() as Role;

  if (!ALLOWED_ROLES.includes(role) || !allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", permissionMessage);
  }

  return {schoolId: data.schoolId, role};
}

/**
 * Ensures the caller is authenticated and has admin role.
 * @param {CallableRequest} request Callable request context.
 * @return {Promise<Object>} The admin profile data used in logs.
 */
async function assertAdmin(
  request: CallableRequest<unknown>
): Promise<{schoolId?: string}> {
  const profile = await assertRole(request, ["admin"], "Admin only.");
  return {schoolId: profile.schoolId};
}

/**
 * Ensures the caller is authenticated and has admin or ec role.
 * @param {CallableRequest} request Callable request context.
 * @return {Promise<Object>} The caller profile data used in logs.
 */
async function assertAdminOrEC(
  request: CallableRequest<unknown>
): Promise<{schoolId?: string; role?: Role}> {
  return assertRole(request, ["admin", "ec"], "EC or admin only.");
}

type CreateUserData = {
  schoolId?: string;
  role?: string;
  email?: string | null;
  studentName?: string | null;
  course?: string | null;
  year?: string | null;
};

type CreateStudentData = {
  schoolId?: string;
  studentName?: string | null;
  course?: string | null;
  year?: string | null;
  email?: string | null;
};

type ListStudentsData = {
  limit?: number;
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
    const studentName = String(data?.studentName ?? "").trim();
    const course = String(data?.course ?? "").trim();
    const year = String(data?.year ?? "").trim();
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

    if (role === "student") {
      if (!studentName) {
        throw new HttpsError(
          "invalid-argument",
          "studentName is required for student role."
        );
      }
      if (!course) {
        throw new HttpsError(
          "invalid-argument",
          "course is required for student role."
        );
      }
      if (!year) {
        throw new HttpsError(
          "invalid-argument",
          "year is required for student role."
        );
      }
    }

    try {
      const user = await admin.auth().createUser({
        email,
        password: schoolId,
      });

      const profileData: {
        schoolId: string;
        role: Role;
        email: string;
        mustChangePassword: boolean;
        createdAt: admin.firestore.FieldValue;
        studentName?: string;
        course?: string;
        year?: string;
      } = {
        schoolId,
        role,
        email,
        mustChangePassword: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (role === "student") {
        profileData.studentName = studentName;
        profileData.course = course;
        profileData.year = year;
      }

      await admin.firestore().doc(`profiles/${user.uid}`).set(profileData);

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

export const ecCreateStudent = onCall<CreateStudentData>(
  {region: REGION},
  async (request) => {
    const actorProfile = await assertAdminOrEC(request);
    const data = request.data;

    const schoolId = String(data?.schoolId ?? "").trim();
    const studentName = String(data?.studentName ?? "").trim();
    const course = String(data?.course ?? "").trim();
    const year = String(data?.year ?? "").trim();
    const emailInput = String(data?.email ?? "").trim();
    const email = emailInput || `${schoolId}@campus.local`;

    if (!schoolId) {
      throw new HttpsError("invalid-argument", "schoolId is required");
    }
    if (schoolId.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "schoolId must be at least 6 characters."
      );
    }
    if (!studentName) {
      throw new HttpsError(
        "invalid-argument",
        "studentName is required."
      );
    }
    if (!course) {
      throw new HttpsError(
        "invalid-argument",
        "course is required."
      );
    }
    if (!year) {
      throw new HttpsError(
        "invalid-argument",
        "year is required."
      );
    }

    try {
      const user = await admin.auth().createUser({
        email,
        password: schoolId,
      });

      await admin.firestore().doc(`profiles/${user.uid}`).set({
        schoolId,
        role: "student",
        email,
        studentName,
        course,
        year,
        mustChangePassword: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await admin.firestore().collection("logs").add({
        action: "CREATE_STUDENT",
        actorUid: request.auth?.uid ?? null,
        actorSchoolId: actorProfile.schoolId ?? null,
        targetUid: user.uid,
        targetSchoolId: schoolId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {uid: user.uid};
    } catch (error) {
      throw toHttpsError(error, "Failed to create student account.");
    }
  }
);

export const ecListStudents = onCall<ListStudentsData>(
  {region: REGION},
  async (request) => {
    await assertAdminOrEC(request);

    const requestedLimit = Number(request.data?.limit ?? 2000);
    const safeLimit = Number.isFinite(requestedLimit) ?
      Math.max(1, Math.min(2000, Math.floor(requestedLimit))) :
      2000;

    try {
      const snap = await admin
        .firestore()
        .collection("profiles")
        .where("role", "==", "student")
        .limit(safeLimit)
        .get();

      const students = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        const createdAt = data.createdAt as
          {toMillis?: () => number} |
          undefined;
        const createdAtMs = createdAt?.toMillis ? createdAt.toMillis() : null;

        return {
          uid: docSnap.id,
          schoolId: String(data.schoolId ?? ""),
          studentName: String(data.studentName ?? ""),
          name: String(data.name ?? ""),
          course: String(data.course ?? ""),
          year: String(data.year ?? ""),
          status: String(data.status ?? "Active"),
          email: String(data.email ?? ""),
          createdAtMs,
        };
      });

      return {students};
    } catch (error) {
      throw toHttpsError(error, "Failed to list students.");
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
