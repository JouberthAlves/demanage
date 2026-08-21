import {
  BadgeDollarSign,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

export type AppNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { to: '/perfil', label: 'Perfil', icon: UserRound },
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/despesas', label: 'Despesas', icon: Receipt },
  { to: '/cofrinho', label: 'Cofrinho', icon: PiggyBank },
  { to: '/entradas', label: 'Entradas', icon: TrendingUp },
  { to: '/moedas', label: 'Moedas', icon: BadgeDollarSign },
  { to: '/patrimonio', label: 'Patrimônio', icon: Landmark },
];
