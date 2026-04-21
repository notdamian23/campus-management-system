export type CampusCanonicalRole =
  | "admin"
  | "ecmember"
  | "bod"
  | "teacher"
  | "student";

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return trimValue(value).toLowerCase();
}

export function isEcRole(role?: unknown) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "ec" || normalized === "ecmember";
}

export function isBodRole(role?: unknown) {
  return normalizeLower(role) === "bod";
}

export function isEcWorkspaceRole(role?: unknown) {
  return isEcRole(role) || isBodRole(role);
}

export function normalizeCampusRole(value: unknown): CampusCanonicalRole | "" {
  const normalized = normalizeLower(value);
  if (!normalized) {
    return "";
  }

  const compact = normalized.replace(/[^a-z]/g, "");
  if (compact === "admin") return "admin";
  if (compact === "teacher") return "teacher";
  if (compact === "student") return "student";
  if (compact === "bod") return "bod";
  if (isEcRole(compact) || compact === "ecmemberprofile") {
    return "ecmember";
  }

  return "";
}

export function isECMemberCampusRole(value: unknown) {
  return isEcRole(value) || normalizeCampusRole(value) === "ecmember";
}

export function resolveCampusRoleHome(value: unknown) {
  const role = normalizeCampusRole(value);
  if (role === "teacher") return "/teacher";
  if (role === "student") return "/student";
  if (role === "bod") return "/ecmember";
  if (role === "ecmember") return "/ecmember";
  if (role === "admin") return "/admin";
  return "/";
}
