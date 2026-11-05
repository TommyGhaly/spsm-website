import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ADMIN_SCREENS } from '@spsm/shared';
import { asAnon, asSuper, createTestEnv } from './helpers.js';

/**
 * The ordination collections.
 *
 * What these assert: the public can list the open ordinations and nothing
 * else; only the Function creates a nomination; an admin may change the review
 * and not what the family sent; and a priest's signature is theirs alone to
 * write.
 */

let env: RulesTestEnvironment;

const asPriest = (e: RulesTestEnvironment) => e.authenticatedContext('priest-1', {});
const asSecondPriest = (e: RulesTestEnvironment) => e.authenticatedContext('priest-2', {});
/** Every other area on the site, which must open none of this. */
const asEveryOtherArea = (e: RulesTestEnvironment) => e.authenticatedContext('every-area-1', {});

const everyScreenButOrdination = Object.fromEntries(
  ADMIN_SCREENS.filter((s) => s !== 'ordination').map((s) => [s, true]),
);

const ordination = {
  date: '2026-12-06',
  open: true,
  churchName: 'St. Philopater Mercurius & St. Mina Coptic Orthodox Church',
  churchAddress: 'Wayland, MA',
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: 'priest-1',
};

const application = {
  ordinationId: 'ord-1',
  rank: 'reader',
  status: 'pending',
  review: null,
  signatures: [],
  nominee: {
    name: 'Mark Example', address: '1 Main St', dateOfBirth: '2010-01-01', schoolGrade: '10th',
    occupation: '', phone: '555-0100', email: '', fatherOfConfession: 'Fr. Mina',
  },
  parents: [{ name: 'George', phone: '555-0101', email: '' }, { name: '', phone: '', email: '' }],
  submittedBy: '',
  message: '',
  submittedAt: new Date(),
  updatedAt: new Date(),
  updatedBy: null,
};

const review = {
  answers: { attendance: 'Yes' },
  note: '',
  decidedByUid: 'priest-1',
  decidedByName: 'Fr. A',
  decidedOn: '2026-11-02',
};

beforeAll(async () => {
  env = await createTestEnv('ordination');
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'ordinations', 'ord-1'), ordination);
    await setDoc(doc(db, 'ordinations', 'ord-closed'), { ...ordination, open: false });
    await setDoc(doc(db, 'ordinationApplications', 'app-1'), application);
    await setDoc(doc(db, 'ordinationSignatures', 'priest-2'), {
      name: 'Fr. B', image: 'data:image/png;base64,AAAA', updatedAt: new Date(),
    });
    await setDoc(doc(db, 'members', 'priest-1'), { screenAdmin: { ordination: true } });
    await setDoc(doc(db, 'members', 'priest-2'), { screenAdmin: { ordination: true } });
    await setDoc(doc(db, 'members', 'every-area-1'), { screenAdmin: everyScreenButOrdination });
  });
});

describe('ordinations', () => {
  it('lets anybody list the open ones, which is what the public form does', async () => {
    const db = asAnon(env).firestore();
    await assertSucceeds(getDocs(query(collection(db, 'ordinations'), where('open', '==', true))));
  });

  it('lets an admin open one, and nobody else', async () => {
    await assertSucceeds(addDoc(collection(asPriest(env).firestore(), 'ordinations'), ordination));
    await assertFails(addDoc(collection(asEveryOtherArea(env).firestore(), 'ordinations'), ordination));
    await assertFails(addDoc(collection(asAnon(env).firestore(), 'ordinations'), ordination));
  });

  it('refuses keys it does not know — a rank included, which belongs to each nomination', async () => {
    const db = asPriest(env).firestore();
    await assertFails(addDoc(collection(db, 'ordinations'), { ...ordination, rank: 'reader' }));
    await assertFails(addDoc(collection(db, 'ordinations'), { ...ordination, extra: true }));
  });

  it('takes a last day to apply as a string, and nothing else', async () => {
    const db = asPriest(env).firestore();
    await assertSucceeds(addDoc(collection(db, 'ordinations'), { ...ordination, closesOn: '2026-11-20' }));
    await assertFails(addDoc(collection(db, 'ordinations'), { ...ordination, closesOn: 20261120 }));
    await assertSucceeds(updateDoc(doc(db, 'ordinations', 'ord-1'), { closesOn: '2026-11-27' }));
  });

  it('lets an admin close one', async () => {
    const db = asPriest(env).firestore();
    await assertSucceeds(updateDoc(doc(db, 'ordinations', 'ord-1'), { open: false }));
  });
});

