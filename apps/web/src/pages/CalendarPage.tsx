import { useMemo, useState } from 'react';
import { CompanySelect } from '../components/CompanySelect';
import { ContentDialog } from '../components/ContentDialog';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Pagination,
  SelectField,
  Spinner,
} from '../components/ui';
import {
  addDays,
  addMonths,
  endOfDay,
  endOfWeek,
  formatDayHeading,
  formatMonth,
  formatTime,
  formatWeekday,
  isSameDay,
  monthGridDays,
  startOfDay,
  startOfWeek,
} from '../lib/dates';
import { contentTypeLabel, productionStatusLabel, strings } from '../lib/strings';
import { useCurrentUser } from '../modules/auth/session';
import {
  useCalendarRange,
  useContentList,
  useContentSummary,
  useDeleteContent,
  useDuplicateContent,
  type Content,
  type ProductionStatus,
} from '../modules/calendar/api';

type CalendarView = 'month' | 'week' | 'day' | 'list';

const views: { value: CalendarView; label: string }[] = [
  { value: 'month', label: strings.calendar.views.month },
  { value: 'week', label: strings.calendar.views.week },
  { value: 'day', label: strings.calendar.views.day },
  { value: 'list', label: strings.calendar.views.list },
];

const statusOptions: { value: ProductionStatus | 'all'; label: string }[] = [
  { value: 'all', label: strings.common.all },
  ...(
    [
      'planned',
      'awaiting_material',
      'in_production',
      'in_review',
      'approved',
      'completed',
      'cancelled',
    ] as const
  ).map((value) => ({ value, label: productionStatusLabel(value) })),
];

function flagTone(item: Content): 'neutral' | 'success' | 'warning' {
  if (item.productionStatus === 'completed') return 'success';
  if (item.isOverdue || item.isBlockedOnClient) return 'warning';
  return 'neutral';
}

