import { createRoot } from 'react-dom/client';
import { PocApp } from './poc/PocApp';
import './poc/poc.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root em falta');
// Sem StrictMode na prova: o duplo efeito em dev criaria dois projetos no arranque.
createRoot(root).render(<PocApp />);
