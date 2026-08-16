import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

/**
 * Static export writes this to `out/404.html`, which is what the catch-all
 * rewrite in firebase.json points at. Without it, an unknown URL on the live
 * site gets Firebase's default 404 page rather than the parish's.
 */
export default function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="404"
        title="Page not found"
        lede="That address doesn’t match anything on the site. It may have moved when the parish website changed platforms."
      />
      <PageBody>
        <div className="prose">
          <p>
            Try the <Link href="/events">parish calendar</Link>, the{' '}
            <Link href="/about">about page</Link>, or{' '}
            <Link href="/contact">contact the office</Link> and we&apos;ll point you to it.
          </p>
        </div>
        <p>
          <Link className="button" href="/">
            Back to the homepage
          </Link>
        </p>
      </PageBody>
    </>
  );
}
