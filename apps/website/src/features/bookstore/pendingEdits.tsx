'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/*
 * Held edits, and the one Save that sends them.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, in Tommy's words: *"add a overall save button rather than
 * sending a request after each edit or increment."*
 *
 * Every control on a card used to write the moment it was touched. The stepper
 * softened that with a 700ms debounce, but the shape was still one request per
 * settled change — so setting six books to a new count was six round trips to
 * Square, each of which could half-fail and leave the shelf disagreeing with the
 * register. Worse, the debounce meant the *card* decided when your edit left the
 * building, which is exactly the decision a person should be making.
 *
 * Now a control changes a number here and nothing else happens. The bar at the
 * foot of the shop says how many books are waiting, and one press sends them.
 *
 * ## What is held, and what deliberately is not
 *
 * Held: the stock count, whether stock is counted at all, the category, and —
 * since 2026-09-01 — pictures added and pictures taken off.
 *
 * **Pictures were deliberately excluded and that decision was reversed.** The
 * argument for sending them at once was that the payload is a file, that holding
 * one means holding the bytes until Save, and that you cannot judge a photograph
 * until it has uploaded anyway. The first two are true and turned out not to
 * matter: `downscale` has already shrunk the file to 1600px before it is held,
 * and a handful of those is nothing beside the ~604KB of Firestore every page
 * already carries. The third was simply wrong — a local `data:` URL renders in
 * the tile immediately, so you can see the photograph *before* it is sent, which
 * is better than seeing it after.
 *
 * What the old behaviour actually cost: a picture added by mistake was already
 * in the parish's Square catalog, and undoing it meant a second round trip that
 * could itself fail. Held, it is a tile you can take straight back off — and
 * one that never reaches Square at all if you discard. Tommy asked for it
 * directly: *"it should wait for me to click save before it tries to save."*
 *
 * Not held — these still act immediately, and it is not an oversight:
 *
 *   - **Removing a product.** It has its own confirmation, and a destructive
 *     action queued behind a Save is a trap: the card would sit there looking
 *     removed while still being for sale.
 *   - **Adding a product, and the category pills.** Both create the thing that
 *     other edits then refer to. A pending edit pointing at a category that does
 *     not exist yet is a category of bug not worth inventing.
 *
 * The bar says which of these are immediate, so nobody has to infer it.
 * ---------------------------------------------------------------------------
 */

/**
 * A photograph chosen but not yet sent.
 *
 * `dataUrl` is what `downscale` produced, so it is both what renders in the tile
 * and what is uploaded — there is no second read of the file, and no `File`
 * handle kept alive across a save. `id` exists so a pending picture can be taken
 * back off before it has any server-side identity to name it by.
 */
export interface PendingImage {
  id: string;
  dataUrl: string;
}

export interface PendingEdit {
  /** A number, or `null` for "not counted". Absent means untouched. */
  stockCount?: number | null;
  /** A category id, or `null` for none. Absent means untouched. */
  section?: string | null;
  /** Ounces per copy, or `null` for not weighed. The parish's, like `section`. */
  weightOz?: number | null;
  /** Media Mail eligible. Held together with `weightOz` — see `setShipping`. */
  mediaMail?: boolean;
  /** Sales tax applies. The parish's field, like `section`. */
  taxable?: boolean;
  /** Photographs chosen here and not yet uploaded, in the order chosen. */
  addImages?: PendingImage[];
  /** Already-saved Square URLs marked to come off. */
  removeImages?: string[];
}

/** What one book currently *is*, so a held edit can be compared against it. */
export interface ActualValues {
  stockCount: number | null;
  section: string | null;
  /** Optional so callers that never show the shipping fields need not pass them. */
  weightOz?: number | null;
  mediaMail?: boolean;
  taxable?: boolean;
}

/** The held fields that are plain values — everything but the pictures. */
const FIELDS = ['stockCount', 'section', 'weightOz', 'mediaMail', 'taxable'] as const;
type Field = (typeof FIELDS)[number];

function actualOf(actual: ActualValues, key: Field): unknown {
  if (key === 'weightOz') return actual.weightOz ?? null;
  if (key === 'mediaMail' || key === 'taxable') return actual[key] ?? false;
  return actual[key];
}

/** What a field reads as with this edit held over the real value. */
function heldOf(edit: PendingEdit | undefined, actual: ActualValues, key: Field): unknown {
  if (edit && key in edit) {
    return key === 'mediaMail' || key === 'taxable' ? (edit[key] ?? false) : (edit[key] ?? null);
  }
  return actualOf(actual, key);
}

