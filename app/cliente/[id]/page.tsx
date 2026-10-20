"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Item, Project } from "@/lib/calc";

// visão somente leitura para o cliente: apenas quantidades prontas, sem prazos nem dados internos
export default function ClientePage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const onErr = (e: Error) => setError(e.message);
    const unsubs = [
      onSnapshot(doc(db, "projects", id), (d) => setProject(d.exists() ? ({ id: d.id, ...d.data() } as Project) : null), onErr),
      onSnapshot(query(collection(db, "items"), where("project_id", "==", id)), (q) => {
        setItems(q.docs.map((d) => ({ id: d.id, ...d.data() }) as Item & { created_at?: number }).sort((x, y) => (x.created_at ?? 0) - (y.created_at ?? 0)));
      }, onErr),
    ];
    return () => unsubs.forEach((u) => u());
  }, [id]);

  if (error) return <main><div className="err">{error}</div></main>;
  if (project === undefined) return <main><div className="sub">Carregando…</div></main>;
  if (project === null) return <main><div className="card">Projeto não encontrado.</div></main>;

  const total = items.reduce((a, i) => a + i.quantity, 0);
  const printed = items.reduce((a, i) => a + Math.min(i.printed, i.quantity), 0);
  const pct = total ? Math.round((printed / total) * 100) : 0;

  return (
    <main>
      <h1>{project.name}</h1>
      <div className="sub">Quantidade de peças prontas — atualizado em tempo real.</div>

      <div className="card">
        <div className="stats">
          <div className="stat"><b>{printed}</b><span>Prontas</span></div>
          <div className="stat"><b>{total - printed}</b><span>Faltam</span></div>
          <div className="stat"><b>{total}</b><span>Total</span></div>
          <div className="stat"><b>{pct}%</b><span>Concluído</span></div>
        </div>
        <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="card">
        <h2>Itens</h2>
        <table>
          <thead>
            <tr><th>Item</th><th>Prontas</th><th>Total</th><th>Progresso</th></tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const done = Math.min(i.printed, i.quantity);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{done}</td>
                  <td>{i.quantity}</td>
                  <td style={{ width: "35%" }}>
                    <div className="bar" style={{ margin: 0 }}><div style={{ width: `${i.quantity ? (done / i.quantity) * 100 : 0}%` }} /></div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={4}>Nenhum item cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
