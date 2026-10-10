"use client";

import type { TranscriptSegment } from "@video/shared";

export type DocumentBlock = {
  index: number;
  text: string;
};

export type SessionDocument = {
  name: string;
  mimeType: string;
  blocks: DocumentBlock[];
};

export type RecorderDocument = SessionDocument & {
  file: Blob;
};

const MAX_BLOCK_WORDS = 36;
const MAX_FORWARD_SEARCH = 6;
const MATCH_THRESHOLD = 0.28;

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

export const normalizeDocumentText = (value: string) =>
  normalizeWhitespace(value.toLowerCase().replace(/[^a-z0-9\s]+/g, " "));

const toWords = (value: string) => normalizeDocumentText(value).split(" ").filter(Boolean);

const buildBlocksFromParagraphs = (paragraphs: string[]) => {
  const blocks: DocumentBlock[] = [];

  paragraphs
    .map((paragraph) => normalizeWhitespace(paragraph))
    .filter(Boolean)
    .forEach((paragraph) => {
      const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (!sentences.length) {
        blocks.push({ index: blocks.length, text: paragraph });
        return;
      }

      let buffer = "";
      let bufferWords = 0;

      sentences.forEach((sentence) => {
        const sentenceWords = toWords(sentence).length;
        const nextText = buffer ? `${buffer} ${sentence}` : sentence;
        if (buffer && bufferWords + sentenceWords > MAX_BLOCK_WORDS) {
          blocks.push({ index: blocks.length, text: buffer });
          buffer = sentence;
          bufferWords = sentenceWords;
          return;
        }
        buffer = nextText;
        bufferWords += sentenceWords;
      });

      if (buffer) {
        blocks.push({ index: blocks.length, text: buffer });
      }
    });

  return blocks;
};

export const buildDocumentBlocks = (sourceText: string) => {
  const paragraphs = sourceText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, " "))
    .filter(Boolean);
  return buildBlocksFromParagraphs(paragraphs);
};

const parseTextDocument = async (file: Blob) => {
  const text = await file.text();
  return buildDocumentBlocks(text);
};

const parsePdfDocument = async (file: Blob) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const versionedWorkerSrc = `/pdf.worker.min.mjs?v=${encodeURIComponent(pdfjs.version)}`;
  if (pdfjs.GlobalWorkerOptions.workerSrc !== versionedWorkerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = versionedWorkerSrc;
  }
  const loadingTask = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (pageText) {
      pages.push(pageText);
    }
  }

  return buildBlocksFromParagraphs(pages);
};

export const parseReadableDocument = async (file: File): Promise<RecorderDocument> => {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type || (lowerName.endsWith(".pdf") ? "application/pdf" : "text/plain");

  let blocks: DocumentBlock[];
  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    blocks = await parsePdfDocument(file);
    return { name: file.name, mimeType: "application/pdf", blocks, file };
  }

  if (mimeType.startsWith("text/plain") || lowerName.endsWith(".txt")) {
    blocks = await parseTextDocument(file);
    return { name: file.name, mimeType: "text/plain", blocks, file };
  }

  throw new Error("Unsupported document type. Upload a PDF or TXT file.");
};

const tokenOverlapScore = (spokenWords: string[], blockWords: string[]) => {
  if (!spokenWords.length || !blockWords.length) return 0;
  const spokenSet = new Set(spokenWords);
  const sharedWordCount = blockWords.reduce((count, word) => count + (spokenSet.has(word) ? 1 : 0), 0);
  return sharedWordCount / Math.max(1, Math.min(blockWords.length, spokenWords.length));
};

const buildSpeechWindow = (transcript: TranscriptSegment[], partial: string) => {
  const recentFinal = transcript
    .slice(-4)
    .map((segment) => segment.text)
    .join(" ");
  const recentWords = toWords(`${recentFinal} ${partial}`);
  return recentWords.slice(-32);
};

export const findBestMatchingDocumentBlock = (
  blocks: DocumentBlock[],
  transcript: TranscriptSegment[],
  partial: string,
  lastIndex: number
) => {
  if (!blocks.length) return -1;

  const spokenWords = buildSpeechWindow(transcript, partial);
  if (spokenWords.length < 3) {
    return lastIndex;
  }

  const startIndex = Math.max(lastIndex, 0);
  const endIndex = lastIndex >= 0 ? Math.min(blocks.length - 1, startIndex + MAX_FORWARD_SEARCH) : blocks.length - 1;
  let bestIndex = lastIndex;
  let bestScore = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const blockWords = toWords(blocks[index].text);
    const score = tokenOverlapScore(spokenWords, blockWords);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestScore < MATCH_THRESHOLD) {
    return lastIndex;
  }

  return bestIndex;
};
