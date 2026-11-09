/** Permission catalogue (phase 1). Seeded into the Permission table; the code is the source of truth. */
export const PERMISSIONS = {
  "dashboard.read": "See the dashboard",
  "branches.read": "View branches",
  "branches.manage": "Create and edit branches",
  "staff.read": "View staff",
  "staff.manage": "Add, edit and offboard staff",
  "roles.read": "View roles and permissions",
  "plans.read": "View membership plans",
  "plans.manage": "Create and edit membership plans",
  "members.read": "View members",
  "members.read.assigned": "View only members assigned to me",
  "members.create": "Register members",
  "members.update": "Edit members",
  "subscriptions.read": "View subscriptions and renewals",
  "subscriptions.sell": "Sell memberships",
  "subscriptions.discount.unlimited": "Give discounts above the plan's cap",
  "subscriptions.backdate": "Start a membership in the past",
  "invoices.read": "View invoices",
  "payments.read": "View payments",
  "payments.collect": "Record payments",
  "leads.read": "View all leads",
  "leads.read.assigned": "View leads assigned to me",
  "leads.create": "Create leads",
  "leads.update": "Update leads and log activity",
  "leads.convert": "Convert leads to members",
  "reports.finance": "See revenue, dues and expenses",
  "audit.read": "Read the audit log",
  "settings.read": "View settings",
  // phase 2
  "attendance.read": "View the attendance log",
  "attendance.read.assigned": "View visits of members assigned to me",
  "attendance.checkin": "Check members in and out",
  "attendance.override": "Let a refused member in (with a reason)",
  "members.credential.rotate": "Issue a new QR / RFID card",
  "subscriptions.freeze": "Freeze and unfreeze memberships",
  "trainers.read": "View trainers and their members",
  "trainers.assign": "Assign trainers to members",
  "workouts.read": "View workout and diet plans",
  "workouts.read.assigned": "View plans of members assigned to me",
  "workouts.manage": "Create workout and diet plans for my members",
  "workouts.manage.any": "Create workout and diet plans for any member",
  "workouts.library.manage": "Edit the exercise library",
  "pt.read": "View personal training",
  "pt.read.assigned": "View my own PT sessions",
  "pt.sell": "Sell PT packages",
  "pt.schedule": "Book and cancel PT sessions",
  "pt.complete": "Mark PT sessions done",
  "pt.packages.manage": "Create and edit PT packages",
  // phase 3
  "settings.manage": "Change business details and rules",
  "members.import": "Import members from a spreadsheet",
  "expenses.read": "View expenses",
  "expenses.manage": "Record and delete expenses",
  "reports.read": "See membership, lead and trainer reports",
  "notifications.read": "See the message queue",
  "notifications.send": "Send and skip messages",
  "notifications.manage": "Edit message templates",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const all = Object.keys(PERMISSIONS) as Permission[];
const without = (...p: Permission[]) => all.filter((x) => !p.includes(x));
const ASSIGNED_ONLY: Permission[] = ["members.read.assigned", "leads.read.assigned", "attendance.read.assigned", "workouts.read.assigned", "pt.read.assigned"];

/** System roles and their default permission sets. */
export const SYSTEM_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  OWNER: { name: "Owner", permissions: all },
  BRANCH_MANAGER: {
    name: "Branch manager",
    permissions: without("branches.manage", "settings.manage", "subscriptions.discount.unlimited", ...ASSIGNED_ONLY),
  },
  GYM_ADMIN: {
    name: "Gym admin",
    permissions: without("branches.manage", "settings.manage", "staff.manage", "audit.read", "reports.finance", "subscriptions.discount.unlimited", "pt.packages.manage", "expenses.manage", "notifications.manage", ...ASSIGNED_ONLY),
  },
  RECEPTIONIST: {
    name: "Receptionist",
    permissions: [
      "dashboard.read", "branches.read", "staff.read", "plans.read", "members.read", "members.create", "members.update",
      "subscriptions.read", "subscriptions.sell", "invoices.read", "payments.read", "payments.collect",
      "leads.read", "leads.create", "leads.update", "leads.convert",
      "attendance.read", "attendance.checkin", "members.credential.rotate", "subscriptions.freeze",
      "trainers.read", "trainers.assign", "workouts.read", "pt.read", "pt.sell", "pt.schedule",
      "notifications.read", "notifications.send",
    ],
  },
  TRAINER: {
    name: "Trainer",
    permissions: [
      "dashboard.read", "branches.read", "plans.read", "members.read.assigned", "leads.read.assigned", "attendance.read.assigned",
      "attendance.checkin", "trainers.read", "workouts.read.assigned", "workouts.manage", "workouts.library.manage",
      "pt.read.assigned", "pt.schedule", "pt.complete",
    ],
  },
  ACCOUNTANT: {
    name: "Accountant",
    permissions: ["dashboard.read", "branches.read", "plans.read", "members.read", "subscriptions.read", "invoices.read", "payments.read", "payments.collect", "reports.finance", "pt.read", "trainers.read",
      "expenses.read", "expenses.manage", "reports.read"],
  },
};
