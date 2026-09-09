import type { ReactNode } from "react";

interface CourseFormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

export function CourseFormField({ id, label, error, hint, children }: CourseFormFieldProps) {
  const messageId = `${id}-message`;
  return (
    <div className="form-field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={id}>{label}</label>
      {children}
      <p id={messageId} className={error ? "field-error" : "field-hint"} aria-live="polite">
        {error ?? hint}
      </p>
    </div>
  );
}
