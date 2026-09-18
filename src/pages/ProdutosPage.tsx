import { useEffect, useState } from "react";
import { ProdutosClient } from "@/components/ProdutosClient";
import { getJson } from "@/lib/client/api";
import type { ProductsResponse } from "@/lib/client/types";

export function ProdutosPage() {
  const [initial, setInitial] = useState<ProductsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<ProductsResponse>("/api/products").then((data) => {
      if (!cancelled) setInitial(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initial) return null;

  return <ProdutosClient initial={initial} />;
}
