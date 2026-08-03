import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { formatCurrency } from "@/lib/format"
import {
  selectMonthlyExpenses,
  selectMonthlyIncome,
  useFinanceStore,
} from "@/stores/finance-store"

export function MonthCompareBarChart() {
  const history = useFinanceStore((state) => state.history)
  const currentIncome = useFinanceStore(selectMonthlyIncome)
  const currentExpense = useFinanceStore(selectMonthlyExpenses)

  const previous = history[history.length - 2]
  const data = [
    {
      name: "Entradas",
      atual: currentIncome,
      anterior: previous?.income ?? 0,
    },
    {
      name: "Saídas",
      atual: currentExpense,
      anterior: previous?.expense ?? 0,
    },
  ]

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#a3a3a3", fontSize: 12 }}
            tickFormatter={(value) =>
              new Intl.NumberFormat("pt-BR", {
                notation: "compact",
                compactDisplay: "short",
              }).format(Number(value))
            }
          />
          <Tooltip
            contentStyle={{
              background: "#111",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
            }}
            formatter={(value) => formatCurrency(Number(value))}
          />
          <Legend />
          <Bar
            dataKey="atual"
            name="Este mês"
            fill="#FFB800"
            radius={[6, 6, 0, 0]}
          />
          <Bar
            dataKey="anterior"
            name="Mês passado"
            fill="#34D399"
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
