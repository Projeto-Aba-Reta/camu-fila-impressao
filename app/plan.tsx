"use client";

import { buildPlan } from "@/lib/plan";
import { fmtDur, type Item, type Project, type Settings } from "@/lib/calc";

const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR");
const fmtDay = (d: Date) => d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

export default function PlanView({ projects, items, settings }: { projects: Project[]; items: Item[]; settings: Settings }) {
  const plan = buildPlan(projects, items, settings);
  if (plan.days.length === 0) return <div className="card">Nada para imprimir no momento.</div>;

  return (
    <>
      <div className="card">
        <h2>Resumo por projeto</h2>
        <table>
          <thead><tr><th>Projeto</th><th>Prazo</th><th>Termina em</th><th></th></tr></thead>
          <tbody>
            {plan.projects.map(({ project, finish, late }) => (
              <tr key={project.id}>
                <td>{project.name}</td>
                <td>{fmtDate(new Date(project.target_date + "T00:00:00"))}</td>
                <td>{finish ? fmtDate(finish) : "além de 120 dias"}</td>
                <td><span className={`badge ${late ? "late" : "ok"}`}>{late ? "Atrasa" : "No prazo"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sub" style={{ margin: "8px 0 0" }}>
          Ordem: projeto de prazo mais próximo primeiro; peças com modelo pronto antes das sem modelo. Capacidade: {settings.printers} impressora(s) × {settings.hours_per_day}h/dia.
        </div>
      </div>

      {plan.days.map((day) => {
        const pct = Math.round((day.minutes / day.capacity) * 100);
        return (
          <div className="card" key={day.date.toISOString()}>
            <div className="head">
              <h2>{fmtDay(day.date)}</h2>
              <span className="sub" style={{ margin: 0 }}>{fmtDur(day.minutes)} de {fmtDur(day.capacity)} ({pct}%)</span>
            </div>
            <div className="bar"><div style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            <table>
              <tbody>
                {day.entries.map((e, k) => (
                  <tr key={k}>
                    <td>{e.project.name}</td>
                    <td>{e.item.name}</td>
                    <td>{e.qty}×</td>
                    <td>{fmtDur(e.minutes)}</td>
                    <td>{e.needsModel && <span className="badge risk">modelo até {fmtDate(day.date)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
