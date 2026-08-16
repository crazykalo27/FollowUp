export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type DraftStatus =
  | 'draft'
  | 'approved'
  | 'pending'
  | 'sent'
  | 'failed'
  | 'bounced'

export interface SearchProfileData {
  roles: string[]
  industries: string[]
  company_types?: string[]
  outreach_targets?: string[]
  skills: string[]
  locations: string[]
  seniority: string
  employment_types?: string[]
  remote_preference?: string
  /** large | medium | small | any */
  company_size?: string
  must_haves: string[]
  tone: string
  notes?: string
  roles_confirmed?: boolean
  /** Orientation question index 0–7 (7 = series done, awaiting save). */
  orientation_q?: number
}

export interface SearchFiltersData {
  include_titles: string[]
  exclude_titles: string[]
  locations: string[]
  company_size_min: number | null
  company_size_max: number | null
  seniority: string[]
  require_verified_email: boolean
  accept_accept_all: boolean
  /** Use Hunter.io for domain search + email find/verify (uses API credits). */
  enable_hunter?: boolean
  /** Use Apollo people/match for email enrichment before Hunter/OSINT. */
  enable_apollo?: boolean
  /** Use Tomba.io domain search + email finder (needs TOMBA_API_KEY + TOMBA_SECRET). */
  enable_tomba?: boolean
  /** SMTP RCPT probe via OSINT worker for live deliverability checks (no email sent). */
  enable_smtp_verify?: boolean
}

export const DEFAULT_FILTERS: SearchFiltersData = {
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
  locations: [],
  company_size_min: null,
  company_size_max: null,
  seniority: [],
  require_verified_email: false,
  accept_accept_all: true,
  enable_hunter: false,
  enable_apollo: false,
  enable_tomba: false,
  enable_smtp_verify: false,
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string | null
          full_name: string | null
          linkedin_url: string | null
          github_url: string | null
          portfolio_url: string | null
          website_url: string | null
          email_subject_template: string | null
          email_body_template: string | null
          email_templates: Json | null
          profile_setup_complete: boolean
          onboarding_complete: boolean
          orientation_step: string
          orientation_complete: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          full_name?: string | null
          linkedin_url?: string | null
          github_url?: string | null
          portfolio_url?: string | null
          website_url?: string | null
          email_subject_template?: string | null
          email_body_template?: string | null
          email_templates?: Json | null
          profile_setup_complete?: boolean
          onboarding_complete?: boolean
          orientation_step?: string
          orientation_complete?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          full_name?: string | null
          linkedin_url?: string | null
          github_url?: string | null
          portfolio_url?: string | null
          website_url?: string | null
          email_subject_template?: string | null
          email_body_template?: string | null
          email_templates?: Json | null
          profile_setup_complete?: boolean
          onboarding_complete?: boolean
          orientation_step?: string
          orientation_complete?: boolean
          updated_at?: string
        }
      }
      resumes: {
        Row: {
          id: string
          user_id: string
          storage_path: string
          file_name: string
          extracted_text: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          user_id: string
          storage_path: string
          file_name: string
          extracted_text?: string | null
          uploaded_at?: string
        }
        Update: {
          storage_path?: string
          file_name?: string
          extracted_text?: string | null
        }
      }
      search_profiles: {
        Row: {
          id: string
          user_id: string
          profile: SearchProfileData
          chat_summary: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          profile?: SearchProfileData
          chat_summary?: string | null
          updated_at?: string
        }
        Update: {
          profile?: SearchProfileData
          chat_summary?: string | null
          updated_at?: string
        }
      }
      search_filters: {
        Row: {
          id: string
          user_id: string
          filters: SearchFiltersData
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          filters?: SearchFiltersData
          updated_at?: string
        }
        Update: {
          filters?: SearchFiltersData
          updated_at?: string
        }
      }
      companies: {
        Row: {
          id: string
          user_id: string
          name: string
          domain: string | null
          hiring_signal_source: string | null
          hiring_signal_url: string | null
          hiring_signal_title: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          domain?: string | null
          hiring_signal_source?: string | null
          hiring_signal_url?: string | null
          hiring_signal_title?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          domain?: string | null
          hiring_signal_source?: string | null
          hiring_signal_url?: string | null
          hiring_signal_title?: string | null
        }
      }
      contacts: {
        Row: {
          id: string
          user_id: string
          company_id: string
          first_name: string | null
          last_name: string | null
          full_name: string | null
          title: string | null
          email: string | null
          verification_status: string | null
          filter_match_reason: string | null
          application_context: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          company_id: string
          first_name?: string | null
          last_name?: string | null
          full_name?: string | null
          title?: string | null
          email?: string | null
          verification_status?: string | null
          filter_match_reason?: string | null
          application_context?: Json | null
          created_at?: string
        }
        Update: {
          first_name?: string | null
          last_name?: string | null
          full_name?: string | null
          title?: string | null
          email?: string | null
          verification_status?: string | null
          filter_match_reason?: string | null
          application_context?: Json | null
        }
      }
      outreach_drafts: {
        Row: {
          id: string
          user_id: string
          contact_id: string
          subject: string
          body: string
          status: DraftStatus
          error_message: string | null
          sent_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          bounce_detected_at: string | null
          bounce_summary: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          contact_id: string
          subject: string
          body: string
          status?: DraftStatus
          error_message?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          subject?: string
          body?: string
          status?: DraftStatus
          error_message?: string | null
          sent_at?: string | null
          updated_at?: string
        }
      }
      gmail_tokens: {
        Row: {
          user_id: string
          refresh_token: string
          access_token: string | null
          expires_at: string | null
          email: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          refresh_token: string
          access_token?: string | null
          expires_at?: string | null
          email?: string | null
          updated_at?: string
        }
        Update: {
          refresh_token?: string
          access_token?: string | null
          expires_at?: string | null
          email?: string | null
          updated_at?: string
        }
      }
      profile_chat_messages: {
        Row: {
          id: string
          user_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role: 'user' | 'assistant' | 'system'
          content: string
          created_at?: string
        }
        Update: {
          content?: string
        }
      }
    }
    Views: {
      gmail_connection: {
        Row: {
          user_id: string
          email: string | null
          updated_at: string
        }
      }
    }
  }
}
