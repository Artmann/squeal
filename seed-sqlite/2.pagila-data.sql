-- Sample data for SQLite Pagila database

-- Languages
INSERT INTO language (name) VALUES ('English');
INSERT INTO language (name) VALUES ('Italian');
INSERT INTO language (name) VALUES ('Japanese');
INSERT INTO language (name) VALUES ('Mandarin');
INSERT INTO language (name) VALUES ('French');
INSERT INTO language (name) VALUES ('German');

-- Categories
INSERT INTO category (name) VALUES ('Action');
INSERT INTO category (name) VALUES ('Animation');
INSERT INTO category (name) VALUES ('Children');
INSERT INTO category (name) VALUES ('Classics');
INSERT INTO category (name) VALUES ('Comedy');
INSERT INTO category (name) VALUES ('Documentary');
INSERT INTO category (name) VALUES ('Drama');
INSERT INTO category (name) VALUES ('Family');
INSERT INTO category (name) VALUES ('Foreign');
INSERT INTO category (name) VALUES ('Games');
INSERT INTO category (name) VALUES ('Horror');
INSERT INTO category (name) VALUES ('Music');
INSERT INTO category (name) VALUES ('New');
INSERT INTO category (name) VALUES ('Sci-Fi');
INSERT INTO category (name) VALUES ('Sports');
INSERT INTO category (name) VALUES ('Travel');

-- Actors
INSERT INTO actor (first_name, last_name) VALUES ('PENELOPE', 'GUINESS');
INSERT INTO actor (first_name, last_name) VALUES ('NICK', 'WAHLBERG');
INSERT INTO actor (first_name, last_name) VALUES ('ED', 'CHASE');
INSERT INTO actor (first_name, last_name) VALUES ('JENNIFER', 'DAVIS');
INSERT INTO actor (first_name, last_name) VALUES ('JOHNNY', 'LOLLOBRIGIDA');
INSERT INTO actor (first_name, last_name) VALUES ('BETTE', 'NICHOLSON');
INSERT INTO actor (first_name, last_name) VALUES ('GRACE', 'MOSTEL');
INSERT INTO actor (first_name, last_name) VALUES ('MATTHEW', 'JOHANSSON');
INSERT INTO actor (first_name, last_name) VALUES ('JOE', 'SWANK');
INSERT INTO actor (first_name, last_name) VALUES ('CHRISTIAN', 'GABLE');
INSERT INTO actor (first_name, last_name) VALUES ('ZERO', 'CAGE');
INSERT INTO actor (first_name, last_name) VALUES ('KARL', 'BERRY');
INSERT INTO actor (first_name, last_name) VALUES ('UMA', 'WOOD');
INSERT INTO actor (first_name, last_name) VALUES ('VIVIEN', 'BERGEN');
INSERT INTO actor (first_name, last_name) VALUES ('CUBA', 'OLIVIER');
INSERT INTO actor (first_name, last_name) VALUES ('FRED', 'COSTNER');
INSERT INTO actor (first_name, last_name) VALUES ('HELEN', 'VOIGHT');
INSERT INTO actor (first_name, last_name) VALUES ('DAN', 'TORN');
INSERT INTO actor (first_name, last_name) VALUES ('BOB', 'FAWCETT');
INSERT INTO actor (first_name, last_name) VALUES ('LUCILLE', 'TRACY');