/**
 * True when every plain field of this edit is back to what is saved. One test
 * for all of them, because the failure this file keeps guarding against is a
 * check that forgot the *other* field and released a book with a change held.
 */
function fieldsMatch(edit: PendingEdit | undefined, actual: ActualValues): boolean {
  return FIELDS.every((key) => heldOf(edit, actual, key) === actualOf(actual, key));
}

interface PendingEditsValue {
  edits: Record<string, PendingEdit>;
  hold: (slug: string, patch: PendingEdit) => void;
  /** Relative change to the count. See the note on `nudgeStock` below. */
  nudgeStock: (slug: string, by: number, actual: ActualValues) => void;
  /** Hold a chosen photograph. Nothing reaches Square until Save. */
  addImage: (slug: string, image: PendingImage) => void;
  /** Take a *held* photograph back off, before it has ever been sent. */
  dropAddedImage: (slug: string, id: string, actual: ActualValues) => void;
  /** Mark an already-saved Square URL to come off at Save. */
  removeImage: (slug: string, url: string) => void;
  /** Undo such a mark. */
  keepImage: (slug: string, url: string, actual: ActualValues) => void;
  release: (slug: string) => void;
  discardAll: () => void;
  save: () => Promise<void>;
  /** How many *books* are waiting, not how many fields. */
  count: number;
  saving: boolean;
}

/**
 * Store a book's edit, or drop the book entirely when the edit says nothing.
 *
 * "Says nothing" means every field is back at what the shop already holds — the
 * count, the category and both picture lists together. Checked as a whole, so
 * undoing one field never discards another that is still outstanding.
 */
export function settle(
  was: Record<string, PendingEdit>,
  slug: string,
  edit: PendingEdit,
  actual: ActualValues,
): Record<string, PendingEdit> {
  if (fieldsMatch(edit, actual) && !hasImageEdits(edit)) {
    if (!(slug in was)) return was;
    const next = { ...was };
    delete next[slug];
    return next;
  }
  return { ...was, [slug]: edit };
}

/** Whether a held edit carries any picture work. Absent and empty both count as none. */
export function hasImageEdits(edit: PendingEdit | undefined): boolean {
  return Boolean(edit?.addImages?.length || edit?.removeImages?.length);
}

/**
 * The stepper's arithmetic, as a pure function of the previous held edits.
 *
 * Exported only so it can be tested. It is the whole of what went wrong the
 * first time — see the note on `nudgeStock` — and a unit test on it is cheaper
 * and more exact than trying to reproduce a fast run of clicks in a browser.
 */
export function nextEditsAfterNudge(
  was: Record<string, PendingEdit>,
  slug: string,
  by: number,
  actual: ActualValues,
): Record<string, PendingEdit> {
  const held = was[slug];
  const heldStock = held && 'stockCount' in held ? held.stockCount ?? null : actual.stockCount;

  // "Not counted" has no neighbouring value; the power button is how that state
  // is left, not the arrows.
  if (heldStock === null) return was;

  const nextStock = Math.max(0, Math.min(99_999, heldStock + by));

  /*
   * Back where it started, and nothing else held: stop calling it an edit.
   *
   * `hasImageEdits` is part of that test for the same reason the other fields are —
   * releasing the whole book the moment its count matched again would silently
   * drop a picture added a second earlier, and the card would look clean and be
   * sent as nothing. That failure already happened once with the category.
   */
  if (fieldsMatch({ ...held, stockCount: nextStock }, actual) && !hasImageEdits(held)) {
    if (!(slug in was)) return was;
    const next = { ...was };
    delete next[slug];
    return next;
  }

  return { ...was, [slug]: { ...held, stockCount: nextStock } };
}

/*
 * Shared empties, so a book with no picture edits returns the *same* array on
 * every render. A fresh `[]` each time is a new identity, and these are read
 * inside `useMemo`/`useEffect` dependency lists in the components below.
 */
const EMPTY_ADDS: readonly PendingImage[] = [];
const EMPTY_REMOVES: readonly string[] = [];

/**
 * An id for a picture that has no server-side identity yet.
 *
 * `crypto.randomUUID` where it exists; two photographs chosen in the same
 * millisecond are ordinary with a multi-select, so a timestamp alone would
 * collide and React would key two tiles the same.
 */
function newImageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `img-${Math.random().toString(36).slice(2)}`;
}

