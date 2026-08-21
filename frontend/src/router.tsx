import { createBrowserRouter } from 'react-router';

import { CurrenciesPage } from '@/pages/currencies-page';
import { DashboardPage } from '@/pages/dashboard-page';
import { ExpensesPage } from '@/pages/expenses-page';
import { IncomePage } from '@/pages/income-page';
import { AppLayout } from '@/pages/layout/app-layout';
import { AuthGuard } from '@/pages/layout/auth-guard';
import { LoginPage } from '@/pages/login-page';
import { PatrimonyPage } from '@/pages/patrimony-page';
import { PiggyPage } from '@/pages/piggy-page';
import { ProfilePage } from '@/pages/profile-page';
import { RecoverPasswordPage } from '@/pages/recover-password-page';
import { RegisterPage } from '@/pages/register-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/recuperar-senha', element: <RecoverPasswordPage /> },
  {
    element: <AuthGuard />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'perfil', element: <ProfilePage /> },
          { path: 'despesas', element: <ExpensesPage /> },
          { path: 'cofrinho', element: <PiggyPage /> },
          { path: 'entradas', element: <IncomePage /> },
          { path: 'moedas', element: <CurrenciesPage /> },
          { path: 'patrimonio', element: <PatrimonyPage /> },
        ],
      },
    ],
  },
]);
