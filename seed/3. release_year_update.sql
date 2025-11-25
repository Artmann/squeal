SELECT SETSEED(0.25);
WITH years AS (
	SELECT film_id, (2005 + 30 * (random()-0.5))::INTEGER AS release_year
	FROM   generate_series(1,1000) film_id)
UPDATE film
SET release_year = years.release_year
FROM years 
WHERE years.film_id = film.film_id;