import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Idea, PrototypeRecord } from '../core';
import {
  IndexedDBStore,
  RemoteSyncStore,
  SyncManager,
  ideaToRow,
  mergeIdeaConflict,
  prototypeToRow,
  rowToIdea,
  rowToPrototype,
} from './index';

let dbSeq = 0;

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 4,
    created: 1700000000000,
    updatedAt: 1700000005000,
    name: 'مستشعر طقس ESP32',
    domain: 'IoT',
    type: 'both',
    status: 'doing',
    lifecycle: 'prototype_generated',
    memory: 'تم اختيار DHT22 على GPIO4.',
    problem: 'رصد الحرارة',
    solution: 'ESP32 + DHT22',
    focus: 'aligned',
    focus_note: 'ضمن التخصص',
    skills: ['ESP32', 'C++'],
    duration: 'أسبوع',
    plan: [
      { step: 'شراء القطع', detail: 'ESP32', done: true },
      { step: 'توصيل الحساس', detail: 'GPIO4', done: false },
    ],
    plan_history: [],
    components: [{ name: 'DHT22', qty: 1, note: '3.3V' }],
    notes: 'ملاحظة',
    chat: [{ role: 'user', content: 'مرحباً' }],
    ...overrides,
  };
}

describe('Supabase mapping, conflict merge, and outbox sync (S9)', () => {
  let localStore: IndexedDBStore;

  beforeEach(() => {
    dbSeq += 1;
    localStore = new IndexedDBStore(`sharara-sync-test-${dbSeq}`);
  });

  afterEach(async () => {
    await localStore.close();
    vi.useRealTimers();
  });

  it('converts Idea <-> IdeaRow and PrototypeRecord <-> PrototypeRow losslessly', () => {
    const idea = makeIdea();
    const row = ideaToRow(idea, 'user-123');
    expect(row.user_id).toBe('user-123');
    expect(row.created_at).toBe(new Date(idea.created).toISOString());
    expect(row.updated_at).toBe(new Date(idea.updatedAt!).toISOString());
    expect(row.memory).toBe(idea.memory);
    expect(row.lifecycle).toBe('prototype_generated');

    const roundTripped = rowToIdea(row);
    expect(roundTripped.id).toBe(idea.id);
    expect(roundTripped.created).toBe(idea.created);
    expect(roundTripped.updatedAt).toBe(idea.updatedAt);
    expect(roundTripped.memory).toBe(idea.memory);
    expect(roundTripped.lifecycle).toBe('prototype_generated');
    expect(roundTripped.plan).toEqual(idea.plan);

    const proto: PrototypeRecord = {
      id: '22222222-2222-4222-8222-222222222222',
      idea_id: idea.id,
      revision: 2,
      schema_version: 1,
      created_at: 1700000010000,
      change_summary: 'نقل LED إلى GPIO19',
      data: {
        schema_version: 1,
        board: { fqbn: 'esp32:esp32:esp32', ota: true },
        wiring: [{ part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO19' }],
        firmware: {
          files: [{ name: 'main.ino', content: 'void setup(){}' }],
          libraries: [],
        },
        dashboard: [],
        simulation: { interval_ms: 1000, frames: [] },
        warnings: [],
      },
    };

    const pRow = prototypeToRow(proto, 'user-123');
    expect(pRow.revision).toBe(2);
    expect(pRow.change_summary).toBe('نقل LED إلى GPIO19');
    const pBack = rowToPrototype(pRow);
    expect(pBack).toEqual(proto);
  });

  it('resolves conflicts by newest updatedAt while merging plan step done flags', () => {
    const phoneOlder = makeIdea({
      updatedAt: 1000,
      notes: 'ملاحظة الهاتف',
      plan: [
        { step: 'شراء القطع', detail: 'ESP32', done: true },
        { step: 'توصيل الحساس', detail: 'GPIO4', done: false },
      ],
    });

    const desktopNewer = makeIdea({
      updatedAt: 2000,
      notes: 'ملاحظة الحاسوب الأحدث',
      plan: [
        { step: 'شراء القطع', detail: 'ESP32', done: false },
        { step: 'توصيل الحساس', detail: 'GPIO4', done: true },
      ],
    });

    const merged = mergeIdeaConflict(phoneOlder, desktopNewer);
    expect(merged.notes).toBe('ملاحظة الحاسوب الأحدث');
    expect(merged.updatedAt).toBe(2000);
    // Both steps stay done after merge
    expect(merged.plan).toEqual([
      { step: 'شراء القطع', detail: 'ESP32', done: true },
      { step: 'توصيل الحساس', detail: 'GPIO4', done: true },
    ]);
  });

  it('queues edits offline in outbox, retries failures, and flushes when online', async () => {
    let online = false;
    let shouldFailRemote = true;
    const remoteIdeas = new Map<string, Idea>();
    const remoteProtos = new Map<string, PrototypeRecord>();

    const mockRemote: RemoteSyncStore = {
      list: async () => Array.from(remoteIdeas.values()),
      get: async (id) => remoteIdeas.get(id),
      put: async (item) => {
        if (shouldFailRemote) throw new Error('network timeout');
        remoteIdeas.set(item.id, item);
      },
      remove: async (id) => {
        if (shouldFailRemote) throw new Error('network timeout');
        remoteIdeas.delete(id);
      },
      listAllPrototypes: async () => Array.from(remoteProtos.values()),
      upsertPrototype: async (rec) => {
        if (shouldFailRemote) throw new Error('network timeout');
        remoteProtos.set(rec.id, rec);
      },
    };

    const sync = new SyncManager({
      localStore,
      getRemoteStore: () => mockRemote,
      isOnline: () => online,
    });

    await sync.setUser({ id: 'u1', email: 'me@example.com' });

    const idea1 = makeIdea({ notes: 'مسودة أولى' });
    await localStore.put(idea1);
    await sync.enqueueIdeaUpsert(idea1);

    // Coalesce second edit on the same idea while still offline
    const idea1Updated = { ...idea1, notes: 'تعديل أوفلاين' };
    await localStore.put(idea1Updated);
    await sync.enqueueIdeaUpsert(idea1Updated);

    expect(sync.getSnapshot().status).toBe('offline');
    expect(sync.getSnapshot().pendingCount).toBe(1);
    expect((await localStore.listOutbox())).toHaveLength(1);

    // Come back online, first flush fails -> entry stays in outbox with attempts=1
    online = true;
    const failedRun = await sync.flushOutbox();
    expect(failedRun).toEqual({ processed: 0, failed: 1 });
    expect(sync.getSnapshot().status).toBe('error');
    const outboxAfterFail = await localStore.listOutbox();
    expect(outboxAfterFail).toHaveLength(1);
    expect(outboxAfterFail[0].attempts).toBe(1);
    expect(outboxAfterFail[0].lastError).toBe('network timeout');

    // Retry succeeds -> outbox empties and status becomes synced
    shouldFailRemote = false;
    const okRun = await sync.flushOutbox();
    expect(okRun).toEqual({ processed: 1, failed: 0 });
    expect(sync.getSnapshot().status).toBe('synced');
    expect(sync.getSnapshot().pendingCount).toBe(0);
    expect(remoteIdeas.get(idea1.id)?.notes).toBe('تعديل أوفلاين');

    sync.stopRealtime();
  });

  it('uploads local IndexedDB ideas and prototypes without deleting local copies', async () => {
    const remoteIdeas = new Map<string, Idea>();
    const remoteProtos = new Map<string, PrototypeRecord>();

    const mockRemote: RemoteSyncStore = {
      list: async () => Array.from(remoteIdeas.values()),
      get: async (id) => remoteIdeas.get(id),
      put: async (item) => {
        remoteIdeas.set(item.id, item);
      },
      remove: async (id) => {
        remoteIdeas.delete(id);
      },
      listAllPrototypes: async () => Array.from(remoteProtos.values()),
      upsertPrototype: async (rec) => {
        remoteProtos.set(rec.id, rec);
      },
    };

    const localIdea = makeIdea();
    await localStore.put(localIdea);
    await localStore.savePrototypeRevision(localIdea.id, {
      schema_version: 1,
      board: { fqbn: 'esp32:esp32:esp32', ota: true },
      wiring: [],
      firmware: { files: [{ name: 'main.ino', content: 'void setup(){}' }], libraries: [] },
      dashboard: [],
      simulation: { interval_ms: 1000, frames: [] },
      warnings: [],
    });

    const sync = new SyncManager({
      localStore,
      getRemoteStore: () => mockRemote,
      isOnline: () => true,
    });
    await sync.setUser({ id: 'u1', email: 'me@example.com' });

    const res = await sync.uploadLocalData();
    expect(res).toEqual({ ideasUploaded: 1, prototypesUploaded: 1 });
    expect(remoteIdeas.size).toBe(1);
    expect(remoteProtos.size).toBe(1);
    // Local copies remain untouched
    expect(await localStore.list()).toHaveLength(1);
    expect(await localStore.listPrototypes(localIdea.id)).toHaveLength(1);
  });
});
