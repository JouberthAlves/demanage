import { Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { ExpenseFormDialog } from "@/components/expenses/expense-form-dialog"
import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EXPENSE_CATEGORY_LABELS } from "@/data/seed"
import { formatCurrency } from "@/lib/format"
import {
  selectMonthlyExpenses,
  useFinanceStore,
} from "@/stores/finance-store"
import type { ExpenseCategory, RecurringExpense } from "@/types/finance"

const categoryColors: Record<ExpenseCategory, string> = {
  assinatura: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  parcela: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  divida: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  outro: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
}

export function ExpensesPage() {
  const expenses = useFinanceStore((state) => state.expenses)
  const cards = useFinanceStore((state) => state.profile.cards)
  const removeExpense = useFinanceStore((state) => state.removeExpense)
  const total = useFinanceStore(selectMonthlyExpenses)

  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string>("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringExpense | null>(null)

  const filtered = useMemo(() => {
    return expenses.filter((expense) => {
      const matchesSearch = expense.name
        .toLowerCase()
        .includes(search.toLowerCase())
      const matchesCategory =
        category === "all" || expense.category === category
      return matchesSearch && matchesCategory
    })
  }, [expenses, search, category])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(expense: RecurringExpense) {
    setEditing(expense)
    setDialogOpen(true)
  }

  function handleDelete(id: string, name: string) {
    removeExpense(id)
    toast.success(`Despesa "${name}" removida`)
  }

  return (
    <div>
      <title>Despesas | deManage</title>
      <PageHeader
        title="Despesas"
        description="Assinaturas, parcelas, dívidas e outros gastos recorrentes."
        actions={
          <Button onClick={openCreate} className="rounded-lg">
            <Plus className="size-4" />
            Nova despesa
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar despesas por nome..."
            className="rounded-lg pl-9"
          />
        </div>
        <Select
          value={category}
          onValueChange={(value) => {
            if (value) setCategory(value)
          }}
        >
          <SelectTrigger className="w-full rounded-lg sm:w-48">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Nome</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Cartão</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  Nenhuma despesa encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((expense) => {
                const card = cards.find((item) => item.id === expense.cardId)

                return (
                  <TableRow key={expense.id}>
                    <TableCell className="font-medium">{expense.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={categoryColors[expense.category]}
                      >
                        {EXPENSE_CATEGORY_LABELS[expense.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {card?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {expense.dueDay ? `Dia ${expense.dueDay}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(expense.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(expense)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(expense.id, expense.name)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {filtered.length} despesa{filtered.length === 1 ? "" : "s"} •{" "}
        {formatCurrency(total)} / mês
      </p>

      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
      />
    </div>
  )
}
