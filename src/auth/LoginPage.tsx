import type { SupabaseClient } from '@supabase/supabase-js';
import { useState, type FormEvent } from 'react';
import { BrandMark } from '../app/AppShell';
import { Button, errorMessage } from '../app/ui';

/** Entrada com email e palavra-passe (Supabase Auth). Só existe em modo servidor. */
export function LoginPage({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'sign-in') {
        const { error: err } = await client.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { data, error: err } = await client.auth.signUp({ email, password });
        if (err) throw err;
        if (!data.session) setInfo('Conta criada. Confirme o endereço no email que enviámos e depois entre.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <div className="brand">
          <BrandMark />
          Bolt IA
        </div>
        <div>
          <h1 style={{ fontSize: 20 }}>{mode === 'sign-in' ? 'Entrar' : 'Criar conta'}</h1>
          <p className="hint">Os projetos ficam guardados na base de dados da equipa.</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Palavra-passe</span>
          <input
            className="input"
            type="password"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        {info && <p className="hint" role="status">{info}</p>}
        <Button type="submit" variant="primary" className="btn-lg" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'sign-in' ? 'Entrar' : 'Criar conta'}
        </Button>
        <Button variant="ghost" onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          {mode === 'sign-in' ? 'Ainda não tem conta? Criar conta' : 'Já tem conta? Entrar'}
        </Button>
      </form>
    </main>
  );
}
