import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ColorModeProvider } from './theme/ColorMode';
import { NotifierProvider } from './components/Notifier';
import './styles/motion.css';
import { APP_NAME, APP_SUBTITLE } from './brand';

document.title = `${APP_NAME} · ${APP_SUBTITLE}`;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ColorModeProvider>
      <NotifierProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </NotifierProvider>
    </ColorModeProvider>
  </React.StrictMode>,
);
