import { Link } from 'react-router-dom';
import { strings } from '../lib/strings';
import { useUnreadCount } from '../modules/notifications/api';

/**
 * The unread counter the spec asks to be visible at all times
 * (08-notifications-and-push.md#readunread-behavior). It polls rather than holding a
 * socket open: the count is cheap, and a websocket for one integer would be a second
 * transport to operate for no gain.
 */
export function NotificationBell() {
  const { data } = useUnreadCount();
  const unread = data?.unread ?? 0;

  return (
    <Link
      to="/notificacoes"
      aria-label={
        unread > 0 ? `${strings.notifications.open} (${unread})` : strings.notifications.open
      }
      className="relative rounded-md p-2 text-slate-600 transition hover:bg-slate-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0m6 0H9"
        />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 font-bold text-white">
          {strings.notifications.badge(unread)}
        </span>
      )}
    </Link>
  );
}
