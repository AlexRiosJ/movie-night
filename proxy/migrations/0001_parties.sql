PRAGMA foreign_keys = ON;

CREATE TABLE parties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  invite_hash TEXT NOT NULL UNIQUE CHECK (length(invite_hash) = 64),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE party_members (
  party_id TEXT NOT NULL REFERENCES parties(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  role TEXT NOT NULL CHECK (role IN ('host', 'member')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  PRIMARY KEY (party_id, id)
);
CREATE UNIQUE INDEX party_one_host ON party_members(party_id) WHERE role = 'host';

CREATE TABLE party_movies (
  party_id TEXT NOT NULL REFERENCES parties(id),
  id TEXT NOT NULL,
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  custom_title TEXT,
  added_by TEXT NOT NULL,
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  PRIMARY KEY (party_id, id),
  UNIQUE (party_id, custom_title),
  FOREIGN KEY (party_id, added_by) REFERENCES party_members(party_id, id)
);

CREATE TABLE party_plans (
  party_id TEXT NOT NULL REFERENCES parties(id),
  id TEXT NOT NULL,
  movie_id TEXT NOT NULL,
  food_id TEXT NOT NULL CHECK (food_id IN
    ('pizza', 'popcorn', 'pasta', 'snacks', 'nachos', 'burgers', 'hot-chocolate', 'sandwiches')),
  date TEXT NOT NULL,
  place TEXT NOT NULL CHECK (length(place) BETWEEN 1 AND 120),
  place_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  PRIMARY KEY (party_id, id),
  UNIQUE (party_id, movie_id, food_id, date, place_key),
  FOREIGN KEY (party_id, movie_id) REFERENCES party_movies(party_id, id),
  FOREIGN KEY (party_id, created_by) REFERENCES party_members(party_id, id)
);

-- Limits are enforced inside the write transaction, including simultaneous requests.
-- Existing IDs remain retryable even when a list is full.
CREATE TRIGGER party_member_limit BEFORE INSERT ON party_members
WHEN (SELECT count(*) FROM party_members WHERE party_id = NEW.party_id) >= 50
BEGIN
  SELECT RAISE(ABORT, 'party_member_limit');
END;
CREATE TRIGGER party_movie_limit BEFORE INSERT ON party_movies
WHEN NOT EXISTS (SELECT 1 FROM party_movies WHERE party_id = NEW.party_id AND id = NEW.id)
  AND (SELECT count(*) FROM party_movies WHERE party_id = NEW.party_id) >= 200
BEGIN
  SELECT RAISE(ABORT, 'party_movie_limit');
END;
CREATE TRIGGER party_plan_limit BEFORE INSERT ON party_plans
WHEN NOT EXISTS (SELECT 1 FROM party_plans WHERE party_id = NEW.party_id AND id = NEW.id)
  AND (SELECT count(*) FROM party_plans WHERE party_id = NEW.party_id) >= 500
BEGIN
  SELECT RAISE(ABORT, 'party_plan_limit');
END;

-- Revision changes and the affected rows commit together, never as separate requests.
CREATE TRIGGER party_member_revision AFTER INSERT ON party_members
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
CREATE TRIGGER party_movie_insert_revision AFTER INSERT ON party_movies
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
CREATE TRIGGER party_movie_update_revision AFTER UPDATE ON party_movies
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
CREATE TRIGGER party_plan_insert_revision AFTER INSERT ON party_plans
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
CREATE TRIGGER party_plan_update_revision AFTER UPDATE ON party_plans
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = NEW.party_id;
END;
CREATE TRIGGER party_plan_delete_revision AFTER DELETE ON party_plans
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = OLD.party_id;
END;
