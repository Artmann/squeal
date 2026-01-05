-- Simplified Pagila Schema for SQLite
-- A subset of the movie rental database schema

-- Language table
CREATE TABLE IF NOT EXISTS language (
  language_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Actor table
CREATE TABLE IF NOT EXISTS actor (
  actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_actor_last_name ON actor(last_name);

-- Category table
CREATE TABLE IF NOT EXISTS category (
  category_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Film table
CREATE TABLE IF NOT EXISTS film (
  film_id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  release_year INTEGER,
  language_id INTEGER NOT NULL REFERENCES language(language_id),
  rental_duration INTEGER NOT NULL DEFAULT 3,
  rental_rate REAL NOT NULL DEFAULT 4.99,
  length INTEGER,
  replacement_cost REAL NOT NULL DEFAULT 19.99,
  rating TEXT DEFAULT 'G' CHECK (rating IN ('G', 'PG', 'PG-13', 'R', 'NC-17')),
  special_features TEXT,
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_film_title ON film(title);

-- Film-Actor junction table
CREATE TABLE IF NOT EXISTS film_actor (
  actor_id INTEGER NOT NULL REFERENCES actor(actor_id),
  film_id INTEGER NOT NULL REFERENCES film(film_id),
  last_update TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (actor_id, film_id)
);

CREATE INDEX idx_film_actor_film_id ON film_actor(film_id);

-- Film-Category junction table
CREATE TABLE IF NOT EXISTS film_category (
  film_id INTEGER NOT NULL REFERENCES film(film_id),
  category_id INTEGER NOT NULL REFERENCES category(category_id),
  last_update TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (film_id, category_id)
);

-- Country table
CREATE TABLE IF NOT EXISTS country (
  country_id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

-- City table
CREATE TABLE IF NOT EXISTS city (
  city_id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  country_id INTEGER NOT NULL REFERENCES country(country_id),
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_city_country_id ON city(country_id);

-- Address table
CREATE TABLE IF NOT EXISTS address (
  address_id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  address2 TEXT,
  district TEXT NOT NULL,
  city_id INTEGER NOT NULL REFERENCES city(city_id),
  postal_code TEXT,
  phone TEXT NOT NULL,
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_address_city_id ON address(city_id);

-- Customer table
CREATE TABLE IF NOT EXISTS customer (
  customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  address_id INTEGER NOT NULL REFERENCES address(address_id),
  active INTEGER NOT NULL DEFAULT 1,
  create_date TEXT NOT NULL DEFAULT (datetime('now')),
  last_update TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_customer_last_name ON customer(last_name);
CREATE INDEX idx_customer_address_id ON customer(address_id);
