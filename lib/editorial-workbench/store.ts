import { randomUUID } from "node:crypto";

import type {
  DailyEditorialPackage,
  EditorialRequest,
  EditorialSelectionResult,
  ResearchPack,
} from "../../types/editorial.ts";
import type {
  DiscoveryTraceEntry,
  EditorialProviderMode,
  HumanApproval,
} from "./types.ts";

export type StoredSelection = {
  request: EditorialRequest;
  selection: EditorialSelectionResult;
  providerMode: EditorialProviderMode;
  providerId: string;
  discoveryTrace: DiscoveryTraceEntry[];
};

export type StoredResearch = {
  selectionId: string;
  pack: ResearchPack;
  providerMode: EditorialProviderMode;
};

export type StoredPackage = {
  researchId: string;
  package: DailyEditorialPackage;
  providerMode: EditorialProviderMode;
  approval?: HumanApproval;
};

type StoredEntry<T> = { value: T; createdAt: number };

export class SessionExpiredError extends Error {
  readonly entity: "selection" | "research" | "package";

  constructor(entity: "selection" | "research" | "package") {
    super(`${entity} session expired`);
    this.name = "SessionExpiredError";
    this.entity = entity;
  }
}

export class EditorialSessionStore {
  private readonly selections = new Map<string, StoredEntry<StoredSelection>>();
  private readonly research = new Map<string, StoredEntry<StoredResearch>>();
  private readonly packages = new Map<string, StoredEntry<StoredPackage>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1_000;
    this.maxEntries = options.maxEntries ?? 100;
    this.now = options.now ?? Date.now;
    if (this.ttlMs <= 0 || this.maxEntries <= 0) throw new Error("Store TTL and maxEntries must be positive");
  }

  private prune<T>(map: Map<string, StoredEntry<T>>, reserveSlot = false): void {
    const now = this.now();
    for (const [id, entry] of map) {
      if (now - entry.createdAt >= this.ttlMs) map.delete(id);
    }
    const limit = this.maxEntries - (reserveSlot ? 1 : 0);
    while (map.size > limit) {
      const oldest = map.keys().next().value as string | undefined;
      if (!oldest) break;
      map.delete(oldest);
    }
  }

  private save<T>(map: Map<string, StoredEntry<T>>, value: T): string {
    this.prune(map, true);
    const id = randomUUID();
    map.set(id, { value: structuredClone(value), createdAt: this.now() });
    return id;
  }

  private get<T>(map: Map<string, StoredEntry<T>>, id: string, entity: SessionExpiredError["entity"]): T | undefined {
    const entry = map.get(id);
    if (!entry) return undefined;
    if (this.now() - entry.createdAt >= this.ttlMs) {
      map.delete(id);
      throw new SessionExpiredError(entity);
    }
    return structuredClone(entry.value);
  }

  saveSelection(value: StoredSelection): string {
    return this.save(this.selections, value);
  }

  getSelection(id: string): StoredSelection | undefined {
    return this.get(this.selections, id, "selection");
  }

  saveResearch(value: StoredResearch): string {
    return this.save(this.research, value);
  }

  getResearch(id: string): StoredResearch | undefined {
    return this.get(this.research, id, "research");
  }

  savePackage(value: StoredPackage): string {
    return this.save(this.packages, value);
  }

  getPackage(id: string): StoredPackage | undefined {
    return this.get(this.packages, id, "package");
  }

  updatePackage(id: string, value: StoredPackage): void {
    const entry = this.packages.get(id);
    if (!entry) return;
    this.packages.set(id, { value: structuredClone(value), createdAt: entry.createdAt });
  }

  sizes(): { selections: number; research: number; packages: number } {
    this.prune(this.selections);
    this.prune(this.research);
    this.prune(this.packages);
    return { selections: this.selections.size, research: this.research.size, packages: this.packages.size };
  }
}
