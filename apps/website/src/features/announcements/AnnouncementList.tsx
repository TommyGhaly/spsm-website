import type { Announcement, DocOf } from '@spsm/shared';

export function AnnouncementList({ announcements }: { announcements: DocOf<Announcement>[] }) {
  return (
    <ul className="grid">
      {announcements.map((item) => (
        <li key={item.id} className="card">
          {item.pinned && <p className="meta pin">Pinned</p>}
          <h3>{item.linkUrl ? <a href={item.linkUrl}>{item.title}</a> : item.title}</h3>
          <p>{item.body}</p>
        </li>
      ))}
    </ul>
  );
}
