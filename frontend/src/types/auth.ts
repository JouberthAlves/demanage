export type AuthUser = {
  id: string;
  name: string;
  email: string;
  hasRecoveryCode: boolean;
  salary: number;
  salaryReceiveDay: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
