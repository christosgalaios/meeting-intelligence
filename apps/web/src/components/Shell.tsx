import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { cx } from '../lib/cx';
import { Banner } from './Banner';
import { IconLibrary, IconSearch, IconTheme } from './icons';
import { ModeBadge } from './ModeBadge';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

const navItem = ({ isActive }: { isActive: boolean }) =>
  cx(
    'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] text-fg no-underline hover:bg-surface-3 hover:text-fg',
    isActive ? 'bg-surface-3' : 'bg-transparent',
  );

/** Sidebar, banner and the routed page. Below 1100 px the sidebar collapses to icons. */
export function Shell() {
  const { health, unreachable, meetings } = useApp();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const { pathname } = useLocation();

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('mi-theme', next);
    } catch {
      // private mode: the choice just does not persist
    }
    setTheme(next);
  };

  const label = 'max-[1099px]:sr-only';

  return (
    <div className="flex h-full min-h-[640px] overflow-hidden bg-bg text-fg">
      <nav aria-label="Primary" className="flex w-[60px] shrink-0 flex-col gap-0.5 border-r border-line bg-bg px-2.5 py-3.5 min-[1100px]:w-[232px]">
        <div className="flex items-center gap-[9px] px-2 pb-4 pt-1">
          <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-fg">
            <span className="size-2 rounded-[2px] bg-bg" />
          </span>
          <span className={cx('whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.01em]', label)}>Meeting Intelligence</span>
        </div>
        <NavLink to="/" end className={navItem}>
          <IconLibrary />
          <span className={cx('flex-1', label)}>Library</span>
          <span className={cx('font-mono text-[11.5px] text-fg-3', label)}>{meetings.length}</span>
        </NavLink>
        <NavLink to="/ask" className={navItem}>
          <IconSearch />
          <span className={label}>Ask</span>
        </NavLink>
        <div className={cx('px-2 pb-1.5 pt-5 text-[11.5px] font-medium text-fg-3', 'max-[1099px]:hidden')}>Meetings</div>
        <div className="flex min-h-0 flex-col gap-px overflow-y-auto max-[1099px]:hidden">
          {meetings.map((m) => (
            <NavLink
              key={m.id}
              to={`/meetings/${m.slug}`}
              className={({ isActive }) =>
                cx(
                  'block h-[30px] shrink-0 truncate rounded-md px-2 text-[13px] leading-[30px] text-fg-2 no-underline hover:bg-surface-3 hover:text-fg',
                  isActive ? 'bg-surface-3' : 'bg-transparent',
                )
              }
            >
              {m.title}
            </NavLink>
          ))}
        </div>
        <div className="flex-1" />
        <ModeBadge health={health} unreachable={unreachable} />
        <button
          type="button"
          onClick={flip}
          aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          className="flex h-8 items-center gap-2.5 rounded-md border-0 bg-transparent px-2 text-left text-[12.5px] text-fg-2 hover:bg-surface-3"
        >
          <IconTheme />
          <span className={label}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
        </button>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <Banner health={health} unreachable={unreachable} showModeNote={!pathname.startsWith('/meetings/')} />
        <Outlet />
      </main>
    </div>
  );
}
