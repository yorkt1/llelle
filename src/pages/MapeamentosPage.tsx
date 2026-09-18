import { useEffect, useState } from "react";
import { MapeamentosClient } from "@/components/MapeamentosClient";
import { getJson } from "@/lib/client/api";
import type { MappingsResponse } from "@/lib/client/types";

export function MapeamentosPage() {
  const [initial, setInitial] = useState<MappingsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<MappingsResponse>("/api/mappings").then((data) => {
      if (!cancelled) setInitial(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initial) return null;

  return <MapeamentosClient initial={initial} />;
}
