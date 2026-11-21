import { Notifications } from '../Notifications';
import { organisationName } from '../organisation';
import React from 'react';

import {
  ActivityIcon,
  BugIcon,
  ChartColumnIcon,
  ChevronLeftIcon,
  CircleHelpIcon,
  LogOutIcon,
  MenuIcon,
  PlusIcon,
  RadarIcon,
  SearchIcon,
  SettingsIcon,
  TagsIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';

import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { cx } from '../ui';

import { motion, useReducedMotion } from 'framer-motion';

import { useAuth } from '../auth';

const navigation = [
  {
    to: '/',
    label: 'Dashboard',
    icon: ChartColumnIcon,
    exact: true,
  },
  {
    to: '/healthcheck',
    label: 'Healthcheck',
    icon: RadarIcon,
  },
  {
    to: '/bugs',
    label: 'Bugs',
    icon: BugIcon,
  },
  {
    to: '/repairs',
    label: 'Repairs',
    icon: WrenchIcon,
  },
  {
    to: '/versions',
    label: 'Versions',
    icon: TagsIcon,
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: SettingsIcon,
    adminOnly: true,
  },
  {
    to: '/stats',
    label: 'Stats',
    icon: ChartColumnIcon,
    adminOnly: true,
  },
];

function BrandMark({ compact = false }) {
  const reduceMotion = useReducedMotion();
  return (
    <span
      className={cx(
        'relative flex shrink-0 items-center justify-center',
        compact ? 'h-9 w-9' : 'h-11 w-11',
      )}
      aria-hidden="true"
    >
      <motion.span
        className="absolute inset-0 rounded-2xl border border-[#FF7A3D]/50 bg-[#FF7A3D]/[0.08] shadow-[0_0_32px_rgba(255,122,61,0.18)]"
        animate={
          reduceMotion
            ? undefined
            : {
                rotate: 360,
              }
        }
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: 'linear',
        }}
      >
        <span className="absolute left-1/2 top-[-2px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#FFB05B] shadow-[0_0_12px_#FF7A3D]" />
      </motion.span>
      <span className="absolute inset-[7px] rounded-xl border border-[#59433A] bg-gradient-to-br from-[#332622] to-[#1B191B]" />
      <ActivityIcon className={cx('relative z-10 text-[#FF8A4C]', compact ? 'h-4 w-4' : 'h-5 w-5')} />
    </span>
  );
}

