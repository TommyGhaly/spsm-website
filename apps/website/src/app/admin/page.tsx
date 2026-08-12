import Link from 'next/link';

export default function AdminHome() {
  return (
    <div className="prose">
      <h1>Parish admin</h1>
      <p className="lede">
        Everything here changes the live website. Edits appear the next time the site
        builds, which happens automatically within about ten minutes.
      </p>

      <h2>What you can do</h2>
      <ul>
        <li>
          <Link href="/admin/events">Events</Link> — add, edit, publish, and remove entries
          on the parish calendar.
        </li>
      </ul>

      <h2>What isn&apos;t here yet</h2>
      <p>
        Page text (About, Our Faith, clergy bios) is edited in the repository and pushed
        with <code>npm run content</code>. Parish contact details, service times, and the
        livestream target live in the Firebase console under <code>config</code>. Both are
        on the list to move here.
      </p>

      <h2>A note on the weekly liturgies</h2>
      <p>
        Don&apos;t add the regular Sunday and weekday services as events. They already come
        from the parish service times and the weekly bulletin, and entering them here puts
        the same liturgy on the homepage twice. The calendar is for the things that
        aren&apos;t every week — the festival, the camp, the classes.
      </p>
    </div>
  );
}
