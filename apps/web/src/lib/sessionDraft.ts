import { deleteDraft, loadDraft, saveDraft, type SessionDraft } from "@/lib/indexedDb";

const ACTIVE_DRAFT_KEY = "activeDraftId";

const canUseLocalStorage = () => typeof window !== "undefined";

const getActiveDraftId = () => {
  if (!canUseLocalStorage()) return null;
  return window.localStorage.getItem(ACTIVE_DRAFT_KEY);
};

export const createDraftId = () => `draft-${Date.now()}`;

export const persistActiveDraft = async (draft: SessionDraft) => {
  if (canUseLocalStorage()) {
    window.localStorage.setItem(ACTIVE_DRAFT_KEY, draft.id);
  }
  await saveDraft(draft);
};

export const loadActiveDraft = async () => {
  const activeDraftId = getActiveDraftId();
  if (!activeDraftId) return null;
  const draft = await loadDraft(activeDraftId);
  if (!draft && canUseLocalStorage()) {
    window.localStorage.removeItem(ACTIVE_DRAFT_KEY);
  }
  return draft;
};

export const clearActiveDraft = async (draftId?: string | null) => {
  const activeDraftId = draftId || getActiveDraftId();
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(ACTIVE_DRAFT_KEY);
  }
  if (!activeDraftId) return;
  await deleteDraft(activeDraftId);
};
