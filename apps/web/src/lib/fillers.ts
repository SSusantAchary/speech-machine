export const FILLER_WORDS = ["um", "uh", "like", "you know", "actually", "basically", "literally"];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildFillerRegex = () => {
  const pattern = FILLER_WORDS
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((word) => escapeRegex(word).replace(/ /g, "\\s+"))
    .join("|");
  return new RegExp(`\\b(${pattern})\\b`, "gi");
};

export const countFillerMatches = (text: string) => {
  const matches = text.match(buildFillerRegex());
  return matches ? matches.length : 0;
};

export type HighlightedTextPart = {
  text: string;
  isFiller: boolean;
};

export const splitTextByFillers = (text: string): HighlightedTextPart[] => {
  const parts: HighlightedTextPart[] = [];
  const regex = buildFillerRegex();
  let lastIndex = 0;

  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), isFiller: false });
    }
    parts.push({ text: match[0], isFiller: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isFiller: false });
  }

  return parts.length ? parts : [{ text, isFiller: false }];
};
