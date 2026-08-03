import { createBrowserRouter } from 'react-router';

import { AppLayout } from '@/pages/layout/app-layout';
import { DashboardPage } from '@/pages/dashboard-page';
import { ExpensesPage } from '@/pages/expenses-page';
import { IncomePage } from '@/pages/income-page';
import { ProfilePage } from '@/pages/profile-page';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'perfil', element: <ProfilePage /> },
      { path: 'despesas', element: <ExpensesPage /> },
      { path: 'entradas', element: <IncomePage /> },
    ],
  },
]);
