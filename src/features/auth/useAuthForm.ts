import { useCallback, useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export type AuthFormErrors = {
  email?: string;
  password?: string;
  form?: string;
};

/**
 * Validation and submit plumbing shared by sign-in and sign-up. Errors are
 * surfaced per field so the user is never left guessing which one failed.
 */
export function useAuthForm(submit: (email: string, password: string) => Promise<void>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthFormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = useCallback(async () => {
    const next: AuthFormErrors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `At least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await submit(email, password);
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [email, password, submit]);

  return {
    email,
    setEmail: (v: string) => {
      setEmail(v);
      setErrors((prev) => ({ ...prev, email: undefined, form: undefined }));
    },
    password,
    setPassword: (v: string) => {
      setPassword(v);
      setErrors((prev) => ({ ...prev, password: undefined, form: undefined }));
    },
    errors,
    submitting,
    onSubmit,
  };
}
