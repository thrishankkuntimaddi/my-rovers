import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/liquid-glass.css';
import './styles/app.css';
import './effects';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

