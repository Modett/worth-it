-- Runs once when the docker-compose Postgres volume is first created.
-- Keeps e2e tests on a separate database from local development data.
CREATE DATABASE worthit_test OWNER worthit;
