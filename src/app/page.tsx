import { QueryWorkbench } from "@/components/query-workbench";
import { readCorpusSummary } from "@/lib/rag/vector-store";

export default async function Home() {
  const corpusSummary = await readCorpusSummary();

  return <QueryWorkbench corpusSummary={corpusSummary} />;
}
