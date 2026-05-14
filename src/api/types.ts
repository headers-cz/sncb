export interface Website {
  id: string;
  organization_id: string;
  name: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebsiteDesign {
  primary_color?: string;
  font_family?: string;
  logo_url?: string;
  [k: string]: unknown;
}

export interface Folder {
  id: string;
  website_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  website_id: string;
  folder_id: string | null;
  title: string;
  slug: string;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageVersion {
  id: string;
  page_id: string;
  version: number;
  created_at: string;
  created_by: string | null;
}

export interface Agent {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  language: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Health {
  ok: boolean;
  organization_id: string;
  scope: "read" | "write";
}
