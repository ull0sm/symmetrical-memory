/**
 * Serializers bridging Drizzle database models to frontend components.
 * Provides both camelCase and snake_case properties to ensure 100% compatibility
 * across all existing UI components without regressions.
 */

export function serializeTournament(t: any) {
  if (!t) return null;
  return {
    ...t,
    id: t.id,
    admin_id: t.adminId,
    name: t.name,
    event_date: t.eventDate ? String(t.eventDate) : null,
    eventDate: t.eventDate ? String(t.eventDate) : null,
    venue: t.venue,
    city: t.city,
    status: t.status,
    organiser_code: t.organiserCode,
    stager_codes: t.stagerCodes || [],
    show_public_draws: t.showPublicDraws ?? true,
    show_public_scoreboard: t.showPublicScoreboard ?? false,
    default_bronze_medals: t.defaultBronzeMedals ?? 2,
    created_at: t.createdAt ? new Date(t.createdAt).toISOString() : null,
    updated_at: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
  };
}

export function serializeRing(r: any) {
  if (!r) return null;
  return {
    ...r,
    id: r.id,
    tournament_id: r.tournamentId,
    name: r.name,
    ring_order: r.ringOrder,
    access_code: r.accessCode,
    timer_status: r.timerStatus || 'idle',
    timer_started_at: r.timerStartedAt ? new Date(r.timerStartedAt).toISOString() : null,
    timer_paused_at: r.timerPausedAt ? new Date(r.timerPausedAt).toISOString() : null,
    timer_accumulated_seconds: r.timerAccumulatedSeconds ?? 0,
    timer_duration_ms: r.timerDurationMs ?? 180000,
    timer_accumulated_ms: r.timerAccumulatedMs ?? 0,
    sides_swapped: r.sidesSwapped ?? false,
    current_match_id: r.currentMatchId ?? null,
    match_duration_seconds: r.matchDurationSeconds ?? 180,
    mat_name: r.matName ?? null,
    judge_pin: r.judgePin ?? "1234",
    judgePin: r.judgePin ?? "1234",
  };
}

export function serializeCategory(c: any) {
  if (!c) return null;
  return {
    ...c,
    id: c.id,
    tournament_id: c.tournamentId,
    name: c.name,
    gender: c.gender,
    discipline: c.discipline || (c.eventType === 'kata' ? 'KATA' : 'KUMITE'),
    event_type: c.eventType || 'kumite',
    eventType: c.eventType || 'kumite',
    kata_format: c.kataFormat || 'GROUP_POOLS',
    kataFormat: c.kataFormat || 'GROUP_POOLS',
    kata_scoring_mode: c.kataScoringMode || 'FLAG',
    kataScoringMode: c.kataScoringMode || 'FLAG',
    pool_size: c.poolSize ?? 8,
    poolSize: c.poolSize ?? 8,
    advance_per_pool: c.advancePerPool ?? 2,
    advancePerPool: c.advancePerPool ?? 2,
    age_category: c.ageCategory,
    weight_category: c.weightCategory,
    sub_category: c.subCategory,
    status: c.status,
    athletes_count: c.athletesCount ?? 0,
    expected_matches: c.expectedMatches ?? 0,
    doc_url: c.docUrl,
    custom_rules: c.customRules,
    bronze_medals: c.bronzeMedals ?? c.bronze_medals ?? null,
    draw_state: c.drawState ?? c.draw_state ?? null,
    is_locked: (c.drawState ?? c.draw_state) === "LOCKED",
    confirmed_matches: c.confirmedMatches ?? c.confirmed_matches ?? 0,
    live_matches: c.liveMatches ?? c.live_matches ?? 0,
    has_draw: c.hasDraw ?? c.has_draw ?? false,
    created_at: c.createdAt ? new Date(c.createdAt).toISOString() : null,
  };
}

export function serializeCategoryAssignment(a: any, category?: any) {
  if (!a) return null;
  const serializedCat = category ? serializeCategory(category) : a.categories ? serializeCategory(a.categories) : null;
  return {
    ...a,
    id: a.id,
    ring_id: a.ringId,
    category_id: a.categoryId,
    queue_order: a.queueOrder,
    status: a.status,
    matches_completed: a.matchesCompleted ?? 0,
    allocated_at: a.allocatedAt ? new Date(a.allocatedAt).toISOString() : null,
    completed_at: a.completedAt ? new Date(a.completedAt).toISOString() : null,
    paused_at: a.pausedAt ? new Date(a.pausedAt).toISOString() : null,
    pause_duration_seconds: a.pauseDurationSeconds ?? 0,
    categories: serializedCat,
  };
}

export function serializeModRequest(mr: any, ring?: any) {
  if (!mr) return null;
  return {
    ...mr,
    id: mr.id,
    ring_id: mr.ringId,
    tournament_id: mr.tournamentId,
    status: mr.status,
    device_info: mr.deviceInfo,
    moderator_name: mr.moderatorName,
    created_at: mr.createdAt ? new Date(mr.createdAt).toISOString() : null,
    updated_at: mr.updatedAt ? new Date(mr.updatedAt).toISOString() : null,
    rings: ring ? { name: ring.name } : mr.ring ? { name: mr.ring.name } : undefined,
  };
}

