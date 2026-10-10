export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type MetricsPoint = {
  t: number; // seconds since start
  wpm: number;
  rms: number;
  eyeContact: number; // 0-1
  smile: number; // 0-1
  yaw: number;
  pitch: number;
  roll: number;
  fillerCount: number;
  pauseMs: number;
};

export type SessionInput = {
  durationMs: number;
  transcript: TranscriptSegment[];
  metrics: MetricsPoint[];
  targetKeywords: string[];
};

export type ScoreBreakdown = {
  total: number;
  speech: number;
  delivery: number;
  content: number;
  details: {
    wpm: number;
    fillers: number;
    pauses: number;
    eyeContact: number;
    smile: number;
    headStability: number;
    structure: number;
    repetition: number;
    clarity: number;
    keywordCoverage: number;
  };
  topFixes: string[];
  recommendedDrill: string;
};
