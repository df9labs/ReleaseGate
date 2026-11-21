// Client-side split of the "Generic content:" review notes. Keep the prefix in step with server/health-content.ts.
export const CONTENT_NOTE_PREFIX = 'Generic content:';

export interface SlopNote { raw: string; rule?: string; phrase?: string; where?: string }
export interface SlopSplit { notes: SlopNote[]; count: number; rest: string[] }

export function splitContentNotes(limitations: readonly string[] | undefined): SlopSplit {
  const notes: SlopNote[] = [], rest: string[] = [];
  let count = 0;
  for (const raw of limitations ?? []) {
    if (!raw.startsWith(CONTENT_NOTE_PREFIX)) { rest.push(raw); continue; }
    const m = /^Generic content: \[([^\]]+)\] "(.*)" (on .+?)\. /s.exec(raw);
    const more = /^Generic content: (\d+) further/.exec(raw);
    notes.push(m ? { raw, rule: m[1], phrase: m[2], where: m[3] } : { raw });
    count += more ? Number(more[1]) : 1;
  }
  return { notes, count, rest };
}
