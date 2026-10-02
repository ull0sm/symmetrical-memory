/**
 * Which bouts of a category a tatami's assignment covers. A whole-category assignment ('ALL')
 * covers every bout; a split category's pool or finals assignment covers only its own part.
 */
export function assignmentCoversMatch(assignmentPart: string | null | undefined, matchPart: string | null | undefined): boolean {
  const part = assignmentPart ?? 'ALL';
  return part === 'ALL' || part === (matchPart ?? null);
}

/** The assignment part a bout belongs to, as stored on `category_assignments.part`. */
export function assignmentPartOfMatch(matchPart: string | null | undefined): string {
  return matchPart ?? 'ALL';
}

/** "Pools 1-2", "Pool 3", "Finals", or null for a whole category: how a part is named on screens. */
export function describePart(part: string | null | undefined): string | null {
  if (!part || part === 'ALL') return null;
  if (part === 'FINALS') return 'Finals';
  const found = /^POOL:(\d+)$/.exec(part);
  return found ? `Pool ${found[1]}` : null;
}