export function serializeEventLog(el: any) {
  if (!el) return null;
  return {
    ...el,
    id: el.id,
    tournament_id: el.tournamentId,
    ring_id: el.ringId,
    category_id: el.categoryId,
    action: el.action,
    metadata: el.metadata,
    created_at: el.createdAt ? new Date(el.createdAt).toISOString() : null,
  };
}

export function serializeAthlete(a: any, categoryName?: string | null) {
  if (!a) return null;
  return {
    ...a,
    id: a.id,
    tournament_id: a.tournamentId,
    category_id: a.categoryId,
    name: a.name,
    school: a.school,
    dojo: a.dojo,
    belt: a.belt,
    weight: a.weight,
    gender: a.gender,
    chest_number: a.chestNumber,
    chestNumber: a.chestNumber,
    seed: a.seed,
    created_at: a.createdAt ? new Date(a.createdAt).toISOString() : null,
    updated_at: a.updatedAt ? new Date(a.updatedAt).toISOString() : null,
    categories: categoryName ? { name: categoryName } : a.category ? { name: a.category.name } : undefined,
  };
}

export function serializeOrganiserRequest(or: any) {
  if (!or) return null;
  return {
    ...or,
    id: or.id,
    tournament_id: or.tournamentId || or.tournament_id,
    access_code_used: or.accessCodeUsed || or.access_code_used,
    status: or.status,
    session_token: or.sessionToken || or.session_token,
    device_info: or.deviceInfo || or.device_info,
    organiser_name: or.organiserName || or.organiser_name,
    expires_at: or.expiresAt ? new Date(or.expiresAt).toISOString() : (or.expires_at || null),
    created_at: or.createdAt ? new Date(or.createdAt).toISOString() : (or.created_at || null),
    updated_at: or.updatedAt ? new Date(or.updatedAt).toISOString() : (or.updated_at || null),
  };
}

export function serializeStagerRequest(sr: any) {
  if (!sr) return null;
  return {
    ...sr,
    id: sr.id,
    tournament_id: sr.tournamentId || sr.tournament_id,
    access_code_used: sr.accessCodeUsed || sr.access_code_used,
    stager_name: sr.stagerName || sr.stager_name,
    status: sr.status,
    session_token: sr.sessionToken || sr.session_token,
    device_info: sr.deviceInfo || sr.device_info,
    expires_at: sr.expiresAt ? new Date(sr.expiresAt).toISOString() : (sr.expires_at || null),
    created_at: sr.createdAt ? new Date(sr.createdAt).toISOString() : (sr.created_at || null),
    updated_at: sr.updatedAt ? new Date(sr.updatedAt).toISOString() : (sr.updated_at || null),
  };
}

export function serializeMatch(m: any) {
  if (!m) return null;
  return {
    ...m,
    id: m.id,
    category_id: m.categoryId || m.category_id,
    match_no: m.matchNo ?? m.match_no,
    round_no: m.roundNo ?? m.round_no,
    round_name: m.roundName || m.round_name,
    bracket_type: m.bracketType || m.bracket_type || 'MAIN',
    status: m.status,
    winner_id: m.winnerId || m.winner_id,
    aka_score: m.akaScore ?? m.aka_score ?? 0,
    ao_score: m.aoScore ?? m.ao_score ?? 0,
    aka_penalties: m.akaPenalties ?? m.aka_penalties ?? 0,
    ao_penalties: m.aoPenalties ?? m.ao_penalties ?? 0,
    senshu: m.senshu,
    winner_side: m.winnerSide || m.winner_side,
    decision_method: m.decisionMethod || m.decision_method,
    kata_scoring_mode: m.kataScoringMode || m.kata_scoring_mode || 'FLAG',
    pool_group: m.poolGroup || m.pool_group,
    aka_kata_name: m.akaKataName || m.aka_kata_name,
    ao_kata_name: m.aoKataName || m.ao_kata_name,
    aka_flags: m.akaFlags ?? m.aka_flags ?? 0,
    ao_flags: m.aoFlags ?? m.ao_flags ?? 0,
    aka_score_total: m.akaScoreTotal ? String(m.akaScoreTotal) : (m.aka_score_total ? String(m.aka_score_total) : null),
    ao_score_total: m.aoScoreTotal ? String(m.aoScoreTotal) : (m.ao_score_total ? String(m.ao_score_total) : null),
  };
}

export function serializeKataScore(ks: any) {
  if (!ks) return null;
  return {
    ...ks,
    id: ks.id,
    match_id: ks.matchId || ks.match_id,
    athlete_id: ks.athleteId || ks.athlete_id,
    target_side: ks.targetSide || ks.target_side,
    judge_seat: ks.judgeSeat ?? ks.judge_seat,
    score_type: ks.scoreType || ks.score_type,
    flag_vote: ks.flagVote || ks.flag_vote,
    numeric_score: ks.numericScore ? Number(ks.numericScore) : (ks.numeric_score ? Number(ks.numeric_score) : null),
    is_dropped: ks.isDropped ?? ks.is_dropped ?? false,
    is_overridden: ks.isOverridden ?? ks.is_overridden ?? false,
    created_at: ks.createdAt ? new Date(ks.createdAt).toISOString() : null,
  };
}