function ContentRow({
  item,
  canManage,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: Content;
  canManage: boolean;
  onEdit: (item: Content) => void;
  onDuplicate: (item: Content) => void;
  onDelete: (item: Content) => void;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{item.title}</p>
          <p className="text-xs text-slate-500">
            {[formatTime(item.scheduledAt), contentTypeLabel(item.type)].join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {item.isOverdue && <Badge tone="warning">{strings.calendar.flags.overdue}</Badge>}
          {item.isBlockedOnClient && <Badge tone="warning">{strings.calendar.flags.blocked}</Badge>}
          <Badge tone={flagTone(item)}>{productionStatusLabel(item.productionStatus)}</Badge>
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onEdit(item)}>
            {strings.common.edit}
          </Button>
          <Button variant="secondary" onClick={() => onDuplicate(item)}>
            {strings.calendar.duplicate}
          </Button>
          <Button variant="danger" onClick={() => onDelete(item)}>
            {strings.calendar.remove}
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function CalendarPage() {
  const { data: currentUser } = useCurrentUser();
  const canManage = currentUser?.role === 'agency_admin' || currentUser?.role === 'agency_manager';

  const [companyId, setCompanyId] = useState('');
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<Content | null>(null);
  const [creatingFor, setCreatingFor] = useState<Date | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [listPage, setListPage] = useState(1);
  const [listStatus, setListStatus] = useState<ProductionStatus | 'all'>('all');

  const range = useMemo(() => {
    if (view === 'month') {
      // The grid shows leading and trailing days of adjacent months, so the query has
      // to cover them or those cells would look empty when they are not.
      const days = monthGridDays(anchor);
      return { from: startOfDay(days[0]!), to: endOfDay(days[days.length - 1]!) };
    }
    if (view === 'week') return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    return { from: startOfDay(anchor), to: endOfDay(anchor) };
  }, [view, anchor]);

  const calendar = useCalendarRange({
    companyId,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    enabled: Boolean(companyId) && view !== 'list',
  });

  const list = useContentList(
    { page: listPage, companyId, productionStatus: listStatus },
    Boolean(companyId) && view === 'list',
  );

  const summary = useContentSummary(companyId, Boolean(companyId));
  const duplicate = useDuplicateContent();
  const remove = useDeleteContent();

  const error = calendar.error ?? list.error ?? duplicate.error ?? remove.error;

  const byDay = useMemo(() => {
    const map = new Map<string, Content[]>();
    for (const item of calendar.data ?? []) {
      const key = startOfDay(new Date(item.scheduledAt)).toDateString();
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [calendar.data]);

  const dayItems = (day: Date) => byDay.get(startOfDay(day).toDateString()) ?? [];

  const handleDuplicate = (item: Content) => {
    const suggestion = addDays(new Date(item.scheduledAt), 7);
    const answer = window.prompt(
      strings.calendar.duplicatePrompt,
      suggestion.toISOString().slice(0, 10),
    );
    if (!answer) return;

    const target = new Date(`${answer}T${new Date(item.scheduledAt).toTimeString().slice(0, 8)}`);
    if (Number.isNaN(target.getTime())) {
      setNotice(strings.calendar.invalidDate);
      return;
    }

    duplicate.mutate(
      { id: item.id, scheduledAt: target.toISOString() },
      { onSuccess: () => setNotice(strings.calendar.duplicated) },
    );
  };

  const handleDelete = (item: Content) => {
    if (!window.confirm(strings.calendar.confirmRemove)) return;
    remove.mutate(item.id, { onSuccess: () => setNotice(strings.calendar.removed) });
  };

  const shift = (direction: -1 | 1) => {
    setSelectedDay(null);
    setAnchor((current) =>
      view === 'month'
        ? addMonths(current, direction)
        : addDays(current, direction * (view === 'week' ? 7 : 1)),
    );
  };

  const periodLabel =
    view === 'month'
      ? formatMonth(anchor)
      : view === 'week'
        ? `${formatDayHeading(startOfWeek(anchor))} – ${formatDayHeading(endOfWeek(anchor))}`
        : formatDayHeading(anchor);

  return (
    <div className="flex flex-col gap-4">
      {(editing || creatingFor) && companyId && (
        <ContentDialog
          companyId={companyId}
          existing={editing ?? undefined}
          defaultDate={creatingFor ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreatingFor(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">{strings.calendar.title}</h1>
        {canManage && companyId && (
          <Button onClick={() => setCreatingFor(selectedDay ?? anchor)}>
            {strings.calendar.newContent}
          </Button>
        )}
      </div>

      <Card>
        <CompanySelect
          value={companyId}
          onChange={(next) => {
            setCompanyId(next);
            setSelectedDay(null);
            setListPage(1);
          }}
        />
      </Card>

      {error && <Alert tone="error">{error.message}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {companyId && (
        <>
          {summary.data && (
            <Card className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {[
                [strings.calendar.summary.planned, summary.data.planned],
                [strings.calendar.summary.awaitingMaterial, summary.data.awaitingMaterial],
                [strings.calendar.summary.inProduction, summary.data.inProduction],
                [strings.calendar.summary.inReview, summary.data.inReview],
                [strings.calendar.summary.completed, summary.data.completed],
                [strings.calendar.summary.overdue, summary.data.overdue],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </Card>
          )}

          <nav
            aria-label={strings.calendar.viewsLabel}
            className="-mx-1 flex gap-1 overflow-x-auto px-1"
          >
            {views.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => {
                  setView(option.value);
                  setSelectedDay(null);
                }}
                className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
                  view === option.value
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </nav>

          {view !== 'list' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => shift(-1)}>
                  {strings.calendar.previous}
                </Button>
                <Button variant="secondary" onClick={() => setAnchor(new Date())}>
                  {strings.calendar.today}
                </Button>
                <Button variant="secondary" onClick={() => shift(1)}>
                  {strings.calendar.next}
                </Button>
              </div>
              <p className="text-sm font-medium text-slate-700 first-letter:uppercase">
                {periodLabel}
              </p>
            </div>
          )}

          {(calendar.isPending && view !== 'list') || (list.isPending && view === 'list') ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner className="h-4 w-4" />
              {strings.app.loading}
            </div>
          ) : null}

          {view === 'month' && calendar.data && (
            <>
              <div className="grid grid-cols-7 gap-1">
                {monthGridDays(anchor)
                  .slice(0, 7)
                  .map((day) => (
                    <div
                      key={`weekday-${day.toDateString()}`}
                      className="py-1 text-center text-xs font-semibold text-slate-500 first-letter:uppercase"
                    >
                      {formatWeekday(day)}
                    </div>
                  ))}

                {monthGridDays(anchor).map((day) => {
                  const dayContent = dayItems(day);
                  const isCurrentMonth = day.getMonth() === anchor.getMonth();
                  const isSelected = selectedDay && isSameDay(day, selectedDay);

                  return (
                    <button
                      key={day.toDateString()}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      aria-pressed={Boolean(isSelected)}
                      aria-label={`${formatDayHeading(day)}, ${strings.calendar.itemCount(dayContent.length)}`}
                      className={`flex min-h-14 flex-col items-center gap-1 rounded-lg border p-1 text-xs transition ${
                        isSelected ? 'border-brand-500 bg-brand-50' : 'border-slate-200'
                      } ${isCurrentMonth ? 'text-slate-900' : 'text-slate-400'}`}
                    >
                      <span
                        className={
                          isSameDay(day, new Date()) ? 'font-bold text-brand-700' : undefined
                        }
                      >
                        {day.getDate()}
                      </span>
                      {dayContent.length > 0 && (
                        <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">
                          {dayContent.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* A month grid cannot show titles on a phone, so the chosen day is
                  listed underneath rather than squeezed into a cell. */}
              {selectedDay && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-base font-semibold text-slate-900 first-letter:uppercase">
                    {formatDayHeading(selectedDay)}
                  </h2>
                  {dayItems(selectedDay).length === 0 ? (
                    <EmptyState
                      title={strings.calendar.emptyDay}
                      action={
                        canManage ? (
                          <Button onClick={() => setCreatingFor(selectedDay)}>
                            {strings.calendar.newContent}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {dayItems(selectedDay).map((item) => (
                        <li key={item.id}>
                          <ContentRow
                            item={item}
                            canManage={canManage}
                            onEdit={setEditing}
                            onDuplicate={handleDuplicate}
                            onDelete={handleDelete}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}

          {(view === 'week' || view === 'day') && calendar.data && (
            <div className="flex flex-col gap-4">
              {(view === 'week'
                ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index))
                : [anchor]
              ).map((day) => (
                <section key={day.toDateString()} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-slate-700 first-letter:uppercase">
                    {formatDayHeading(day)}
                  </h2>
                  {dayItems(day).length === 0 ? (
                    <p className="text-xs text-slate-500">{strings.calendar.emptyDay}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {dayItems(day).map((item) => (
                        <li key={item.id}>
                          <ContentRow
                            item={item}
                            canManage={canManage}
                            onEdit={setEditing}
                            onDuplicate={handleDuplicate}
                            onDelete={handleDelete}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}

          {view === 'list' && (
            <>
              <Card>
                <SelectField
                  label={strings.calendar.productionStatus}
                  value={listStatus}
                  onChange={(event) => {
                    setListStatus(event.target.value as ProductionStatus | 'all');
                    setListPage(1);
                  }}
                  options={statusOptions}
                />
              </Card>

              {list.data && list.data.rows.length === 0 && (
                <EmptyState
                  title={strings.calendar.empty}
                  hint={canManage ? strings.calendar.emptyHint : undefined}
                />
              )}

              {list.data && list.data.rows.length > 0 && (
                <>
                  <ul className="flex flex-col gap-3">
                    {list.data.rows.map((item) => (
                      <li key={item.id}>
                        <ContentRow
                          item={item}
                          canManage={canManage}
                          onEdit={setEditing}
                          onDuplicate={handleDuplicate}
                          onDelete={handleDelete}
                        />
                      </li>
                    ))}
                  </ul>

                  <Pagination
                    page={list.data.meta.page}
                    pageSize={list.data.meta.pageSize}
                    total={list.data.meta.total}
                    onPageChange={setListPage}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
