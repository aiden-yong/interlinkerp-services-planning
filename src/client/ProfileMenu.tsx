'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useFeedback } from './feedback';
import { ChevronDownIcon } from './icons';
import { ThemeSwitch } from './ThemeSwitch';
import type { Me } from './types';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/**
 * Who you are and the appearance setting, as in HR Recruitment. On the public demo it also holds the view switch, Reset
 * demo data and Sign out, whose forms the demo gate handles (src/server/demo/demoGate.ts). Elsewhere there is no sign-out
 * here: the InterlinkERP gateway is the only place to sign out.
 */
export function ProfileMenu({ me }: { me: Me }) {
  const { confirm } = useFeedback();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const resetForm = useRef<HTMLFormElement>(null);
  const panelId = useId();
  const name = me.name ?? me.email ?? '';
  const role = me.is_manager ? 'Planning Manager' : 'Employee';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A reset replaces the data every visitor shares, so ask first.
  async function askToReset() {
    setOpen(false);
    const ok = await confirm('Reset demo data?', ['All shifts, people and settings go back to the original sample data, for everyone using the demo.'], 'Reset demo data');
    if (ok) resetForm.current?.requestSubmit();
  }

  return (
    <div className="profile" ref={box}>
      <button type="button" className="user-profile-badge" title={me.email ? `${name} (${me.email}) - ${role}` : `${name} - ${role}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <span className="user-profile-avatar" aria-hidden="true">
          {initials(name)}
          <span className="user-status-indicator" />
        </span>
        <span className="user-profile-info">
          <span className="user-profile-name">{name}</span>
          <span className="user-profile-role">{role}</span>
        </span>
        <span className="user-profile-chevron"><ChevronDownIcon /></span>
      </button>
      {me.demo && <form ref={resetForm} method="post" hidden><input type="hidden" name="demo_action" value="reset" /></form>}
      <div id={panelId} className="profile-panel" hidden={!open}>
        <p className="profile-name">{name}</p>
        {me.email && <p className="muted">{me.email}</p>}
        <div className="profile-row">
          <span className="muted">Appearance</span>
          <ThemeSwitch />
        </div>
        {me.demo && (
          <>
            <form method="post" className="view-switch" role="group" aria-label="View the demo as">
              <input type="hidden" name="demo_action" value="view_as" />
              <button type="submit" name="demo_view" value="manager" aria-pressed={me.is_manager}>Manager</button>
              <button type="submit" name="demo_view" value="employee" aria-pressed={!me.is_manager}>Employee</button>
            </form>
            <p className="profile-note">Public demo with sample data. Other visitors see your changes, and no emails are sent.</p>
            <div className="profile-actions">
              <button type="button" onClick={() => void askToReset()}>Reset demo data</button>
              <form method="post">
                <input type="hidden" name="demo_action" value="sign_out" />
                <button type="submit">Sign out</button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
