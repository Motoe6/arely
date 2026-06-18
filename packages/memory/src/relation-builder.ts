import type { ExtractedEntity } from "./entity-extractor.js";

export type RelationType =
  | "uses"
  | "depends_on"
  | "part_of"
  | "similar_to"
  | "mentions"
  | "created_by"
  | "related_to";

export interface EntityRelation {
  sourceEntity: string;
  targetEntity: string;
  relationType: RelationType;
  weight: number;
}

const VERB_PATTERNS: Array<{ pattern: RegExp; relation: RelationType; sourceIdx: number; targetIdx: number }> = [
  { pattern: /(\w+(?:\s\w+)?)\s+uses?\s+(\w+(?:\s\w+)?)/gi, relation: "uses", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+depends?\s+on\s+(\w+(?:\s\w+)?)/gi, relation: "depends_on", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+is\s+(?:a\s+)?part\s+of\s+(\w+(?:\s\w+)?)/gi, relation: "part_of", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+is\s+similar\s+to\s+(\w+(?:\s\w+)?)/gi, relation: "similar_to", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+created\s+(?:by|from)\s+(\w+(?:\s\w+)?)/gi, relation: "created_by", sourceIdx: 2, targetIdx: 1 },
  { pattern: /(\w+(?:\s\w+)?)\s+built\s+(?:by|on|with)\s+(\w+(?:\s\w+)?)/gi, relation: "depends_on", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+runs?\s+on\s+(\w+(?:\s\w+)?)/gi, relation: "depends_on", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+integrat(?:es|ed)\s+with\s+(\w+(?:\s\w+)?)/gi, relation: "uses", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+power(?:s|ed)\s+by\s+(\w+(?:\s\w+)?)/gi, relation: "depends_on", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+outperform(?:s|ed)?\s+(\w+(?:\s\w+)?)/gi, relation: "similar_to", sourceIdx: 1, targetIdx: 2 },
  { pattern: /(\w+(?:\s\w+)?)\s+replace(?:s|d)?\s+(\w+(?:\s\w+)?)/gi, relation: "similar_to", sourceIdx: 1, targetIdx: 2 },
];

function normalizeEntity(value: string): string {
  return value.trim();
}

function extractVerbRelations(text: string): EntityRelation[] {
  const relations: EntityRelation[] = [];

  for (const vp of VERB_PATTERNS) {
    const matches = text.matchAll(vp.pattern);
    for (const m of matches) {
      const source = normalizeEntity(m[vp.sourceIdx]);
      const target = normalizeEntity(m[vp.targetIdx]);
      if (source.toLowerCase() === target.toLowerCase()) continue;
      relations.push({
        sourceEntity: source,
        targetEntity: target,
        relationType: vp.relation,
        weight: 1.0,
      });
    }
  }

  return relations;
}

function extractCooccurrenceRelations(
  entities: ExtractedEntity[],
  content: string,
): EntityRelation[] {
  const relations: EntityRelation[] = [];
  const sentences = content.split(/[.!?]+/).filter(Boolean);

  for (const sentence of sentences) {
    const inSentence = entities.filter((e) =>
      sentence.toLowerCase().includes(e.value.toLowerCase()),
    );

    for (let i = 0; i < inSentence.length; i++) {
      for (let j = i + 1; j < inSentence.length; j++) {
        const a = inSentence[i];
        const b = inSentence[j];
        if (a.value.toLowerCase() === b.value.toLowerCase()) continue;

        const existing = relations.find(
          (r) =>
            (r.sourceEntity.toLowerCase() === a.value.toLowerCase() &&
              r.targetEntity.toLowerCase() === b.value.toLowerCase()) ||
            (r.sourceEntity.toLowerCase() === b.value.toLowerCase() &&
              r.targetEntity.toLowerCase() === a.value.toLowerCase()),
        );

        if (existing) {
          existing.weight = Math.min(existing.weight + 0.5, 5.0);
        } else {
          relations.push({
            sourceEntity: a.value,
            targetEntity: b.value,
            relationType: "related_to",
            weight: 0.5,
          });
        }
      }
    }
  }

  return relations;
}

export function buildRelations(
  entities: ExtractedEntity[],
  content: string,
): EntityRelation[] {
  const verbRelations = extractVerbRelations(content);
  const cooccurrenceRelations = extractCooccurrenceRelations(entities, content);

  const merged = new Map<string, EntityRelation>();

  const key = (r: EntityRelation) => {
    const a = r.sourceEntity.toLowerCase();
    const b = r.targetEntity.toLowerCase();
    const sorted = [a, b].sort();
    return `${sorted[0]}:${sorted[1]}:${r.relationType}`;
  };

  for (const r of [...verbRelations, ...cooccurrenceRelations]) {
    const k = key(r);
    const existing = merged.get(k);
    if (existing) {
      existing.weight = Math.min(existing.weight + r.weight, 5.0);
    } else {
      merged.set(k, { ...r });
    }
  }

  return Array.from(merged.values());
}
