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
      <PageHeader title="Page not found" />
      <PageBody>
        <h2>Page not found</h2>
        <p className="prose">
          That address doesn&apos;t match anything on the site. It may have moved when the
          church website changed platforms.
        </p>
        <div className="prose">
          <p>
            Try the <Link href="/calendar">church calendar</Link>, the{' '}
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
