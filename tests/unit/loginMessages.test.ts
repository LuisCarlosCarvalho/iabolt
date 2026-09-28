import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '../../src/auth/LoginPage';

describe('Login · mensagens de erro', () => {
  it('traduz os erros conhecidos do Supabase Auth', () => {
    expect(authErrorMessage(new Error('Invalid login credentials'))).toBe('Email ou palavra-passe incorretos.');
    expect(authErrorMessage(new Error('Email not confirmed'))).toMatch(/^Confirme o seu email/);
    expect(authErrorMessage(new Error('User already registered'))).toMatch(/^Já existe uma conta/);
    expect(authErrorMessage(new Error('Password should be at least 6 characters.'))).toMatch(/8 caracteres/);
    expect(authErrorMessage(new Error('email rate limit exceeded'))).toMatch(/^Demasiadas tentativas/);
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toMatch(/^Sem ligação ao servidor/);
  });

  it('mantém mensagens desconhecidas (não esconde informação)', () => {
    expect(authErrorMessage(new Error('Erro inesperado 42'))).toBe('Erro inesperado 42');
  });
});
