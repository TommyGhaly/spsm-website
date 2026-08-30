/**
 * Public surface of the festival tour.
 *
 * `TourScreen` only. The station data, the transliterator and the interactive
 * primitives are all internal — they exist to build this one page, and
 * exporting them would invite a second page to grow half a tour.
 */
export { TourScreen } from './TourScreen';
