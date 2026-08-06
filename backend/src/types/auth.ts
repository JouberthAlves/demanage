export type PublicUser = {
  id: string;
  name: string;
  email: string;
  salary: number;
  salaryReceiveDay: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};
