create table if not exists public.health_check (
  id bigint generated always as identity primary key,
  status text not null default 'ok',
  created_at timestamptz not null default now()
);

alter table public.health_check enable row level security;

create policy "Allow public read of health_check"
  on public.health_check for select
  to anon
  using (true);

insert into public.health_check (status) values ('ok');
