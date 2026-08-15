/**
 * Term normalisation, shared by the seed and the query path.
 *
 * This being one function is the whole point. If the seed stored `"Motor Jal
 * Gayi"` and the query looked up `"motor jal gayi"`, nothing would ever match
 * and the bug would look like "synonyms don't work" rather than "two places
 * lowercase differently". Both sides call this.
 *
 * Devanagari has no case, so `toLowerCase()` is a no-op there — but NFC
 * normalisation is not. `मोटर` can be encoded with precomposed or decomposed
 * vowel signs, which compare unequal as strings while looking identical on
 * screen. Everything is folded to NFC before comparison.
 */

/** Punctuation people type that carries no meaning for matching. */
const STRIPPABLE = /[!?.,;:'"“”‘’()[\]{}<>/\\|@#$%^&*_+=~`]/g;

/** Devanagari danda and double danda — sentence terminators, not content. */
const DANDA = /[।॥]/g;

export function normalizeSearchTerm(input: string): string {
  return (
    input
      .normalize('NFC')
      .toLowerCase()
      .replace(DANDA, ' ')
      .replace(STRIPPABLE, ' ')
      // Collapse every run of whitespace, including the non-breaking spaces that
      // come from copy-paste, into a single ordinary space.
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Rough guard against someone pasting an essay into the search box. */
export const MAX_QUERY_LENGTH = 120;

export function isUsableQuery(normalized: string): boolean {
  return normalized.length > 0 && normalized.length <= MAX_QUERY_LENGTH;
}

/**
 * Splits a normalised phrase into words, for prefix matching on the last token
 * while the user is still typing.
 */
export function tokens(normalized: string): string[] {
  return normalized.split(' ').filter((token) => token.length > 0);
}
