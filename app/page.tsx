"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, increment, onSnapshot, setDoc, updateDoc, writeBatch, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fmtDur, summarize, type Item, type Project, type Settings, type Status } from "@/lib/calc";

const STATUS_LABEL: Record<Status, string> = {
  done: "Concluído",
  ok: "No prazo",
  risk: "Em risco",
  late: "Atrasado",
};

const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR");

type Run = (q: Promise<unknown>) => Promise<void>;

export default function Page() {
  const [settings, setSettings] = useState<Settings>({ printers: 1, hours_per_day: 12 });
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");

  // atualização em tempo real via Firestore
  useEffect(() => {
    const onErr = (e: Error) => setError(e.message);
    const unsubs = [
      onSnapshot(doc(db, "settings", "main"), (d) => {
        if (d.exists()) setSettings({ printers: Number(d.data().printers) || 1, hours_per_day: Number(d.data().hours_per_day) || 12 });
      }, onErr),
      onSnapshot(collection(db, "projects"), (q) => {
        setError("");
        setProjects(q.docs.map((d) => ({ id: d.id, ...d.data() }) as Project).sort((x, y) => x.target_date.localeCompare(y.target_date)));
      }, onErr),
      onSnapshot(collection(db, "items"), (q) => {
        setItems(q.docs.map((d) => ({ id: d.id, ...d.data() }) as Item & { created_at?: number }).sort((x, y) => (x.created_at ?? 0) - (y.created_at ?? 0)));
      }, onErr),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const run: Run = async (q) => {
    try {
      await q;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveSettings = (next: Settings) => {
    setSettings(next);
    run(setDoc(doc(db, "settings", "main"), next));
  };

  return (
    <main>
      <h1>Fila de Impressão 3D</h1>
      <div className="sub">Acompanhe o que falta imprimir e se o prazo de cada projeto é viável.</div>

      {error && <div className="err">{error}</div>}

      <SettingsCard settings={settings} onSave={saveSettings} />

      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          items={items.filter((i) => i.project_id === p.id)}
          settings={settings}
          run={run}
        />
      ))}
      {projects.length === 0 && !error && <div className="card">Nenhum projeto ainda. Crie um abaixo.</div>}

      <NewProject run={run} />
    </main>
  );
}

function SettingsCard({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  return (
    <div className="card">
      <h2>Configuração</h2>
      <div className="row">
        <label>
          Impressoras
          <input
            className="num"
            type="number"
            min={1}
            value={settings.printers}
            onChange={(e) => onSave({ ...settings, printers: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label>
          Horas de impressão por dia
          <input
            className="num"
            type="number"
            min={1}
            max={24}
            value={settings.hours_per_day}
            onChange={(e) =>
              onSave({ ...settings, hours_per_day: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })
            }
          />
        </label>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  items,
  settings,
  run,
}: {
  project: Project;
  items: Item[];
  settings: Settings;
  run: Run;
}) {
  const s = summarize(project, items, settings);
  const pct = s.total ? Math.round((s.printed / s.total) * 100) : 0;
  const slack = fmtDur(Math.abs(s.slackHours) * 60);

  return (
    <div className="card">
      <div className="head">
        <h2>{project.name}</h2>
        <div className="row">
          <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status]}</span>
          <button
            className="ghost sm"
            onClick={() =>
              navigator.clipboard
                .writeText(`${location.origin}/cliente/${project.id}`)
                .then(() => alert("Link do cliente copiado!"))
            }
          >
            Link do cliente
          </button>
          <button
            className="ghost sm"
            onClick={() => confirm(`Excluir "${project.name}"?`) && run(deleteProject(project.id))}
          >
            Excluir
          </button>
        </div>
      </div>

      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="sub" style={{ marginBottom: 0 }}>
        {s.printed}/{s.total} peças impressas ({pct}%) · faltam {s.remaining}
      </div>

      <div className="stats">
        <div className="stat">
          <input
            type="date"
            value={project.target_date}
            onChange={(e) => e.target.value && run(updateDoc(doc(db, "projects", project.id), { target_date: e.target.value }))}
          />
          <span>Data alvo (editável)</span>
        </div>
        <div className="stat"><b>{fmtDur(s.availableHours * 60)}</b><span>Horas úteis disponíveis (por impressora)</span></div>
        <div className="stat"><b>{fmtDur(s.neededHours * 60)}</b><span>Horas necessárias (por impressora)</span></div>
        <div className="stat"><b>{fmtDur(s.remMinutes)}</b><span>Impressão restante (total)</span></div>
        <div className="stat"><b>{s.remaining ? fmtDate(s.eta) : "—"}</b><span>Previsão de término</span></div>
        <div className="stat"><b>{(s.remFilament / 1000).toFixed(2)} kg</b><span>Filamento restante</span></div>
        <div className="stat"><b>{s.remaining ? s.perDayNeeded.toFixed(1) : "—"}</b><span>Peças/dia necessárias</span></div>
      </div>
      {s.remaining > 0 && (
        <div className="sub">
          {s.slackHours >= 0 ? `Folga de ${slack} de impressão por impressora em relação ao prazo.` : `Faltam ${slack} de impressão por impressora para cumprir o prazo — considere mais impressoras ou horas/dia.`}
        </div>
      )}
      {s.modelDeadline && (
        <div className="sub">
          Faltam {s.unreadyCount} modelo(s): para cumprir o prazo, todos precisam estar prontos até{" "}
          <b>{fmtDate(s.modelDeadline)}</b>.
        </div>
      )}
      {s.status === "late" && (
        <div className="sub">
          No prazo, na melhor distribuição, vão faltar {s.missingTotal} peça(s).
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {s.plan.map((p) => (
              <li key={p.item.id}>
                {p.item.name}: imprime {p.fit} de {p.fit + p.qty} restantes
                {p.qty > 0 ? ` · faltam ${p.qty}` : " · completo"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <table>
        <thead>
          <tr><th>Item</th><th>Feitas</th><th>Qtd</th><th>Tempo/un (h · min)</th><th>Filamento/un (g)</th><th>Modelo</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <ItemRow key={i.id} item={i} run={run} />
          ))}
        </tbody>
      </table>

      <NewItem projectId={project.id} run={run} />
    </div>
  );
}

function NewItem({ projectId, run }: { projectId: string; run: Run }) {
  const empty = { name: "", quantity: "", hours: "", minutes: "", filament: "", ready: true, done: "" };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const print_minutes = (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0);
    if (!f.name.trim() || !Number(f.quantity) || print_minutes <= 0) return;
    run(
      addDoc(collection(db, "items"), {
        created_at: Date.now(),
        printed: 0,
        project_id: projectId,
        name: f.name.trim(),
        quantity: Number(f.quantity),
        print_minutes,
        filament_g: Number(f.filament) || 0,
        model_ready: f.ready,
        models_done: f.ready ? 0 : Math.min(Math.max(Math.floor(Number(f.done)) || 0, 0), Number(f.quantity)),
      })
    );
    setF(empty);
  };

  return (
    <form className="row" style={{ marginTop: 12 }} onSubmit={submit}>
      <label className="w">Novo item<input value={f.name} onChange={set("name")} placeholder="Nome da peça" required /></label>
      <label>Qtd<input className="num" type="number" min={1} value={f.quantity} onChange={set("quantity")} required /></label>
      <label>Horas<input className="num" type="number" min={0} value={f.hours} onChange={set("hours")} /></label>
      <label>Min<input className="num" type="number" min={0} max={59} value={f.minutes} onChange={set("minutes")} /></label>
      <label>Filamento (g)<input className="num" type="number" min={0} step="0.1" value={f.filament} onChange={set("filament")} /></label>
      <label><span>Modelo pronto</span><input type="checkbox" checked={f.ready} onChange={(e) => setF({ ...f, ready: e.target.checked })} /></label>
      {!f.ready && (
        <>
          <label>Modelos feitos<input className="num" type="number" min={0} value={f.done} onChange={set("done")} /></label>
        </>
      )}
      <button type="submit">Adicionar</button>
    </form>
  );
}

function NewProject({ run }: { run: Run }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    run(addDoc(collection(db, "projects"), { name: name.trim(), target_date: date }));
    setName("");
    setDate("");
  };

  return (
    <form className="card row" onSubmit={submit}>
      <label className="w">Novo projeto<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do projeto" required /></label>
      <label>Data alvo<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
      <button type="submit">Criar projeto</button>
    </form>
  );
}

// exclui o projeto e seus itens
async function deleteProject(id: string) {
  const batch = writeBatch(db);
  const its = await getDocs(query(collection(db, "items"), where("project_id", "==", id)));
  its.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "projects", id));
  await batch.commit();
}

// linha editável: os campos salvam ao sair (blur); a key remonta o campo quando o valor muda no banco
function ItemRow({ item: i, run }: { item: Item; run: Run }) {
  const ref = doc(db, "items", i.id);
  const save = (data: Record<string, unknown>) => run(updateDoc(ref, data));
  const h = Math.floor(i.print_minutes / 60);
  const m = i.print_minutes % 60;

  const saveTime = (hh: number, mm: number) => {
    const total = Math.max(0, hh) * 60 + Math.max(0, mm);
    if (total > 0 && total !== i.print_minutes) save({ print_minutes: total });
  };

  return (
    <tr>
      <td>
        <input
          key={"n" + i.name}
          className="w"
          defaultValue={i.name}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== i.name && save({ name: e.target.value.trim() })}
        />
      </td>
      <td>
        <button className="ghost sm" onClick={() => i.printed > 0 && save({ printed: increment(-1) })}>−</button>{" "}
        {i.printed}{" "}
        <button className="sm" onClick={() => i.printed < i.quantity && save({ printed: increment(1) })}>+</button>
      </td>
      <td>
        <input
          key={"q" + i.quantity}
          className="num"
          type="number"
          min={1}
          defaultValue={i.quantity}
          onBlur={(e) => {
            const q = Math.floor(Number(e.target.value));
            if (q >= 1 && q !== i.quantity) save({ quantity: q, printed: Math.min(i.printed, q) });
          }}
        />
      </td>
      <td>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input key={"h" + h} className="num" type="number" min={0} defaultValue={h} onBlur={(e) => saveTime(Number(e.target.value), m)} />
          <input key={"m" + m} className="num" type="number" min={0} max={59} defaultValue={m} onBlur={(e) => saveTime(h, Number(e.target.value))} />
        </div>
      </td>
      <td>
        <input
          key={"f" + i.filament_g}
          className="num"
          type="number"
          min={0}
          step="0.1"
          defaultValue={i.filament_g}
          onBlur={(e) => {
            const f = Number(e.target.value);
            if (f >= 0 && f !== i.filament_g) save({ filament_g: f });
          }}
        />
      </td>
      <td>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <label>
            <input
              type="checkbox"
              checked={i.model_ready !== false}
              onChange={(e) => save(e.target.checked ? { model_ready: true } : { model_ready: false, models_done: i.models_done ?? 0 })}
            />{" "}
            Pronto
          </label>
          {i.model_ready === false && (
            <>
              <label>
                Feitos
                <input
                  key={"md" + i.models_done}
                  className="num"
                  type="number"
                  min={0}
                  max={i.quantity}
                  defaultValue={i.models_done ?? 0}
                  onBlur={(e) => {
                    const d = Math.min(Math.max(Math.floor(Number(e.target.value)) || 0, 0), i.quantity);
                    if (d !== (i.models_done ?? 0)) save({ models_done: d });
                  }}
                />
              </label>
            </>
          )}
        </div>
      </td>
      <td><button className="ghost sm" onClick={() => run(deleteDoc(ref))}>×</button></td>
    </tr>
  );
}
