import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleUserRound, KeyRound, Lock, LogIn, Mail, UserPlus } from 'lucide-react';
import { api } from './api';
import { useAuth } from './auth';

const pages = {
  '/login': ['Welcome back', 'Log in to your account', 'Log in'],
  '/register': ['Create your free account', '5 website checks a day. No card needed.', 'Create account'],
  '/forgot-password': ['Reset password', "We'll send you a link to reset it", 'Send reset link'],
  '/reset-password': ['Set a new password', 'Enter a new password for your account', 'Reset password'],
} as const;

const inputClass =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm pl-10 h-12';
const buttonClass =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 px-4 py-2 w-full h-12';
const textLink = 'text-primary font-medium hover:underline';

function Field({
  id,
  label,
  autoComplete,
  link,
}: {
  id: 'email' | 'password' | 'confirm';
  label: string;
  autoComplete: string;
  link?: ReactNode;
}) {
  const isEmail = id === 'email';
  const Icon = isEmail ? Mail : Lock;
  const fieldLabel = (
    <label className="text-sm font-medium leading-none" htmlFor={id}>
      {label}
    </label>
  );
  return (
    <div className="space-y-2">
      {link ? (
        <div className="flex items-center justify-between">
          {fieldLabel}
          {link}
        </div>
      ) : (
        fieldLabel
      )}
      <div className="relative">
        <Icon
          aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
        />
        <input
          id={id}
          name={id}
          autoFocus={isEmail}
          type={isEmail ? 'email' : 'password'}
          autoComplete={autoComplete}
          className={inputClass}
          placeholder={isEmail ? 'you@example.com' : '••••••••'}
          required
        />
      </div>
    </div>
  );
}

export function AuthPage() {
  const location = useLocation();
  const pathname = location.pathname as keyof typeof pages;
  const [title, subtitle, action] = pages[pathname] ?? pages['/login'];
  const { accept } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const signingIn = pathname === '/login';
  const registering = pathname === '/register';
  const recovery = pathname === '/forgot-password';
  const Icon = signingIn ? LogIn : registering ? UserPlus : recovery ? Mail : KeyRound;
  const parameters = new URLSearchParams(location.search);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('email') || '').trim();
    const password = String(fields.get('password') || '');
    setError('');
    setMessage('');
    if ((registering || pathname === '/reset-password') && fields.get('confirm') !== password) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      if (signingIn || registering) {
        const result = signingIn
          ? await api.login(email, password)
          : await api.register(email.split('@')[0], email, password);
        accept(result.user);
        const to = parameters.get('returnTo');
        navigate(to?.startsWith('/') && !to.startsWith('//') && !to.includes('\\') ? to : '/', {
          replace: true,
        });
      } else {
        const result = recovery
          ? await api.forgotPassword(email)
          : await api.resetPassword(parameters.get('token') || '', password);
        setMessage(result.message);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 inline-block text-xs text-muted-foreground hover:text-foreground">← ReleaseGate home</Link>
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-4">
            <Icon aria-hidden="true" className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="text-muted-foreground mt-2">{subtitle}</p>
        </div>
        <div className="bg-card rounded-2xl shadow-sm border border-border p-8">
          <form className="space-y-4" onSubmit={submit}>
            {pathname !== '/reset-password' && (
              <Field id="email" label={recovery ? 'Email address' : 'Email'} autoComplete="email" />
            )}
            {!recovery && (
              <Field
                id="password"
                label="Password"
                autoComplete={signingIn ? 'current-password' : 'new-password'}
                link={
                  signingIn && (
                    <Link to="/forgot-password" className="text-xs text-primary hover:underline">
                      Forgot password?
                    </Link>
                  )
                }
              />
            )}
            {(registering || pathname === '/reset-password') && (
              <Field id="confirm" label="Confirm Password" autoComplete="new-password" />
            )}
            {error && (
              <p role="alert" className="text-sm text-[#FF8C9A]">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="text-sm text-[#78CAA9]">
                {message}
              </p>
            )}
            <button
              className={buttonClass + ' bg-primary text-primary-foreground shadow hover:bg-primary/90'}
              type="submit"
              disabled={pending}
            >
              {pending ? 'Please wait…' : action}
            </button>
            {registering && (
              <p className="text-xs leading-5 text-muted-foreground">
                By creating an account you agree to the{' '}
                <Link className={textLink} to="/terms">Terms</Link> and how we handle your data in our{' '}
                <Link className={textLink} to="/privacy">Privacy notice</Link>. We may email you a link to confirm your address.
              </p>
            )}
          </form>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">
          {signingIn ? (
            <>
              Don't have an account?{' '}
              <Link className={textLink} to="/register">
                Create one
              </Link>
            </>
          ) : registering ? (
            <>
              Already have an account?{' '}
              <Link className={textLink} to="/login">
                Log in
              </Link>
            </>
          ) : (
            <Link className={textLink} to="/login">
              <ArrowLeft className="w-3 h-3 inline mr-1" />
              Back to log in
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
