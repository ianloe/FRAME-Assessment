import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Cpu,
  ClipboardCheck,
  CheckSquare,
  ShieldAlert,
  Settings,
  LogOut,
  Sun,
  Moon,
  Bell,
  UserCheck,
  BookOpen,
  Menu,
  X
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { session, logout, theme, toggleTheme } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: notifData, refetch: refetchNotifs } = useQuery<{ notifications: NotificationItem[] }>({
    queryKey: ['notifications'],
    queryFn: () => apiFetch('/api/notifications'),
    enabled: Boolean(session?.mfaVerified)
  });

  const unreadCount = (notifData?.notifications ?? []).filter((n) => !n.readAt).length;

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { to: '/systems', label: 'AI Systems', icon: Cpu, show: true },
    { to: '/assessments', label: 'Assessments', icon: ClipboardCheck, show: true },
    { to: '/actions', label: 'Actions', icon: CheckSquare, show: true },
    {
      to: '/auditor',
      label: 'Auditor Workspace',
      icon: ShieldAlert,
      show: session?.user.role === 'auditor' || session?.user.role === 'admin'
    },
    {
      to: '/admin',
      label: 'Administration',
      icon: Settings,
      show: session?.user.role === 'admin'
    },
    { to: '/security', label: 'My Security', icon: UserCheck, show: true },
    { to: '/manual', label: 'User Manual', icon: BookOpen, show: true }
  ].filter((item) => item.show);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-[#f8fafc] text-slate-900 dark:bg-[#0b1120] dark:text-slate-100">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 transform border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-[#111827] lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
          <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <img
              src="/frame-logo.png"
              alt="FRAME logo"
              className="h-8 w-8 rounded-lg object-contain"
            />
            <div className="leading-tight">
              <span className="block text-sm font-bold tracking-wide text-[#1e3a5f] dark:text-white">
                FRAME
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                AI Governance
              </span>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded p-1 lg:hidden"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-[#1e3a5f] text-white shadow-xs dark:bg-blue-600'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-300">{session?.user.name}</p>
          <p className="mt-0.5 capitalize">
            {session?.user.role}
            {session?.user.isReviewer && session.user.role === 'user' ? ' (Reviewer)' : ''}
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-[#111827]/95 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden text-xs font-medium text-slate-500 sm:block dark:text-slate-400">
            FRAME Governance Envelope &amp; Enterprise AI Assessment
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden items-center gap-2 text-xs sm:flex">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {session?.user.name}
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {session?.user.role}
              </span>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">Notifications</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Close
                    </button>
                  </div>
                  {(notifData?.notifications ?? []).length === 0 ? (
                    <p className="py-3 text-xs text-slate-500">No notifications.</p>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto">
                      {(notifData?.notifications ?? []).map((n) => (
                        <li
                          key={n.id}
                          className={`rounded-lg border p-2 text-xs ${
                            n.readAt
                              ? 'border-slate-100 dark:border-slate-800'
                              : 'border-teal-200 bg-teal-50/50 dark:border-teal-900 dark:bg-teal-950/30'
                          }`}
                        >
                          <p className="font-semibold">{n.title}</p>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400">{n.body}</p>
                          {!n.readAt && (
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
                                await refetchNotifs();
                              }}
                              className="mt-1 text-teal-700 underline dark:text-teal-400"
                            >
                              Mark read
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>

        <footer className="border-t border-slate-200 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          FRAME ("A governance framework for enterprise AI deployment") by Ian Loe, Tactics Solutions,
          licensed under CC BY-NC 4.0.
        </footer>
      </div>
    </div>
  );
}
