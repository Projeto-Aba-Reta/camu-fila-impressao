import type { Item, Project, Settings } from "./calc";

export type PlanEntry = { project: Project; item: Item; qty: number; minutes: number; needsModel: boolean };
export type PlanDay = { date: Date; entries: PlanEntry[]; minutes: number; capacity: number };
export type PlanProject = { project: Project; finish: Date | null; late: boolean };

const DAY = 86400000;

// plano recomendado: projetos por prazo (o mais próximo primeiro); dentro do projeto, peças com modelo pronto
// antes das sem modelo, que ficam para o fim e só entram quando o modelo estiver feito
export function buildPlan(projects: Project[], items: Item[], s: Settings, now = new Date(), maxDays = 120) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const capacity = s.printers * s.hours_per_day * 60;
  const left = (i: Item) => Math.max(i.quantity - i.printed, 0);
  const unready = (i: Item) =>
    i.model_ready === false ? Math.min(left(i), Math.max(i.quantity - (i.models_done ?? 0), 0)) : 0;

  const queue: { project: Project; item: Item; qty: number; needsModel: boolean }[] = [];
  for (const p of [...projects].sort((a, b) => a.target_date.localeCompare(b.target_date))) {
    const its = items.filter((i) => i.project_id === p.id && left(i) > 0);
    // mais rápidas primeiro dentro de cada grupo
    const byTime = (a: Item, b: Item) => a.print_minutes - b.print_minutes;
    for (const i of [...its].sort(byTime)) if (left(i) - unready(i) > 0) queue.push({ project: p, item: i, qty: left(i) - unready(i), needsModel: false });
    for (const i of [...its].sort(byTime)) if (unready(i) > 0) queue.push({ project: p, item: i, qty: unready(i), needsModel: true });
  }

  const days: PlanDay[] = [];
  const finishByProject = new Map<string, Date>();
  const pending = queue.filter((q) => q.item.print_minutes > 0);
  for (let d = 0; d < maxDays && pending.some((q) => q.qty > 0); d++) {
    const day: PlanDay = { date: new Date(start.getTime() + d * DAY), entries: [], minutes: 0, capacity };
    for (const q of pending) {
      if (q.qty <= 0) continue;
      const free = capacity - day.minutes;
      let n = Math.min(q.qty, Math.floor(free / q.item.print_minutes));
      // peça maior que o dia inteiro: entra num dia vazio
      if (n === 0 && day.minutes === 0) n = 1;
      if (n <= 0) continue;
      q.qty -= n;
      const minutes = n * q.item.print_minutes;
      day.minutes += minutes;
      day.entries.push({ project: q.project, item: q.item, qty: n, minutes, needsModel: q.needsModel });
      finishByProject.set(q.project.id, day.date);
    }
    days.push(day);
  }

  const projectsOut: PlanProject[] = projects
    .filter((p) => items.some((i) => i.project_id === p.id && left(i) > 0))
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
    .map((p) => {
      const finish = finishByProject.get(p.id) ?? null;
      // o dia da data alvo não conta como dia de produção
      const late = !finish || finish.getTime() >= new Date(p.target_date + "T00:00:00").getTime();
      return { project: p, finish, late };
    });
  return { days, projects: projectsOut };
}
