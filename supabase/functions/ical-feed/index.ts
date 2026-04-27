/**
 * FRe:x Schedule — iCal ライブフィード
 * GET /functions/v1/ical-feed?token=USER_ICAL_TOKEN[&target=all]
 *
 * - target=self (default): ログインユーザー自身の予定 + 参加者として登録された予定
 * - target=all           : 全社員の予定（グループカレンダー用）
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVENT_TYPES: Record<string, string> = {
  'telework':      'テレワーク',
  'tele-half':     'テレハーフ',
  'meeting':       '会議',
  'visitor':       '来客',
  'out':           '外出',
  'business-trip': '出張',
  'holiday':       '休み',
  'other':         'その他',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const url    = new URL(req.url)
  const token  = url.searchParams.get('token')
  const target = url.searchParams.get('target') || 'self'

  if (!token) {
    return new Response('token parameter is required', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // トークンからユーザーを特定
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('ical_token', token)
    .single()

  if (profileError || !profile) {
    return new Response('Invalid token', { status: 401 })
  }

  const userId = profile.id

  // 取得範囲: 過去1年〜未来1年
  const now       = new Date()
  const rangeStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString()
  const rangeEnd   = new Date(now.getFullYear() + 1, now.getMonth() + 1, 0).toISOString()

  // events.facility は TEXT カラム（FK ではない）。facilities テーブルへの JOIN は使わない。
  const EVENTS_SELECT = '*, profiles!events_user_id_fkey(name)'

  let events: Record<string, unknown>[] = []

  if (target === 'all') {
    // 全社員の予定
    const { data, error } = await supabase
      .from('events')
      .select(EVENTS_SELECT)
      .gte('start_datetime', rangeStart)
      .lte('start_datetime', rangeEnd)
      .order('start_datetime')
    if (error) {
      console.error('events query (all) error:', error)
      return new Response(`events query failed: ${error.message}`, { status: 500 })
    }
    events = data || []

  } else {
    // 自分の予定
    const { data: ownEvents, error: ownErr } = await supabase
      .from('events')
      .select(EVENTS_SELECT)
      .eq('user_id', userId)
      .gte('start_datetime', rangeStart)
      .lte('start_datetime', rangeEnd)
    if (ownErr) {
      console.error('events query (self) error:', ownErr)
      return new Response(`events query failed: ${ownErr.message}`, { status: 500 })
    }

    // 参加者として登録されている予定のID
    const { data: participantRows, error: partErr } = await supabase
      .from('event_participants')
      .select('event_id')
      .eq('user_id', userId)
    if (partErr) {
      console.error('event_participants query error:', partErr)
    }

    const participantIds = (participantRows || []).map((p: Record<string, unknown>) => p.event_id)

    let participantEvents: Record<string, unknown>[] = []
    if (participantIds.length > 0) {
      const { data, error: pevErr } = await supabase
        .from('events')
        .select(EVENTS_SELECT)
        .in('id', participantIds)
        .gte('start_datetime', rangeStart)
        .lte('start_datetime', rangeEnd)
      if (pevErr) console.error('participant events query error:', pevErr)
      participantEvents = data || []
    }

    // マージ & 重複除去
    const seen = new Set<string>()
    for (const ev of [...(ownEvents || []), ...participantEvents]) {
      const id = String((ev as Record<string, unknown>).id)
      if (!seen.has(id)) {
        seen.add(id)
        events.push(ev as Record<string, unknown>)
      }
    }
    events.sort((a, b) =>
      String(a.start_datetime).localeCompare(String(b.start_datetime))
    )
  }

  const ics = buildIcal(events, profile, target === 'all')

  return new Response(ics, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type':        'text/calendar; charset=utf-8',
      'Cache-Control':       'no-cache, no-store, must-revalidate',
      'Pragma':              'no-cache',
    },
  })
})

// ────────────────────────────────────────
// iCal 生成
// ────────────────────────────────────────

function buildIcal(
  events: Record<string, unknown>[],
  profile: { id: string; name: string },
  allUsers: boolean,
): string {
  const esc = (s: unknown) =>
    String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')

  const pad = (n: number) => String(n).padStart(2, '0')

  // JSTでの日時文字列を返す（タイムゾーン付き）
  const dtJst = (dtStr: string): string => {
    const d = new Date(dtStr)
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    return (
      `${jst.getUTCFullYear()}` +
      `${pad(jst.getUTCMonth() + 1)}` +
      `${pad(jst.getUTCDate())}T` +
      `${pad(jst.getUTCHours())}` +
      `${pad(jst.getUTCMinutes())}00`
    )
  }

  const dtDate = (dtStr: string): string => {
    const d = new Date(dtStr)
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    return (
      `${jst.getUTCFullYear()}` +
      `${pad(jst.getUTCMonth() + 1)}` +
      `${pad(jst.getUTCDate())}`
    )
  }

  const dtstamp = (() => {
    const now = new Date()
    return (
      `${now.getUTCFullYear()}` +
      `${pad(now.getUTCMonth() + 1)}` +
      `${pad(now.getUTCDate())}T` +
      `${pad(now.getUTCHours())}` +
      `${pad(now.getUTCMinutes())}` +
      `${pad(now.getUTCSeconds())}Z`
    )
  })()

  const calName = allUsers
    ? 'FRex Schedule（全社員）'
    : `FRex Schedule — ${profile.name}`

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FRex Design Inc.//FRex Schedule//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calName}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'X-WR-CALDESC:株式会社フレックスデザイン スケジュール',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]

  for (const ev of events) {
    const ownerProfile = (ev.profiles as Record<string, unknown>) || {}
    const ownerName    = String(ownerProfile.name || '')
    const facilityName = String(ev.facility || '')
    const typeLabel    = EVENT_TYPES[String(ev.type || '')] || 'その他'

    const summary = allUsers && ownerName
      ? `[${esc(ownerName)}] ${esc(ev.title)}`
      : esc(ev.title)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.id}@frex-schedule`)
    lines.push(`DTSTAMP:${dtstamp}`)

    if (ev.is_all_day) {
      // 終日: 翌日を DTEND にする（iCal 仕様）
      const endD  = new Date(String(ev.end_datetime))
      endD.setDate(endD.getDate() + 1)
      const endDt = new Date(endD.getTime() + 9 * 60 * 60 * 1000)
      const endStr =
        `${endDt.getUTCFullYear()}` +
        `${pad(endDt.getUTCMonth() + 1)}` +
        `${pad(endDt.getUTCDate())}`

      lines.push(`DTSTART;VALUE=DATE:${dtDate(String(ev.start_datetime))}`)
      lines.push(`DTEND;VALUE=DATE:${endStr}`)
    } else {
      lines.push(`DTSTART;TZID=Asia/Tokyo:${dtJst(String(ev.start_datetime))}`)
      lines.push(`DTEND;TZID=Asia/Tokyo:${dtJst(String(ev.end_datetime))}`)
    }

    lines.push(`SUMMARY:${summary}`)
    if (ev.memo)     lines.push(`DESCRIPTION:${esc(ev.memo)}`)
    if (facilityName) lines.push(`LOCATION:${esc(facilityName)}`)
    lines.push(`CATEGORIES:${typeLabel}`)
    lines.push('STATUS:CONFIRMED')
    lines.push('TRANSP:OPAQUE')
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
