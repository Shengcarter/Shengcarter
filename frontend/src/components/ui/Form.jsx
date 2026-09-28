import { useId, useState } from 'react';
import { Eye, EyeOff, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

const controlBase =
  'w-full rounded-xl border bg-surface text-fg placeholder:text-muted/70 transition-colors duration-150 ' +
  'focus:border-gold-500 focus:ring-2 focus:ring-gold-500/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';

const controlState = (error) => (error ? 'border-danger/70' : 'border-line hover:border-muted/40');

/**
 * Field wrapper: label, control, hint and error message, wired together with
 * aria attributes so screen readers announce errors.
 */
export function Field({ label, error, hint, required, children, className, id: providedId }) {
  const autoId = useId();
  const id = providedId || autoId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden>*</span> : null}
        </label>
      ) : null}
      {typeof children === 'function' ? children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined }) : children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ label, error, hint, required, className, inputClassName, prefix, suffix, ref, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} id={props.id}>
      {(aria) => (
        <div className="relative flex items-center">
          {prefix ? <span className="pointer-events-none absolute left-3 text-sm text-muted">{prefix}</span> : null}
          <input
            ref={ref}
            {...aria}
            {...props}
            className={cn(controlBase, controlState(error), 'h-10 px-3 text-sm', prefix && 'pl-10', suffix && 'pr-10', inputClassName)}
          />
          {suffix ? <span className="absolute right-3 text-sm text-muted">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

export function PasswordInput({ label, error, hint, required, className, ref, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} id={props.id}>
      {(aria) => (
        <div className="relative">
          <input
            ref={ref}
            {...aria}
            {...props}
            type={visible ? 'text' : 'password'}
            className={cn(controlBase, controlState(error), 'h-11 px-3 pr-11 text-sm')}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted hover:text-fg"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      )}
    </Field>
  );
}

export function Textarea({ label, error, hint, required, className, rows = 3, ref, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} id={props.id}>
      {(aria) => (
        <textarea
          ref={ref}
          rows={rows}
          {...aria}
          {...props}
          className={cn(controlBase, controlState(error), 'min-h-20 px-3 py-2.5 text-sm')}
        />
      )}
    </Field>
  );
}

export function Select({ label, error, hint, required, className, options = [], placeholder, children, ref, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className} id={props.id}>
      {(aria) => (
        <div className="relative">
          <select
            ref={ref}
            {...aria}
            {...props}
            className={cn(controlBase, controlState(error), 'h-10 appearance-none pr-9 pl-3 text-sm')}
          >
            {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      )}
    </Field>
  );
}

export function Checkbox({ label, description, className, ref, ...props }) {
  const id = useId();
  return (
    <label htmlFor={props.id || id} className={cn('flex cursor-pointer items-start gap-3', className)}>
      <input
        ref={ref}
        id={props.id || id}
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line accent-gold-500"
      />
      <span className="text-sm">
        <span className="font-medium text-fg">{label}</span>
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Accessible on/off switch (button with role="switch"). */
export function Switch({ checked, onChange, label, description, disabled, className }) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      {label ? (
        <label htmlFor={id} className="text-sm">
          <span className="font-medium text-fg">{label}</span>
          {description ? <span className="block text-xs text-muted">{description}</span> : null}
        </label>
      ) : null}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
          checked ? 'bg-gold-500' : 'bg-surface-3',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** Apply field errors returned by the API (422) to a react-hook-form form. */
export function applyServerErrors(error, setError) {
  if (!error?.errors?.length) return false;
  error.errors.forEach((e) => {
    if (e.field) setError(e.field, { type: 'server', message: e.message });
  });
  return true;
}
