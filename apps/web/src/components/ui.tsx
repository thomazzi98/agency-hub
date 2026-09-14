import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { strings } from '../lib/strings';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary:
    'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Renders the busy label and blocks re-submission, per the duplicate-submit rule. */
  isLoading?: boolean;
  loadingLabel?: string;
}

export function Button({
  variant = 'primary',
  isLoading = false,
  loadingLabel,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${buttonVariants[variant]} ${className}`}
    >
      {isLoading && <Spinner className="h-4 w-4" />}
      {isLoading ? (loadingLabel ?? strings.app.loading) : children}
    </button>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        {...props}
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        // Errors are tied to the field programmatically, never signalled by colour alone.
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`min-h-11 rounded-lg border px-3 py-2.5 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
            : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100'
        } ${className}`}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
});

export type AlertTone = 'error' | 'success' | 'info';

const alertTones: Record<AlertTone, string> = {
  error: 'bg-red-50 text-red-800 ring-red-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  info: 'bg-brand-50 text-brand-700 ring-brand-100',
};

export function Alert({
  tone = 'info',
  children,
  onRetry,
}: {
  tone?: AlertTone;
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-col gap-2 rounded-lg px-3.5 py-3 text-sm ring-1 ${alertTones[tone]}`}
    >
      <span>{children}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start text-sm font-semibold underline underline-offset-2"
        >
          {strings.app.retry}
        </button>
      )}
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function LoadingScreen({ label = strings.app.loading }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-screen flex-col items-center justify-center gap-3 text-slate-500"
    >
      <Spinner className="h-7 w-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>
      {children}
    </section>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function SelectField({ label, error, options, className = '', ...props }: SelectFieldProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${className}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
}

export function TextAreaField({ label, error, className = '', ...props }: TextAreaFieldProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        {...props}
        id={id}
        rows={props.rows ?? 4}
        className={`rounded-lg border border-slate-300 px-3 py-2.5 text-base text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${className}`}
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  return (
    <div className="flex items-start gap-2.5">
      <input
        {...props}
        id={id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
      />
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </label>
    </div>
  );
}

/** An empty state says what the emptiness means and what creates the first row. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Paginação">
      <p className="text-xs text-slate-500">{strings.common.resultCount(total)}</p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {strings.common.previous}
        </Button>
        <span className="text-xs text-slate-600">{strings.common.pageOf(page, pages)}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          {strings.common.next}
        </Button>
      </div>
    </nav>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warning';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  } as const;

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
        {children}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {strings.common.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
