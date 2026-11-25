import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Idea, OutboxEntry, PrototypeRecord, SyncStatus } from '../core';
import { IndexedDBStore } from './idb';
import {
  IdeaRow,
  PrototypeRow,
  RemoteSyncStore,
  SupabaseStore,
  mergeIdeaConflict,
  rowToIdea,
  rowToPrototype,
} from './supabase';
import { getSupabaseClient } from './supabaseClient';

export interface SyncStateSnapshot {
  status: SyncStatus;
  pendingCount: number;
  user: { id: string; email?: string } | null;
  lastError?: string;
}

export interface SyncManagerDeps {
  localStore: IndexedDBStore;
  getRemoteStore: () => RemoteSyncStore | null;
  getSupabaseClient?: () => SupabaseClient | null;
  isOnline?: () => boolean;
  onIdeasUpdated?: (ideas: Idea[]) => void;
  onPrototypeUpdated?: (ideaId: string, revision: number) => void;
}

export class SyncManager {
  private status: SyncStatus = 'local_only';
  private user: { id: string; email?: string } | null = null;
  private pendingCount = 0;
  private lastError: string | undefined;
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<(snap: SyncStateSnapshot) => void>();

  constructor(private readonly deps: SyncManagerDeps) {}

  private isOnline(): boolean {
    if (this.deps.isOnline) return this.deps.isOnline();
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) {
      cb(snap);
    }
  }

  getSnapshot(): SyncStateSnapshot {
    return {
      status: this.status,
      pendingCount: this.pendingCount,
      user: this.user,
      lastError: this.lastError,
    };
  }

  subscribe(cb: (snap: SyncStateSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => {
      this.listeners.delete(cb);
    };
  }

  async setUser(user: { id: string; email?: string } | null): Promise<void> {
    const prevId = this.user?.id || null;
    this.user = user;
    if (!user) {
      this.stopRealtime();
      this.status = 'local_only';
      this.lastError = undefined;
      this.pendingCount = (await this.deps.localStore.listOutbox()).length;
      this.emit();
      return;
    }

    await this.refreshStatusFromOutbox();
    if (prevId !== user.id) {
      this.startRealtime();
    }
    if (this.isOnline()) {
      await this.flushOutbox();
      await this.pullFromRemote();
    }
  }

  async refreshStatusFromOutbox(): Promise<void> {
    const entries = await this.deps.localStore.listOutbox();
    this.pendingCount = entries.length;
    if (!this.user) {
      this.status = 'local_only';
    } else if (!this.isOnline()) {
      this.status = 'offline';
    } else if (this.pendingCount > 0) {
      this.status = this.lastError ? 'error' : 'pending';
    } else {
      this.status = 'synced';
    }
    this.emit();
  }

  async enqueueIdeaUpsert(idea: Idea): Promise<void> {
    if (!this.user) return;
    await this.deps.localStore.enqueueOutbox({
      table: 'ideas',
      op: 'upsert',
      recordId: idea.id,
      payload: idea,
    });
    await this.refreshStatusFromOutbox();
    if (this.isOnline()) {
      void this.flushOutbox();
    }
  }

  async enqueueIdeaDelete(id: string): Promise<void> {
    if (!this.user) return;
    await this.deps.localStore.enqueueOutbox({
      table: 'ideas',
      op: 'delete',
      recordId: id,
    });
    await this.refreshStatusFromOutbox();
    if (this.isOnline()) {
      void this.flushOutbox();
    }
  }

  async enqueuePrototypeUpsert(record: PrototypeRecord): Promise<void> {
    if (!this.user) return;
    await this.deps.localStore.enqueueOutbox({
      table: 'idea_prototypes',
      op: 'upsert',
      recordId: record.id,
      payload: record,
    });
    await this.refreshStatusFromOutbox();
    if (this.isOnline()) {
      void this.flushOutbox();
    }
  }

  async flushOutbox(): Promise<{ processed: number; failed: number }> {
    if (this.flushing) return { processed: 0, failed: 0 };
    const remote = this.deps.getRemoteStore();
    if (!this.user || !remote) {
      await this.refreshStatusFromOutbox();
      return { processed: 0, failed: 0 };
    }

    if (!this.isOnline()) {
      this.status = 'offline';
      this.emit();
      return { processed: 0, failed: 0 };
    }

    this.flushing = true;
    const entries = await this.deps.localStore.listOutbox();
    this.pendingCount = entries.length;
    if (entries.length > 0) {
      this.status = 'syncing';
      this.emit();
    }

    let processed = 0;
    let failed = 0;

    try {
      for (const entry of entries) {
        try {
          await this.dispatchEntry(remote, entry);
          await this.deps.localStore.removeOutbox(entry.id);
          processed += 1;
        } catch (err: any) {
          failed += 1;
          const msg = err?.message || 'فشلت المزامنة';
          this.lastError = msg;
          await this.deps.localStore.updateOutboxAttempt(entry.id, msg);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }

    if (failed === 0) {
      this.lastError = undefined;
    }
    await this.refreshStatusFromOutbox();

    if (failed > 0 && this.isOnline() && typeof setTimeout === 'function') {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        void this.flushOutbox();
      }, 8000);
    }

    return { processed, failed };
  }

  private async dispatchEntry(
    remote: RemoteSyncStore,
    entry: OutboxEntry
  ): Promise<void> {
    if (entry.table === 'ideas') {
      if (entry.op === 'delete') {
        await remote.remove(entry.recordId);
      } else if (entry.payload) {
        await remote.put(entry.payload as Idea);
      }
      return;
    }

    if (entry.table === 'idea_prototypes' && entry.op === 'upsert' && entry.payload) {
      await remote.upsertPrototype(entry.payload as PrototypeRecord);
    }
  }

  async pullFromRemote(): Promise<void> {
    const remote = this.deps.getRemoteStore();
    if (!this.user || !remote || !this.isOnline()) return;

    try {
      const [remoteIdeas, remoteProtos, outbox] = await Promise.all([
        remote.list(),
        remote.listAllPrototypes(),
        this.deps.localStore.listOutbox(),
      ]);

      const pendingDeleteIds = new Set(
        outbox
          .filter((e) => e.table === 'ideas' && e.op === 'delete')
          .map((e) => e.recordId)
      );

      for (const rIdea of remoteIdeas) {
        if (pendingDeleteIds.has(rIdea.id)) continue;
        const localIdea = await this.deps.localStore.get(rIdea.id);
        const merged = localIdea ? mergeIdeaConflict(localIdea, rIdea) : rIdea;
        await this.deps.localStore.put(merged);
      }

      for (const rProto of remoteProtos) {
        if (pendingDeleteIds.has(rProto.idea_id)) continue;
        await this.deps.localStore.putPrototypeRecord(rProto);
      }

      const freshIdeas = await this.deps.localStore.list();
      this.deps.onIdeasUpdated?.(freshIdeas);
      this.lastError = undefined;
      await this.refreshStatusFromOutbox();
    } catch (err: any) {
      this.lastError = err?.message || 'تعذّر جلب التحديثات';
      await this.refreshStatusFromOutbox();
    }
  }

  async uploadLocalData(): Promise<{ ideasUploaded: number; prototypesUploaded: number }> {
    const remote = this.deps.getRemoteStore();
    if (!this.user || !remote) {
      throw new Error('سجّل الدخول أولاً لرفع بياناتك المحلية');
    }

    const [localIdeas, localProtos] = await Promise.all([
      this.deps.localStore.list(),
      this.deps.localStore.listAllPrototypes(),
    ]);

    let ideasUploaded = 0;
    for (const idea of localIdeas) {
      const existingRemote = await remote.get(idea.id);
      const toSend = existingRemote ? mergeIdeaConflict(idea, existingRemote) : idea;
      await remote.put(toSend);
      await this.deps.localStore.put(toSend);
      ideasUploaded += 1;
    }

    let prototypesUploaded = 0;
    for (const proto of localProtos) {
      await remote.upsertPrototype(proto);
      prototypesUploaded += 1;
    }

    const freshIdeas = await this.deps.localStore.list();
    this.deps.onIdeasUpdated?.(freshIdeas);
    await this.refreshStatusFromOutbox();
    return { ideasUploaded, prototypesUploaded };
  }

  startRealtime(): void {
    const client = this.deps.getSupabaseClient?.();
    if (!client || !this.user) return;
    this.stopRealtime();

    const uid = this.user.id;
    this.channel = client
      .channel(`sharara-sync-${uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ideas',
          filter: `user_id=eq.${uid}`,
        },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as any)?.id;
            if (oldId) {
              await this.deps.localStore.remove(oldId);
            }
          } else if (payload.new) {
            const incoming = rowToIdea(payload.new as IdeaRow);
            const local = await this.deps.localStore.get(incoming.id);
            const merged = local ? mergeIdeaConflict(local, incoming) : incoming;
            await this.deps.localStore.put(merged);
          }
          const fresh = await this.deps.localStore.list();
          this.deps.onIdeasUpdated?.(fresh);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'idea_prototypes',
          filter: `user_id=eq.${uid}`,
        },
        async (payload) => {
          if (payload.new) {
            const proto = rowToPrototype(payload.new as PrototypeRow);
            await this.deps.localStore.putPrototypeRecord(proto);
            this.deps.onPrototypeUpdated?.(proto.idea_id, proto.revision);
          }
        }
      )
      .subscribe();
  }

  stopRealtime(): void {
    if (this.channel) {
      const client = this.deps.getSupabaseClient?.();
      if (client) {
        void client.removeChannel(this.channel);
      }
      this.channel = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

export function createDefaultSyncManager(
  localStore: IndexedDBStore,
  onIdeasUpdated: (ideas: Idea[]) => void,
  onPrototypeUpdated?: (ideaId: string, revision: number) => void
): SyncManager {
  let currentUid: string | null = null;

  const manager = new SyncManager({
    localStore,
    getSupabaseClient: () => getSupabaseClient(),
    getRemoteStore: () => {
      const client = getSupabaseClient();
      if (!client || !currentUid) return null;
      return new SupabaseStore(client, () => currentUid);
    },
    onIdeasUpdated,
    onPrototypeUpdated,
  });

  const origSetUser = manager.setUser.bind(manager);
  manager.setUser = async (u) => {
    currentUid = u?.id || null;
    return origSetUser(u);
  };

  return manager;
}
