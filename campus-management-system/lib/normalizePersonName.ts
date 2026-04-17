/**
 * Normalize person names to proper title case with special handling for particles and suffixes
 * Examples:
 * - "MC JERREL ABALA" -> "Mc Jerrel Abala"
 * - "juan dela cruz" -> "Juan Dela Cruz"
 * - "MARIA CLARA DE LOS SANTOS" -> "Maria Clara de los Santos"
 * - "JOHN PAUL DELA CRUZ JR." -> "John Paul Dela Cruz Jr."
 * - "ANNE-MARIE O'BRIEN" -> "Anne-Marie O'Brien"
 */

const LOWERCASE_PARTICLES = new Set([
  "de",
  "del",
  "della",
  "dela",
  "di",
  "da",
  "dos",
  "das",
  "van",
  "von",
  "mit",
  "und",
  "et",
  "and",
  "y",
  "o",
]);

const UPPERCASE_SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
  "esq",
  "phd",
  "md",
  "dds",
  "dvm",
]);

const APOSTROPHE_SEPARATORS = ["'", "’"] as const;

function isSuffix(word: string): boolean {
  const lower = word.toLowerCase().replace(/\.$/g, "");
  return UPPERCASE_SUFFIXES.has(lower);
}

function isParticle(word: string): boolean {
  return LOWERCASE_PARTICLES.has(word.toLowerCase());
}

function shouldLowercase(word: string, index: number, totalWords: number): boolean {
  // Don't lowercase first or last word
  if (index === 0 || index === totalWords - 1) {
    return false;
  }

  // Don't lowercase suffixes
  if (isSuffix(word)) {
    return false;
  }

  // Lowercase particles
  if (isParticle(word)) {
    return true;
  }

  return false;
}

function formatWord(word: string): string {
  if (!word) return "";

  // Handle hyphenated words (e.g., "anne-marie", "mary-jane")
  if (word.includes("-")) {
    return word
      .split("-")
      .map((part) => {
        if (!part) return "";
        if (isSuffix(part)) {
          return part.toUpperCase().replace(/\.$/, "");
        }
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join("-");
  }

  // Preserve both straight and curly apostrophes for names like O'Brien/O’Brien.
  const apostropheSeparator = APOSTROPHE_SEPARATORS.find((separator) =>
    word.includes(separator),
  );
  if (apostropheSeparator) {
    return word
      .split(apostropheSeparator)
      .map((part) => {
        if (!part) return "";
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(apostropheSeparator);
  }

  // Handle suffixes with periods (e.g., "Jr.", "Sr.")
  const hasPeriod = word.endsWith(".");
  const cleanWord = word.replace(/\.$/g, "");

  if (isSuffix(cleanWord)) {
    const suffix = cleanWord.toUpperCase();
    return hasPeriod ? `${suffix}.` : suffix;
  }

  // Regular title case
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function normalizePersonName(rawName: string): string {
  if (!rawName) return "";

  // Trim and collapse multiple spaces
  const trimmed = rawName.trim().replace(/\s+/g, " ");

  // Split into words
  const words = trimmed.split(/\s+/);

  if (words.length === 0) return "";

  // Format each word
  const formattedWords = words.map((word, index) => {
    if (shouldLowercase(word, index, words.length)) {
      return word.toLowerCase();
    }
    return formatWord(word);
  });

  return formattedWords.join(" ");
}
