import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { printBrand } from '@/lib/brand';
import { startAuthSessionSync } from '@/stores/auth-store';
import { startCalendarClock } from '@/stores/calendar-store';

import '@/global.css';

printBrand();
startCalendarClock();
startAuthSessionSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
