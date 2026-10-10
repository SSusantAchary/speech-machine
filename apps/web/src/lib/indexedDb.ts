import { openDB } from "idb";
import type { MetricsPoint, TranscriptSegment } from "@video/shared";
import type { DocumentBlock } from "@/lib/documentReader";

export type SessionDraftDocument = {
  name: string;
  mimeType: string;
  blocks: DocumentBlock[];
  file: Blob;
};

export type SessionDraft = {
  id: string;
  createdAt: string;
  prompt: string;
  mode: string;
  goal: string;
  durationMs: number;
  transcript: TranscriptSegment[];
  metrics: MetricsPoint[];
  chunks: Blob[];
  document?: SessionDraftDocument | null;
};

const DB_NAME = "video-coach";
const STORE = "drafts";

const isBrowser = typeof window !== "undefined" && typeof indexedDB !== "undefined";
let dbPromise: ReturnType<typeof openDB> | null = null;

const getDb = () => {
  if (!isBrowser) return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
};

export const saveDraft = async (draft: SessionDraft) => {
  const db = getDb();
  if (!db) return;
  const instance = await db;
  await instance.put(STORE, draft);
};

export const loadDraft = async (id: string) => {
  const db = getDb();
  if (!db) return null;
  const instance = await db;
  return instance.get(STORE, id);
};

export const deleteDraft = async (id: string) => {
  const db = getDb();
  if (!db) return;
  const instance = await db;
  return instance.delete(STORE, id);
};
