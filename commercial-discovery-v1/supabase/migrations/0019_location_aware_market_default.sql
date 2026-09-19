alter table public.profiles
  alter column default_market set default 'Global';

alter table public.profiles
  drop constraint if exists profiles_default_market_check,
  add constraint profiles_default_market_check
    check (default_market in ('Global', 'India', 'United States', 'United Kingdom', 'UAE', 'Singapore', 'Australia'));
