export interface GlobalMemoryRecord {
  id: string;
  content: string;
  sessionIds: string[];
  entities: string[];
  tags: string[];
  importance: number;
  confidence: number;
  accessCount: number;
  lastAccessedAt: string | null;
  embedding: number[] | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntityRecord {
  id: string;
  memoryId: string;
  entity: string;
  type: string;
}

export interface EntityRelationRecord {
  id: string;
  sourceEntity: string;
  targetEntity: string;
  weight: number;
  relationType: string;
  updatedAt: string;
}

export interface GlobalMemorySearchQuery {
  query?: string;
  tags?: string[];
  entities?: string[];
  minImportance?: number;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}