describe('applications', () => {
  it('are refused to the public and to every other area', async () => {
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'ordinationApplications', 'app-1')));
    await assertFails(getDoc(doc(asEveryOtherArea(env).firestore(), 'ordinationApplications', 'app-1')));
    await assertFails(
      getDocs(collection(asEveryOtherArea(env).firestore(), 'ordinationApplications')),
    );
  });

  it('are read by the query the review screen issues', async () => {
    const db = asPriest(env).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'ordinationApplications'), where('ordinationId', '==', 'ord-1'))),
    );
  });

  it('are created by the Function only — not even by an admin or the superadmin', async () => {
    await assertFails(addDoc(collection(asAnon(env).firestore(), 'ordinationApplications'), application));
    await assertFails(addDoc(collection(asPriest(env).firestore(), 'ordinationApplications'), application));
    await assertFails(addDoc(collection(asSuper(env).firestore(), 'ordinationApplications'), application));
  });

  it('let an admin approve, answer and sign', async () => {
    const db = asPriest(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'ordinationApplications', 'app-1'), {
        status: 'approved',
        review,
        signatures: [{ uid: 'priest-1', name: 'Fr. A', image: 'data:image/png;base64,AAAA', signedOn: '2026-11-02' }],
        updatedAt: new Date(),
        updatedBy: 'priest-1',
      }),
    );
  });

  it('let an admin take signatures off a nomination, their own or another priest’s', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'ordinationApplications', 'app-1'), {
        signatures: [{ uid: 'priest-2', name: 'Fr. B', image: 'data:image/png;base64,AAAA', signedOn: '2026-11-02' }],
      });
    });
    const db = asPriest(env).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'ordinationApplications', 'app-1'), {
        signatures: [],
        updatedAt: new Date(),
        updatedBy: 'priest-1',
      }),
    );
  });

  it('refuse an admin changing what the family sent', async () => {
    const db = asPriest(env).firestore();
    await assertFails(
      updateDoc(doc(db, 'ordinationApplications', 'app-1'), {
        nominee: { ...application.nominee, name: 'Somebody Else' },
      }),
    );
    await assertFails(updateDoc(doc(db, 'ordinationApplications', 'app-1'), { rank: 'subdeacon' }));
  });

  it('refuse a fourth signature and a status the screen never writes', async () => {
    const db = asPriest(env).firestore();
    const signature = { uid: 'x', name: 'x', image: 'data:image/png;base64,AAAA', signedOn: '2026-11-02' };
    await assertFails(
      updateDoc(doc(db, 'ordinationApplications', 'app-1'), {
        signatures: [signature, signature, signature, signature],
      }),
    );
    await assertFails(updateDoc(doc(db, 'ordinationApplications', 'app-1'), { status: 'ordained' }));
  });

  it('can be deleted by an admin only', async () => {
    await assertFails(deleteDoc(doc(asEveryOtherArea(env).firestore(), 'ordinationApplications', 'app-1')));
    await assertSucceeds(deleteDoc(doc(asPriest(env).firestore(), 'ordinationApplications', 'app-1')));
  });
});

describe('signatures', () => {
  const mine = { name: 'Fr. A', image: 'data:image/png;base64,AAAA', updatedAt: new Date() };

  it('let a priest save their own', async () => {
    await assertSucceeds(setDoc(doc(asPriest(env).firestore(), 'ordinationSignatures', 'priest-1'), mine));
  });

  it('refuse writing somebody else’s', async () => {
    await assertFails(setDoc(doc(asPriest(env).firestore(), 'ordinationSignatures', 'priest-2'), mine));
  });

  it('refuse somebody without the screen keeping one', async () => {
    await assertFails(
      setDoc(doc(asEveryOtherArea(env).firestore(), 'ordinationSignatures', 'every-area-1'), mine),
    );
  });

  it('refuse an image larger than the cap', async () => {
    await assertFails(
      setDoc(doc(asPriest(env).firestore(), 'ordinationSignatures', 'priest-1'), {
        ...mine,
        image: `data:image/png;base64,${'A'.repeat(150_001)}`,
      }),
    );
  });

  it('are readable by the other admins, and nobody else', async () => {
    await assertSucceeds(getDoc(doc(asPriest(env).firestore(), 'ordinationSignatures', 'priest-2')));
    await assertFails(getDoc(doc(asAnon(env).firestore(), 'ordinationSignatures', 'priest-2')));
    await assertFails(getDoc(doc(asEveryOtherArea(env).firestore(), 'ordinationSignatures', 'priest-2')));
  });

  it('let a priest delete their own', async () => {
    await assertSucceeds(deleteDoc(doc(asSecondPriest(env).firestore(), 'ordinationSignatures', 'priest-2')));
  });

  it('refuse deleting somebody else’s', async () => {
    await assertFails(deleteDoc(doc(asPriest(env).firestore(), 'ordinationSignatures', 'priest-2')));
  });
});
