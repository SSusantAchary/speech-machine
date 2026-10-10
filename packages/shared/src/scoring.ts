import type { MetricsPoint, ScoreBreakdown, SessionInput, TranscriptSegment } from "./types";

const FILLER_WORDS = [
  "um",
  "uh",
  "like",
  "you know",
  "actually",
  "basically",
  "literally",
];

const STRUCTURE_WORDS = [
  "first",
  "second",
  "third",
  "because",
  "therefore",
  "however",
  "so",
  "thus",
];

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export const countWords = (segments: TranscriptSegment[]) =>
  segments.reduce((acc, seg) => acc + tokenize(seg.text).length, 0);

export const countFillers = (segments: TranscriptSegment[]) => {
  const text = segments.map((seg) => seg.text.toLowerCase()).join(" ");
  let count = 0;
  for (const filler of FILLER_WORDS) {
    const pattern = new RegExp(`\\b${filler.replace(" ", "\\s+")}\\b`, "g");
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
};

export const computeWpm = (wordCount: number, durationMs: number) => {
  if (durationMs <= 0) return 0;
  return Math.round((wordCount / (durationMs / 60000)) * 10) / 10;
};

const scoreWpm = (wpm: number) => {
  if (wpm >= 120 && wpm <= 160) return 18;
  if ((wpm >= 100 && wpm < 120) || (wpm > 160 && wpm <= 180)) return 10;
  return 4;
};

const scoreFillers = (fillersPerMinute: number) => {
  if (fillersPerMinute <= 2) return 12;
  if (fillersPerMinute <= 6) return 8;
  return 3;
};

const scorePauses = (pauseEvents: number[], durationMs: number) => {
  if (!pauseEvents.length) {
    return 4;
  }
  const natural = pauseEvents.filter((p) => p >= 600 && p <= 1500).length;
  const long = pauseEvents.filter((p) => p > 1500).length;
  const minutes = Math.max(durationMs / 60000, 0.1);
  const rate = natural / minutes;
  if (long > Math.max(2, minutes)) {
    return 4;
  }
  if (rate >= 2 && rate <= 6) return 10;
  if (rate >= 1) return 7;
  return 5;
};

const scoreEyeContact = (eyeContactPct: number) => {
  if (eyeContactPct > 0.7) return 15;
  if (eyeContactPct >= 0.4) return 10;
  return 5;
};

const scoreSmile = (smileAvg: number) => Math.round(7 * Math.min(1, Math.max(smileAvg, 0)));

const scoreHeadStability = (yawVar: number, pitchVar: number, rollVar: number) => {
  const totalVar = yawVar + pitchVar + rollVar;
  if (totalVar < 5) return 8;
  if (totalVar < 12) return 6;
  return 4;
};

const scoreStructure = (segments: TranscriptSegment[]) => {
  const words = tokenize(segments.map((s) => s.text).join(" "));
  const count = words.filter((w) => STRUCTURE_WORDS.includes(w)).length;
  if (count >= 4) return 10;
  if (count >= 2) return 7;
  return 4;
};

const scoreRepetition = (segments: TranscriptSegment[]) => {
  const words = tokenize(segments.map((s) => s.text).join(" "));
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  const repeated = Array.from(freq.values()).filter((count) => count >= 6).length;
  if (repeated >= 3) return -8;
  if (repeated >= 1) return -4;
  return 0;
};

const scoreClarity = (segments: TranscriptSegment[]) => {
  const sentences = segments
    .map((s) => s.text)
    .join(" ")
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return 0;
  const lengths = sentences.map((s) => tokenize(s).length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg >= 8 && avg <= 20) return 12;
  if (avg >= 5 && avg <= 25) return 8;
  return 4;
};

const scoreKeywordCoverage = (segments: TranscriptSegment[], keywords: string[]) => {
  if (!keywords.length) return 0;
  const text = segments.map((s) => s.text.toLowerCase()).join(" ");
  const covered = keywords.filter((k) => text.includes(k.toLowerCase())).length;
  const ratio = covered / keywords.length;
  if (ratio >= 0.8) return 8;
  if (ratio >= 0.5) return 5;
  return 2;
};

const avg = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

const variance = (values: number[]) => {
  if (!values.length) return 0;
  const mean = avg(values);
  return avg(values.map((v) => (v - mean) ** 2));
};

const collectPauseEvents = (metrics: MetricsPoint[]) =>
  metrics.map((m) => m.pauseMs).filter((p) => p > 0);

export const computeScore = (input: SessionInput): ScoreBreakdown => {
  const wordCount = countWords(input.transcript);
  const wpm = computeWpm(wordCount, input.durationMs);
  const fillerCount = countFillers(input.transcript);
  const minutes = Math.max(input.durationMs / 60000, 0.1);
  const fillersPerMinute = fillerCount / minutes;
  const pauseEvents = collectPauseEvents(input.metrics);

  const wpmScore = scoreWpm(wpm);
  const fillerScore = scoreFillers(fillersPerMinute);
  const pauseScore = scorePauses(pauseEvents, input.durationMs);
  const speech = wpmScore + fillerScore + pauseScore;

  const eyeContactPct = avg(input.metrics.map((m) => m.eyeContact));
  const smileAvg = avg(input.metrics.map((m) => m.smile));
  const yawVar = variance(input.metrics.map((m) => m.yaw));
  const pitchVar = variance(input.metrics.map((m) => m.pitch));
  const rollVar = variance(input.metrics.map((m) => m.roll));

  const eyeScore = scoreEyeContact(eyeContactPct);
  const smileScore = scoreSmile(smileAvg);
  const headScore = scoreHeadStability(yawVar, pitchVar, rollVar);
  const delivery = eyeScore + smileScore + headScore;

  const structureScore = scoreStructure(input.transcript);
  const repetitionScore = scoreRepetition(input.transcript);
  const clarityScore = scoreClarity(input.transcript);
  const keywordScore = scoreKeywordCoverage(input.transcript, input.targetKeywords);
  const content = Math.max(0, structureScore + repetitionScore + clarityScore + keywordScore);

  const total = Math.min(100, Math.max(0, speech + delivery + content));

  const fixes: string[] = [];
  if (wpmScore <= 10) fixes.push("Adjust pace to 120-160 WPM.");
  if (fillerScore <= 8) fixes.push("Reduce filler words with pauses.");
  if (eyeScore <= 10) fixes.push("Increase eye contact with the lens.");
  if (clarityScore <= 8) fixes.push("Shorten sentences for clarity.");
  if (keywordScore <= 5 && input.targetKeywords.length) fixes.push("Cover target keywords.");

  const drill = speech < delivery && speech < content
    ? "60-second pace drill"
    : delivery < content
      ? "Eye contact mirror drill"
      : "Story arc outline drill";

  return {
    total,
    speech,
    delivery,
    content,
    details: {
      wpm: wpmScore,
      fillers: fillerScore,
      pauses: pauseScore,
      eyeContact: eyeScore,
      smile: smileScore,
      headStability: headScore,
      structure: structureScore,
      repetition: repetitionScore,
      clarity: clarityScore,
      keywordCoverage: keywordScore,
    },
    topFixes: fixes.slice(0, 3),
    recommendedDrill: drill,
  };
};
