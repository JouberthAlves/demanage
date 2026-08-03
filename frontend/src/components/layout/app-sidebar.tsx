import {
  LayoutDashboard,
  Receipt,
  TrendingUp,
  UserRound,
} from "lucide-react"
import { NavLink } from "react-router"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/perfil", label: "Perfil", icon: UserRound },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/despesas", label: "Despesas", icon: Receipt },
  { to: "/entradas", label: "Entradas", icon: TrendingUp },
]

export function AppSidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center border-r border-border bg-background py-4">
      <nav className="flex flex-1 flex-col items-center gap-2">
        {navItems.map((item) => {
          const Icon = item.icon

          return (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      isActive && "bg-accent text-foreground",
                    )
                  }
                >
                  <Icon className="size-5" />
                  <span className="sr-only">{item.label}</span>
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </aside>
  )
}
