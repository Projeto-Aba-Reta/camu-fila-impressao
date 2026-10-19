export type Settings = { printers: number; hours_per_day: number };
export type Item = {
  id: string;
  project_id: string;
  name: string;
  quantity: number;
  printed: number;
  print_minutes: number;
  filament_g: number;
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

  // dias de produção necessários, dividindo o trabalho entre as impressoras
  const workDays = remMinutes / 60 / s.printers / s.hours_per_day;

  const target = new Date(p.target_date + "T23:59:59");
  const daysLeft = (target.getTime() - now.getTime()) / 86400000;
  const eta = new Date(now.getTime() + workDays * 86400000);
  const slackDays = daysLeft - workDays;

  let status: Status = "ok";
  if (remaining === 0) status = "done";
  else if (slackDays < 0) status = "late";
  else if (slackDays < Math.max(1, workDays * 0.2)) status = "risk";

  const perDayNeeded = remaining / Math.max(daysLeft, 1);

  return { total, printed, remaining, remMinutes, remFilament, workDays, daysLeft, eta, slackDays, status, perDayNeeded };
}

export const fmtDur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`;
};
