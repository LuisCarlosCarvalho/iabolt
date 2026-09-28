import type { SupabaseClient } from '@supabase/supabase-js';
import { Eye, EyeOff, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { errorMessage } from '../app/ui';
import './login.css';

const LOGO = '/assets/brand/logo-bolt-ia.png';
const VIDEO = '/assets/login/blueiavd.mp4';
const POSTER = '/assets/login/poster.jpg';

/** Mensagens do Supabase Auth em português; as desconhecidas aparecem tal como vêm. */
const AUTH_ERRORS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Email ou palavra-passe incorretos.'],
  [/email not confirmed/i, 'Confirme o seu email antes de entrar. Procure a mensagem que enviámos.'],
  [/user already registered/i, 'Já existe uma conta com este email. Entre com a sua palavra-passe.'],
  [/password should be at least|weak password/i, 'A palavra-passe tem de ter pelo menos 8 caracteres.'],
  [/rate limit|too many requests/i, 'Demasiadas tentativas. Aguarde alguns minutos e tente de novo.'],
  [/failed to fetch|network|fetch failed|load failed/i, 'Sem ligação ao servidor. Verifique a internet e tente de novo.'],
  [/signups not allowed|signup is disabled/i, 'A criação de contas está desativada. Peça acesso à equipa.'],
];

export function authErrorMessage(err: unknown): string {
  const raw = errorMessage(err);
  return AUTH_ERRORS.find(([re]) => re.test(raw))?.[1] ?? raw;
}

const REDUCED = '(prefers-reduced-motion: reduce)';
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED).matches,
  );
}

/**
 * Vídeo de fundo. Tenta tocar com som (como a referência); se o browser o impedir, toca
 * sem som e o botão permite ativar o áudio. Com movimento reduzido não há vídeo nem som:
 * fica a imagem de fundo.
 */
function BackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [audioOn, setAudioOn] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = 0.5;
    v.muted = false;
    v.play()
      .then(() => setAudioOn(true))
      .catch(() => {
        v.muted = true;
        setAudioOn(false);
        v.play().catch(() => undefined);
      });
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setAudioOn(!v.muted);
    if (v.paused) v.play().catch(() => undefined);
  };

  return (
    <>
      <video ref={ref} className="login-video" loop playsInline preload="auto" poster={POSTER} aria-hidden="true" tabIndex={-1}>
        <source src={VIDEO} type="video/mp4" />
      </video>
      <div className="login-veil" aria-hidden="true" />
      <button type="button" className="login-audio" aria-pressed={audioOn} onClick={toggle} title={audioOn ? 'Silenciar áudio do vídeo' : 'Ativar áudio do vídeo'}>
        {audioOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
        <span>{audioOn ? 'Áudio ativo' : 'Áudio desligado'}</span>
      </button>
    </>
  );
}

/** Entrada com email e palavra-passe (Supabase Auth). Só existe em modo servidor. */
export function LoginPage({ client }: { client: SupabaseClient }) {
  const reducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Guarda síncrona: um duplo clique não envia dois pedidos antes de o estado re-renderizar.
  const inFlight = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
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
      setError(authErrorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
    setError(null);
    setInfo(null);
  };

  const signIn = mode === 'sign-in';
  return (
    <main className="login">
      {reducedMotion && <div className="login-veil" aria-hidden="true" />}
      <div className="login-card">
        <div className="login-head">
          <h1 className="sr-only">{signIn ? 'Entrar no Bolt IA' : 'Criar conta no Bolt IA'}</h1>
          <img className="login-logo" src={LOGO} alt="Blue Bolt IA studio" width={1233} height={502} draggable={false} />
          <p className="login-sub">{signIn ? 'Aceda ao seu estúdio' : 'Crie a sua conta'}</p>
        </div>
        <form className="login-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-email">
              E-mail profissional
            </label>
            <input
              id="login-email"
              className="login-input"
              type="email"
              autoComplete="email"
              placeholder="nome@empresa.com"
              required
              value={email}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              Palavra-passe
            </label>
            <div className="login-password">
              <input
                id="login-password"
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete={signIn ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                minLength={8}
                required
                value={password}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-eye"
                aria-label={showPassword ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
          </div>
          {error && (
            <p id="login-error" className="login-message login-message-error" role="alert">
              {error}
            </p>
          )}
          {info && (
            <p className="login-message login-message-info" role="status">
              {info}
            </p>
          )}
          <button type="submit" className="login-submit" disabled={busy}>
            {busy && <span className="login-spinner" aria-hidden="true" />}
            {busy ? (signIn ? 'A entrar…' : 'A criar conta…') : signIn ? 'Entrar no estúdio' : 'Criar conta'}
          </button>
        </form>
        <div className="login-foot">
          <p>Acesso restrito à equipa Blue Bolt</p>
          <button type="button" className="login-switch" onClick={switchMode} disabled={busy}>
            {signIn ? 'Ainda não tem conta? Criar conta' : 'Já tem conta? Entrar'}
          </button>
        </div>
      </div>
      {/* Depois do cartão no DOM: o foco começa no email; visualmente fica atrás e no canto. */}
      {!reducedMotion && <BackgroundVideo />}
    </main>
  );
}
