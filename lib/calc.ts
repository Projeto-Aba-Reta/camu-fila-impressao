export type Settings = { printers: number; hours_per_day: number };
export type Item = {
  id: string;
  project_id: string;
  name: string;
  quantity: number;
  printed: number;
  print_minutes: number;
  filament_g: number;
  // sem model_ready (ou true) = todos os modelos prontos; false = só `models_done` modelos feitos
  model_ready?: boolean;
  models_done?: number;
};
export type Project = { id: string; name: string; target_date: string };

export type Status = "done" | "ok" | "risk" | "late";

export function summarize(p: Project, items: Item[], s: Settings, now = new Date()) {
  const total = items.reduce((a, i) => a + i.quantity, 0);
  const printed = items.reduce((a, i) => a + Math.min(i.printed, i.quantity), 0);
  const remaining = total - printed;
  const left = (i: Item) => Math.max(i.quantity - i.printed, 0);
  const remMinutes = items.reduce((a, i) => a + left(i) * i.print_minutes, 0);
  const remFilament = items.reduce((a, i) => a + left(i) * i.filament_g, 0);

  // cada peça restante precisa de um modelo; peças sem modelo só imprimem depois de modelar
  const unready = (i: Item) =>
    i.model_ready === false ? Math.min(left(i), Math.max(i.quantity - (i.models_done ?? 0), 0)) : 0;
  const unreadyPrintMinutes = items.reduce((a, i) => a + unready(i) * i.print_minutes, 0);

  // horas de impressão por impressora (o trabalho é dividido entre as impressoras)
  const neededHours = remMinutes / 60 / s.printers;
  const workDays = neededHours / s.hours_per_day;

  // o dia da data alvo não conta como dia de produção: o prazo vence no início dele
  const target = new Date(p.target_date + "T00:00:00");
  const daysLeft = (target.getTime() - now.getTime()) / 86400000;
  // horas úteis de impressão disponíveis por impressora até o prazo
  const availableHours = Math.max(daysLeft, 0) * s.hours_per_day;
  const eta = new Date(now.getTime() + workDays * 86400000);
  const slackHours = availableHours - neededHours;

  let status: Status = "ok";
  if (remaining === 0) status = "done";
  else if (slackHours < 0) status = "late";
  else if (slackHours < Math.max(s.hours_per_day, neededHours * 0.2)) status = "risk";

  // data limite para ter todos os modelos: sobra o tempo de imprimir as peças sem modelo antes do prazo
  const unreadyCount = items.reduce((a, i) => a + unready(i), 0);
  const modelDeadline =
    unreadyCount > 0
      ? new Date(target.getTime() - (unreadyPrintMinutes / 60 / s.printers / s.hours_per_day) * 86400000)
      : null;

  const perDayNeeded = remaining / Math.max(daysLeft, 1);

  // em caso de atraso: maximiza o nº de peças feitas no tempo disponível
  // (prioriza as mais rápidas) e devolve o que fica faltando por item
  let capacity = availableHours * s.printers * 60;
  const missing: { item: Item; qty: number }[] = [];
  const plan: { item: Item; fit: number; qty: number }[] = [];
  if (status === "late") {
    const fitByItem = new Map<string, number>();
    // peças com modelo e sem modelo como entradas separadas; as mais rápidas primeiro, as com modelo à frente
    const entries = items
      .filter((i) => left(i) > 0)
      .flatMap((i) => [
        { i, n: left(i) - unready(i) },
        { i, n: unready(i) },
      ])
      .filter((e) => e.n > 0)
      .sort((a, b) => a.i.print_minutes - b.i.print_minutes);
    for (const { i, n } of entries) {
      let fit = i.print_minutes > 0 ? Math.min(n, Math.floor(capacity / i.print_minutes)) : n;
      capacity -= fit * i.print_minutes;
      fitByItem.set(i.id, (fitByItem.get(i.id) ?? 0) + fit);
    }
    for (const i of items.filter((i) => left(i) > 0)) {
      const fit = fitByItem.get(i.id) ?? 0;
      plan.push({ item: i, fit, qty: left(i) - fit });
      if (left(i) - fit > 0) missing.push({ item: i, qty: left(i) - fit });
    }
  }
  const missingTotal = missing.reduce((a, m) => a + m.qty, 0);

  return { total, printed, remaining, remMinutes, unreadyCount, modelDeadline, remFilament, neededHours, availableHours, eta, slackHours, status, perDayNeeded, missing, missingTotal, plan };
}

export const fmtDur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`;
};
