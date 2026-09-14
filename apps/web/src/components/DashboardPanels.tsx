import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card } from './ui';
import { formatDate, formatDateTime } from '../lib/dates';
import {
  contentTypeLabel,
  fileStatusLabel,
  pendingRequestStatusLabel,
  productionStatusLabel,
  strings,
} from '../lib/strings';
import type {
  DashboardContentCard,
  DashboardFileCard,
  DashboardRequestCard,
} from '../modules/dashboard/api';

/**
 * A number somebody has to act on. Each one links to the screen that acts on it,
 * because a dashboard that only tells you a count makes you go and find the thing
 * yourself (03-functional-requirements.md: "o que preciso fazer agora?").
 */
export function StatTile({
  label,
  value,
  to,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  to?: string;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'text-slate-900',
    warning: 'text-amber-700',
    danger: 'text-rose-700',
  } as const;

  const body = (
    <>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${value === 0 ? 'text-slate-300' : tones[tone]}`}>
        {value}
      </p>
    </>
  );

  return to ? (
    <Link
      to={to}
      className="rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-slate-200 bg-white p-3">{body}</div>
  );
}

/**
 * `count` rather than inspecting `children`: the row components render as one element
 * whether they were given ten items or none, so the panel has to be told.
 */
export function Panel({
  title,
  count,
  to,
  empty,
  children,
}: {
  title: string;
  count: number;
  to?: string;
  empty?: string;
  children: ReactNode;
}) {
  const isEmpty = count === 0;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {to && (
          <Link
            to={to}
            className="text-xs font-semibold text-brand-700 underline underline-offset-2"
          >
            {strings.dashboard.seeAll}
          </Link>
        )}
      </div>
      {isEmpty ? (
        <p className="text-sm text-slate-500">{empty ?? strings.dashboard.nothingHere}</p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </Card>
  );
}

function Row({ title, meta, badge }: { title: string; meta: string; badge?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{meta}</p>
      </div>
      {badge}
    </li>
  );
}

export function ContentRows({ items }: { items: DashboardContentCard[] }) {
  return (
    <>
      {items.map((item) => (
        <Row
          key={item.id}
          title={item.title}
          meta={[formatDateTime(item.scheduledAt), contentTypeLabel(item.type)].join(' · ')}
          badge={<Badge tone="neutral">{productionStatusLabel(item.productionStatus)}</Badge>}
        />
      ))}
    </>
  );
}

export function FileRows({ items }: { items: DashboardFileCard[] }) {
  return (
    <>
      {items.map((item) => (
        <Row
          key={item.id}
          title={item.originalName}
          meta={formatDateTime(item.uploadedAt)}
          badge={<Badge tone="neutral">{fileStatusLabel(item.status)}</Badge>}
        />
      ))}
    </>
  );
}

export function RequestRows({ items }: { items: DashboardRequestCard[] }) {
  return (
    <>
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0"
        >
          <div className="min-w-0">
            <Link
              to={`/pendencias/${item.id}`}
              className="truncate text-sm font-medium text-slate-900 underline-offset-2 hover:underline"
            >
              {item.title}
            </Link>
            <p className="text-xs text-slate-500">
              {item.dueDate ? formatDate(item.dueDate) : strings.pendingRequests.noDueDate}
            </p>
          </div>
          <Badge tone="warning">{pendingRequestStatusLabel(item.status)}</Badge>
        </li>
      ))}
    </>
  );
}
