import Link from 'next/link';

/**
 * Static export writes this to `out/404.html`, which is what the catch-all
 * rewrite in firebase.json points at. Without it, an unknown URL on the live
 * site gets Firebase's default 404 page rather than the parish's.
 */
export default function NotFound() {
  return (
    <div className="prose">
      <h1>Page not found</h1>
      <p className="lede">
        That address doesn&apos;t match anything on the site. It may have moved when the
        parish website changed platforms.
      </p>
      <p>
        Try the <Link href="/events">parish calendar</Link>, the{' '}
        <Link href="/about">about page</Link>, or{' '}
        <Link href="/contact">contact the office</Link> and we&apos;ll point you to it.
      </p>
    </div>
  );
}
