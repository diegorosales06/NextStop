/**
 * Hand-crafted types mirroring the schema in sql/001–005. Regenerate with
 * `npm run types` (see README) once the Supabase CLI is installed and linked.
 *
 * Shape matches `supabase gen types typescript --schema public` output:
 * every Table has Row/Insert/Update/Relationships; Functions is a flat map
 * of Args → Returns. RPC calls need this exact shape or the client falls
 * back to `never` on all row types.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type EntryRow = {
  entry_id: number
  template_cell_id: string
  entry_type: string
  receiving_summary: string | null
  receiving_courses: Json
  satisfied: boolean
  no_articulation_reason: string | null
}

type RankRow = {
  agreement_id: number
  receiving_id: number
  receiving_name: string
  major_name: string
  year_id: number
  total_entries: number
  satisfied_entries: number
  completion_pct: number | null
}

export type Database = {
  public: {
    Tables: {
      institutions: {
        Row: {
          id: number
          code: string
          name: string
          category: 'CCC' | 'UC' | 'CSU' | 'private'
          is_community: boolean
          term_type: 'Quarter' | 'Semester' | null
        }
        Insert: {
          id: number
          code: string
          name: string
          category: 'CCC' | 'UC' | 'CSU' | 'private'
          is_community: boolean
          term_type?: 'Quarter' | 'Semester' | null
        }
        Update: {
          code?: string
          name?: string
          category?: 'CCC' | 'UC' | 'CSU' | 'private'
          is_community?: boolean
          term_type?: 'Quarter' | 'Semester' | null
        }
        Relationships: []
      }
      academic_years: {
        Row: { id: number; from_year: number | null; to_year: number | null }
        Insert: { id: number; from_year?: number | null; to_year?: number | null }
        Update: { from_year?: number | null; to_year?: number | null }
        Relationships: []
      }
      agreements: {
        Row: {
          id: number
          key: string
          year_id: number
          sending_id: number
          receiving_id: number
          major_name: string
          category: string
          publish_date: string | null
          catalog_year: string | null
          scraped_at: string
        }
        Insert: {
          key: string
          year_id: number
          sending_id: number
          receiving_id: number
          major_name: string
          category: string
          publish_date?: string | null
          catalog_year?: string | null
        }
        Update: {
          catalog_year?: string | null
          publish_date?: string | null
        }
        Relationships: []
      }
      courses: {
        Row: {
          id: number
          institution_id: number
          course_identifier_parent_id: number
          prefix: string
          course_number: string
          title: string
          department: string | null
          min_units: number | null
          max_units: number | null
          begin_term: string | null
          end_term: string | null
        }
        Insert: {
          institution_id: number
          course_identifier_parent_id: number
          prefix: string
          course_number: string
          title: string
          department?: string | null
          min_units?: number | null
          max_units?: number | null
          begin_term?: string | null
          end_term?: string | null
        }
        Update: {
          title?: string
          department?: string | null
          min_units?: number | null
          max_units?: number | null
          begin_term?: string | null
          end_term?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          avatar_url: string | null
          home_cc_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          avatar_url?: string | null
          home_cc_id?: number | null
        }
        Update: {
          display_name?: string | null
          avatar_url?: string | null
          home_cc_id?: number | null
        }
        Relationships: []
      }
      schedules: {
        Row: {
          id: number
          user_id: string
          name: string
          notes: string | null
          is_primary: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          name: string
          notes?: string | null
          is_primary?: boolean
        }
        Update: {
          name?: string
          notes?: string | null
          is_primary?: boolean
        }
        Relationships: []
      }
      schedule_courses: {
        Row: {
          id: number
          schedule_id: number
          course_id: number
          status: 'completed' | 'in_progress' | 'planned'
          term: string | null
          grade: string | null
          added_at: string
        }
        Insert: {
          schedule_id: number
          course_id: number
          status: 'completed' | 'in_progress' | 'planned'
          term?: string | null
          grade?: string | null
        }
        Update: {
          status?: 'completed' | 'in_progress' | 'planned'
          term?: string | null
          grade?: string | null
        }
        Relationships: []
      }
      saved_agreements: {
        Row: {
          id: number
          user_id: string
          agreement_id: number
          note: string | null
          created_at: string
        }
        Insert: {
          user_id: string
          agreement_id: number
          note?: string | null
        }
        Update: { note?: string | null }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_entry_satisfied: {
        Args: { p_entry_id: number; p_taken_course_ids: number[] }
        Returns: boolean
      }
      check_agreement_for_courses: {
        Args: { p_course_ids: number[]; p_agreement_id: number }
        Returns: EntryRow[]
      }
      check_agreement_for_schedule: {
        Args: { p_schedule_id: number; p_agreement_id: number }
        Returns: EntryRow[]
      }
      rank_agreements_for_courses: {
        Args: {
          p_course_ids: number[]
          p_receiving_ids?: number[] | null
          p_year_id?: number | null
          p_category?: string | null
          p_limit?: number
        }
        Returns: RankRow[]
      }
      rank_agreements_for_schedule: {
        Args: {
          p_schedule_id: number
          p_receiving_ids?: number[] | null
          p_year_id?: number | null
          p_category?: string | null
          p_limit?: number
        }
        Returns: RankRow[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
