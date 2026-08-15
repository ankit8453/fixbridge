import { describe, expect, it } from 'vitest';
import { MAX_QUERY_LENGTH, isUsableQuery, normalizeSearchTerm, tokens } from './normalize';

describe('normalizeSearchTerm', () => {
  it('lowercases and trims Latin text', () => {
    expect(normalizeSearchTerm('  Motor Jal Gayi  ')).toBe('motor jal gayi');
    expect(normalizeSearchTerm('MOTOR JAL GAYI')).toBe('motor jal gayi');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeSearchTerm('motor   jal\tgayi')).toBe('motor jal gayi');
    expect(normalizeSearchTerm('nal\n\ntapak')).toBe('nal tapak');
  });

  it('leaves Devanagari intact — it has no case to fold', () => {
    expect(normalizeSearchTerm('मोटर जल गई')).toBe('मोटर जल गई');
    expect(normalizeSearchTerm('  बिजली  ')).toBe('बिजली');
  });

  /**
   * The bug this function exists to prevent: the seed and the query path
   * disagreeing about what a term looks like. Mixed-script input with mixed case
   * has to land on the same string from either side.
   */
  it('handles mixed Devanagari and Latin with mixed case', () => {
    expect(normalizeSearchTerm('AC ठंडा Nahi')).toBe('ac ठंडा nahi');
    expect(normalizeSearchTerm('  Motor मोटर  JAL  ')).toBe('motor मोटर jal');
  });

  it('folds to NFC, so identical-looking text compares equal', () => {
    /**
     * क़ can be typed as the single code point U+0958, or as क (U+0915) followed
     * by a nukta (U+093C). They render identically and compare unequal as raw
     * strings — which would mean a synonym seeded one way never matches a query
     * typed the other. NFC collapses both to the same sequence.
     */
    const singleCodePoint = 'क़';
    const withCombiningNukta = 'क़';

    expect(singleCodePoint).not.toBe(withCombiningNukta);
    expect(normalizeSearchTerm(singleCodePoint)).toBe(normalizeSearchTerm(withCombiningNukta));
  });

  it('strips punctuation people type but do not mean', () => {
    expect(normalizeSearchTerm('motor jal gayi?')).toBe('motor jal gayi');
    expect(normalizeSearchTerm('"nal tapak raha!"')).toBe('nal tapak raha');
    expect(normalizeSearchTerm('a.c. service')).toBe('a c service');
  });

  it('strips the Devanagari danda', () => {
    expect(normalizeSearchTerm('मोटर जल गई।')).toBe('मोटर जल गई');
    expect(normalizeSearchTerm('बिजली॥')).toBe('बिजली');
  });

  it('is idempotent', () => {
    const once = normalizeSearchTerm('  AC ठंडा Nahi!!  ');
    expect(normalizeSearchTerm(once)).toBe(once);
  });

  it('returns empty for input with no content', () => {
    expect(normalizeSearchTerm('')).toBe('');
    expect(normalizeSearchTerm('   ')).toBe('');
    expect(normalizeSearchTerm('!!!')).toBe('');
  });
});

describe('isUsableQuery', () => {
  it('accepts an ordinary phrase', () => {
    expect(isUsableQuery('motor jal gayi')).toBe(true);
  });

  it('rejects nothing and rejects an essay', () => {
    expect(isUsableQuery('')).toBe(false);
    expect(isUsableQuery('x'.repeat(MAX_QUERY_LENGTH + 1))).toBe(false);
  });

  it('accepts exactly the maximum length', () => {
    expect(isUsableQuery('x'.repeat(MAX_QUERY_LENGTH))).toBe(true);
  });
});

describe('tokens', () => {
  it('splits a normalised phrase', () => {
    expect(tokens('motor jal gayi')).toEqual(['motor', 'jal', 'gayi']);
    expect(tokens('मोटर जल गई')).toEqual(['मोटर', 'जल', 'गई']);
  });

  it('returns nothing for an empty phrase', () => {
    expect(tokens('')).toEqual([]);
  });
});
