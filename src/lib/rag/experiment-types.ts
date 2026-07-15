import type { ChunkingConfig } from "./chunking";

export type ExperimentConfig = {
  schemaVersion: 1;
  id: string;
  title: string;
  hypothesis: string;
  tags?: string[];
  corpus: {
    manifests: string[];
  };
  chunking: ChunkingConfig;
  embedding: {
    provider: string;
    model: string;
  };
  retrieval: {
    strategy: string;
    topK: number;
    minScore: number;
  };
  generation: {
    provider: string;
    model: string;
  };
  evaluation: {
    judgeEnabled: boolean;
    judgeModel?: string;
    goldenSet?: string;
    caseStatuses?: Array<"source-verified" | "human-approved">;
  };
};

export type ExperimentRun = {
  schemaVersion: 1;
  runId: string;
  experimentId: string;
  status: "prepared" | "failed";
  createdAt: string;
  completedAt: string;
  configHash: string;
  configPath: string;
  corpusManifestHashes: Array<{ path: string; sha256: string }>;
  evaluationDatasetHashes: Array<{ path: string; sha256: string }>;
  corpusSnapshot?: {
    sha256: string;
    documentCount: number;
    sources: Array<{ sourceId?: string; sourceUrl: string; sha256: string }>;
  };
  code: {
    gitCommit: string;
    dirty: boolean;
    gitDiffHash: string;
    sourceTreeHash: string;
    changedFiles: string[];
  };
  environment: {
    node: string;
    platform: string;
    architecture: string;
    python?: string;
    docling?: string;
  };
  configuration: ExperimentConfig;
  statistics?: {
    documentCount: number;
    sourceCount: number;
    chunkCount: number;
    wordCount: number;
    averageChunkWords: number;
    languages: Record<string, number>;
    sourceTypes: Record<string, number>;
  };
  timingsMs?: {
    loadDocuments: number;
    chunking: number;
    total: number;
  };
  metrics?: Record<string, number | null>;
  error?: string;
};
