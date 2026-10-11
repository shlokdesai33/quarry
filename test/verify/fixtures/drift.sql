create type user_status as enum ('active', 'suspended', 'banned');

create table users (
  id integer generated always as identity primary key,
  email varchar(320) not null,
  display_name text,
  age bigint,
  status user_status not null default 'active',
  tags text[] not null default '{}',
  created_at timestamptz,
  legacy_code text not null
);

create table orders (
  id bigint generated always as identity primary key,
  user_id integer not null,
  total numeric(12, 2) not null,
  search tsvector
);
