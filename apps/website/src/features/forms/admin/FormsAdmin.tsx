'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CAMP_FORM_SLUG,
  DEFAULT_FORMS_PAGE_CONFIG,
  NO_PAYMENT,
  isBuiltInForm,
  keepsNoSubmissions,
  toFormSlug,
  type FormDefinition,
  type FormDraft,
  type FormsPageConfig,
} from '@spsm/shared';
import { Dialog } from '@/features/bookstore/Sheet';
import { readAllForms, watchFormsPageConfig, type WithId } from '../data';
import {
  deleteForm,
  setFormFlags,
  setFormOrder,
  setFormsPageConfig,
  writeForm,
} from './adminData';
import { FormBuilder } from './FormBuilder';
import { SubmissionsPanel } from './SubmissionsPanel';
import { EmbedImport } from './EmbedImport';

/**
 * The forms back office: a drawer down the right of /forms.
 *
 * ---------------------------------------------------------------------------
 * The bookstore's arrangement, chosen for the same reason.
 *
 * `BookstoreAdmin` records why a drawer beat a panel in the page flow: an inline
 * panel is laid out *in* the document, so opening it moves everything below, and
 * the card you were looking at before you pressed the button is somewhere else
 * when you close it again. An overlay costs that never.
 *
 * It also records the rule that a review surface should not become a place to
 * edit the thing it reviews — the bookstore's catalog tab was taken out again
 * for exactly that. This drawer does not break that rule so much as sit on the
 * other side of it: a form *definition* has no page of its own to edit in place.
 * The hub shows cards, and a card is a title and a sentence — there is nowhere
 * on it to put a conditional field, an option price, or a notification address.
 *
 * So the builder lives here, and the thing that would break the rule is absent:
 * nothing in this drawer edits a *submission's* content. Staff can advance one
 * through its statuses and attach a note, which is the same pair of writes the
 * orders queue allows, and for the same reason — both are about the record's
 * handling rather than its contents.
 * ---------------------------------------------------------------------------
 */

type View =
  | { kind: 'list' }
  | { kind: 'build'; form: WithId<FormDraft> }
  | { kind: 'submissions'; formId: string | null }
  | { kind: 'import' };

