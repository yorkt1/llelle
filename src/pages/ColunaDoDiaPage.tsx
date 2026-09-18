import { useEffect, useState } from "react";
import { ColunaDoDia } from "@/components/ColunaDoDia";
import { getJson } from "@/lib/client/api";
import type { ProductsResponse, StatusResponse } from "@/lib/client/types";

export function ColunaDoDiaPage() {
  const [initial, setInitial] = useState<{
    status: StatusResponse;
    products: ProductsResponse["products"];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson<StatusResponse>("/api/status"), getJson<ProductsResponse>("/api/products")]).then(
      ([status, products]) => {
        if (!cancelled) setInitial({ status, products: products.products });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initial) return null;

  return <ColunaDoDia initialStatus={initial.status} initialProducts={initial.products} />;
}
