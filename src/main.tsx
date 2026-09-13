import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Disable the default browser right-click context menu on blank/non-interactive areas.
// Elements with `data-context-menu` attribute or editable inputs retain their context menu.
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  const isEditable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest('[data-context-menu]') !== null;

  if (!isEditable) {
    e.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
