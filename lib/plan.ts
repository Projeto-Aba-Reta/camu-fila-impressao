import type { Item, Project, Settings } from "./calc";

export type PlanEntry = { project: Project; item: Item; qty: number; minutes: number; modelBy: Date | null };
export type PlanDay = { date: Date; entries: PlanEntry[]; minutes: number; capacity: number; mixed: boolean };
export type PlanProject = { project: Project; finish: Date | null; late: boolean };

const DAY = 86400000;

type Block = { key: string; project: Project; item: Item; qty: number; unready: boolean; first: number };
type Slot = { owner: string | null; entries: { block: Block; qty: number; minutes: number }[]; minutes: number };

// plano recomendado:
// - um tipo de item por dia (material/cor), só mescla itens no mesmo dia se for o único jeito de cumprir os prazos;
// - peças sem modelo ficam no fim do prazo do projeto (dá o máximo de tempo para modelar e evita trocar de material);
// - peças com modelo pronto vão o quanto antes, projeto de prazo mais próximo primeiro.
export function buildPlan(projects: Project[], items: Item[], s: Settings, now = new Date(), maxDays = 120) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDate = (d: number) => new Date(start.getTime() + d * DAY);
  const capacity = s.printers * s.hours_per_day * 60;
  const left = (i: Item) => Math.max(i.quantity - i.printed, 0);
  const unreadyQty = (i: Item) =>
    i.model_ready === false ? Math.min(left(i), Math.max(i.quantity - (i.models_done ?? 0), 0)) : 0;

  const sorted = [...projects].sort((a, b) => a.target_date.localeCompare(b.target_date));
  // último dia de produção: o dia da data alvo não conta
  const lastDay = (p: Project) => Math.ceil((new Date(p.target_date + "T00:00:00").getTime() - start.getTime()) / DAY) - 1;
  const byTime = (a: Item, b: Item) => a.print_minutes - b.print_minutes;

  const ready: Block[] = [];
  const unready: Block[] = [];
  for (const p of sorted) {
    const its = items.filter((i) => i.project_id === p.id && left(i) > 0 && i.print_minutes > 0).sort(byTime);
    for (const i of its) {
      if (left(i) - unreadyQty(i) > 0) ready.push({ key: i.id + "r", project: p, item: i, qty: left(i) - unreadyQty(i), unready: false, first: Infinity });
      if (unreadyQty(i) > 0) unready.push({ key: i.id + "u", project: p, item: i, qty: unreadyQty(i), unready: true, first: Infinity });
    }
  }

  const run = (mix: boolean) => {
    const slots: Slot[] = Array.from({ length: maxDays }, () => ({ owner: null, entries: [], minutes: 0 }));
    const blocks = [...ready, ...unready].map((b) => ({ ...b, first: Infinity }));
    const put = (b: Block, d: number) => {
      const sl = slots[d];
      if (!mix && sl.owner !== null && sl.owner !== b.key) return;
      let n = Math.min(b.qty, Math.floor((capacity - sl.minutes) / b.item.print_minutes));
      if (n === 0 && sl.minutes === 0) n = 1; // peça maior que o dia: ocupa um dia vazio
      if (n <= 0) return;
      const minutes = n * b.item.print_minutes;
      sl.owner ??= b.key;
      sl.entries.push({ block: b, qty: n, minutes });
      sl.minutes += minutes;
      b.qty -= n;
      b.first = Math.min(b.first, d);
    };
    const forward = (b: Block, from: number) => {
      for (let d = Math.max(from, 0); d < maxDays && b.qty > 0; d++) put(b, d);
    };

    // 1) sem modelo: de trás para frente a partir do fim do prazo; prazos mais curtos reservam primeiro
    for (const b of blocks.filter((b) => b.unready)) {
      const last = Math.min(lastDay(b.project), maxDays - 1);
      for (let d = last; d >= 0 && b.qty > 0; d--) put(b, d);
      forward(b, last + 1); // não coube antes do prazo: atrasa
    }
    // 2) com modelo: o quanto antes
    for (const b of blocks.filter((b) => !b.unready)) forward(b, 0);
    return { slots, blocks };
  };

  const finishDay = (r: ReturnType<typeof run>) => {
    const m = new Map<string, number>();
    r.slots.forEach((sl, d) => sl.entries.forEach((e) => m.set(e.block.project.id, Math.max(m.get(e.block.project.id) ?? -1, d))));
    return m;
  };
  const anyLate = (r: ReturnType<typeof run>) => {
    const f = finishDay(r);
    return [...f].some(([id, d]) => d > lastDay(sorted.find((p) => p.id === id)!)) || r.blocks.some((b) => b.qty > 0);
  };

  let result = run(false);
  if (anyLate(result)) result = run(true); // mesclar só quando é obrigatório

  const first = new Map(result.blocks.map((b) => [b.key, b.first]));
  const days: PlanDay[] = [];
  result.slots.forEach((sl, d) => {
    if (!sl.entries.length) return;
    days.push({
      date: dayDate(d),
      capacity,
      minutes: sl.minutes,
      mixed: new Set(sl.entries.map((e) => e.block.item.id)).size > 1,
      entries: sl.entries.map((e) => ({
        project: e.block.project,
        item: e.block.item,
        qty: e.qty,
        minutes: e.minutes,
        modelBy: e.block.unready ? dayDate(first.get(e.block.key) ?? d) : null,
      })),
    });
  });

  const fin = finishDay(result);
  const projectsOut: PlanProject[] = sorted
    .filter((p) => fin.has(p.id))
    .map((p) => {
      const d = fin.get(p.id)!;
      return { project: p, finish: dayDate(d), late: d > lastDay(p) };
    });
  return { days, projects: projectsOut };
}
