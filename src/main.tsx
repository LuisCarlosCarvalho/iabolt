import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import './app/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root em falta');
// Sem StrictMode: o duplo efeito em dev montaria dois editores GrapesJS no mesmo contentor.
createRoot(root).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
