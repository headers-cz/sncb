/**
 * Wire types for the Seneca REST API. These match the DTOs at
 * `seneca-web/src/app/api/v1/_lib/dto.ts`. Keep them in sync.
 */

export interface Website {
  id: string;
  organization_id: string;
  name: string;
  url: string | null;
  domain: string | null;
  domain_verified: boolean;
  domain_verification_token: string | null;
  domain_status: string;
  domain_error: string | null;
  domain_status_changed_at: string | null;
  status: string;
  design_scheme: string;
  primary_color: string | null;
  secondary_color: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebsiteDesign {
  design_scheme: string;
  primary_color: string | null;
  secondary_color: string | null;
}

export interface WebsiteDomain {
  domain: string | null;
  domain_verified: boolean;
  domain_verification_token: string | null;
  domain_status: string;
  domain_error: string | null;
  domain_status_changed_at: string | null;
}

/**
 * A page. Folders are pages with `is_folder: true`; there is no separate
 * folder entity. The same DTO is returned by /api/v1/websites/<id>/pages,
 * /api/v1/pages/<id>, and /api/v1/websites/<id>/folders (filtered).
 */
export interface Page {
  id: string;
  website_id: string;
  title: string;
  slug: string;
  slug_path: string | null;
  content: string;
  published: boolean;
  parent_id: string | null;
  position: number;
  is_folder: boolean;
  visibility: string;
  has_draft: boolean;
  draft_title: string | null;
  draft_content: string | null;
  created_at: string;
  updated_at: string;
}

export type Folder = Page;

export interface PageVersion {
  id: string;
  page_id: string;
  title: string;
  content: string;
  user_id: string | null;
  created_at: string;
}

export interface Agent {
  id: string;
  slug: string;
  company_name: string | null;
  source_url: string | null;
  system_prompt: string | null;
  language: string | null;
  personality: string;
  status: string;
  organization_id: string | null;
  created_at: string;
}

export interface Health {
  ok: boolean;
  organization_id: string;
  scope: string;
}
