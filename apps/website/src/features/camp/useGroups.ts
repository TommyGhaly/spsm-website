'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  campPeople,
  countPlacements,
  groupNameUpdates,
  parseCampAllocation,
  resolveAllocation,
  type CampAllocationDraft,
  type CampPerson,
  type CampRegistration,
} from '@spsm/shared';
import {
  AllocationConflict,
  applyGroupNames,
  subscribeAllocation,
  writeAllocation,
} from './allocationData';
import { subscribeRegistrations, type WithId } from './data';

/**
 * The groups screen's state: the arrangement, the people, and the saving.
 *
 * ---------------------------------------------------------------------------
 * Two listeners and one local draft.
 *
 * Both documents are held open for hours by more than one person — two laptops
 * at a table the week before camp is the ordinary case, not the exception — so
 * the arrangement and the registrations are both `onSnapshot`. A child
 * registered at the desk has to become draggable here without anybody being
 * told to refresh.
 *
 * What is *not* live is the arrangement being edited. Dragging is a hundred
 * small changes over ten minutes, and writing each one would be a hundred
 * writes on a document somebody else is also editing. So the draft is local
 * until Save, and a remote version arriving while there is unsaved work is
 * **held, never merged** — two boards edited apart cannot be reconciled without
 * inventing an arrangement neither person made. The banner offers theirs; it is
 * never taken silently.
 * ---------------------------------------------------------------------------
 */

export interface GroupsState {
  loading: boolean;
  error: string | null;
  draft: CampAllocationDraft | null;
  people: CampPerson[];
  registrations: WithId<CampRegistration>[];
  resolved: ReturnType<typeof resolveAllocation> | null;
  dirty: boolean;
  saving: boolean;
  /** Set when somebody else saved while there was unsaved work here. */
  conflictWith: string | null;
  readOnly: boolean;
  edit: (change: (draft: CampAllocationDraft) => CampAllocationDraft) => void;
  save: () => Promise<void>;
  takeTheirs: () => void;
  /** Write the group names back onto the children's registrations. */
  publishNames: () => Promise<number>;
}

export function useGroups(programId: string, season: string, uid: string | null, on: boolean): GroupsState {
  const [draft, setDraft] = useState<CampAllocationDraft | null>(null);
  const [registrations, setRegistrations] = useState<WithId<CampRegistration>[]>([]);
  const [loadedPeople, setLoadedPeople] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictWith, setConflictWith] = useState<string | null>(null);

  /** The stamp of the version this draft was taken from. See `writeAllocation`. */
  const readAt = useRef<number | null>(null);
  /** A remote version that arrived while there was unsaved work. */
  const held = useRef<{ draft: CampAllocationDraft; readAt: number | null } | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!on) return;
    return subscribeAllocation(
      programId,
      season,
      (update) => {
        if (dirtyRef.current) {
          /*
           * Held rather than applied.
           *
           * `readAt` is deliberately not moved: the next save must still
           * compare against the version this draft was taken from, or it would
           * overwrite the arrival it never showed anybody.
           */
          held.current = { draft: update.draft, readAt: update.readAt };
          if (update.updatedBy && update.updatedBy !== uid) setConflictWith(update.updatedBy);
          return;
        }
        setDraft(update.draft);
        if (!update.pending) readAt.current = update.readAt;
      },
      (cause) => setError(cause.message),
    );
  }, [on, programId, season, uid]);

  useEffect(() => {
    if (!on) return;
    return subscribeRegistrations(
      programId,
      season,
      (rows) => {
        setRegistrations(rows);
        setLoadedPeople(true);
      },
      (cause) => setError(cause.message),
    );
  }, [on, programId, season]);

  const people = useMemo(() => campPeople(registrations), [registrations]);
  const resolved = useMemo(
    () => (draft ? resolveAllocation(draft, people) : null),
    [draft, people],
  );

  const edit = useCallback(
    (change: (current: CampAllocationDraft) => CampAllocationDraft) => {
      /*
       * The updater re-reads the draft rather than closing over it.
       *
       * A fast run of clicks — three "add group" in a second, or a drag
       * finishing while another is starting — otherwise all apply to the same
       * stale copy and only the last one survives. Same lesson as
       * [[spsm-batched-clicks-need-functional-updates]].
       */
      setDraft((current) => (current ? change(current) : current));
      setDirty(true);
    },
    [],
  );

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const result = await writeAllocation(draft, uid, readAt.current);
      readAt.current = result.readAt;
      setDirty(false);
      setConflictWith(null);
      /*
       * An arrival that landed mid-save is re-offered here, not applied.
       *
       * Whose version won cannot be known until the write returns the stamp it
       * wrote — see the note on `readAt` being withheld while there are pending
       * writes.
       */
      if (held.current) {
        setConflictWith((previous) => previous ?? 'somebody else');
      }
    } catch (cause) {
      if (cause instanceof AllocationConflict) {
        setConflictWith(cause.updatedBy ?? 'somebody else');
      } else {
        setError((cause as Error)?.message ?? 'The save did not go through.');
      }
    } finally {
      setSaving(false);
    }
  }, [draft, uid]);

  const takeTheirs = useCallback(() => {
    const theirs = held.current;
    held.current = null;
    setConflictWith(null);
    if (!theirs) return;
    setDraft(theirs.draft);
    readAt.current = theirs.readAt;
    setDirty(false);
  }, []);

  const publishNames = useCallback(async () => {
    if (!draft) return 0;
    const updates = groupNameUpdates(draft, registrations);
    if (updates.length === 0) return 0;
    return applyGroupNames(updates, uid);
  }, [draft, registrations, uid]);

  return {
    loading: draft === null || !loadedPeople,
    error,
    draft,
    people,
    registrations,
    resolved,
    dirty,
    saving,
    conflictWith,
    readOnly: draft?.archivedAt != null,
    edit,
    save,
    takeTheirs,
    publishNames,
  };
}

/** How many people are placed, for the header count. */
export function placedCount(draft: CampAllocationDraft | null): number {
  return draft ? countPlacements(draft) : 0;
}

/** Re-exported so the screen does not import the parser for one call. */
export { parseCampAllocation };
