import { QueryWorkbench } from "@/components/query-workbench";
import { readRuntimeCorpusSummary } from "@/lib/rag/runtime-vector-store";

export default async function Home() {
  const corpusSummary = await readRuntimeCorpusSummary();

  return <QueryWorkbench corpusSummary={corpusSummary} />;
}
