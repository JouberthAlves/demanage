import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseCurrencyInput } from "@/lib/format"
import { useFinanceStore } from "@/stores/finance-store"
import type { Card } from "@/types/finance"

type CardFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: Card | null
}

type FormState = {
  name: string
  limit: string
  closingDay: string
  dueDay: string
}

const emptyForm: FormState = {
  name: "",
  limit: "",
  closingDay: "",
  dueDay: "",
}

export function CardFormDialog({
  open,
  onOpenChange,
  card,
}: CardFormDialogProps) {
  const addCard = useFinanceStore((state) => state.addCard)
  const updateCard = useFinanceStore((state) => state.updateCard)
  const [form, setForm] = useState<FormState>(emptyForm)

  useEffect(() => {
    if (!open) return

    if (card) {
      setForm({
        name: card.name,
        limit: card.limit != null ? String(card.limit).replace(".", ",") : "",
        closingDay: card.closingDay ? String(card.closingDay) : "",
        dueDay: card.dueDay ? String(card.dueDay) : "",
      })
      return
    }

    setForm(emptyForm)
  }, [card, open])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!form.name.trim()) {
      toast.error("Informe o nome do cartão")
      return
    }

    const payload = {
      name: form.name.trim(),
      limit: form.limit ? parseCurrencyInput(form.limit) : undefined,
      closingDay: form.closingDay ? Number(form.closingDay) : undefined,
      dueDay: form.dueDay ? Number(form.dueDay) : undefined,
    }

    if (card) {
      updateCard(card.id, payload)
      toast.success("Cartão atualizado")
    } else {
      addCard(payload)
      toast.success("Cartão adicionado")
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{card ? "Editar cartão" : "Novo cartão"}</DialogTitle>
          <DialogDescription>
            Cadastre limite, fechamento e vencimento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="card-name">Nome</Label>
            <Input
              id="card-name"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Ex: Nubank"
              className="rounded-lg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="card-limit">Limite</Label>
            <Input
              id="card-limit"
              value={form.limit}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  limit: event.target.value,
                }))
              }
              placeholder="0,00"
              className="rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="card-closing">Fechamento</Label>
              <Input
                id="card-closing"
                type="number"
                min={1}
                max={31}
                value={form.closingDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    closingDay: event.target.value,
                  }))
                }
                className="rounded-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-due">Vencimento</Label>
              <Input
                id="card-due"
                type="number"
                min={1}
                max={31}
                value={form.dueDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dueDay: event.target.value,
                  }))
                }
                className="rounded-lg"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="rounded-lg">
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
