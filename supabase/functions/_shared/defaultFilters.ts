/** Default search_filters JSON — industry-neutral; profile + recommend-filters refine. */
export const DEFAULT_SEARCH_FILTERS = {
  include_titles: [
    'Hiring Manager',
    'Team Lead',
    'Director',
    'Manager',
  ],
  exclude_titles: [
    'Recruiter',
    'Talent Acquisition',
    'People Ops',
    'HR',
    'Sourcer',
    'Staffing',
  ],
  locations: [] as string[],
  company_size_min: null as number | null,
  company_size_max: null as number | null,
  seniority: [] as string[],
  require_verified_email: false,
  accept_accept_all: true,
  enable_hunter: false,
  enable_apollo: false,
  enable_tomba: false,
  enable_smtp_verify: false,
}