const PendingEditsContext = createContext<PendingEditsValue | null>(null);

export function PendingEditsProvider({
  children,
  onSaved,
  onError,
}: {
  children: ReactNode;
  /** Refresh the shelf once the writes have landed. */
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [edits, setEdits] = useState<Record<string, PendingEdit>>({});
  const [saving, setSaving] = useState(false);

  /*
   * Functional updates throughout, and not as a formality: a volunteer pressing
   * `+` six times fast produces six updates inside one React batch, and reading
   * `edits` from the closure would collapse them to a single increment. That
   * exact bug has been found in this codebase before.
   */
  const hold = useCallback((slug: string, patch: PendingEdit) => {
    setEdits((was) => ({ ...was, [slug]: { ...was[slug], ...patch } }));
  }, []);

  const release = useCallback((slug: string) => {
    setEdits((was) => {
      if (!(slug in was)) return was;
      const next = { ...was };
      delete next[slug];
      return next;
    });
  }, []);

  /*
   * Stepping the count, computed *inside* the updater.
   *
   * ---------------------------------------------------------------------------
   * This cannot be `hold(slug, { stockCount: shown + 1 })` from the component,
   * and the first version of this file was exactly that. Six quick presses on
   * one card produced six updates in a single React batch, and every one of them
   * read `shown` from the render that was on screen when the run started — so
   * all six computed the same number and the count went up by one. Measured, not
   * theorised: nine clicks across two books moved them by one each.
   *
   * A relative change has to be applied to whatever the previous updater left,
   * which means the arithmetic belongs in here where that value is the argument.
   * `actual` is passed in because the release-when-unchanged decision needs it
   * and the provider does not know one book from another.
   * ---------------------------------------------------------------------------
   */
  const nudgeStock = useCallback((slug: string, by: number, actual: ActualValues) => {
    setEdits((was) => nextEditsAfterNudge(was, slug, by, actual));
  }, []);

  /*
   * The four picture mutators.
   *
   * All functional updates, like everything else here: choosing three files at
   * once produces three updates inside one React batch, and reading `edits` from
   * the closure would keep only the last of them. That is the same fault the
   * stepper hit, and files make it easier to hit — a multi-select fires them
   * back to back with no gesture in between.
   *
   * The two "undo" mutators take `actual` so they can release the book outright
   * when undoing leaves nothing held. Without that, adding a picture and
   * removing it again would leave the card marked "Edited" with an empty edit,
   * and the bar would offer to save nothing.
   */
  const addImage = useCallback((slug: string, image: PendingImage) => {
    setEdits((was) => ({
      ...was,
      [slug]: { ...was[slug], addImages: [...(was[slug]?.addImages ?? []), image] },
    }));
  }, []);

  const removeImage = useCallback((slug: string, url: string) => {
    setEdits((was) => {
      const held = was[slug];
      if (held?.removeImages?.includes(url)) return was;
      return {
        ...was,
        [slug]: { ...held, removeImages: [...(held?.removeImages ?? []), url] },
      };
    });
  }, []);

  const dropAddedImage = useCallback((slug: string, id: string, actual: ActualValues) => {
    setEdits((was) => {
      const held = was[slug];
      if (!held?.addImages) return was;
      const addImages = held.addImages.filter((one) => one.id !== id);
      return settle(was, slug, { ...held, addImages }, actual);
    });
  }, []);

  const keepImage = useCallback((slug: string, url: string, actual: ActualValues) => {
    setEdits((was) => {
      const held = was[slug];
      if (!held?.removeImages) return was;
      const removeImages = held.removeImages.filter((one) => one !== url);
      return settle(was, slug, { ...held, removeImages }, actual);
    });
  }, []);

  const discardAll = useCallback(() => setEdits({}), []);

  const releaseSaved = useCallback((slugs: string[]) => {
    if (slugs.length === 0) return;
    setEdits((was) => {
      const next = { ...was };
      for (const slug of slugs) delete next[slug];
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    const pending = Object.entries(edits);
    if (pending.length === 0) return;

    setSaving(true);
    /* Hoisted out of the `try` so the failure path can release the books that
       did land — otherwise a refusal on the fourth book leaves the first three
       showing "Edited" and counted on the bar, and pressing Save again re-sends
       writes that already succeeded. */
    const saved: string[] = [];
    try {
      const {
        setProductStock,
        setProductSection,
        setProductShipping,
        setProductTaxable,
        uploadProductImage,
        removeProductImage,
      } = await import('./adminData');

      /*
       * Sequential, not `Promise.all`. Each stock change is a write to Square's
       * inventory API, and firing ten at once is how a shop of any size meets
       * Square's rate limit — at which point some of the ten have landed and
       * some have not, which is the state this whole change exists to avoid.
       *
       * The failed book keeps its held edit so it is still on the bar and can be
       * retried; the ones that landed are released. Stopping at the first
       * failure rather than pressing on means the bar's count stays truthful.
       */
      for (const [slug, edit] of pending) {
        if ('stockCount' in edit) await setProductStock(slug, edit.stockCount ?? null);
        if ('section' in edit) await setProductSection(slug, edit.section ?? null);
        // Both fields in one write; `setShipping` always holds them together.
        if ('taxable' in edit) await setProductTaxable(slug, edit.taxable ?? false);
        if ('weightOz' in edit || 'mediaMail' in edit) {
          await setProductShipping(slug, {
            weightOz: edit.weightOz ?? null,
            mediaMail: edit.mediaMail ?? false,
          });
        }

        /*
         * Removals before additions, so the result matches the tiles you were
         * looking at when you pressed Save.
         *
         * The preview renders saved-minus-removed followed by the pending adds,
         * and Square's first picture is the cover — so doing it the other way
         * round would briefly make a new photograph the cover and then not, and
         * on a book where every old picture was removed it would settle on a
         * different one than the preview showed.
         *
         * Still sequential, and now for a second reason beyond Square's rate
         * limit: these are uploads, and firing a book's worth at once is how a
         * slow connection turns into several half-finished ones.
         */
        for (const url of edit.removeImages ?? []) await removeProductImage(slug, url);
        for (const image of edit.addImages ?? []) await uploadProductImage(slug, image.dataUrl);

        saved.push(slug);
      }

      releaseSaved(saved);
      onSaved();
    } catch (cause) {
      /*
       * `onSaved` is called even on a failure, because the books before the one
       * that broke did land and the shelf is now stale for them.
       */
      releaseSaved(saved);
      onSaved();
      onError(
        cause instanceof Error
          ? `${cause.message} Nothing after that book was sent.`
          : 'That change was refused. Nothing after that book was sent.',
      );
    } finally {
      setSaving(false);
    }
  }, [edits, releaseSaved, onSaved, onError]);

  const value = useMemo<PendingEditsValue>(
    () => ({
      edits,
      hold,
      nudgeStock,
      addImage,
      dropAddedImage,
      removeImage,
      keepImage,
      release,
      discardAll,
      save,
      count: Object.keys(edits).length,
      saving,
    }),
    [
      edits,
      hold,
      nudgeStock,
      addImage,
      dropAddedImage,
      removeImage,
      keepImage,
      release,
      discardAll,
      save,
      saving,
    ],
  );

  return (
    <PendingEditsContext.Provider value={value}>{children}</PendingEditsContext.Provider>
  );
}

/**
 * The bar's view of the held edits.
 *
 * Returns nulls outside a provider rather than throwing, so that the enlarged
 * settings dialog — which is rendered from the same components but can open when
 * the shop is not in edit mode — does not have to know which context it is in.
 */
export function usePendingEdits(): PendingEditsValue {
  return (
    useContext(PendingEditsContext) ?? {
      edits: {},
      hold: () => {},
      nudgeStock: () => {},
      addImage: () => {},
      dropAddedImage: () => {},
      removeImage: () => {},
      keepImage: () => {},
      release: () => {},
      discardAll: () => {},
      save: async () => {},
      count: 0,
      saving: false,
    }
  );
}

/**
 * One book's view: what to *show*, which is the held value when there is one and
 * the saved value otherwise.
 *
 * `dirty` drives the marker on the card. It compares against the actual value
 * rather than merely asking whether a key is present, so that nudging a count up
 * and back down again leaves the card clean — which is what a person who just
 * undid their own change expects to see.
 */
export function usePendingEdit(slug: string, actual: ActualValues) {
  const { edits, hold, nudgeStock, addImage, dropAddedImage, removeImage, keepImage, release } =
    usePendingEdits();
  const edit = edits[slug];

  const stockCount = heldOf(edit, actual, 'stockCount') as number | null;
  const section = heldOf(edit, actual, 'section') as string | null;
  const weightOz = heldOf(edit, actual, 'weightOz') as number | null;
  const mediaMail = heldOf(edit, actual, 'mediaMail') as boolean;
  const taxable = heldOf(edit, actual, 'taxable') as boolean;
  const addedImages = edit?.addImages ?? EMPTY_ADDS;
  const removedImages = edit?.removeImages ?? EMPTY_REMOVES;
  const dirty = !fieldsMatch(edit, actual) || addedImages.length > 0 || removedImages.length > 0;

  /*
   * One writer for every field, because the "back to where it started" case has
   * to consider the *other* field too. Releasing the whole book the moment its
   * count matched again would silently drop a category change made a second
   * earlier — the book would look clean and be sent as nothing.
   */
  const setField = useCallback(
    (patch: PendingEdit) => {
      if (fieldsMatch({ ...edit, ...patch }, actual) && !hasImageEdits(edit)) release(slug);
      else hold(slug, patch);
    },
    // `actual` is a fresh object each render; its fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug, edit, actual.stockCount, actual.section, actual.weightOz, actual.mediaMail, actual.taxable, hold, release],
  );

  const setStock = useCallback(
    (next: number | null) => setField({ stockCount: next }),
    [setField],
  );

  const setSection = useCallback(
    (next: string | null) => setField({ section: next }),
    [setField],
  );

  /* Always both together, so Save sends one complete shipping write. */
  const setShipping = useCallback(
    (next: { weightOz: number | null; mediaMail: boolean }) => setField(next),
    [setField],
  );

  const setTaxable = useCallback((next: boolean) => setField({ taxable: next }), [setField]);

  /* Relative, so a fast run of presses accumulates rather than collapsing. */
  const nudge = useCallback(
    (by: number) => nudgeStock(slug, by, actual),
    [nudgeStock, slug, actual.stockCount, actual.section], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /*
   * The picture callbacks, bound to this book.
   *
   * `actual` is threaded into the two undo paths so the provider can release the
   * book when undoing leaves nothing held — see `settle`.
   */
  const holdImage = useCallback(
    (dataUrl: string) => addImage(slug, { id: newImageId(), dataUrl }),
    [addImage, slug],
  );

  const unholdImage = useCallback(
    (id: string) => dropAddedImage(slug, id, actual),
    [dropAddedImage, slug, actual.stockCount, actual.section], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const markImageRemoved = useCallback(
    (url: string) => removeImage(slug, url),
    [removeImage, slug],
  );

  const unmarkImageRemoved = useCallback(
    (url: string) => keepImage(slug, url, actual),
    [keepImage, slug, actual.stockCount, actual.section], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    stockCount,
    section,
    weightOz,
    mediaMail,
    taxable,
    setTaxable,
    dirty,
    setStock,
    setSection,
    setShipping,
    nudge,
    addedImages,
    removedImages,
    holdImage,
    unholdImage,
    markImageRemoved,
    unmarkImageRemoved,
  };
}

/**
 * The bar that sends them.
 *
 * ---------------------------------------------------------------------------
 * Fixed to the foot of the window rather than placed above the shelf, for the
 * same reason the orders drawer is an overlay: a bar in the flow moves the
 * books when it appears, so the card you were about to press is somewhere else
 * by the time you press it. This one is out of the layout entirely and the
 * shelf never shifts.
 *
 * It renders nothing at all until something is held. A permanently visible
 * "Save" with nothing to save is furniture, and worse, it trains people to
 * press it out of habit and wonder whether it worked.
 *
 * The count is books, not fields: "2 books" is what somebody can check against
 * the two cards showing "Edited". A field count could read "3 changes" across
 * two cards and match nothing on screen.
 */
export function SaveBar() {
  const { count, save, discardAll, saving } = usePendingEdits();

  if (count === 0) return null;

  return (
    <div className="bksave" role="region" aria-label="Unsaved shop changes">
      <p className="bksave__count">
        <strong>
          {count} {count === 1 ? 'book' : 'books'}
        </strong>{' '}
        edited but not saved
        {/* Said here because this is where somebody is deciding whether they
            are finished — not in a note further up the page they scrolled past
            several minutes ago. */}
        <span className="bksave__aside">
          Renaming and removing a book save on their own.
        </span>
      </p>

      <div className="bksave__actions">
        <button
          type="button"
          className="bksave__discard"
          disabled={saving}
          onClick={discardAll}
        >
          Discard
        </button>
        <button
          type="button"
          className="bksave__go"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : `Save ${count === 1 ? 'change' : 'changes'}`}
        </button>
      </div>
    </div>
  );
}
