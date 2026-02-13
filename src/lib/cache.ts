/**
 * In-Memory Cache System with Invalidation Logic
 * Supports TTL, tenant isolation, and event-based invalidation
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
  version: number;
  tags: string[];
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

type InvalidationCallback = (key: string, tags: string[]) => void;

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, size: 0 };
  private invalidationCallbacks: InvalidationCallback[] = [];
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Generate a cache key with tenant isolation
   */
  private generateKey(tenantId: string, key: string): string {
    return `${tenantId}:${key}`;
  }

  /**
   * Set a value in the cache
   */
  set<T>(
    tenantId: string,
    key: string,
    data: T,
    options?: {
      ttl?: number; // Time to live in milliseconds
      tags?: string[]; // Tags for group invalidation
    }
  ): void {
    const fullKey = this.generateKey(tenantId, key);
    const ttl = options?.ttl ?? 30 * 60 * 1000; // Default 30 minutes
    const tags = options?.tags ?? [];

    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
      version: 1,
      tags: [tenantId, ...tags],
    };

    this.cache.set(fullKey, entry);
    this.stats.size = this.cache.size;
  }

  /**
   * Get a value from the cache
   */
  get<T>(tenantId: string, key: string): T | null {
    const fullKey = this.generateKey(tenantId, key);
    const entry = this.cache.get(fullKey) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(fullKey);
      this.stats.misses++;
      this.stats.evictions++;
      this.stats.size = this.cache.size;
      return null;
    }

    this.stats.hits++;
    return entry.data;
  }

  /**
   * Check if a key exists and is valid
   */
  has(tenantId: string, key: string): boolean {
    return this.get(tenantId, key) !== null;
  }

  /**
   * Delete a specific key
   */
  delete(tenantId: string, key: string): boolean {
    const fullKey = this.generateKey(tenantId, key);
    const entry = this.cache.get(fullKey);
    if (entry) {
      const tags = entry.tags;
      this.cache.delete(fullKey);
      this.stats.size = this.cache.size;
      this.notifyInvalidation(fullKey, tags);
      return true;
    }
    return false;
  }

  /**
   * Invalidate all entries for a tenant
   */
  invalidateTenant(tenantId: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (entry.tags.includes(tenantId)) {
        keysToDelete.push(key);
        count++;
      }
    });

    keysToDelete.forEach((key) => {
      const entry = this.cache.get(key);
      this.cache.delete(key);
      if (entry) {
        this.notifyInvalidation(key, entry.tags);
      }
    });

    this.stats.evictions += count;
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Invalidate all entries matching a tag
   */
  invalidateByTag(tag: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (entry.tags.includes(tag)) {
        keysToDelete.push(key);
        count++;
      }
    });

    keysToDelete.forEach((key) => {
      const entry = this.cache.get(key);
      this.cache.delete(key);
      if (entry) {
        this.notifyInvalidation(key, entry.tags);
      }
    });

    this.stats.evictions += count;
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Invalidate entries by multiple tags (OR logic)
   */
  invalidateByTags(tags: string[]): number {
    let count = 0;
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (tags.some((tag) => entry.tags.includes(tag))) {
        keysToDelete.push(key);
        count++;
      }
    });

    keysToDelete.forEach((key) => {
      const entry = this.cache.get(key);
      this.cache.delete(key);
      if (entry) {
        this.notifyInvalidation(key, entry.tags);
      }
    });

    this.stats.evictions += count;
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Invalidate regulation-related cache
   */
  invalidateRegulation(tenantId: string, regulationId: string): void {
    this.invalidateByTags([
      `regulation:${regulationId}`,
      "dependency-graph",
      "risk-scores",
      "impact-analysis",
    ]);
  }

  /**
   * Invalidate entity-related cache
   */
  invalidateEntity(
    tenantId: string,
    entityType: string,
    entityId: string
  ): void {
    this.invalidateByTags([
      `entity:${entityType}:${entityId}`,
      "dependency-graph",
      "risk-scores",
    ]);
  }

  /**
   * Invalidate edge-related cache
   */
  invalidateEdge(tenantId: string): void {
    this.invalidateByTag("dependency-graph");
  }

  /**
   * Register a callback for cache invalidation events
   */
  onInvalidation(callback: InvalidationCallback): () => void {
    this.invalidationCallbacks.push(callback);
    return () => {
      const index = this.invalidationCallbacks.indexOf(callback);
      if (index > -1) {
        this.invalidationCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Notify all invalidation callbacks
   */
  private notifyInvalidation(key: string, tags: string[]): void {
    this.invalidationCallbacks.forEach((callback) => {
      try {
        callback(key, tags);
      } catch (error) {
        console.error("Cache invalidation callback error:", error);
      }
    });
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      this.stats.evictions += keysToDelete.length;
      this.stats.size = this.cache.size;
      console.log(`Cache cleanup: removed ${keysToDelete.length} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0, size: this.cache.size };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Shutdown the cache
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.invalidationCallbacks = [];
  }
}

// Singleton instance
export const cache = new MemoryCache();

// Cache key generators
export const CacheKeys = {
  dependencyGraph: (tenantId: string) => `dependency-graph:${tenantId}`,
  entityDependencies: (tenantId: string, entityType: string, entityId: string) =>
    `entity-deps:${entityType}:${entityId}:${tenantId}`,
  regulationImpact: (tenantId: string, regulationId: string) =>
    `reg-impact:${regulationId}:${tenantId}`,
  riskScore: (tenantId: string, entityType: string, entityId: string) =>
    `risk:${entityType}:${entityId}:${tenantId}`,
  riskRanking: (tenantId: string) => `risk-ranking:${tenantId}`,
  simulationResult: (tenantId: string, simulationId: string) =>
    `simulation:${simulationId}:${tenantId}`,
};

// Cache tags for group invalidation
export const CacheTags = {
  dependencyGraph: "dependency-graph",
  riskScores: "risk-scores",
  impactAnalysis: "impact-analysis",
  regulation: (id: string) => `regulation:${id}`,
  entity: (type: string, id: string) => `entity:${type}:${id}`,
};

export default cache;
