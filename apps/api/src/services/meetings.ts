import type { Pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { UUID } from '../uuid.js';
import type { ActionItem, Decision, ExtractionStatus, MeetingDetail, MeetingSummary, Turn } from '../types.js';

interface MeetingRow {
  id: string;
  slug: string;
  title: string;
  source_filename: string;
  turn_count: number;
  duration_seconds: number;
  speakers: string[];
  extraction_status: ExtractionStatus;
  extraction_error: string | null;
  created_at: Date;
  meeting_date: string | null;
  decision_count: number;
  action_item_count: number;
}

const MEETING_COLS =
  `id, slug, title, source_filename, turn_count, duration_seconds, speakers, extraction_status, extraction_error, created_at,
   to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date,
   (SELECT count(*)::int FROM decisions d WHERE d.meeting_id = meetings.id) AS decision_count,
   (SELECT count(*)::int FROM action_items a WHERE a.meeting_id = meetings.id) AS action_item_count`;

const toSummary = (r: MeetingRow): MeetingSummary => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  sourceFilename: r.source_filename,
  turnCount: r.turn_count,
  durationSeconds: r.duration_seconds,
  speakers: r.speakers,
  extractionStatus: r.extraction_status,
  createdAt: r.created_at.toISOString(),
  meetingDate: r.meeting_date,
  decisionCount: r.decision_count,
  actionItemCount: r.action_item_count,
});

export async function listMeetings(pool: Pool): Promise<MeetingSummary[]> {
  const { rows } = await pool.query<MeetingRow>(`SELECT ${MEETING_COLS} FROM meetings ORDER BY created_at DESC, slug`);
  return rows.map(toSummary);
}

/** id is a uuid or a slug. Returns null when there is no such meeting. */
export async function getMeetingDetail(pool: Pool, idOrSlug: string): Promise<MeetingDetail | null> {
  const { rows } = await pool.query<MeetingRow>(
    `SELECT ${MEETING_COLS} FROM meetings WHERE ${UUID.test(idOrSlug) ? 'id' : 'slug'} = $1`,
    [idOrSlug],
  );
  const m = rows[0];
  if (!m) return null;

  const [turns, decisions, actions] = await Promise.all([
    pool.query<{ id: string; n: number; speaker: string; start_seconds: number; timestamp_label: string; text: string }>(
      'SELECT id, n, speaker, start_seconds, timestamp_label, text FROM turns WHERE meeting_id = $1 ORDER BY n',
      [m.id],
    ),
    pool.query<{ id: string; text: string; turn_id: string | null }>(
      'SELECT id, text, turn_id FROM decisions WHERE meeting_id = $1 ORDER BY position',
      [m.id],
    ),
    pool.query<{ id: string; text: string; owner: string | null; due: string | null; turn_id: string | null }>(
      'SELECT id, text, owner, due, turn_id FROM action_items WHERE meeting_id = $1 ORDER BY position',
      [m.id],
    ),
  ]);

  return {
    ...toSummary(m),
    extractionError: m.extraction_error,
    turns: turns.rows.map((t): Turn => ({
      id: t.id,
      meetingId: m.id,
      n: t.n,
      speaker: t.speaker,
      startSeconds: t.start_seconds,
      timestampLabel: t.timestamp_label,
      text: t.text,
    })),
    decisions: decisions.rows.map((d): Decision => ({ id: d.id, text: d.text, turnId: d.turn_id })),
    actionItems: actions.rows.map((a): ActionItem => ({
      id: a.id,
      text: a.text,
      owner: a.owner,
      due: a.due,
      turnId: a.turn_id,
    })),
  };
}

/** Accepts uuids or slugs and returns uuids. An unknown id is a 404 before any stream starts. */
export async function resolveMeetingIds(pool: Pool, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  const { rows } = await pool.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM meetings WHERE id::text = ANY($1) OR slug = ANY($1)',
    [unique],
  );
  const byKey = new Map<string, string>();
  for (const r of rows) {
    byKey.set(r.id, r.id);
    byKey.set(r.slug, r.id);
  }
  const resolved = new Set<string>();
  for (const id of unique) {
    const found = byKey.get(id);
    if (!found) throw new AppError('NOT_FOUND', `Meeting not found: ${id}`);
    resolved.add(found);
  }
  return [...resolved];
}
