-- Remove dependent nights before the existing movie foreign key is checked.
CREATE TRIGGER party_movie_delete_plans BEFORE DELETE ON party_movies
BEGIN
  DELETE FROM party_plans WHERE party_id = OLD.party_id AND movie_id = OLD.id;
END;

CREATE TRIGGER party_movie_delete_revision AFTER DELETE ON party_movies
BEGIN
  UPDATE parties SET revision = revision + 1 WHERE id = OLD.party_id;
END;
