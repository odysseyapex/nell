import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Audit logging.
 *
 * Records who did what to which entity. Deliberately never records client
 * journal content — the point is accountability for actions, not a second copy
 * of sensitive reflection.
 *
 * Writes go through the service-role client so a failed audit write can never
 * be caused by (or mask) an RLS problem, and failures are swallowed: an audit
 * write must never break the user's action.
 */
export type AuditAction =
  | 'organization.created'
  | 'organization.updated'
  | 'branding.updated'
  | 'framework.published'
  | 'framework.updated'
  | 'exercise.created'
  | 'client.invited'
  | 'invitation.accepted'
  | 'coach.invited'
  | 'coach_note.created'
  | 'experiment.created'
  | 'experiment.completed'
  | 'brief.generated'
  | 'alert.resolved'
  | 'pattern.dismissed'
  | 'reason_codes.updated'
  | 'ai_settings.updated'
  | 'subscription.changed';

export interface AuditEntry {
  organizationId: string | null;
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from('audit_logs').insert({
      organization_id: entry.organizationId,
      user_id: entry.userId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata_json: entry.metadata ?? {},
    });
  } catch (error) {
    console.error('[audit] failed to record entry', entry.action, error);
  }
}
