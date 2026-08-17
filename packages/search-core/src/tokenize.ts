/**
 * Produces the versioned lexical representation used by Phase 2 search.
 * Latin/number runs are normalized as terms; Han text is represented by
 * overlapping two-character terms so short Chinese queries remain useful.
 */
export function tokenizeLexical(text: string): string[] {
  const normalized = text.normalize('NFKC');
  const terms: string[] = [];
  const seen = new Set<string>();
  let latin = '';

  const add = (term: string) => {
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  };
  const flushLatin = () => {
    if (latin) add(latin.toLocaleLowerCase('en-US'));
    latin = '';
  };

  const characters = Array.from(normalized);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (isHan(character)) {
      flushLatin();
      const next = characters[index + 1];
      if (next && isHan(next)) add(`${character}${next}`);
      continue;
    }
    if (isLetterOrNumber(character)) {
      latin += character;
    } else {
      flushLatin();
    }
  }
  flushLatin();
  return terms;
}

function isHan(character: string): boolean {
  return /\p{Script=Han}/u.test(character);
}

function isLetterOrNumber(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character) && !isHan(character);
}
