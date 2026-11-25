export type Role = 'admin' | 'user' | 'auditor';

export type Permission =
  | 'users:manage'
  | 'security_policy:manage'
  | 'org_taxonomy:manage'
  | 'questionnaire:manage'
  | 'ai_system:create'
  | 'ai_system:edit'
  | 'ai_system:archive'
  | 'ai_system:view'
  | 'assessment:create'
  | 'assessment:edit'
  | 'assessment:answer'
  | 'assessment:submit'
  | 'assessment:review'
  | 'assessment:view'
  | 'assessment:archive_own_draft'
  | 'assessment:delete'
  | 'checklist:edit'
  | 'action:create'
  | 'action:edit'
  | 'audit_log:view_all'
  | 'audit_log:view_own'
  | 'audit_log:verify'
  | 'report:export'
  | 'audit_finding:create'
  | 'audit_finding:respond';

export interface PermissionRule {
  permission: Permission;
  label: string;
  category: string;
  admin: 'Yes' | 'No' | 'Conditional';
  user: 'Yes' | 'No' | 'Conditional';
  auditor: 'Yes' | 'No' | 'Conditional';
  notes: string;
}

export const PERMISSION_DEFINITIONS: readonly PermissionRule[] = [
  {
    permission: 'users:manage',
    label: 'Manage users, roles, invitations and scopes',
    category: 'Administration',
    admin: 'Yes',
    user: 'No',
    auditor: 'No',
    notes: 'Includes creating users, resetting MFA/passkeys and revoking sessions.'
  },
  {
    permission: 'security_policy:manage',
    label: 'Manage MFA policy and security settings',
    category: 'Administration',
    admin: 'Yes',
    user: 'No',
    auditor: 'No',
    notes: 'Requires step-up re-authentication.'
  },
  {
    permission: 'org_taxonomy:manage',
    label: 'Manage organisations, business units and taxonomy',
    category: 'Administration',
    admin: 'Yes',
    user: 'No',
    auditor: 'No',
    notes: 'Includes branding settings.'
  },
  {
    permission: 'questionnaire:manage',
    label: 'Manage FRAME questionnaire versions',
    category: 'Administration',
    admin: 'Yes',
    user: 'No',
    auditor: 'No',
    notes: 'Draft, edit weights/descriptors and publish immutable versions.'
  },
  {
    permission: 'ai_system:view',
    label: 'View AI systems in scope',
    category: 'AI Systems',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'Conditional',
    notes: 'User and Auditor restricted to assigned organisation/BU/system scope.'
  },
  {
    permission: 'ai_system:create',
    label: 'Create AI systems',
    category: 'AI Systems',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User may create within assigned organisation/business unit scope.'
  },
  {
    permission: 'ai_system:edit',
    label: 'Edit AI systems',
    category: 'AI Systems',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User may edit within assigned scope.'
  },
  {
    permission: 'ai_system:archive',
    label: 'Archive or delete AI systems',
    category: 'AI Systems',
    admin: 'Yes',
    user: 'No',
    auditor: 'No',
    notes: 'Requires step-up re-authentication for Admin.'
  },
  {
    permission: 'assessment:view',
    label: 'View assessments, evidence and comments in scope',
    category: 'Assessments',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'Conditional',
    notes: 'Auditor has read-only access across all in-scope assessments; views are audit logged.'
  },
  {
    permission: 'assessment:create',
    label: 'Create or clone assessments',
    category: 'Assessments',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User within assigned scope.'
  },
  {
    permission: 'assessment:edit',
    label: 'Edit assessment metadata',
    category: 'Assessments',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'Locked once approved.'
  },
  {
    permission: 'assessment:answer',
    label: 'Answer questions, upload evidence and comment',
    category: 'Assessments',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User within assigned scope while assessment is editable.'
  },
  {
    permission: 'assessment:submit',
    label: 'Submit assessment for review',
    category: 'Assessments',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'Validates completeness before submission.'
  },
  {
    permission: 'assessment:review',
    label: 'Review, approve or request changes on assessments',
    category: 'Review Workflow',
    admin: 'Conditional',
    user: 'Conditional',
    auditor: 'No',
    notes: 'Admin or User with Reviewer flag only; four-eyes rule prevents approving own assessment.'
  },
  {
    permission: 'assessment:archive_own_draft',
    label: 'Archive own draft assessments',
    category: 'Assessments',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User may archive only draft assessments they authored.'
  },
  {
    permission: 'assessment:delete',
    label: 'Delete records',
    category: 'Assessments',
    admin: 'Yes',
    user: 'No',
    auditor: 'No',
    notes: 'Requires step-up re-authentication.'
  },
  {
    permission: 'checklist:edit',
    label: 'Complete FRAME implementation checklists',
    category: 'Checklists & Actions',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User within assigned scope.'
  },
  {
    permission: 'action:create',
    label: 'Create remediation actions',
    category: 'Checklists & Actions',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User within assigned scope.'
  },
  {
    permission: 'action:edit',
    label: 'Update and close remediation actions',
    category: 'Checklists & Actions',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'User within assigned scope.'
  },
  {
    permission: 'audit_finding:create',
    label: 'Add auditor findings and observations',
    category: 'Audit',
    admin: 'No',
    user: 'No',
    auditor: 'Yes',
    notes: 'Stored in separate AuditFinding table; never alters assessment answers.'
  },
  {
    permission: 'audit_finding:respond',
    label: 'Record management response to audit findings',
    category: 'Audit',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'No',
    notes: 'System owners/admins respond to auditor findings.'
  },
  {
    permission: 'audit_log:view_all',
    label: 'View full tamper-evident audit log',
    category: 'Audit',
    admin: 'Yes',
    user: 'No',
    auditor: 'Yes',
    notes: 'Auditor has full read-only visibility.'
  },
  {
    permission: 'audit_log:view_own',
    label: 'View own audit log actions',
    category: 'Audit',
    admin: 'Yes',
    user: 'Yes',
    auditor: 'Yes',
    notes: 'Users see only their own actions.'
  },
  {
    permission: 'audit_log:verify',
    label: 'Verify audit log hash chain integrity',
    category: 'Audit',
    admin: 'Yes',
    user: 'No',
    auditor: 'Yes',
    notes: 'Recomputes SHA-256 chain across all rows.'
  },
  {
    permission: 'report:export',
    label: 'Export reports (PDF, DOCX, CSV, JSON, Audit Pack)',
    category: 'Reporting',
    admin: 'Yes',
    user: 'Conditional',
    auditor: 'Yes',
    notes: 'User restricted to own scope; requires step-up re-authentication.'
  }
] as const;

