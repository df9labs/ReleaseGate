import feedhive from './rules/feedhive-slop-patterns.json';

// Matcher table for the "Generic AI content" review notes.
//
// FeedHive's patterns (server/rules/feedhive-slop-patterns.json, MIT, see THIRD_PARTY_NOTICES.md) are
// prose descriptions, not regexes. This table maps the ones that can be matched reliably from text
// to hand-written regexes, keyed by FeedHive id. Everything else is listed in SKIPPED below.
//
// Matching is deliberately narrow: phrases, not single everyday words ("key", "journey", "rich",
// "critical" and "explore" are NOT matched). A single hit is normal copy; the density rule in
// health-content.ts decides when a page is worth a note.

export interface ContentRule {
  id: string;
  name: string;
  better?: string;
  re: RegExp;
  /** Reported on its own: one hit is enough (chatbot residue, citation debris). */
  strong?: boolean;
  /** Own tagline clichés: noted even once when they appear in a heading or hero block. */
  tagline?: boolean;
  /** Only applied to headings and hero blocks, because the shape is too loose for body text. */
  heroOnly?: boolean;
}

const apos = "['’]";
const a = (s: string) => s.replace(/'(?=(?:s|re|ve|t|ll|d)\b)/g, apos);
const rx = (source: string, flags = 'gi') => new RegExp(a(source), flags);

type Spec = [id: string, source: string, flags?: string, strong?: boolean];

// FeedHive ids we match.
const specs: Spec[] = [
  ['V-01', String.raw`\bdelv(?:e|es|ed|ing)\b|\bdiv(?:e|es|ing) into\b|\bdeep dive\b|\bunpack(?:s|ing)? (?:the|how|what|why)\b`],
  ['V-02', String.raw`\b(?:rich )?tapestry\b|\brealm of\b|\b(?:ever-evolving|ever-changing|evolving|digital) landscape\b`],
  ['V-03', String.raw`\btestament to\b|\bbeacon of\b|\bembodiment of\b|\bhallmark of\b`],
  ['V-04', String.raw`\bpivotal\b|\bparamount\b|\bcrucial\b`],
  ['V-05', String.raw`\bunderscor(?:e|es|ed|ing)\b`],
  ['V-06', String.raw`\bfoster(?:s|ing)? (?:a |an |the )?(?:sense|culture|innovation|growth|collaboration|community|environment)\b|\bcultivat(?:e|es|ing) (?:a|an|the) `],
  ['V-07', String.raw`\bleverag(?:e|es|ing)\b|\butiliz(?:e|es|ing)\b|\bharness(?:es|ing)?\b|\bcapitaliz(?:e|es|ing) on\b`],
  ['V-08', String.raw`\belevat(?:e|es|ing) (?:your|the|our)\b|\bempower(?:s|ing)?\b|\bsupercharg(?:e|es|ing)\b|\bunlock(?:s|ing)? (?:the|your|new)\b|\bamplif(?:y|ies|ying) (?:your|the)\b`],
  ['V-09', String.raw`\bseamless(?:ly)?\b|\bcutting-edge\b|\bstate-of-the-art\b|\bbest-in-class\b|\bworld-class\b`],
  ['V-10', String.raw`\bintricate\b|\bmultifaceted\b|\bnuanced\b`],
  ['V-11', String.raw`\bmeticulous(?:ly)?\b|\bpainstakingly\b|\bcarefully crafted\b`],
  ['V-12', String.raw`\bvibrant\b|\bbustling\b`],
  ['V-13', String.raw`\bembark(?:s|ed|ing)? on\b|\byour journey\b`],
  ['V-14', String.raw`\bgame[- ]?chang(?:er|ers|ing)\b|\brevolutionary\b|\bgroundbreaking\b|\btransformative\b|\bparadigm shift\b`],
  ['V-15', String.raw`(?:^|[.!?]\s+)(?:Additionally|Furthermore|Moreover|Notably|Importantly),`, 'g'],
  ['V-16', String.raw`\bincredibly\b|\bprofoundly\b|\bremarkably\b`],
  ['V-18', String.raw`\bresonat(?:e|es|ing) with\b`],
  ['V-20', String.raw`\bin the digital age\b|\bin an era of\b|\bnow more than ever\b|\bin today's (?:digital|modern|ever-changing) (?:world|age|landscape)\b`],
  ['P-01', String.raw`\bit's worth noting\b|\bit's important to note\b|\bit should be noted\b`],
  ['P-02', String.raw`\bat its core\b|\bat the end of the day\b|\bwhen all is said and done\b`],
  ['P-03', String.raw`\bwhen it comes to\b|\bin the world of\b|\bwith regard to\b`],
  ['P-04', String.raw`\blet's dive in\b|\bbuckle up\b|\bwithout further ado\b`],
  ['P-05', String.raw`\bplays? an? (?:key|vital|crucial|significant|pivotal|important) role in\b`],
  ['P-06', String.raw`\bstands as (?:a|an|the)\b|\bserves as (?:a|an|the)\b`],
  ['P-07', String.raw`\bnavigat(?:e|es|ing) the (?:complexit(?:y|ies)|landscape|challenges)\b|\bthe ins and outs of\b|\bthe nuances of\b`],
  ['P-08', String.raw`\bwhether you're (?:a|an) [^.!?]{1,40}? or (?:a|an) |\bfrom startups to enterprises\b`],
  ['P-09', String.raw`\blook no further\b|\byou've come to the right place\b|\bthis is your ultimate guide\b`],
  ['P-10', String.raw`\bunlock the power of\b|\bharness the potential of\b|\btake it to the next level\b`],
  ['P-11', String.raw`\bhere's the thing\b|\bhere's the deal\b|\blet me be clear\b|\bI'll be honest\b|\bI'll be straight with you\b`],
  ['P-12', String.raw`\bthe truth is\b|\bthe reality is\b|\bthe (?:uncomfortable|hard) truth\b`],
  ['P-13', String.raw`\bI hope this helps\b|\bhappy writing\b|\blet me know if you have any questions\b`],
  ['P-14', String.raw`(?:^|[.!?]\s+)(?:In conclusion|In summary|To sum up|All in all),`, 'g'],
  ['P-15', String.raw`\bthe future is bright\b|\bthe possibilities are endless\b|\bonly time will tell\b|\bthe sky's the limit\b`],
  ['S-01', String.raw`\b(?:it's|it is|this is|that's) not (?:just |only |about |a |an )?[^.!?;:]{1,50}?[.,;—–-]\s*(?:it's|it is|this is|that's) (?:about |a |an |the )?|\b(?:this|it|that) isn't (?:just |only |about )?[^.!?;:]{1,50}?[.,;]\s*(?:it's|it is) `],
  ['S-02', String.raw`\bnot (?:just|only|merely) [^.!?;]{1,60}?,?\s*(?:but|it's|it is) (?:also )?`],
  ['S-03', String.raw`\bthe (?:question|problem) isn't [^.!?]{1,60}[.,]\s*(?:it's|the (?:question|problem) is)`],
  ['S-06', String.raw`\bthe obvious question is\b|\byou (?:might|may) be wondering\b`],
  ['S-08', String.raw`\bwhat nobody tells you\b|\bthe part most people miss\b|\bhere's what most (?:people )?get wrong\b`],
  ['S-09', String.raw`\bthis is where it gets interesting\b|\bthis changes everything\b|\bthat's where things get wild\b`],
  ['S-16', String.raw`\bboasts (?:a|an|over|more|some)\b`],
  ['S-17', String.raw`\bimagine a world\b|\bpicture this\b|\bwhat if I told you\b`],
  ['S-18', String.raw`\b(?:may|could|might) potentially\b|\bcould possibly\b`],
  ['R-10', String.raw`\bdespite (?:these|its|the) challenges,? [^.]{0,40}future\b`],
  ['R-11', String.raw`\band honestly,|\bso yeah\b`],
  ['M-05', String.raw`\bcatalyst for\b|\bspringboard (?:for|to)\b|\bflywheel\b`],
  ['M-06', String.raw`\bsecret sauce\b|\bsilver bullet\b|\bholy grail\b`],
  ['C-01', String.raw`\bmarks? a (?:pivotal|significant|turning) (?:moment|point|shift)\b|\ba significant shift\b`],
  ['C-02', String.raw`\bexperts agree\b|\bstudies show\b|\bmany believe\b|\bit is widely regarded\b|\bwidely regarded as\b`],
  ['C-09', String.raw`\bfeatured in top outlets\b|\bwidely recognized\b|\bhas an active social media presence\b`],
  ['C-12', String.raw`\beverything you need to know\b|\bthe ultimate guide\b|\bmaster \w+ in minutes\b`],
  ['F-03', String.raw`[✅🚀💡👉]`, 'gu'],
  ['F-06', String.raw`\*\*[^*\s][^*]{0,60}\*\*|(?:^|\n)#{1,6} \S`, 'g'],
  ['F-09', String.raw`[\u{1D400}-\u{1D7FF}]{3,}`, 'gu'],
  ['B-01', String.raw`(?:^|[.!?]\s+)(?:Certainly|Absolutely|Great question|Of course)!`, 'g'],
  ['B-02', String.raw`\byou're absolutely right\b|\bwhat a great idea\b`],
  ['B-03', String.raw`\bwould you like me to\b|\blet me know if you'd like (?:a|an|me)\b`],
  ['B-04', String.raw`(?:^|[.!?]\s+)here is an? (?:polished|revised|rewritten|improved|updated|refined) `, 'g', true],
  ['B-05', String.raw`\[insert [^\]]{1,40}\]|\bXX%`, 'g', true],
  ['B-06', String.raw`\bas an AI(?: language model)?\b|\bas a language model\b|\bmy knowledge (?:is limited|cutoff)\b`, 'gi', true],
  ['B-07', String.raw`\bbased on available information\b|\bspecific details are limited\b`],
  ['B-08', String.raw`\bcontentReference\b|\boaicite\b|\bturn\d+search\d+\b`, 'gi', true],
  ['L-02', String.raw`\bunpopular opinion:`],
  ['L-03', String.raw`\b(?:thrilled|excited|humbled) to announce\b`],
  ['L-04', String.raw`\bread that again\b|\blet that sink in\b`],
  ['L-07', String.raw`\bI don't usually post this\b`],
  ['L-09', String.raw`(?:#\w+\s+){10,}`, 'g'],
  ['L-10', String.raw`\bthat's it\. that's the post\b`],
  ['L-12', String.raw`\bno fluff,? just value\b|\breal talk\b`],
];

// FeedHive ids we do NOT match, and why. Together with the ids above these cover all 120 patterns
// (tests/health-content.test.ts checks the partition).
export const SKIPPED: Record<string, string[]> = {
  'ordinary words that are too common to match safely': ['V-17', 'V-19', 'S-15', 'S-19', 'S-20', 'M-01', 'M-02', 'M-03', 'M-04'],
  'sentence shape, rhythm or layout (needs more than a text match)': [
    'S-04', 'S-05', 'S-07', 'S-10', 'S-11', 'S-12', 'S-13', 'S-14', 'S-21', 'S-22',
    'R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08', 'R-09', 'R-12',
    'F-01', 'F-02', 'F-04', 'F-05', 'F-07', 'F-08', 'F-10', 'L-01', 'L-08', 'L-14',
  ],
  'substance or judgement (needs a reader, not a matcher)': ['C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-10', 'C-11'],
  'social-media or comment context that does not appear on ordinary pages': ['L-05', 'L-06', 'L-11', 'L-13', 'L-15'],
};

// Our own hero and tagline clichés that FeedHive does not cover. Listed first so that, where a
// phrase also appears in a FeedHive pattern (for example "look no further"), this id wins.
const taglines: ContentRule[] = [
  {
    id: 'DF9-T', name: 'Tagline cliché', tagline: true,
    re: rx(
      String.raw`\bideas made real\b|\bwhere [\w' -]{2,30}? meets [\w' -]{2,30}?(?=[.,!?]|$)|\b[\w' -]{2,30}?, reimagined\b|\bbuilt for the future\b|` +
      String.raw`\byour journey starts here\b|\bunlock the power of\b|\bin today's fast-paced world\b|\bseamless experiences?\b|\belevate your\b|` +
      String.raw`\bcutting-edge solutions\b|\bgame[- ]?changer\b|\brevolutioni[sz](?:e|es|ing)\b|\blook no further\b|\bnext[- ]level\b|` +
      String.raw`\bempower(?:s|ing) [\w' -]{2,30}? to [\w' -]{2,30}?(?=[.,!?]|$)|` +
      String.raw`\ba home for your [\w'-]+|\b(?:built|designed|tailored|crafted) around (?:you|your (?:business|needs|brand|goals))\b|\btailored to you\b`,
    ),
  },
  {
    // Sentence-shape families. Loose on purpose, so they run on h1/h2 and hero text only.
    id: 'DF9-T', name: 'Tagline cliché', tagline: true, heroOnly: true,
    re: rx(
      String.raw`\bnot (?:just|only|merely) an? [\w' -]{2,40}[.!—–-]\s*[\w' -]{3,40}|` + // Not just X. Y.
      String.raw`\ban? [a-z]+ [a-z]+(?: [a-z]+)?\.\s+an? [a-z]+ [a-z]+|` + // A <adj> X. A <adj> Y.
      String.raw`\byour [\w' -]{2,25}[.!—–-]\s*our [\w' -]{2,25}|` + // Your X. Our Y.
      String.raw`\bno [\w' -]{2,30}[.,—–-]\s*just [\w' -]{2,40}|` + // No X. Just Y.
      String.raw`\b(?:small|little|tiny|simple) [\w' -]{2,20}[.,]\s*(?:big|bigger|great|bold) [\w' -]{2,30}|` + // Small X. Big Y.
      String.raw`[\w'-]+(?: [\w'-]+){0,3} [×✕] [\w'-]+(?: [\w'-]+){0,3}|` + // X × Y
      String.raw`\b[\w' -]{2,30} meets [\w' -]{2,30}|` + // X meets Y
      String.raw`\bwith (?:intention|purpose)\b`,
    ),
  },
];

const FEEDHIVE = new Map<string, { name: string; better?: string }>();
for (const category of feedhive.categories)
  for (const p of category.patterns) FEEDHIVE.set(p.id, { name: p.name, better: p.better });

export const FEEDHIVE_PATTERN_IDS = [...FEEDHIVE.keys()];

export const contentRules: ContentRule[] = [
  ...taglines,
  ...specs.map(([id, source, flags = 'gi', strong]): ContentRule => {
    const meta = FEEDHIVE.get(id);
    if (!meta) throw new Error('Unknown FeedHive pattern id ' + id);
    return { id, name: meta.name, better: meta.better, re: rx(source, flags), strong };
  }),
];

export const matchedFeedhiveIds = () => [...new Set(specs.map(([id]) => id))];
