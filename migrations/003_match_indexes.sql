CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at);
CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id, id);
