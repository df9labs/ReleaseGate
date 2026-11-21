import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth';
import { AuthPage } from './AuthPages';
import { Shell } from './views/Shell';
import { Dashboard } from './views/Dashboard';
import { Bugs } from './views/Bugs';
import { BugRecord } from './views/BugRecord';
import { Report } from './views/Report';
import { Healthcheck } from './views/Healthcheck';
import { Repairs } from './views/Repairs';
import { Versions } from './views/Versions';
import { Settings } from './views/Settings';
import { Landing, Privacy, Terms, VerifyEmail } from './views/Public';
import { Stats } from './views/Stats';
import type { Notice } from './ui';
import './styles.css';

const queries = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#050810]">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#493D38] border-t-[#FF7A3D]" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-[#B5A29A]">
          Loading ReleaseGate
        </p>
      </div>
    </div>
  );
}
function SignedIn() {
  const { user } = useAuth();
  const location = useLocation();
  if (!user && location.pathname === '/') return <Landing />;
  return user ? (
    <Shell />
  ) : (
    <Navigate replace to={'/login?returnTo=' + encodeURIComponent(location.pathname + location.search)} />
  );
}
function Admin({ children }: { children: ReactNode }) {
  return useAuth().user?.role === 'admin' ? children : <Navigate to="/" replace />;
}
/** Self-serve accounts start on the Healthcheck page; the release dashboard is for the operator. */
function Home() {
  return <Dashboard />;
}
function countVisit() {
  try {
    if (sessionStorage.getItem('rg-visit')) return;
    sessionStorage.setItem('rg-visit', '1');
  } catch {
    // Storage can be unavailable; count the visit anyway.
  }
  void fetch('/api/stats/visit', { method: 'POST', credentials: 'omit', keepalive: true }).catch(() => undefined);
}
function Notices() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      setNotice((event as CustomEvent<Notice>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), 5000);
    };
    window.addEventListener('releasegate-notice', show);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('releasegate-notice', show);
    };
  }, []);
  return (
    notice && (
      <aside
        role="status"
        className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-white/10 bg-[#242124] p-4 text-sm shadow-xl"
      >
        <strong>{notice.title}</strong>
        <p>{notice.description}</p>
      </aside>
    )
  );
}
const routeTitles: Record<string, string> = {
  login: 'Login',
  register: 'Register',
  'forgot-password': 'Forgot Password',
  'reset-password': 'Reset Password',
  healthcheck: 'Healthcheck',
  bugs: 'Bugs',
  report: 'Report',
  repairs: 'Repairs',
  versions: 'Versions',
  settings: 'Settings',
  stats: 'Stats',
  privacy: 'Privacy',
  terms: 'Terms',
  'verify-email': 'Confirm email',
};

function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    const section = routeTitles[pathname.split('/')[1]];
    document.title = section ? section + ' | ReleaseGate' : 'ReleaseGate';
  }, [pathname]);
  useEffect(countVisit, []);
  const { user, loading, failure, refresh } = useAuth();
  if (loading) return <Loading />;
  if (failure)
    return (
      <main className="grid min-h-screen place-content-center gap-4 text-center">
        <p>{failure}</p>
        <button className="shipsure-button justify-center" onClick={refresh}>
          Retry
        </button>
      </main>
    );
  return (
    <>
      <Routes>
        {['/login', '/register', '/forgot-password', '/reset-password'].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              user && path !== '/reset-password' ? <Navigate to="/" replace /> : <AuthPage key={path} />
            }
          />
        ))}
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route element={<SignedIn />}>
          <Route index element={<Home />} />
          <Route path="healthcheck" element={<Healthcheck />} />
          <Route path="bugs" element={<Bugs />} />
          <Route path="bugs/:id" element={<BugRecord />} />
          <Route path="report" element={<Report />} />
          <Route path="repairs" element={<Repairs />} />
          <Route path="versions" element={<Versions />} />
          <Route
            element={
              <Admin>
                <Outlet />
              </Admin>
            }
          >
            <Route path="stats" element={<Stats />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route
          path="*"
          element={
            <main className="grid min-h-screen place-content-center gap-4 text-center">
              <h1>Page not found</h1>
              <Link className="shipsure-button" to="/">
                Return to dashboard
              </Link>
            </main>
          }
        />
      </Routes>
      <Notices />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <QueryClientProvider client={queries}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </BrowserRouter>,
);
