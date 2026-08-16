import type { Announcement, DocOf } from '@spsm/shared';
import { Icon } from '@/components/Icon';

export function AnnouncementList({ announcements }: { announcements: DocOf<Announcement>[] }) {
  return (
    <ul className="grid">
      {announcements.map((item) => (
        // `card--link` only when there is somewhere to go. An announcement with
        // no `linkUrl` is a notice to read, and lifting it on hover would
        // promise a click that does nothing.
        <li key={item.id} className={item.linkUrl ? 'card card--link' : 'card'}>
          {item.pinned && (
            <p className="meta pin">
              <Icon name="pin" size={14} /> Pinned
            </p>
          )}
          <h3>
            {item.linkUrl ? (
              // An announcement's link is staff-entered and usually points off
              // the parish's own site, so this stays a plain anchor rather than
              // next/link — and carries `rel` accordingly.
              <a href={item.linkUrl} rel="noopener noreferrer">
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h3>
          <p>{item.body}</p>
        </li>
      ))}
    </ul>
  );
}
