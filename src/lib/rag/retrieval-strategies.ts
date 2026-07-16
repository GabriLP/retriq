import type { DocumentationChunk } from "./types";

export type ScoredChunk = DocumentationChunk & { score: number };

export type Bm25Options = {
  k1?: number;
  b?: number;
};

export class Bm25Index {
  private readonly termFrequencies: Array<Map<string, number>>;
  private readonly documentFrequencies = new Map<string, number>();
  private readonly documentLengths: number[];
  private readonly averageDocumentLength: number;
  private readonly k1: number;
  private readonly b: number;

  constructor(private readonly chunks: DocumentationChunk[], options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.termFrequencies = chunks.map((chunk) => frequencies(tokenize(`${chunk.title} ${chunk.section} ${chunk.content}`)));
    this.documentLengths = this.termFrequencies.map((terms) => sum([...terms.values()]));
    this.averageDocumentLength = this.documentLengths.length ? sum(this.documentLengths) / this.documentLengths.length : 0;
    for (const terms of this.termFrequencies) {
      for (const term of terms.keys()) this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1);
    }
  }

  search(query: string, limit = this.chunks.length): ScoredChunk[] {
    const queryTerms = [...new Set(tokenize(query))];
    return this.chunks
      .map((chunk, index) => ({ ...chunk, score: this.score(index, queryTerms) }))
      .filter((chunk) => chunk.score > 0)
      .sort(compareScores)
      .slice(0, limit);
  }

  private score(index: number, queryTerms: string[]) {
    const terms = this.termFrequencies[index];
    const length = this.documentLengths[index];
    let score = 0;
    for (const term of queryTerms) {
      const tf = terms.get(term) ?? 0;
      if (!tf) continue;
      const df = this.documentFrequencies.get(term) ?? 0;
      const idf = Math.log(1 + (this.chunks.length - df + 0.5) / (df + 0.5));
      const normalization = tf + this.k1 * (1 - this.b + this.b * length / Math.max(this.averageDocumentLength, 1));
      score += idf * (tf * (this.k1 + 1)) / normalization;
    }
    return score;
  }
}

export function reciprocalRankFusion(
  rankings: ScoredChunk[][],
  options: { rankConstant?: number; limit?: number } = {},
) {
  const rankConstant = options.rankConstant ?? 60;
  const byId = new Map<string, ScoredChunk>();
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((chunk, index) => {
      byId.set(chunk.id, chunk);
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (rankConstant + index + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ ...byId.get(id)!, score }))
    .sort(compareScores)
    .slice(0, options.limit ?? scores.size);
}

export function tokenize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{N}_.$#:+-]+/gu) ?? [];
}

function frequencies(tokens: string[]) {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function compareScores(left: ScoredChunk, right: ScoredChunk) {
  return right.score - left.score || left.id.localeCompare(right.id);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