function Navigation({
  collapsed,
  setCollapsed,
  closeMobile = () => {},
}: {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  closeMobile?: () => void;
}) {
  const { logout, user } = useAuth();
  const links = navigation.filter((item) => !item.adminOnly || user?.role === 'admin');
  return (
    <>
      <div
        className={cx(
          'flex h-[78px] items-center border-b border-white/[0.06] px-4',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        <NavLink to="/" onClick={closeMobile} className="flex min-w-0 items-center gap-3">
          <BrandMark compact={collapsed} />
          {!collapsed && (
            <span className="min-w-0">
              <strong className="block text-[17px] font-extrabold tracking-[-0.04em] text-white">
                ReleaseGate
              </strong>
              <span className="mt-0.5 block truncate text-[8px] font-extrabold uppercase tracking-[0.22em] text-[#B6907D]">
                Release control network
              </span>
            </span>
          )}
        </NavLink>
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="hidden rounded-xl border border-transparent p-2 text-[#698199] transition hover:border-white/[0.07] hover:bg-white/[0.04] hover:text-white lg:block"
            aria-label="Collapse navigation"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className={cx('px-3 pt-5', collapsed && 'px-2')}>
        {!collapsed && (
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="text-[8px] font-extrabold uppercase tracking-[0.22em] text-[#5F778E]">
              Control surface
            </span>
            <span className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-[#6EAF95]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#52F2B8] shadow-[0_0_8px_#52F2B8]" />
              Live
            </span>
          </div>
        )}
      </div>
      <nav
        className={cx('flex-1 space-y-1.5 px-3', collapsed && 'px-2')}
        aria-label="Primary navigation"
      >
        {links.map(({ to, label, icon: ItemIcon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={closeMobile}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cx(
                'group relative flex h-11 items-center gap-3 overflow-hidden rounded-xl border px-3 text-[13px] font-bold transition duration-200',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'border-[#FF7A3D]/25 bg-gradient-to-r from-[#FF7A3D]/[0.16] to-[#FF7A3D]/[0.035] text-[#FFD5C0] shadow-[0_12px_34px_rgba(0,0,0,0.18)]'
                  : 'border-transparent text-[#9E8F87] hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-[#FFF7F2]',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#FF7A3D] shadow-[0_0_12px_#FF7A3D]" />
                )}
                <ItemIcon
                  className={cx(
                    'h-4 w-4 shrink-0 transition-transform group-hover:scale-105',
                    isActive && 'drop-shadow-[0_0_8px_rgba(255,122,61,0.42)]',
                  )}
                />
                {!collapsed && <span>{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className={cx('border-t border-white/[0.06] p-3', collapsed && 'px-2')}>
        {!collapsed && (
          <div className="mb-3 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#FF7A3D]/25 bg-[#FF7A3D]/[0.09] text-[10px] font-extrabold uppercase text-[#FF9B5C]">
                {user?.full_name === organisationName ? 'DF9' : (user?.full_name || user?.email || 'S').slice(0, 2)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-[#FFF7F2]">
                  {user?.full_name || user?.email || 'ReleaseGate admin'}
                </p>
                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-[#6F8499]">
                  {user?.role || 'user'}
                  {' channel'}
                </p>
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => logout(true)}
          title={collapsed ? 'Log out' : undefined}
          className={cx(
            'flex h-10 w-full items-center gap-3 rounded-xl border border-transparent px-3 text-xs font-bold text-[#75899C] transition hover:border-[#FF6577]/15 hover:bg-[#FF6577]/[0.07] hover:text-[#FF8C9A]',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOutIcon className="h-4 w-4" />
          {!collapsed && <span>Disconnect</span>}
        </button>
      </div>
    </>
  );
}

export function Shell() {
  const { user } = useAuth();
  const operator = user?.role === 'admin';
  const [collapsed, setCollapsed] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const pageTitle = location.pathname.startsWith('/bugs/')
    ? 'Bug record'
    : navigation.find((item) => item.to !== '/' && location.pathname.startsWith(item.to))?.label ||
      (location.pathname === '/report' ? 'Report a bug' : 'Release dashboard');
  React.useEffect(() => {
    if (!drawerOpen) return;
    const overflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [drawerOpen]);
  const search = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = query.trim();
    navigate(term ? `/bugs?q=${encodeURIComponent(term)}` : '/bugs');
    setDrawerOpen(false);
  };
  return (
    <div className="shipsure-space relative min-h-screen overflow-x-hidden bg-[#17171A] text-[#FFF7F2]">
      <div className="shipsure-aurora pointer-events-none fixed inset-0" aria-hidden="true" />
      <div
        className="shipsure-page-grid pointer-events-none fixed inset-0 opacity-30"
        aria-hidden="true"
      />
      <aside
        className={cx(
          'fixed inset-y-3 left-3 z-40 hidden flex-col overflow-hidden rounded-2xl border border-white/[0.075] bg-[#1D1C20]/94 shadow-[0_28px_100px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition-[width] duration-300 lg:flex',
          collapsed ? 'w-[70px]' : 'w-[238px]',
        )}
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#FF7A3D]/80 to-transparent" />
        <Navigation collapsed={collapsed} setCollapsed={setCollapsed} />
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="absolute -right-3 top-24 rounded-full border border-[#FF7A3D]/30 bg-[#242124] p-1.5 text-[#FF8A4C] shadow-xl"
            aria-label="Expand navigation"
          >
            <MenuIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[#02060C]/75 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="ReleaseGate navigation"
            initial={
              reduceMotion
                ? false
                : {
                    x: -300,
                  }
            }
            animate={{
              x: 0,
            }}
            exit={
              reduceMotion
                ? undefined
                : {
                    x: -300,
                  }
            }
            className="relative m-3 flex h-[calc(100%-1.5rem)] w-[min(290px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1D1C20]/96 shadow-2xl backdrop-blur-2xl"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-xl border border-white/[0.06] bg-white/[0.035] p-2 text-[#8FA2B4] hover:text-white"
              aria-label="Close navigation"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <Navigation
              collapsed={false}
              setCollapsed={() => {}}
              closeMobile={() => setDrawerOpen(false)}
            />
          </motion.aside>
        </div>
      )}
      <div
        className={cx(
          'relative min-h-screen transition-[padding] duration-300',
          collapsed ? 'lg:pl-[86px]' : 'lg:pl-[254px]',
        )}
      >
        <header className="sticky top-3 z-30 mx-3 flex h-[66px] items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#1D1C20]/88 px-3 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:px-4 md:gap-4 md:px-5">
          <div className="pointer-events-none absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-[#F5FAFF] lg:hidden"
            aria-label="Open navigation"
          >
            <MenuIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[8px] font-extrabold uppercase tracking-[0.2em] text-[#FF8A4C]">
              ReleaseGate · Control network
            </p>
            <h1 className="mt-0.5 truncate text-[15px] font-extrabold tracking-[-0.03em] text-white">
              {pageTitle}
            </h1>
          </div>
          <div className="ml-auto hidden items-center gap-2 xl:flex">
            <span className="flex items-center gap-2 rounded-full border border-[#52F2B8]/15 bg-[#52F2B8]/[0.045] px-3 py-1.5 text-[8px] font-extrabold uppercase tracking-[0.16em] text-[#78CAA9]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#52F2B8] shadow-[0_0_8px_#52F2B8]" />
              Release network online
            </span>
          </div>
          {<form onSubmit={search} className="hidden w-full max-w-[360px] md:block xl:ml-2">
            <label className="relative block">
              <span className="sr-only">Search bugs</span>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6F8499]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search signals, refs or versions…"
                className="h-9 w-full rounded-xl border border-white/[0.07] bg-[#18171A]/70 pl-9 pr-3 text-xs text-[#FFF7F2] outline-none transition placeholder:text-[#776D68] focus:border-[#FF7A3D]/55 focus:bg-[#222024] focus:ring-2 focus:ring-[#FF7A3D]/10"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/[0.07] px-1.5 py-0.5 font-mono text-[8px] text-[#5E748A] 2xl:block">
                ↵
              </span>
            </label>
          </form>}
          <div className="hidden items-center gap-1 sm:flex">
            <Notifications />
            <a
              href="mailto:hello@datumfoundrynine.co.uk?subject=ReleaseGate%20help"
              className="rounded-xl border border-transparent p-2 text-[#71869A] transition hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-white"
              aria-label="Help: email us"
              title="Help: email us"
            >
              <CircleHelpIcon className="h-4 w-4" />
            </a>
          </div>
          {(
            <NavLink to="/report" className="shipsure-button h-9 shrink-0 px-3">
              <PlusIcon className="h-4 w-4" />
              <span className="hidden sm:inline">New signal</span>
            </NavLink>
          )}
        </header>
        <main className="relative mx-auto w-full max-w-[1720px] p-3 pt-6 sm:p-4 sm:pt-7 md:p-6 md:pt-8 lg:p-7 lg:pt-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
