import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { formatDate } from './views/presentation';

export function Notifications() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const feed = useQuery({ queryKey: ['release-notifications'], queryFn: api.notifications, enabled: open });
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="relative" ref={container}>
      <button
        ref={trigger}
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="release-notifications"
        className="rounded-xl border border-transparent p-2 text-[#71869A] transition hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-white"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-4 w-4" />
      </button>
      {open && (
        <section
          id="release-notifications"
          aria-label="Release notifications"
          className="absolute right-0 top-10 z-50 w-80 max-h-80 overflow-auto rounded-xl border border-white/10 bg-[#211E21] p-4 text-sm shadow-2xl"
        >
          <h2 className="mb-2 font-bold text-white">Notifications</h2>
          {feed.isPending ? (
            <p role="status">Loading activity…</p>
          ) : feed.isError ? (
            <button type="button" className="text-[#FF9B5C]" onClick={() => feed.refetch()}>
              Retry loading activity
            </button>
          ) : feed.data.notifications.length ? (
            <ul className="divide-y divide-white/10">
              {feed.data.notifications.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={entry.href}
                    onClick={() => setOpen(false)}
                    className="block rounded py-2 hover:text-white"
                  >
                    <strong className="block">{entry.title}</strong>
                    <span className="block text-xs text-[#A8AFBC]">{entry.detail}</span>
                    <time dateTime={entry.occurred_at} className="text-[10px] text-[#AB9286]">
                      {formatDate(entry.occurred_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No release activity yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
