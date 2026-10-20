'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

interface Persona { email: string; name: string; role: 'admin' | 'user'; ref: string | null }
interface Choices { current: Persona; identities: { label: string; persona: Persona | null }[] }

export const DEV_AS_COOKIE = 'planning_dev_as';

/** The cookie value the server's parsePersona() reads: base64url JSON. */
export function personaCookie(persona: Persona | null): string {
  if (!persona) return `${DEV_AS_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  const json = new TextEncoder().encode(JSON.stringify(persona));
  const value = btoa(String.fromCharCode(...json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${DEV_AS_COOKIE}=${value}; Path=/; SameSite=Lax`;
}

const same = (a: Persona | null, b: Persona) => !!a && a.email === b.email && a.role === b.role && a.ref === b.ref;

/**
 * Backlog item 32: switch between manager and employee views without editing .env.local. Shown only when /api/me
 * says the development sign-in is active; the server ignores the cookie everywhere else.
 */
export function DevIdentityPicker() {
  const [choices, setChoices] = useState<Choices | null>(null);
  useEffect(() => {
    api<Choices>('GET', '/internal/dev/identities').then(setChoices, () => setChoices(null));
  }, []);
  if (!choices) return null;
  const selected = Math.max(0, choices.identities.findIndex((c) => same(c.persona, choices.current)));
  return (
    <label className="dev-picker" title="Local development only">
      <span className="visually-hidden">Act as</span>
      <select value={selected} onChange={(e) => {
        document.cookie = personaCookie(choices.identities[Number(e.target.value)]!.persona);
        window.location.reload();
      }}>
        {choices.identities.map((c, i) => <option key={c.label} value={i}>Dev: {c.label}</option>)}
      </select>
    </label>
  );
}
