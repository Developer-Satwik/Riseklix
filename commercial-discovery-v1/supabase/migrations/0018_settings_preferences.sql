alter table public.profiles
  add column if not exists default_market text not null default 'India',
  add column if not exists default_analysis_mode text not null default 'autopilot',
  add column if not exists default_primary_language text not null default 'English';

alter table public.profiles
  drop constraint if exists profiles_default_analysis_mode_check,
  add constraint profiles_default_analysis_mode_check
    check (default_analysis_mode in ('manual', 'autopilot'));

alter table public.profiles
  drop constraint if exists profiles_default_primary_language_check,
  add constraint profiles_default_primary_language_check
    check (default_primary_language in ('English', 'Hindi', 'Hinglish'));

alter table public.profiles
  drop constraint if exists profiles_default_market_check,
  add constraint profiles_default_market_check
    check (default_market in ('India', 'United States', 'United Kingdom', 'UAE', 'Singapore', 'Australia'));
