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
 * Vídeo de fundo. Começa SEMPRE sem som; o áudio só é ativado pelo utilizador, no botão.
 * Com movimento reduzido não há vídeo nem som: fica a imagem de fundo.
 */
function BackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [audioOn, setAudioOn] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.volume = 0.5;
    v.play().catch(() => undefined);
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    const next = !audioOn;
    v.muted = !next;
    setAudioOn(next);
    if (v.paused) v.play().catch(() => undefined);
  };

  return (
    <>
      <video ref={ref} className="login-video" autoPlay muted loop playsInline preload="auto" poster={POSTER} aria-hidden="true" tabIndex={-1}>
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

/**
 * Entrada com email e palavra-passe (Supabase Auth). Só existe em modo servidor.
 * Acesso restrito à equipa: as contas são criadas pela administração (Supabase → Users),
 * por isso o ecrã não oferece registo, tal como a referência visual.
 */
export function LoginPage({ client }: { client: SupabaseClient }) {
  const reducedMotion = usePrefersReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guarda síncrona: um duplo clique não envia dois pedidos antes de o estado re-renderizar.
  const inFlight = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await client.auth.signInWithPassword({ email, password });
      if (err) throw err;
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="login">
      {reducedMotion && <div className="login-veil" aria-hidden="true" />}
      <div className="login-card">
        <div className="login-head">
          <h1 className="sr-only">Entrar no Bolt IA</h1>
          <img className="login-logo" src={LOGO} alt="Blue Bolt IA studio" width={1233} height={502} draggable={false} />
          <p className="login-sub">Aceda ao seu estúdio</p>
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
                autoComplete="current-password"
                placeholder="••••••••"
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
          <button type="submit" className="login-submit" disabled={busy}>
            {busy && <span className="login-spinner" aria-hidden="true" />}
            {busy ? 'A entrar…' : 'Entrar no estúdio'}
          </button>
        </form>
        <div className="login-foot">
          <p>Acesso restrito à equipa Blue Bolt</p>
        </div>
      </div>
      {/* Depois do cartão no DOM: o foco começa no email; visualmente fica atrás e no canto. */}
      {!reducedMotion && <BackgroundVideo />}
    </main>
  );
}
