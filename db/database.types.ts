export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      disturbances: {
        Row: {
          county_no: number | null
          first_seen: string
          geom: unknown
          icon_id: string | null
          id: string
          last_seen: string
          message: string | null
          message_type: string | null
          modified_time: string | null
          raw: Json
          road_number: string | null
          severity: string | null
        }
        Insert: {
          county_no?: number | null
          first_seen?: string
          geom: unknown
          icon_id?: string | null
          id: string
          last_seen?: string
          message?: string | null
          message_type?: string | null
          modified_time?: string | null
          raw: Json
          road_number?: string | null
          severity?: string | null
        }
        Update: {
          county_no?: number | null
          first_seen?: string
          geom?: unknown
          icon_id?: string | null
          id?: string
          last_seen?: string
          message?: string | null
          message_type?: string | null
          modified_time?: string | null
          raw?: Json
          road_number?: string | null
          severity?: string | null
        }
        Relationships: []
      }
      event_segments: {
        Row: {
          distance_m: number
          event_id: string
          fid: number
          snapped_at: string
        }
        Insert: {
          distance_m: number
          event_id: string
          fid: number
          snapped_at?: string
        }
        Update: {
          distance_m?: number
          event_id?: string
          fid?: number
          snapped_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_segments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_segments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events_public"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          county_no: number | null
          first_seen: string
          geom: unknown
          icon_id: string | null
          id: string
          last_seen: string
          message: string | null
          modified_time: string | null
          raw: Json
          road_number: string | null
          severity: string | null
          snap_processed_at: string | null
        }
        Insert: {
          county_no?: number | null
          first_seen?: string
          geom: unknown
          icon_id?: string | null
          id: string
          last_seen?: string
          message?: string | null
          modified_time?: string | null
          raw: Json
          road_number?: string | null
          severity?: string | null
          snap_processed_at?: string | null
        }
        Update: {
          county_no?: number | null
          first_seen?: string
          geom?: unknown
          icon_id?: string | null
          id?: string
          last_seen?: string
          message?: string | null
          modified_time?: string | null
          raw?: Json
          road_number?: string | null
          severity?: string | null
          snap_processed_at?: string | null
        }
        Relationships: []
      }
      nvdb_large_roads_speed: {
        Row: {
          element_id: string | null
          fid: number
          geom: unknown
          length_m: number | null
          speed_limit: number | null
        }
        Insert: {
          element_id?: string | null
          fid?: number
          geom?: unknown
          length_m?: number | null
          speed_limit?: number | null
        }
        Update: {
          element_id?: string | null
          fid?: number
          geom?: unknown
          length_m?: number | null
          speed_limit?: number | null
        }
        Relationships: []
      }
      nvdb_large_roads_type: {
        Row: {
          element_id: string | null
          fid: number
          geom: unknown
          lane_description: string | null
          length_m: number | null
          road_type: string | null
        }
        Insert: {
          element_id?: string | null
          fid?: number
          geom?: unknown
          lane_description?: string | null
          length_m?: number | null
          road_type?: string | null
        }
        Update: {
          element_id?: string | null
          fid?: number
          geom?: unknown
          lane_description?: string | null
          length_m?: number | null
          road_type?: string | null
        }
        Relationships: []
      }
      nvdb_trafik: {
        Row: {
          adt_axelpar: number | null
          adt_latta_fordon_06_18: number | null
          adt_latta_fordon_18_22: number | null
          adt_latta_fordon_22_06: number | null
          adt_medeltunga_fordon_06_18: number | null
          adt_medeltunga_fordon_18_22: number | null
          adt_medeltunga_fordon_22_06: number | null
          adt_samtliga_fordon: number | null
          adt_tunga_fordon: number | null
          adt_tunga_fordon_06_18: number | null
          adt_tunga_fordon_18_22: number | null
          adt_tunga_fordon_22_06: number | null
          avsnittsidentitet: number | null
          direction: string | null
          element_id: string | null
          end_measure: number | null
          extent_length: number | null
          fid: number
          geom: unknown
          ishost: string | null
          matarsperiod: number | null
          matmetod: string | null
          mc_floden: string | null
          osakerhet_axelpar: number | null
          osakerhet_samtliga_fordon: number | null
          osakerhet_tunga_fordon: number | null
          role: string | null
          seq_no: number | null
          start_measure: number | null
          valid_from: number | null
          valid_to: number | null
        }
        Insert: {
          adt_axelpar?: number | null
          adt_latta_fordon_06_18?: number | null
          adt_latta_fordon_18_22?: number | null
          adt_latta_fordon_22_06?: number | null
          adt_medeltunga_fordon_06_18?: number | null
          adt_medeltunga_fordon_18_22?: number | null
          adt_medeltunga_fordon_22_06?: number | null
          adt_samtliga_fordon?: number | null
          adt_tunga_fordon?: number | null
          adt_tunga_fordon_06_18?: number | null
          adt_tunga_fordon_18_22?: number | null
          adt_tunga_fordon_22_06?: number | null
          avsnittsidentitet?: number | null
          direction?: string | null
          element_id?: string | null
          end_measure?: number | null
          extent_length?: number | null
          fid?: number
          geom?: unknown
          ishost?: string | null
          matarsperiod?: number | null
          matmetod?: string | null
          mc_floden?: string | null
          osakerhet_axelpar?: number | null
          osakerhet_samtliga_fordon?: number | null
          osakerhet_tunga_fordon?: number | null
          role?: string | null
          seq_no?: number | null
          start_measure?: number | null
          valid_from?: number | null
          valid_to?: number | null
        }
        Update: {
          adt_axelpar?: number | null
          adt_latta_fordon_06_18?: number | null
          adt_latta_fordon_18_22?: number | null
          adt_latta_fordon_22_06?: number | null
          adt_medeltunga_fordon_06_18?: number | null
          adt_medeltunga_fordon_18_22?: number | null
          adt_medeltunga_fordon_22_06?: number | null
          adt_samtliga_fordon?: number | null
          adt_tunga_fordon?: number | null
          adt_tunga_fordon_06_18?: number | null
          adt_tunga_fordon_18_22?: number | null
          adt_tunga_fordon_22_06?: number | null
          avsnittsidentitet?: number | null
          direction?: string | null
          element_id?: string | null
          end_measure?: number | null
          extent_length?: number | null
          fid?: number
          geom?: unknown
          ishost?: string | null
          matarsperiod?: number | null
          matmetod?: string | null
          mc_floden?: string | null
          osakerhet_axelpar?: number | null
          osakerhet_samtliga_fordon?: number | null
          osakerhet_tunga_fordon?: number | null
          role?: string | null
          seq_no?: number | null
          start_measure?: number | null
          valid_from?: number | null
          valid_to?: number | null
        }
        Relationships: []
      }
      nvdb_tsk_deprecated: {
        Row: {
          element_id: string | null
          end_measure: number | null
          extent_length: number | null
          fid: number
          geom: unknown
          start_measure: number | null
          ts_klass_stracka: string | null
          valid_from: number | null
          valid_to: number | null
        }
        Insert: {
          element_id?: string | null
          end_measure?: number | null
          extent_length?: number | null
          fid?: number
          geom?: unknown
          start_measure?: number | null
          ts_klass_stracka?: string | null
          valid_from?: number | null
          valid_to?: number | null
        }
        Update: {
          element_id?: string | null
          end_measure?: number | null
          extent_length?: number | null
          fid?: number
          geom?: unknown
          start_measure?: number | null
          ts_klass_stracka?: string | null
          valid_from?: number | null
          valid_to?: number | null
        }
        Relationships: []
      }
      route_feedback: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          route_meta: Json
          search_meta: Json
          snapshot_id: string | null
          vote: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          route_meta?: Json
          search_meta?: Json
          snapshot_id?: string | null
          vote: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          route_meta?: Json
          search_meta?: Json
          snapshot_id?: string | null
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_feedback_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "route_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      route_snapshots: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          is_public: boolean
          payload: Json
          slug: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          is_public?: boolean
          payload: Json
          slug?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          is_public?: boolean
          payload?: Json
          slug?: string | null
        }
        Relationships: []
      }
      traffic_flow_measurements: {
        Row: {
          average_vehicle_speed: number | null
          county_no: number | null
          data_quality: string | null
          deleted: boolean
          first_seen: string
          geom: unknown
          id: string
          last_seen: string
          measurement_or_calculation_period: number | null
          measurement_side: string | null
          measurement_time: string | null
          modified_time: string | null
          raw: Json
          region_id: number | null
          site_id: number
          specific_lane: string | null
          vehicle_flow_rate: number | null
          vehicle_type: string | null
        }
        Insert: {
          average_vehicle_speed?: number | null
          county_no?: number | null
          data_quality?: string | null
          deleted?: boolean
          first_seen?: string
          geom: unknown
          id: string
          last_seen?: string
          measurement_or_calculation_period?: number | null
          measurement_side?: string | null
          measurement_time?: string | null
          modified_time?: string | null
          raw: Json
          region_id?: number | null
          site_id: number
          specific_lane?: string | null
          vehicle_flow_rate?: number | null
          vehicle_type?: string | null
        }
        Update: {
          average_vehicle_speed?: number | null
          county_no?: number | null
          data_quality?: string | null
          deleted?: boolean
          first_seen?: string
          geom?: unknown
          id?: string
          last_seen?: string
          measurement_or_calculation_period?: number | null
          measurement_side?: string | null
          measurement_time?: string | null
          modified_time?: string | null
          raw?: Json
          region_id?: number | null
          site_id?: number
          specific_lane?: string | null
          vehicle_flow_rate?: number | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      adt_public: {
        Row: {
          adt_total: number | null
          adt_tung: number | null
          element_id: string | null
          fid: number | null
          geometry: Json | null
          langd_m: number | null
          matar: number | null
          matmetod: string | null
          osakerhet: number | null
        }
        Insert: {
          adt_total?: number | null
          adt_tung?: number | null
          element_id?: string | null
          fid?: number | null
          geometry?: never
          langd_m?: number | null
          matar?: never
          matmetod?: string | null
          osakerhet?: number | null
        }
        Update: {
          adt_total?: number | null
          adt_tung?: number | null
          element_id?: string | null
          fid?: number | null
          geometry?: never
          langd_m?: number | null
          matar?: never
          matmetod?: string | null
          osakerhet?: number | null
        }
        Relationships: []
      }
      disturbances_public: {
        Row: {
          county_no: number | null
          first_seen: string | null
          icon_id: string | null
          id: string | null
          last_seen: string | null
          lat: number | null
          lng: number | null
          message: string | null
          message_type: string | null
          modified_time: string | null
          road_number: string | null
          severity: string | null
        }
        Insert: {
          county_no?: number | null
          first_seen?: string | null
          icon_id?: string | null
          id?: string | null
          last_seen?: string | null
          lat?: never
          lng?: never
          message?: string | null
          message_type?: string | null
          modified_time?: string | null
          road_number?: string | null
          severity?: string | null
        }
        Update: {
          county_no?: number | null
          first_seen?: string | null
          icon_id?: string | null
          id?: string | null
          last_seen?: string | null
          lat?: never
          lng?: never
          message?: string | null
          message_type?: string | null
          modified_time?: string | null
          road_number?: string | null
          severity?: string | null
        }
        Relationships: []
      }
      events_public: {
        Row: {
          county_no: number | null
          first_seen: string | null
          icon_id: string | null
          id: string | null
          last_seen: string | null
          lat: number | null
          lng: number | null
          message: string | null
          modified_time: string | null
          road_number: string | null
          severity: string | null
        }
        Insert: {
          county_no?: number | null
          first_seen?: string | null
          icon_id?: string | null
          id?: string | null
          last_seen?: string | null
          lat?: never
          lng?: never
          message?: string | null
          modified_time?: string | null
          road_number?: string | null
          severity?: string | null
        }
        Update: {
          county_no?: number | null
          first_seen?: string | null
          icon_id?: string | null
          id?: string | null
          last_seen?: string | null
          lat?: never
          lng?: never
          message?: string | null
          modified_time?: string | null
          road_number?: string | null
          severity?: string | null
        }
        Relationships: []
      }
      large_roads_public: {
        Row: {
          class: string | null
          element_id: string | null
          fid: number | null
          geom: unknown
          length_m: number | null
          rank: number | null
          road_type: string | null
          speed_limit: number | null
        }
        Relationships: []
      }
      nvdb_trafik_latest: {
        Row: {
          adt_total: number | null
          element_id: string | null
          fid: number | null
          geom: unknown
          langd_m: number | null
        }
        Relationships: []
      }
      risk_per_segment: {
        Row: {
          adt_total: number | null
          element_id: string | null
          events_count: number | null
          fid: number | null
          geom: unknown
          risk_per_milj_fordon: number | null
        }
        Relationships: []
      }
      traffic_flow_public: {
        Row: {
          average_vehicle_speed: number | null
          county_no: number | null
          data_quality: string | null
          deleted: boolean | null
          first_seen: string | null
          id: string | null
          last_seen: string | null
          lat: number | null
          lng: number | null
          measurement_or_calculation_period: number | null
          measurement_side: string | null
          measurement_time: string | null
          modified_time: string | null
          region_id: number | null
          site_id: number | null
          specific_lane: string | null
          vehicle_flow_rate: number | null
          vehicle_type: string | null
        }
        Insert: {
          average_vehicle_speed?: number | null
          county_no?: number | null
          data_quality?: string | null
          deleted?: boolean | null
          first_seen?: string | null
          id?: string | null
          last_seen?: string | null
          lat?: never
          lng?: never
          measurement_or_calculation_period?: number | null
          measurement_side?: string | null
          measurement_time?: string | null
          modified_time?: string | null
          region_id?: number | null
          site_id?: number | null
          specific_lane?: string | null
          vehicle_flow_rate?: number | null
          vehicle_type?: string | null
        }
        Update: {
          average_vehicle_speed?: number | null
          county_no?: number | null
          data_quality?: string | null
          deleted?: boolean | null
          first_seen?: string | null
          id?: string | null
          last_seen?: string | null
          lat?: never
          lng?: never
          measurement_or_calculation_period?: number | null
          measurement_side?: string | null
          measurement_time?: string | null
          modified_time?: string | null
          region_id?: number | null
          site_id?: number | null
          specific_lane?: string | null
          vehicle_flow_rate?: number | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      adt_in_bbox: {
        Args: {
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
        }
        Returns: {
          adt_total: number
          adt_tung: number
          element_id: string
          fid: number
          geometry: Json
          langd_m: number
          matar: number
          matmetod: string
          osakerhet: number
        }[]
      }
      cleanup_expired_route_snapshots: { Args: never; Returns: number }
      create_route_feedback: {
        Args: {
          p_comment: string
          p_route_meta?: Json
          p_search_meta?: Json
          p_snapshot_id: string
          p_vote: string
        }
        Returns: string
      }
      create_route_snapshot: {
        Args: {
          p_expires_at?: string
          p_is_public: boolean
          p_payload: Json
          p_slug: string
        }
        Returns: {
          expires_at: string
          id: string
          slug: string
        }[]
      }
      delete_route_feedback: {
        Args: { p_feedback_id: string }
        Returns: boolean
      }
      disturbances_in_bbox: {
        Args: {
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
          p_active_since?: string
        }
        Returns: {
          first_seen: string
          icon_id: string
          id: string
          last_seen: string
          lat: number
          lng: number
          message: string
          message_type: string
          road_number: string
          severity: string
        }[]
      }
      events_in_bbox: {
        Args: {
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
          p_live_since?: string
          p_since?: string
        }
        Returns: {
          first_seen: string
          icon_id: string
          id: string
          last_seen: string
          lat: number
          lng: number
          message: string
          road_number: string
          severity: string
        }[]
      }
      get_public_route_snapshot: {
        Args: { p_slug: string }
        Returns: {
          expired: boolean
          expires_at: string
          payload: Json
        }[]
      }
      large_roads_in_bbox: {
        Args: {
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
        }
        Returns: {
          class: string
          element_id: string
          fid: number
          geometry: Json
          length_m: number
          rank: number
          road_type: string
          speed_limit: number
        }[]
      }
      route_lane_penalties_in_bbox: {
        Args: {
          include_large_roundabouts?: boolean
          include_multilane?: boolean
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
        }
        Returns: {
          element_id: string | null
          fid: number
          geometry: Json
          kind: string
          lane_count: number | null
          length_m: number | null
        }[]
      }
      resnap_orphan_events: { Args: { p_limit?: number }; Returns: number }
      risk_in_bbox: {
        Args: {
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
        }
        Returns: {
          adt_total: number
          events_count: number
          fid: number
          geometry: Json
          risk_per_milj_fordon: number
        }[]
      }
      segment_detail: { Args: { p_fid: number }; Returns: Json }
      snap_pending_events: { Args: { p_limit?: number }; Returns: number }
      traffic_flow_segments_in_bbox: {
        Args: {
          active_since?: string
          max_lat: number
          max_lng: number
          min_lat: number
          min_lng: number
        }
        Returns: {
          average_vehicle_speed: number
          data_quality: string
          fid: number
          geometry: Json
          last_seen: string
          measurement_time: string
          sample_count: number
          site_id: number
          snap_distance_m: number
          vehicle_flow_rate: number
        }[]
      }
      update_route_feedback_comment: {
        Args: { p_comment: string; p_feedback_id: string }
        Returns: string
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
