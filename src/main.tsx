import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Disable native browser/WebView right-click context menu ("Save as", "Refresh", "Inspect", etc.) across the entire desktop app
if (typeof window !== 'undefined') {
  window.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { capture: false }
  );
}

createRoot(document.getElementById('root')!).render(<App />);
