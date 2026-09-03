/**
 * Pictures a page or a form may wear, without uploading anything.
 *
 * ---------------------------------------------------------------------------
 * Moved out of `features/forms/admin/PicturePicker` when the About pages got an
 * editor, because a list of the photographs this site ships is not a fact about
 * forms.
 *
 * A fixed list rather than a free text box, because a box here is how a page
 * ends up hotlinking a photograph from somebody else's website.
 *
 * The four stock photographs first: each one says what a form is *for* — a car
 * park, a van, a group meeting, a gathering — which is the job a generic
 * photograph can do honestly. Their licence and photo ids are recorded in
 * `assets/README.md`, unlike every other stock image this repo inherited. The
 * parish's own images follow, for a page or form where they genuinely fit.
 *
 * Notable absence: the Crucifixion icon. It is genuine and beautiful, and an
 * icon is venerated rather than used as page furniture — nobody should meet it
 * at the top of a form about parking a car.
 * ---------------------------------------------------------------------------
 */
export interface PictureChoice {
  value: string | null;
  label: string;
}

export const STOCK_PICTURES: readonly PictureChoice[] = [
  { value: '/img/stock-parking-lot-1000.webp', label: 'Car park' },
  { value: '/img/stock-passenger-van-1000.webp', label: 'Passenger van' },
  { value: '/img/stock-small-group-1000.webp', label: 'Small group' },
  { value: '/img/stock-gathering-1000.webp', label: 'Gathering' },
  { value: '/img/stock-camp-1000.webp', label: 'Summer camp' },
  { value: '/img/stock-office-1000.webp', label: 'Office desk' },
  { value: '/img/home-sanctuary-1000.webp', label: 'The sanctuary (ours)' },
  { value: '/img/cross-coptic-360.webp', label: 'Coptic cross (ours)' },
  { value: '/img/hero-glass-1000.webp', label: 'Stained glass' },
  { value: null, label: 'No picture' },
] as const;
