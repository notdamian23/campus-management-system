import { normalizePersonName } from "./normalizePersonName";

export type StudentNameSource = {
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
  name?: unknown;
  studentName?: unknown;
  displayName?: unknown;
  teacherName?: unknown;
  schoolId?: unknown;
};

function normalizeNameValue(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeStudentNamePart(value: unknown) {
  return normalizeNameValue(value);
}

export function buildRawStudentFullName(
  firstName?: unknown,
  lastName?: unknown,
) {
  const normalizedFirstName = normalizeStudentNamePart(firstName);
  const normalizedLastName = normalizeStudentNamePart(lastName);

  return [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");
}

export function resolveStudentRawFullName(
  source?: StudentNameSource | null,
) {
  return (
    [
      normalizeNameValue(source?.name),
      normalizeNameValue(source?.fullName),
      normalizeNameValue(source?.studentName),
      normalizeNameValue(source?.displayName),
      normalizeNameValue(source?.teacherName),
      buildRawStudentFullName(source?.firstName, source?.lastName),
    ].find(Boolean) ?? ""
  );
}

export function formatStudentFullName(
  source?: StudentNameSource | null,
  fallback = "",
) {
  const rawName = resolveStudentRawFullName(source);
  if (rawName) {
    return normalizePersonName(rawName);
  }

  const schoolId = normalizeNameValue(source?.schoolId);
  return schoolId || fallback;
}

export function formatStudentReferenceList(value: string | undefined) {
  return String(value ?? "")
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^(.*)\(([^)]+)\)$/);
      const rawName = normalizeStudentNamePart(match?.[1] ?? token);
      const schoolId = normalizeStudentNamePart(match?.[2] ?? "");
      const formattedName = formatStudentFullName({ name: rawName }, rawName);

      if (formattedName && schoolId) {
        return `${formattedName} (${schoolId})`;
      }

      return formattedName || schoolId || token;
    })
    .join("; ");
}