-- Films
INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('ACADEMY DINOSAUR', 'A Epic Drama of a Feminist And a Mad Scientist who must Battle a Teacher in The Canadian Rockies', 2006, 1, 6, 0.99, 86, 20.99, 'PG', 'Deleted Scenes,Behind the Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('ACE GOLDFINGER', 'A Astounding Epistle of a Database Administrator And a Explorer who must Find a Car in Ancient China', 2006, 1, 3, 4.99, 48, 12.99, 'G', 'Trailers,Deleted Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('ADAPTATION HOLES', 'A Astounding Reflection of a Lumberjack And a Car who must Sink a Lumberjack in A Baloon Factory', 2006, 1, 7, 2.99, 50, 18.99, 'NC-17', 'Trailers,Deleted Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('AFFAIR PREJUDICE', 'A Fanciful Documentary of a Frisbee And a Lumberjack who must Chase a Monkey in A Shark Tank', 2006, 1, 5, 2.99, 117, 26.99, 'G', 'Commentaries,Behind the Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('AFRICAN EGG', 'A Fast-Paced Documentary of a Pastry Chef And a Dentist who must Pursue a Forensic Psychologist in The Gulf of Mexico', 2006, 1, 6, 2.99, 130, 22.99, 'G', 'Deleted Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('AGENT TRUMAN', 'A Intrepid Panorama of a Robot And a Boy who must Escape a Sumo Wrestler in Ancient China', 2006, 1, 3, 2.99, 169, 17.99, 'PG', 'Deleted Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('AIRPLANE SIERRA', 'A Touching Saga of a Hunter And a Butler who must Discover a Butler in A Jet Boat', 2006, 1, 6, 4.99, 62, 28.99, 'PG-13', 'Trailers,Deleted Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('AIRPORT POLLOCK', 'A Epic Tale of a Moose And a Girl who must Confront a Monkey in Ancient India', 2006, 1, 6, 4.99, 54, 15.99, 'R', 'Trailers');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('ALABAMA DEVIL', 'A Thoughtful Panorama of a Database Administrator And a Mad Scientist who must Outgun a Mad Scientist in A Jet Boat', 2006, 1, 3, 2.99, 114, 21.99, 'PG-13', 'Trailers,Deleted Scenes');

INSERT INTO film (title, description, release_year, language_id, rental_duration, rental_rate, length, replacement_cost, rating, special_features)
VALUES ('ALADDIN CALENDAR', 'A Action-Packed Tale of a Man And a Lumberjack who must Reach a Feminist in Ancient China', 2006, 1, 6, 4.99, 63, 24.99, 'NC-17', 'Trailers,Deleted Scenes');

-- Film-Actor relationships
INSERT INTO film_actor (actor_id, film_id) VALUES (1, 1);
INSERT INTO film_actor (actor_id, film_id) VALUES (10, 1);
INSERT INTO film_actor (actor_id, film_id) VALUES (2, 3);
INSERT INTO film_actor (actor_id, film_id) VALUES (5, 3);
INSERT INTO film_actor (actor_id, film_id) VALUES (8, 4);
INSERT INTO film_actor (actor_id, film_id) VALUES (9, 4);
INSERT INTO film_actor (actor_id, film_id) VALUES (3, 5);
INSERT INTO film_actor (actor_id, film_id) VALUES (7, 5);
INSERT INTO film_actor (actor_id, film_id) VALUES (4, 6);
INSERT INTO film_actor (actor_id, film_id) VALUES (6, 6);
INSERT INTO film_actor (actor_id, film_id) VALUES (11, 7);
INSERT INTO film_actor (actor_id, film_id) VALUES (12, 7);
INSERT INTO film_actor (actor_id, film_id) VALUES (13, 8);
INSERT INTO film_actor (actor_id, film_id) VALUES (14, 8);
INSERT INTO film_actor (actor_id, film_id) VALUES (15, 9);
INSERT INTO film_actor (actor_id, film_id) VALUES (16, 9);
INSERT INTO film_actor (actor_id, film_id) VALUES (17, 10);
INSERT INTO film_actor (actor_id, film_id) VALUES (18, 10);
INSERT INTO film_actor (actor_id, film_id) VALUES (19, 2);
INSERT INTO film_actor (actor_id, film_id) VALUES (20, 2);

-- Film-Category relationships
INSERT INTO film_category (film_id, category_id) VALUES (1, 6);
INSERT INTO film_category (film_id, category_id) VALUES (2, 11);
INSERT INTO film_category (film_id, category_id) VALUES (3, 6);
INSERT INTO film_category (film_id, category_id) VALUES (4, 11);
INSERT INTO film_category (film_id, category_id) VALUES (5, 8);
INSERT INTO film_category (film_id, category_id) VALUES (6, 9);
INSERT INTO film_category (film_id, category_id) VALUES (7, 5);
INSERT INTO film_category (film_id, category_id) VALUES (8, 11);
INSERT INTO film_category (film_id, category_id) VALUES (9, 11);
INSERT INTO film_category (film_id, category_id) VALUES (10, 15);

-- Countries
INSERT INTO country (country) VALUES ('United States');
INSERT INTO country (country) VALUES ('Canada');
INSERT INTO country (country) VALUES ('United Kingdom');
INSERT INTO country (country) VALUES ('Australia');
INSERT INTO country (country) VALUES ('Germany');

-- Cities
INSERT INTO city (city, country_id) VALUES ('New York', 1);
INSERT INTO city (city, country_id) VALUES ('Los Angeles', 1);
INSERT INTO city (city, country_id) VALUES ('Toronto', 2);
INSERT INTO city (city, country_id) VALUES ('London', 3);
INSERT INTO city (city, country_id) VALUES ('Sydney', 4);

-- Addresses
INSERT INTO address (address, district, city_id, postal_code, phone)
VALUES ('123 Main Street', 'Manhattan', 1, '10001', '555-1234');
INSERT INTO address (address, district, city_id, postal_code, phone)
VALUES ('456 Oak Avenue', 'Hollywood', 2, '90028', '555-5678');
INSERT INTO address (address, district, city_id, postal_code, phone)
VALUES ('789 Maple Road', 'Downtown', 3, 'M5V 3L9', '555-9012');
INSERT INTO address (address, district, city_id, postal_code, phone)
VALUES ('321 Pine Lane', 'Westminster', 4, 'SW1A 1AA', '555-3456');
INSERT INTO address (address, district, city_id, postal_code, phone)
VALUES ('654 Cedar Court', 'CBD', 5, '2000', '555-7890');

-- Customers
INSERT INTO customer (first_name, last_name, email, address_id, active)
VALUES ('MARY', 'SMITH', 'mary.smith@example.com', 1, 1);
INSERT INTO customer (first_name, last_name, email, address_id, active)
VALUES ('PATRICIA', 'JOHNSON', 'patricia.johnson@example.com', 2, 1);
INSERT INTO customer (first_name, last_name, email, address_id, active)
VALUES ('LINDA', 'WILLIAMS', 'linda.williams@example.com', 3, 1);
INSERT INTO customer (first_name, last_name, email, address_id, active)
VALUES ('BARBARA', 'JONES', 'barbara.jones@example.com', 4, 1);
INSERT INTO customer (first_name, last_name, email, address_id, active)
VALUES ('ELIZABETH', 'BROWN', 'elizabeth.brown@example.com', 5, 1);
