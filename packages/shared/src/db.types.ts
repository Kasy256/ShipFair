export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      banned_identities: {
        Row: {
          created_at: string;
          identity_hash: string;
          reason: string;
          until: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          identity_hash: string;
          reason: string;
          until?: string | null;
        };
        Update: {
          created_at?: string;
          identity_hash?: string;
          reason?: string;
          until?: string | null;
        };
        Relationships: [];
      };
      bans: {
        Row: {
          created_at: string;
          reason: string;
          until: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          reason: string;
          until?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          reason?: string;
          until?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bans_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bans_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      booth_stats_daily: {
        Row: {
          booth_id: string;
          day: string;
          try_clicks: number;
          unique_visitors: number;
          visits: number;
        };
        ComputedFields: never;
        Insert: {
          booth_id: string;
          day: string;
          try_clicks?: number;
          unique_visitors?: number;
          visits?: number;
        };
        Update: {
          booth_id?: string;
          day?: string;
          try_clicks?: number;
          unique_visitors?: number;
          visits?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'booth_stats_daily_booth_id_fkey';
            columns: ['booth_id'];
            isOneToOne: false;
            referencedRelation: 'booths';
            referencedColumns: ['id'];
          },
        ];
      };
      booth_votes: {
        Row: {
          booth_id: string;
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          booth_id: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          booth_id?: string;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'booth_votes_booth_id_fkey';
            columns: ['booth_id'];
            isOneToOne: false;
            referencedRelation: 'booths';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booth_votes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booth_votes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      booths: {
        Row: {
          approved_at: string | null;
          created_at: string;
          description: string | null;
          district_id: number;
          id: string;
          logo_key: string | null;
          media: NonNullable<Json>;
          name: string;
          owner_id: string;
          pricing: string | null;
          reject_reason: string | null;
          slug: string;
          status: Database['public']['Enums']['booth_status'];
          tagline: string;
          tier: Database['public']['Enums']['booth_tier'];
          updated_at: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          created_at?: string;
          description?: string | null;
          district_id: number;
          id?: string;
          logo_key?: string | null;
          media?: NonNullable<Json>;
          name: string;
          owner_id: string;
          pricing?: string | null;
          reject_reason?: string | null;
          slug: string;
          status?: Database['public']['Enums']['booth_status'];
          tagline: string;
          tier?: Database['public']['Enums']['booth_tier'];
          updated_at?: string;
          url: string;
        };
        Update: {
          approved_at?: string | null;
          created_at?: string;
          description?: string | null;
          district_id?: number;
          id?: string;
          logo_key?: string | null;
          media?: NonNullable<Json>;
          name?: string;
          owner_id?: string;
          pricing?: string | null;
          reject_reason?: string | null;
          slug?: string;
          status?: Database['public']['Enums']['booth_status'];
          tagline?: string;
          tier?: Database['public']['Enums']['booth_tier'];
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'booths_district_id_fkey';
            columns: ['district_id'];
            isOneToOne: false;
            referencedRelation: 'districts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booths_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'booths_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      districts: {
        Row: {
          color: string;
          id: number;
          name: string;
          slug: string;
          sort_order: number;
          theme: string;
        };
        ComputedFields: never;
        Insert: {
          color: string;
          id: number;
          name: string;
          slug: string;
          sort_order: number;
          theme: string;
        };
        Update: {
          color?: string;
          id?: number;
          name?: string;
          slug?: string;
          sort_order?: number;
          theme?: string;
        };
        Relationships: [];
      };
      guestbook_entries: {
        Row: {
          author_id: string;
          body: string;
          booth_id: string;
          created_at: string;
          hidden: boolean;
          id: number;
        };
        ComputedFields: never;
        Insert: {
          author_id: string;
          body: string;
          booth_id: string;
          created_at?: string;
          hidden?: boolean;
          id?: never;
        };
        Update: {
          author_id?: string;
          body?: string;
          booth_id?: string;
          created_at?: string;
          hidden?: boolean;
          id?: never;
        };
        Relationships: [
          {
            foreignKeyName: 'guestbook_entries_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'guestbook_entries_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'guestbook_entries_booth_id_fkey';
            columns: ['booth_id'];
            isOneToOne: false;
            referencedRelation: 'booths';
            referencedColumns: ['id'];
          },
        ];
      };
      moderation_log: {
        Row: {
          action: string;
          actor_handle: string | null;
          actor_id: string | null;
          created_at: string;
          detail: NonNullable<Json>;
          id: number;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_handle?: string | null;
          actor_id?: string | null;
          created_at?: string;
          detail?: NonNullable<Json>;
          id?: never;
          target_id: string;
          target_type: string;
        };
        Update: {
          action?: string;
          actor_handle?: string | null;
          actor_id?: string | null;
          created_at?: string;
          detail?: NonNullable<Json>;
          id?: never;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'moderation_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'moderation_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      passport_stamps: {
        Row: {
          created_at: string;
          stamp: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          stamp: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          stamp?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'passport_stamps_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'passport_stamps_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_style: NonNullable<Json>;
          created_at: string;
          display_name: string;
          handle: string;
          id: string;
          links: NonNullable<Json>;
          role: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_style?: NonNullable<Json>;
          created_at?: string;
          display_name: string;
          handle: string;
          id: string;
          links?: NonNullable<Json>;
          role?: string;
        };
        Update: {
          avatar_style?: NonNullable<Json>;
          created_at?: string;
          display_name?: string;
          handle?: string;
          id?: string;
          links?: NonNullable<Json>;
          role?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          id: number;
          note: string | null;
          reason: string;
          reporter_id: string | null;
          status: string;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: never;
          note?: string | null;
          reason: string;
          reporter_id?: string | null;
          status?: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          note?: string | null;
          reason?: string;
          reporter_id?: string | null;
          status?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'public_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      booth_vote_counts: {
        Row: {
          booth_id: string;
          votes: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: 'booth_votes_booth_id_fkey';
            columns: ['booth_id'];
            isOneToOne: false;
            referencedRelation: 'booths';
            referencedColumns: ['id'];
          },
        ];
      };
      public_profiles: {
        Row: {
          avatar_style: NonNullable<Json>;
          created_at: string;
          display_name: string;
          handle: string;
          id: string;
          links: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          avatar_style?: Json | null;
          created_at?: string | null;
          display_name?: string | null;
          handle?: string | null;
          id?: string | null;
          links?: Json | null;
        };
        Update: {
          avatar_style?: Json | null;
          created_at?: string | null;
          display_name?: string | null;
          handle?: string | null;
          id?: string | null;
          links?: Json | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      booth_media_keys_valid: {
        Args: { logo_key: string; media: Json; owner: string };
        Returns: boolean;
      };
      is_not_banned: { Args: { uid: string }; Returns: boolean };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
    };
    Enums: {
      booth_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'hidden' | 'archived';
      booth_tier: 'stall' | 'booth' | 'pavilion';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booth_status: ['draft', 'pending', 'approved', 'rejected', 'hidden', 'archived'],
      booth_tier: ['stall', 'booth', 'pavilion'],
    },
  },
} as const;
