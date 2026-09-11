-- Secret submissions have no member reference or arbitrary metadata.
CREATE TABLE party_surprises (
  party_id TEXT NOT NULL REFERENCES parties(id),
  id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  title_key TEXT NOT NULL,
  year INTEGER CHECK (year IS NULL OR (typeof(year) = 'integer' AND year BETWEEN 1888 AND 2200)),
  revealed_at INTEGER CHECK (revealed_at IS NULL OR typeof(revealed_at) = 'integer'),
  PRIMARY KEY (party_id, id)
);
CREATE INDEX party_surprise_title_year ON party_surprises(party_id, title_key, year);
CREATE INDEX party_surprise_reveals ON party_surprises(party_id, revealed_at);

CREATE TRIGGER party_surprise_limit BEFORE INSERT ON party_surprises
WHEN NOT EXISTS (
  SELECT 1 FROM party_surprises WHERE party_id = NEW.party_id AND id = NEW.id
) AND (SELECT count(*) FROM party_surprises WHERE party_id = NEW.party_id) >= 200
BEGIN
  SELECT RAISE(ABORT, 'party_surprise_limit');
END;

CREATE TRIGGER party_surprise_insert_revision AFTER INSERT ON party_surprises
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
CREATE TRIGGER party_surprise_reveal_revision AFTER UPDATE OF revealed_at ON party_surprises
WHEN OLD.revealed_at IS NOT NEW.revealed_at
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