export function FormsAdmin() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="bkadmin__toggle" onClick={() => setOpen(true)}>
        Forms &amp; submissions
      </button>

      {/* Mounted only while open, so closing genuinely unmounts the builder and
          its draft state rather than leaving it hidden with unsaved edits in it. */}
      {open && <AdminDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function AdminDrawer({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [forms, setForms] = useState<WithId<FormDefinition>[] | null>(null);
  /*
   * The hub's own two settings, live rather than fetched with the list.
   *
   * They are one world-readable document and they change from this drawer, so a
   * subscription means the tap destination on screen is the one stored even
   * when a second administrator is the one who moved it. Until it answers these
   * are the defaults, which is the behaviour the page had before the document
   * existed — see `watchFormsPageConfig`.
   */
  const [config, setConfig] = useState<FormsPageConfig>(DEFAULT_FORMS_PAGE_CONFIG);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchFormsPageConfig(setConfig), []);

  const refresh = useCallback(async () => {
    try {
      setForms(await readAllForms());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The forms could not be read.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    const id = `form-${Date.now().toString(36)}`;
    const draft = blankForm(id);
    await writeForm(id, draft);
    await refresh();
    setView({ kind: 'build', form: { id, ...draft } });
  }

  return (
    <Dialog
      title="Church forms"
      className="sheet--drawer"
      screen={view.kind}
      onClose={onClose}
    >
      <div className="bkadmin">
        <div className="bktabs" role="tablist" aria-label="Forms">
          <button
            type="button"
            role="tab"
            aria-selected={view.kind === 'list' || view.kind === 'build'}
            className={
              view.kind === 'submissions' || view.kind === 'import'
                ? 'bktabs__tab'
                : 'bktabs__tab is-on'
            }
            onClick={() => setView({ kind: 'list' })}
          >
            Forms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view.kind === 'submissions'}
            className={view.kind === 'submissions' ? 'bktabs__tab is-on' : 'bktabs__tab'}
            onClick={() => setView({ kind: 'submissions', formId: null })}
          >
            Submissions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view.kind === 'import'}
            className={view.kind === 'import' ? 'bktabs__tab is-on' : 'bktabs__tab'}
            onClick={() => setView({ kind: 'import' })}
          >
            Import
          </button>
        </div>

        {error && (
          <div className="notice notice--alarm" role="alert">
            <p>{error}</p>
          </div>
        )}

        {view.kind === 'list' && (
          <FormsList
            forms={forms}
            config={config}
            onCreate={() => void create()}
            onEdit={(form) => setView({ kind: 'build', form })}
            onSubmissions={(formId) => setView({ kind: 'submissions', formId })}
            onChanged={() => void refresh()}
          />
        )}

        {view.kind === 'build' && (
          <FormBuilder
            form={view.form}
            onDone={() => {
              void refresh();
              setView({ kind: 'list' });
            }}
          />
        )}

        {view.kind === 'submissions' && (
          <SubmissionsPanel formId={view.formId} forms={forms ?? []} />
        )}

        {view.kind === 'import' && (
          <EmbedImport
            onImported={async () => {
              await refresh();
              setView({ kind: 'list' });
            }}
          />
        )}
      </div>
    </Dialog>
  );
}

/**
 * Forms that are parish infrastructure rather than parish paperwork.
 *
 * Two of them, and both for the same reason: **their addresses are printed on
 * things this drawer cannot reach.** The vehicle registration is on an NFC tag
 * and a card in the car park, which cannot be reprinted by editing a file. The
 * contact form is behind every "ask the church office" link on the site — the
 * one at the foot of this very hub included — and on the parish's stationery.
 *
 * `published` is what makes that concrete rather than sentimental. `/parking`
 * and `/contact` do not check it, but `formSubmit` does, and it answers 404 to
 * an unpublished form. So unticking Published would leave the tag and the
 * contact page loading a form that silently refuses every submission, with
 * nothing on the page to say why. Deleting it is worse again.
 *
 * Neither is a decision anybody makes on purpose from a list of checkboxes, so
 * the two controls that cause it are not offered on these rows. Everything else
 * about them is editable as normal — `isBuiltInForm` is a list of two document
 * ids, not a wall around the form.
 *
 * `firestore.rules` refuses the delete regardless of what this draws.
 */
function isPermanent(form: WithId<FormDraft>): boolean {
  return isBuiltInForm(form.id) || form.kind === 'vehicle' || isCampRow(form);
}

/**
 * The summer camp's row, which is not a form document.
 *
 * ---------------------------------------------------------------------------
 * Why the camp is in this list at all, given it has nothing to edit here.
 *
 * Because it is a card on /forms, and this list is the parish's answer to "what
 * order are the cards in". Leaving the camp out meant the one card nobody could
 * move — appended after everything else, whatever the office wanted the page to
 * lead with in June. So it appears as a row that can be dragged and can be
 * chosen as the tap destination, and nothing else.
 *
 * **Published and Open are not offered, and that is not the same withholding
 * `isPermanent` does for the vehicle form.** There, Published is withheld
 * because unticking it would break a printed tag. Here there is no `published`
 * field to tick: whether the camp is advertised is decided by `SHOW_CAMP` in
 * `FormsHub` and by `servantSignUp` in the camp's own settings panel, which is
 * where somebody running a camp already goes to open and close the sign-up. A
 * box here would be a second, disagreeing switch for one thing.
 *
 * The tap destination box *is* offered, because that one is this drawer's
 * question rather than the camp's: pointing the tag at the sign-up for the
 * fortnight it runs is the whole reason the camp is in this list.
 *
 * It is `isPermanent` too, so the delete and the submissions rows stay off the
 * `⋯` menu — there is no document to delete and the registrations live in the
 * camp's own collections, behind its own screen.
 * ---------------------------------------------------------------------------
 */
function isCampRow(form: WithId<FormDraft>): boolean {
  return form.id === CAMP_FORM_SLUG;
}

/**
 * Whether a tap on the tag opens this row's form.
 *
 * Compares on **slug**, because that is what the setting stores and what the
 * camp — which has no document in `forms` and so no id there — can be named by.
 * A form whose slug was edited in the builder stops matching, and that is the
 * honest answer rather than a bug: the setting names an address, and the
 * address changed. The list draws a warning above itself when nothing matches,
 * and the site falls back to the vehicle registration meanwhile.
 */
function isTapDestination(form: WithId<FormDraft>, config: FormsPageConfig): boolean {
  return form.published && form.slug === config.nfcFormSlug;
}

/**
 * The camp as a row, carrying the position stored in `config/forms`.
 *
 * A `FormDraft` rather than a `FormDefinition`, which is what types the whole
 * list below: the draft is everything the builder can edit and the definition
 * adds the three stamps a *stored document* carries. There is no document here,
 * so inventing a `createdAt` for it would be a lie this list would then have to
 * be careful around. Every stored form is a draft too, so the forms read from
 * Firestore sit in the same array unchanged.
 */
function campRow(order: number): WithId<FormDraft> {
  return {
    ...blankForm(CAMP_FORM_SLUG),
    id: CAMP_FORM_SLUG,
    title: 'Serve at summer camp',
    blurb: '',
    icon: 'present',
    order,
    // Neither is read anywhere — the row draws a sentence where the checkboxes
    // would be — but `published: true` keeps the shape honest for anything that
    // later reads this list looking for what is on the hub.
    published: true,
    open: true,
  };
}

/**
 * The forms and the camp, in one list, sorted the way the hub sorts them.
 *
 * Same tie-break as `sortForms` in `../data`: `order`, then title, so two rows
 * left on the same number still come out in an order somebody can explain.
 */
function withCampRow(
  forms: readonly WithId<FormDraft>[],
  campOrder: number,
): WithId<FormDraft>[] {
  return [...forms, campRow(campOrder)].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}

function FormsList({
  forms,
  config,
  onCreate,
  onEdit,
  onSubmissions,
  onChanged,
}: {
  forms: WithId<FormDefinition>[] | null;
  config: FormsPageConfig;
  onCreate: () => void;
  onEdit: (form: WithId<FormDraft>) => void;
  onSubmissions: (formId: string) => void;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  /*
   * The order on screen, held locally while it is being changed.
   *
   * A drag moves the row under the finger and the write follows on release, so
   * the list has to be able to say something the server has not been told yet.
   * `onChanged` refreshes from the server afterwards, which is what corrects
   * the screen if a write was refused.
   *
   * Null means "no local opinion" — show whatever the server last said. That
   * matters after a refresh: keeping a stale local array would pin the list to
   * an order that no longer exists once somebody else has edited it.
   */
  const [moved, setMoved] = useState<WithId<FormDraft>[] | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  /*
   * What a drag is doing, said out loud.
   *
   * The handle's own label carries the position, but it is written at render
   * time and a drag deliberately does not re-render — so during the one gesture
   * where the position is changing, the label is the only thing on screen that
   * is stale. This region is updated as the row crosses each slot, which is
   * also what the arrow keys announce, so both routes report the same thing.
   */
  const liveRef = useRef<HTMLParagraphElement | null>(null);

  if (forms === null) return <p className="note">Loading…</p>;

  const rows = moved ?? withCampRow(forms, config.campOrder);

  /**
   * Renumber the whole list on the server.
   *
   * Every row is rewritten rather than the two that swapped — see
   * `setFormOrder` for why a swap does not work when most forms share
   * `order: 100`.
   *
   * The camp's row is pulled out and sent somewhere else. It is not a document
   * in `forms` and never will be, so its position is a field on `config/forms`
   * — but it is numbered from the same sequence as everything above and below
   * it, which is what lets the hub sort one list by one field. Its slot in the
   * numbering is left empty rather than closed up, so a form does not jump past
   * the camp because the camp is stored elsewhere.
   */
  function commit(next: WithId<FormDraft>[]) {
    setMoved(next);
    const numbered = next.map((form, index) => ({ form, order: (index + 1) * 10 }));
    const camp = numbered.find((entry) => isCampRow(entry.form));

    void Promise.all([
      setFormOrder(
        numbered
          .filter((entry) => !isCampRow(entry.form))
          .map((entry) => ({ id: entry.form.id, order: entry.order })),
        new Map(next.map((form) => [form.id, form.order])),
      ),
      // Only when it moved. A drag two rows down the list should not write a
      // settings document that says exactly what it said before.
      camp && camp.order !== config.campOrder
        ? setFormsPageConfig({ campOrder: camp.order })
        : Promise.resolve(),
    ]).then(() => {
      // Let the server's answer take over again. Without this the local array
      // outlives the edit and hides anything a second administrator changed.
      setMoved(null);
      onChanged();
    });
  }

  /** Announce a position to a screen reader, without repainting the list. */
  function say(message: string) {
    if (liveRef.current) liveRef.current.textContent = message;
  }

  /** Move one form to a new index, without writing. Used while a drag runs. */
  function reorder(from: number, to: number): WithId<FormDraft>[] | null {
    if (to < 0 || to >= rows.length || to === from) return null;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row!);
    return next;
  }

  /**
   * The drag itself.
   *
   * ---------------------------------------------------------------------------
   * ### Pointer events on the handle alone, not on the row
   *
   * The arrows this replaces were chosen partly to avoid the bug the photo
   * manager already paid for: a drag container wrapped around a row swallows
   * the click of every button inside it, because whatever captured the pointer
   * keeps it. That failure needs the capture to be *over* the other controls.
   * Here it is over one 1.75rem handle with nothing inside it, so the five
   * controls beside it never see a captured pointer at all.
   *
   * `setPointerCapture` is what makes a touch drag work: without it the browser
   * hands each move to whatever element is under the finger, which is a
   * different row the moment the list moves. `touch-action: none` on the handle
   * (see globals.css) stops the drawer scrolling underneath the drag.
   *
   * ### Nothing is reordered until the finger comes up
   *
   * The obvious version swaps the rows in React state as the pointer crosses
   * each midpoint. It was written first, and it moves a row exactly one place
   * and then goes dead however far you drag — which is worth recording,
   * because the cause is not obvious and it is not this list's alone.
   *
   * Reordering a keyed list is `insertBefore`, and `insertBefore` on a captured
   * element's ancestor takes that element out of the document for an instant.
   * A pointer capture does not survive that: the browser releases it and fires
   * `pointercancel`, so the first swap ends the drag it was supposed to be the
   * beginning of.
   *
   * So the drag never touches the DOM's order. It moves the rows with inline
   * `translateY` — the dragged one under the finger, the ones it has passed by
   * a row's pitch the other way — which is a paint and not a mutation, and
   * `setMoved` is called once, on release. Writing those transforms directly
   * rather than through state is deliberate for the same reason: a React
   * re-render mid-drag is exactly what must not happen.
   */
  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    // Left button and touch only; a right-click on the handle is not a drag.
    if (event.button !== 0) return;
    // Stops the drawer's text being selected as the pointer sweeps over it.
    event.preventDefault();

    const list = listRef.current;
    if (!list) return;

    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const items = [...list.querySelectorAll<HTMLLIElement>('.fxa__row')];
    const boxes = items.map((item) => item.getBoundingClientRect());
    /*
     * Each row's own pitch — its height plus the gap to the next one — taken
     * from the distance between successive tops.
     *
     * This was one number for the whole list, measured off the first two rows,
     * and that is the cause of most of what looked like jitter. These rows are
     * not the same height: one wraps its slug onto a second line, one carries a
     * `.fxa__row-warn`, one is taller while its `⋯` menu is open. With a single
     * pitch, dragging past a tall row moved every other row by the *short* row's
     * distance, so rows overlapped, gaps opened where nothing was, and the row
     * under the finger landed somewhere other than the slot it appeared to be
     * in. Per-row pitches make the displacement exact whatever the heights are.
     */
    const gap = boxes.length > 1 ? boxes[1]!.top - boxes[0]!.bottom : 0;
    const pitch = boxes.map((box, i) =>
      // The last row has no row after it to measure against, so it is given the
      // list's gap explicitly. Leaving it as a bare height is a real error and
      // not a rounding one: dragging the *last* form upward would then displace
      // every row it passed by one gap too little, and they would sit visibly
      // overlapping until the finger came up.
      i + 1 < boxes.length ? boxes[i + 1]!.top - box.top : box.height + gap,
    );
    const middles = boxes.map((box) => box.top + box.height / 2);
    const startY = event.clientY;
    /*
     * The scroller the list sits in, so a drag can reach a row that is off the
     * bottom of the drawer.
     *
     * Found by walking up and asking each ancestor whether it actually scrolls,
     * rather than by naming a class. The drawer is the bookstore's `Sheet` and
     * which of its elements carries the overflow has already moved once; a
     * selector would go quietly wrong the next time it does, and the symptom
     * would be a drag that simply cannot reach the last form.
     */
    let scroller: HTMLElement | null = list.parentElement;
    while (scroller) {
      const flow = getComputedStyle(scroller).overflowY;
      if (
        (flow === 'auto' || flow === 'scroll') &&
        scroller.scrollHeight > scroller.clientHeight
      )
        break;
      scroller = scroller.parentElement;
    }

    /*
     * A press is not a drag until it has travelled.
     *
     * Without this every press on the handle — including one that only means to
     * focus it before using the arrow keys — ran the whole drag, wrote the
     * order back and refetched the list. A few pixels of hand tremor was enough
     * to make the drawer flash and reload.
     */
    const THRESHOLD = 4;
    let live = false;
    let at = index;
    /** How far the dragged row has been carried, in pixels. */
    let travel = 0;

    /** Where the dragged row must be drawn to sit in slot `to`. */
    function offsetFor(to: number) {
      let d = 0;
      if (to > index) for (let i = index + 1; i <= to; i += 1) d += pitch[i]!;
      if (to < index) for (let i = to; i < index; i += 1) d -= pitch[i]!;
      return d;
    }

    function paint() {
      /*
       * The dragged row follows the finger, but never further than the list —
       * clamped to the travel that would put it in the first or the last slot,
       * plus half a row of overshoot so it still feels attached at the ends
       * rather than nailed down.
       */
      const slack = (pitch[index] ?? 0) / 2;
      const low = offsetFor(0) - slack;
      const high = offsetFor(items.length - 1) + slack;
      items[index]!.style.transform =
        `translateY(${Math.max(low, Math.min(high, travel))}px)`;
    }

    function settle(target: number) {
      if (target === at) return;
      at = target;
      for (let i = 0; i < items.length; i += 1) {
        if (i === index) continue;
        /*
         * A row the dragged one has passed moves by the *dragged* row's pitch,
         * which is the space that opened where it used to be — not by its own.
         * The two are only the same when every row is the same height.
         */
        const shift =
          (target > index && i > index && i <= target && -pitch[index]!) ||
          (target < index && i < index && i >= target && pitch[index]!) ||
          0;
        items[i]!.style.transform = shift ? `translateY(${shift}px)` : '';
      }
      say(`${rows[index]?.title ?? 'Form'}, position ${target + 1} of ${items.length}`);
    }

    const move = (moveEvent: PointerEvent) => {
      travel = moveEvent.clientY - startY;

      if (!live) {
        if (Math.abs(travel) < THRESHOLD) return;
        live = true;
        items[index]!.classList.add('is-dragging');
        list.classList.add('is-reordering');
        document.body.classList.add('is-reordering');
      }

      paint();

      /*
       * Nudge the drawer when the finger is near its edge, so a list longer
       * than the visible drawer can be reordered end to end. `middles` is in
       * viewport coordinates and so is `clientY`, so scrolling shifts both
       * together and the geometry below stays true without re-measuring.
       */
      if (scroller) {
        const edge = scroller.getBoundingClientRect();
        const margin = 48;
        const up = moveEvent.clientY - edge.top;
        const down = edge.bottom - moveEvent.clientY;
        if (up < margin) scroller.scrollTop -= Math.min(18, margin - up) / 2;
        else if (down < margin) scroller.scrollTop += Math.min(18, margin - down) / 2;
      }

      /*
       * The slot the pointer is over, counted against the midpoints the rows
       * had when the drag began — which is the whole geometry, since nothing
       * has actually moved. Clamped rather than ignored, so dragging past
       * either end parks the row at that end.
       */
      let target = middles.filter((middle) => moveEvent.clientY > middle).length;
      if (target > index) target -= 1;
      settle(Math.max(0, Math.min(items.length - 1, target)));
    };

    /** Put the list back the way it was drawn, and let go of the gesture. */
    const clear = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', drop);
      handle.removeEventListener('pointercancel', abandon);
      list.classList.remove('is-reordering');
      document.body.classList.remove('is-reordering');

      // The transforms come off in the same frame the new order goes in, so the
      // row never appears twice in one place or jumps back before it lands.
      for (const item of items) item.style.transform = '';
      items[index]!.classList.remove('is-dragging');
    };

    const drop = () => {
      clear();

      // A press that never travelled is a press, not a drag: leave the order
      // alone so the handle can be focused for the arrow keys.
      if (!live) return;

      const next = reorder(index, at);
      if (next) commit(next);
    };

    /*
     * A cancelled drag writes nothing.
     *
     * `pointercancel` and `pointerup` were the same handler, which is a real
     * bug and not a tidiness point: anything that takes the pointer away
     * mid-drag — the browser deciding the gesture was a scroll after all, a
     * touch becoming a system gesture, the window losing the pointer — then
     * *committed* the half-finished move and refetched the list. A drag the
     * reader never finished has to leave the order exactly as it was.
     */
    const abandon = () => {
      clear();
      if (live) say('Move cancelled');
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', drop);
    handle.addEventListener('pointercancel', abandon);
  }

  /**
   * The same reorder from a keyboard, on the same handle.
   *
   * A drag is unusable without a pointer, and this drawer is a staff tool that
   * has to stay operable from a keyboard — so the handle is a real button that
   * moves its row with the arrow keys. This is what the two visible arrows were
   * also good at, and it is the part of them worth keeping.
   */
  function onHandleKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (by === 0) return;

    const next = reorder(index, index + by);
    if (!next) return;
    event.preventDefault();

    /*
     * Keep the keyboard on the row that moved, not on the row that took its
     * place — otherwise a second press moves a different form, which is what
     * this did at first.
     *
     * It is the *same button* either way: the list is keyed by form id, so
     * React moves this `<li>` rather than rewriting the one above it, and this
     * node travels with its form. Re-focusing it after the render is only
     * needed because moving a node can drop focus; picking a handle out of the
     * list by its new index cannot work, because the indices belong to the
     * order that has not been painted yet.
     */
    const handle = event.currentTarget;
    commit(next);
    say(`${rows[index]?.title ?? 'Form'}, position ${index + by + 1} of ${rows.length}`);
    setTimeout(() => handle.focus(), 0);
  }

  return (
    <>
      <button type="button" className="button" onClick={onCreate}>
        + New form
      </button>

      {rows.length === 0 && <p className="note">No forms yet.</p>}

      {/*
        The tap destination has no control of its own up here.
        ---------------------------------------------------------------------
        It was a select over the list, and it is a box on each row instead, at
        Tommy's direction. The reason to prefer it: the question "which form
        does the tag open" is asked *about a form*, and every other answer this
        drawer gives about a form — published, open — is a box on its row. A
        select is a second place to look and a second vocabulary for one list.

        Only one box is ever ticked, and that is a property of the storage
        rather than of this screen policing it: the destination is one field
        naming one slug, so ticking a box is a single write that names the new
        form, and the box that was ticked before goes out because the document
        says something else now. There is no state where two are ticked, and
        none where a half-landed write leaves zero. See
        `FormsPageConfig.nfcFormSlug`.

        What *is* policed here is unticking. A tag has to go somewhere, so the
        ticked box refuses to become unticked — the way out is to tick another
        one. See the `onChange` below.

        This paragraph is the exception: it is drawn only when the stored
        destination is no form on the list, which is the one state the boxes
        cannot express. Nothing is ticked, and without a sentence that reads as
        a bug rather than as a setting that has gone stale behind a rename.
      */}
      {!rows.some((form) => form.published && form.slug === config.nfcFormSlug) && (
        <div className="notice notice--alarm" role="status">
          <p>
            The NFC tag is set to open <strong>{config.nfcFormSlug}</strong>, which is not
            a published form any more. Until somebody ticks a box below, a tap opens the
            vehicle registration.
          </p>
        </div>
      )}

      {rows.length > 1 && (
        <p className="note">
          The order here is the order on /forms. Drag a form by its handle to move it, or
          focus a handle and press the up and down arrow keys.
        </p>
      )}

      <p ref={liveRef} className="visually-hidden" role="status" aria-live="polite" />

      <ul className="fxa__list" ref={listRef}>
        {rows.map((form, index) => (
          <li key={form.id} className="fxa__row">
            <button
              type="button"
              className="fxa__grip"
              onPointerDown={(event) => startDrag(event, index)}
              onKeyDown={(event) => onHandleKey(event, index)}
              aria-label={`Reorder ${form.title}. Position ${index + 1} of ${rows.length}. Drag, or press the up and down arrow keys.`}
            >
              <span aria-hidden="true">⠿</span>
            </button>

            <div className="fxa__row-main">
              {isCampRow(form) ? (
                /*
                  Not a button. Everything else in this column opens the
                  builder, and there is no form document behind this row to open
                  — a title that looks the same and does nothing is worse than
                  one that plainly is not a control.
                */
                <span className="fxa__row-title">{form.title}</span>
              ) : (
                <button
                  type="button"
                  className="fxa__row-title"
                  onClick={() => onEdit(form)}
                >
                  {form.title}
                </button>
              )}
              <span className="fxa__row-meta">
                /forms/{form.slug} ·{' '}
                {isCampRow(form) ? 'the camp’s own sign-up' : KIND_LABEL[form.kind]}
                {!isCampRow(form) && form.payment.enabled && ' · takes payment'}
              </span>
            </div>

            <div className="fxa__row-flags">
              {isCampRow(form) ? (
                /*
                  A sentence where Published and Open would be. Whether the
                  camp is on the hub is the camp's decision and is made on its
                  own settings panel — see `isCampRow` for why a switch here
                  would be a second, disagreeing one. The row is still
                  draggable, and it still carries the tap box below.
                */
                <p className="fxa__fixed">
                  <small>
                    Shown while the camp is taking sign-ups. Open and close it under{' '}
                    <strong>Run summer camp</strong>.
                  </small>
                </p>
              ) : (
                <>
                  {/*
                    Publish and open are toggled here rather than only inside
                    the builder. Closing a registration the night it fills up is
                    the one edit that is urgent, and it should not require
                    opening a form editor and finding the right checkbox.
                  */}
                  <label className="fxa__flag">
                    <input
                      type="checkbox"
                      checked={form.published}
                      disabled={isPermanent(form)}
                      onChange={(event) => {
                        void setFormFlags(form.id, {
                          published: event.target.checked,
                        }).then(onChanged);
                      }}
                    />
                    <span>
                      Published
                      {isPermanent(form) && (
                        <small> — always on, the church’s own links use it</small>
                      )}
                    </span>
                  </label>
                  <label className="fxa__flag">
                    <input
                      type="checkbox"
                      checked={form.open}
                      onChange={(event) => {
                        void setFormFlags(form.id, {
                          open: event.target.checked,
                        }).then(onChanged);
                      }}
                    />
                    <span>Open</span>
                  </label>
                </>
              )}

              {/*
                The tap destination, on every row including the camp's.
                -------------------------------------------------------------
                A checkbox rather than a radio, which is the accessible default
                for one-of-many and is deliberately not what this is. A radio
                group has to be one group — one `name`, one set of inputs — and
                these are scattered one per row through a list that also
                contains a row backed by no document, in a drawer where a row
                can appear and disappear under a live subscription. The boxes
                beside this one are checkboxes, and a circle among them would
                read as a different kind of answer to the same kind of
                question.

                What that owes the reader is said out loud rather than left to
                the shape of the control: the ticked row's label carries how to
                move it.
              */}
              <label className="fxa__flag fxa__flag--nfc">
                <input
                  type="checkbox"
                  checked={isTapDestination(form, config)}
                  /*
                   * A form nobody can see is not somewhere to send a tap:
                   * `formSubmit` answers 404 to an unpublished form, so the tag
                   * would open a page that refuses every submission with
                   * nothing on it to say why.
                   */
                  disabled={!form.published}
                  onChange={(event) => {
                    /*
                     * Unticking is not an edit, it is an empty tag. The only
                     * way out of being the destination is for another form to
                     * become it, so the box does not come off — and it cannot
                     * be left looking off either, because `config` is a live
                     * subscription and the next render draws the stored answer.
                     */
                    if (!event.target.checked) return;
                    void setFormsPageConfig({ nfcFormSlug: form.slug });
                  }}
                />
                <span>
                  Opens from the NFC tag
                  {isTapDestination(form, config) && (
                    <small> — tick another form to move it</small>
                  )}
                </span>
              </label>
            </div>

            {/*
              One `⋯` where there were three buttons.
              -----------------------------------------------------------------
              A row used to end in Edit, Submissions and Delete, which over six
              forms was eighteen buttons in a 600px column — and one of the
              three was pure duplication: the title above is already the button
              that opens the editor, so "Edit" was a second control for the
              thing a volunteer's first instinct clicks anyway.

              The other two are kept but demoted. Neither is the reason anybody
              opens this list — that is the two checkboxes, which stay on the
              row because closing a registration the night it fills up is the
              one urgent edit here.

              Not a `<dialog>`: this list is already inside one, opened with
              `showModal()`, and a nested modal in the top layer is a fight
              over focus and over Escape. A plain absolutely-positioned panel
              that closes on an outside press is the smaller thing.
            */}
            <RowMenu
              label={form.title}
              items={[
                ...(keepsNoSubmissions(form.kind)
                  ? []
                  : [
                      {
                        label: 'Submissions',
                        onSelect: () => onSubmissions(form.id),
                      },
                    ]),
                ...(isPermanent(form)
                  ? []
                  : [
                      {
                        label: 'Delete this form…',
                        danger: true,
                        onSelect: () => setConfirming(form.id),
                      },
                    ]),
              ]}
            />

            {/*
              The confirm opens on the row rather than in the menu.

              A second menu hanging off the first is where this would have gone
              if Delete carried its own "Really?" — and a destructive question
              asked inside a popover that an outside click dismisses is the
              wrong shape for it. Same warning block the submissions queue
              uses, for the same reason: the sentence is the safeguard, not the
              second click.
            */}
            {confirming === form.id && (
              <div className="fxa__row-warn">
                <div
                  className="fxa__warn"
                  role="alertdialog"
                  aria-label={`Delete ${form.title}?`}
                >
                  <p className="fxa__warn-lede">Delete the {form.title} form?</p>
                  <p>
                    The form and its questions go for good. Anything already sent in
                    through it stays — a submission is a record of something that happened
                    — and will still be listed under this title.
                  </p>
                  <p>
                    To take it off /forms and keep it, untick <strong>Published</strong>{' '}
                    instead.
                  </p>
                  <div className="fxa__warn-actions">
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => {
                        void deleteForm(form.id).then(() => {
                          setConfirming(null);
                          onChanged();
                        });
                      }}
                    >
                      Delete for good
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => setConfirming(null)}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="meta">
        Deleting a form leaves its submissions in place — they are a record of something
        that happened. Unpublish instead to take a form off the site while keeping it.
      </p>
    </>
  );
}

interface MenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The `⋯` at the end of a form's row.
 *
 * ---------------------------------------------------------------------------
 * Hand-rolled rather than a `<dialog>` or a `<details>`, and both alternatives
 * were tried first.
 *
 * `<dialog>` is what `Sheet.tsx` uses and it is the right thing for the drawer
 * this list sits in — but a modal inside a modal means two elements in the top
 * layer arguing about focus, and Escape closing the outer one instead of the
 * inner. `<details>`/`<summary>` gets the toggle for free and gives away the
 * two behaviours a menu actually needs: it does not close when you press
 * somewhere else, and it does not close when you choose something.
 *
 * So: a button, a panel, and three listeners.
 *
 *   - `pointerdown` on the document, not `click`. A `click` listener fires
 *     after the press has already moved focus and, on a touch screen, after a
 *     300ms delay in which the panel is still over what was tapped.
 *   - `keydown` in the **capture** phase, calling `preventDefault()`. Without
 *     both of those, Escape reaches the `<dialog>` above and shuts the whole
 *     drawer — losing the builder's place to dismiss a menu.
 *   - `focusout`, so tabbing off the last item closes it too.
 *
 * Focus goes back to the trigger on Escape. It deliberately does *not* on
 * choosing an item: both items replace what the drawer is showing, and moving
 * focus back to a button that is about to unmount fights the new screen for it.
 * ---------------------------------------------------------------------------
 */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function away(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }

    function key(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Stops the modal `<dialog>` this list lives in from closing with it.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }

    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  // Focus the first item, so the menu is usable from a keyboard the moment it
  // opens. In an effect rather than in the click handler: the panel does not
  // exist until this render has committed.
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  if (items.length === 0) return <span className="fxa__row-menu" />;

  return (
    <div
      className="fxa__row-menu"
      ref={box}
      /* React's `onBlur` is `focusout` underneath, so it bubbles from the
         items — which is what makes tabbing off the last one close the menu. */
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="fxa__more"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${label}`}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open && (
        <div className="fxa__menu" role="menu">
          {items.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              ref={index === 0 ? first : undefined}
              className={item.danger ? 'fxa__menu-item is-danger' : 'fxa__menu-item'}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<FormDefinition['kind'], string> = {
  native: 'built here',
  embed: 'shown here, answers stay with the host',
  external: 'links out',
  vehicle: 'vehicle registration',
};

/**
 * A new form, unpublished.
 *
 * `published: false` is the important default. A form created by a mis-click
 * should not be a live page with no questions on it, and the builder's warnings
 * are written on the assumption that the thing being warned about is not yet
 * in front of anybody.
 */
function blankForm(id: string): FormDraft {
  return {
    slug: toFormSlug(id),
    title: 'New form',
    blurb: '',
    icon: 'file',
    image: null,
    order: 100,
    published: false,
    open: true,
    closedMessage: null,
    kind: 'native',
    externalUrl: null,
    pushesToTaksis: false,
    fields: [],
    payment: { ...NO_PAYMENT },
    notifyEmails: [],
    confirmationMessage: 'Thank you — the church office has your submission.',
    confirmationEmailBody: '',
  };
}