export interface AuthActor {
  id: string;
  role: Role;
  isReviewer: boolean;
}

export interface PermissionContext {
  inScope?: boolean;
  isOwnerOrAuthor?: boolean;
  isDraft?: boolean;
}

export function hasPermission(
  actor: AuthActor,
  permission: Permission,
  ctx: PermissionContext = {}
): boolean {
  const inScope = ctx.inScope ?? true;

  switch (permission) {
    case 'users:manage':
    case 'security_policy:manage':
    case 'org_taxonomy:manage':
    case 'questionnaire:manage':
    case 'ai_system:archive':
    case 'assessment:delete':
      return actor.role === 'admin';

    case 'ai_system:view':
    case 'assessment:view':
      if (actor.role === 'admin') return true;
      return inScope;

    case 'ai_system:create':
    case 'ai_system:edit':
    case 'assessment:create':
    case 'assessment:edit':
    case 'assessment:answer':
    case 'assessment:submit':
    case 'checklist:edit':
    case 'action:create':
    case 'action:edit':
    case 'audit_finding:respond':
      if (actor.role === 'admin') return true;
      if (actor.role === 'user') return inScope;
      return false;

    case 'assessment:review': {
      // Four-eyes principle: author cannot approve/review own submission
      if (ctx.isOwnerOrAuthor) return false;
      if (actor.role === 'admin') return true;
      if (actor.role === 'user' && actor.isReviewer) return inScope;
      return false;
    }

    case 'assessment:archive_own_draft':
      if (actor.role === 'admin') return true;
      if (actor.role === 'user') {
        return inScope && Boolean(ctx.isOwnerOrAuthor) && Boolean(ctx.isDraft);
      }
      return false;

    case 'audit_finding:create':
      return actor.role === 'auditor' && inScope;

    case 'audit_log:view_all':
    case 'audit_log:verify':
      return actor.role === 'admin' || actor.role === 'auditor';

    case 'audit_log:view_own':
      return true;

    case 'report:export':
      if (actor.role === 'admin' || actor.role === 'auditor') return inScope;
      return actor.role === 'user' && inScope;

    default:
      return false;
  }
}

export function getPermissionsMatrix(): PermissionRule[] {
  return [...PERMISSION_DEFINITIONS];
}
