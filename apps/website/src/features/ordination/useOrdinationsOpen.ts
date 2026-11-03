'use client';

import { useEffect, useState } from 'react';
import { watchOpenOrdinations } from './data';

/**
 * Whether any ordination is taking nominations, for the forms hub's card.
 *
 * Opens `false` and stays false on a failed read — the opposite of the camp's
 * `useCampSignUpOpen`. The camp card is the form most people arriving at the
 * hub want; this one is wanted a few times a year, and a card that flickers in
 * on every visit, or appears on a failure to say nothing is open, costs more
 * than one that arrives a moment late.
 */
export function useOrdinationsOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(
    () =>
      watchOpenOrdinations(
        (rows) => setOpen(rows.length > 0),
        (error) => {
          console.warn('[ordination] could not read the open ordinations', error);
          setOpen(false);
        },
      ),
    [],
  );
  return open;
}
