export type PromptCategory = {
  mode: string;
  prompts: string[];
};

export const PROMPTS: PromptCategory[] = [
  {
    mode: "Interview",
    prompts: [
      "Tell me about a time you disagreed with a stakeholder and how you handled it.",
      "Describe a project where you owned the strategy from start to finish.",
      "Share a time you led through ambiguity and what you learned.",
    ],
  },
  {
    mode: "Pitch",
    prompts: [
      "Pitch your startup in 60 seconds to an investor who is skeptical.",
      "Explain your product's wedge and why now is the right time.",
      "Describe your go-to-market plan for the first 100 customers.",
    ],
  },
  {
    mode: "Storytelling",
    prompts: [
      "Tell a story about a moment that changed how you work.",
      "Share a personal story with a clear beginning, middle, and end.",
      "Describe a failure and the lesson you carry forward.",
    ],
  },
  {
    mode: "Debate",
    prompts: [
      "Argue for remote work as the default future of teams.",
      "Make the case for prioritizing climate tech investment.",
      "Defend a controversial product decision with evidence.",
    ],
  },
  {
    mode: "Reading",
    prompts: [
      "Read the paragraph aloud and focus on crisp articulation.",
      "Read with emphasis on pauses and sentence endings.",
      "Read the passage with a confident, steady rhythm.",
    ],
  },
];
