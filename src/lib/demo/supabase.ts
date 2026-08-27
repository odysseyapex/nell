import 'server-only';

import { randomUUID } from 'node:crypto';

import { type Row, type Tables, demoTables, rebuildFacts } from './dataset';

/**
 * A minimal in-memory stand-in for the Supabase client.
 *
 * Development harness only — reachable exclusively when NELL_DEMO_MODE=1. It
 * implements just enough of the PostgREST query builder for this application's
 * queries, so every page, server action and engine runs completely unmodified
 * against in-memory rows.
 *
 * It also emulates the two database behaviours the app depends on, because
 * without them the demo would show numbers the real system would never
 * produce:
 *
 *   - the commitment_facts view, rebuilt after any write that feeds it
 *   - the trigger that moves commitments.status in step with a check-in
 *
 * Row Level Security is emulated too, and deliberately: a client signed into
 * the demo genuinely cannot read another client's rows, or any coach-private
 * table, through this client.
 */

type Filter = (row: Row) => boolean;

/** Tables a client has no policy on at all, mirroring 0006_rls.sql. */
const COACH_PRIVATE = new Set([
  'coach_alerts',
  'client_status_snapshots',
  'coaching_briefs',
  'coach_notes',
  'audit_logs',
  'ai_usage_events',
  'invitations',
  'organization_ai_settings',
]);

/** Embedded selects used by the app, resolved by hand. */
const RELATIONS: Record<string, { table: string; localKey: string }> = {
  'exercise_assignments.exercise': { table: 'exercises', localKey: 'exercise_id' },
  'coach_client_assignments.coach': { table: 'profiles', localKey: 'coach_id' },
};

export interface DemoViewer {
  profileId: string;
  role: string;
  organizationId: string;
}

interface Result<T> {
  data: T;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

class DemoQuery<T = Row[]> implements PromiseLike<Result<T>> {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row[] = [];
  private conflictKeys: string[] = [];
  private columns = '*';
  private wantsProjection = false;
  private orderKey: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private rowMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private countMode: 'exact' | null = null;
  private headOnly = false;

  constructor(
    private tables: Tables,
    private table: string,
    private viewer: DemoViewer | null,
  ) {}

