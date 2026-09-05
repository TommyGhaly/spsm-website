'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { COLLECTIONS, CONFIG_DOC_CAMP, parseCampConfig } from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Whether the camp is taking servant sign-ups, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * A second, much smaller reader of `config/camp`, beside `useCampAdmin`.
 *
 * `useCampAdmin` answers three questions — the settings, whether this person
 * runs the camp, and whether they may see its money — and pays a member-document
 * read for the last two. The forms hub needs none of that. It has one yes/no
 * question, it is the public list of forms, and a page a car-park NFC tag lands
 * on should not read a second document to draw a card.
 *
 * So this is the settings listener out of that hook with the grants left off:
 * one world-readable document, no permission, live.
 *
 * **It opens `true` and only ever closes on a document that says so.** The camp
 * card is the reason: a hub that hides the sign-up while Firestore is still
 * answering is a hub that flickers, and a hub that hides it because the read
 * *failed* has taken away the form on exactly the connection least able to go
 * looking for it another way. Closed is a decision somebody made on the
 * settings panel; it is never an absence.
 * ---------------------------------------------------------------------------
 */
export function useCampSignUpOpen(): boolean {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    return onSnapshot(
      doc(db(), COLLECTIONS.config, CONFIG_DOC_CAMP),
      (snapshot) => {
        // A missing document is not a closed camp — it is a camp nobody has
        // configured, and `parseCampConfig` reads an absent switch as open for
        // the reason recorded on the field itself.
        setOpen(snapshot.exists() ? parseCampConfig(snapshot.data()).servantSignUp : true);
      },
      (error) => {
        console.warn('[camp] could not read the camp settings; leaving sign-ups open', error);
        setOpen(true);
      },
    );
  }, []);

  return open;
}
