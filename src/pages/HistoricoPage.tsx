import { useEffect, useState } from "react";
import { HistoricoClient } from "@/components/HistoricoClient";
import { getJson } from "@/lib/client/api";
import type { Snapshot } from "@/lib/client/types";

export function HistoricoPage() {
  const [initial, setInitial] = useState<Snapshot[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ snapshots: Snapshot[] }>("/api/snapshots").then((data) => {
      if (!cancelled) setInitial(data.snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initial) return null;

  return <HistoricoClient initial={initial} />;
}
