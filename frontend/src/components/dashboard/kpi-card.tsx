import { cn } from "@/lib/utils"

type KpiCardProps = {
  label: string
  value: string
  hint?: string
  tone?: "default" | "positive" | "negative"
}

export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: KpiCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
          tone === "positive" && "text-neon-green",
          tone === "negative" && "text-rose-400",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p
          className={cn(
            "mt-1 text-xs text-muted-foreground",
            tone === "positive" && "text-neon-green/80",
            tone === "negative" && "text-rose-400/80",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  )
}