  // --- builder ------------------------------------------------------------

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }) {
    this.columns = columns;
    this.wantsProjection = true;
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row) {
    this.mode = 'update';
    this.payload = [patch];
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictKeys = (options?.onConflict ?? 'id').split(',').map((key) => key.trim());
    return this;
  }

  delete() {
    this.mode = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]) {
    const set = new Set(values);
    this.filters.push((row) => set.has(row[column]));
    return this;
  }

  gte(column: string, value: string | number) {
    this.filters.push((row) => (row[column] as string | number) >= value);
    return this;
  }

  lte(column: string, value: string | number) {
    this.filters.push((row) => (row[column] as string | number) <= value);
    return this;
  }

  lt(column: string, value: string | number) {
    this.filters.push((row) => (row[column] as string | number) < value);
    return this;
  }

  gt(column: string, value: string | number) {
    this.filters.push((row) => (row[column] as string | number) > value);
    return this;
  }

  is(column: string, value: null | boolean) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderKey = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single<R = Row>() {
    this.rowMode = 'single';
    return this as unknown as DemoQuery<R>;
  }

  maybeSingle<R = Row>() {
    this.rowMode = 'maybeSingle';
    return this as unknown as DemoQuery<R | null>;
  }

  // --- execution ----------------------------------------------------------

  then<TResult1 = Result<T>, TResult2 = never>(
    onfulfilled?: ((value: Result<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  /**
   * The RLS emulation. A client sees only their own rows and nothing from a
   * coach-private table; staff see their whole organization.
   */
  private scope(rows: Row[]): Row[] {
    const viewer = this.viewer;
    if (!viewer) return [];
    if (viewer.role === 'service_role') return rows;

    if (viewer.role === 'client') {
      if (COACH_PRIVATE.has(this.table)) return [];
      // client_preferences, client_insights and client_experiments are the
      // client's own rows, so the generic client_id filter below covers them.
      if (this.table === 'patterns') {
        return rows.filter((row) => row.client_id === viewer.profileId && row.status === 'active');
      }
      if (this.table === 'exercise_responses') {
        const entryIds = new Set(
          (this.tables.exercise_entries ?? [])
            .filter((entry) => entry.client_id === viewer.profileId)
            .map((entry) => entry.id),
        );
        return rows.filter((row) => entryIds.has(row.entry_id));
      }
      if (rows.length > 0 && 'client_id' in rows[0]) {
        return rows.filter((row) => row.client_id === viewer.profileId);
      }
    }

    if ('organization_id' in (rows[0] ?? {})) {
      return rows.filter((row) => row.organization_id === viewer.organizationId);
    }
    if (this.table === 'organizations') {
      return rows.filter((row) => row.id === viewer.organizationId);
    }
    return rows;
  }

  private matching(): Row[] {
    const all = this.tables[this.table] ?? [];
    return this.scope(all).filter((row) => this.filters.every((filter) => filter(row)));
  }

  private project(rows: Row[]): Row[] {
    if (!this.wantsProjection || this.columns === '*' || this.columns.trim() === '') return rows;

    // Split on top-level commas only, so embedded selects stay intact.
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of this.columns) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    if (current.trim()) parts.push(current.trim());
    if (parts.includes('*')) return rows;

    return rows.map((row) => {
      const projected: Row = {};
      for (const part of parts) {
        const embedded = part.match(/^(\w+):([\w!.]+)\((.*)\)$/);
        if (embedded) {
          const [, alias] = embedded;
          const relation = RELATIONS[`${this.table}.${alias}`];
          if (relation) {
            const target = (this.tables[relation.table] ?? []).find(
              (candidate) => candidate.id === row[relation.localKey],
            );
            // A to-one embed resolves to the row itself, matching PostgREST.
            projected[alias] = target ?? null;
          } else {
            projected[alias] = null;
          }
          continue;
        }
        projected[part] = row[part];
      }
      return projected;
    });
  }

  private run(): Result<T> {
    const table = (this.tables[this.table] ??= []);
    let affected: Row[] = [];

    if (this.mode === 'insert') {
      affected = this.payload.map((row) => ({ ...withDefaults(row) }));
      table.push(...affected);
    } else if (this.mode === 'update') {
      affected = this.matching();
      for (const row of affected) Object.assign(row, this.payload[0]);
    } else if (this.mode === 'upsert') {
      for (const incoming of this.payload) {
        const existing = table.find((row) =>
          this.conflictKeys.every((key) => row[key] === incoming[key]),
        );
        if (existing) {
          Object.assign(existing, incoming);
          affected.push(existing);
        } else {
          const created = withDefaults(incoming);
          table.push(created);
          affected.push(created);
        }
      }
    } else if (this.mode === 'delete') {
      affected = this.matching();
      const doomed = new Set(affected);
      this.tables[this.table] = table.filter((row) => !doomed.has(row));
    } else {
      affected = this.matching();
    }

    if (this.mode !== 'select') applySideEffects(this.tables, this.table, this.mode, affected);

    let rows = affected;

    if (this.mode === 'select') {
      if (this.orderKey) {
        const { column, ascending } = this.orderKey;
        rows = [...rows].sort((a, b) => {
          const left = a[column];
          const right = b[column];
          if (left === right) return 0;
          if (left === null || left === undefined) return 1;
          if (right === null || right === undefined) return -1;
          const comparison = left < right ? -1 : 1;
          return ascending ? comparison : -comparison;
        });
      }
      if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    }

    if (this.countMode) {
      return { data: (this.headOnly ? null : rows) as T, error: null, count: rows.length };
    }

    const projected = this.project(rows);

    if (this.rowMode === 'single') {
      if (projected.length === 0) {
        return { data: null as T, error: { message: 'No rows found', code: 'PGRST116' } };
      }
      return { data: projected[0] as T, error: null };
    }
    if (this.rowMode === 'maybeSingle') {
      return { data: (projected[0] ?? null) as T, error: null };
    }

    // A mutation with no .select() returns no rows, matching PostgREST.
    if (this.mode !== 'select' && !this.wantsProjection) {
      return { data: null as T, error: null };
    }
    return { data: projected as T, error: null };
  }
}

function withDefaults(row: Row): Row {
  const now = new Date().toISOString();
  return {
    id: row.id ?? randomUUID(),
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
    ...row,
  };
}

/**
 * The database behaviours the application relies on. Without these the demo
 * would show follow-through numbers the real system could never produce.
 */
function applySideEffects(tables: Tables, table: string, mode: string, affected: Row[]) {
  // The trigger in 0003_commitments.sql: a check-in sets its commitment's status.
  if (table === 'commitment_checkins' && (mode === 'insert' || mode === 'update')) {
    for (const checkin of affected) {
      const commitment = tables.commitments.find((row) => row.id === checkin.commitment_id);
      if (!commitment) continue;
      commitment.status =
        checkin.outcome === 'completed'
          ? 'completed'
          : checkin.outcome === 'missed'
            ? 'missed'
            : 'changed';
    }
  }

  if (['commitments', 'commitment_checkins', 'reason_codes'].includes(table)) {
    rebuildFacts(tables);
  }
}

// ---------------------------------------------------------------------------

export interface DemoAuthAdapter {
  getAuthUserId: () => string | null;
  clearSession: () => void;
}

/** The object handed to application code in place of a Supabase client. */
export function createDemoClient(auth: DemoAuthAdapter) {
  const tables = demoTables();
  const authUserId = auth.getAuthUserId();

  const viewer: DemoViewer | null = authUserId
    ? (() => {
        const profile = tables.profiles.find((row) => row.auth_user_id === authUserId);
        if (!profile) return null;
        return {
          profileId: profile.id as string,
          role: profile.role as string,
          organizationId: profile.organization_id as string,
        };
      })()
    : null;

  return {
    from(table: string) {
      return new DemoQuery(tables, table, viewer);
    },
    rpc(_name: string, _args?: Record<string, unknown>) {
      // The only RPCs used are bootstrap helpers, already applied to the dataset.
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      async getUser() {
        return { data: { user: authUserId ? { id: authUserId } : null }, error: null };
      },
      async signOut() {
        auth.clearSession();
        return { error: null };
      },
      async signInWithPassword() {
        return {
          data: { user: null, session: null },
          error: { message: 'Demo mode does not use passwords. Choose a person on /demo.' },
        };
      },
      async signUp() {
        return {
          data: { user: null, session: null },
          error: { message: 'Demo mode is read-only for signup. Choose a person on /demo.' },
        };
      },
    },
  };
}

export function isDemoMode(): boolean {
  return process.env.NELL_DEMO_MODE === '1';
}

/**
 * The service-role equivalent for demo mode: the same in-memory tables with
 * scoping switched off, mirroring how the real admin client bypasses RLS.
 */
export function createDemoAdminClient() {
  const tables = demoTables();

  return {
    from(table: string) {
      return new DemoQuery(tables, table, { profileId: '', role: 'service_role', organizationId: '' });
    },
    rpc() {
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      admin: {
        async createUser() {
          return { data: { user: null }, error: { message: 'Not available in demo mode' } };
        },
        async deleteUser() {
          return { error: null };
        },
        async listUsers() {
          return { data: { users: [] }, error: null };
        },
      },
    },
  };
}
