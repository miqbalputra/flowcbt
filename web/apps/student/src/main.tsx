import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiProvider } from '@flowcbt/api-client';
import { ThemeProvider, ToastProvider } from '@flowcbt/ui';
import '@flowcbt/ui/src/theme.css';
import '@flowcbt/ui/src/styles.css';
import App from './app';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ApiProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ApiProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
