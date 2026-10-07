/** Permisos compartidos (servidor y cliente). La seguridad real la imponen las políticas RLS y las funciones SQL; esto solo adapta la interfaz. */

export type Role = "super_admin" | "manager" | "receptionist" | "specialist";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super administrador", manager: "Gerente", receptionist: "Recepción", specialist: "Especialista",
};

/** Áreas del panel visibles por rol. */
export const PERMISSIONS = {
  dashboard: ["super_admin", "manager"],
  agenda: ["super_admin", "manager", "receptionist", "specialist"],
  appointments: ["super_admin", "manager", "receptionist", "specialist"],
  clients: ["super_admin", "manager", "receptionist", "specialist"], // el especialista solo lee los suyos
  services: ["super_admin", "manager"],
  staff: ["super_admin", "manager"],
  payroll: ["super_admin", "manager"],
  sales: ["super_admin", "manager", "receptionist"],
  payments: ["super_admin", "manager", "receptionist"],
  reports: ["super_admin", "manager"],
  promotions: ["super_admin", "manager"],
  gallery: ["super_admin", "manager"],
  settings: ["super_admin", "manager"],
  audit: ["super_admin", "manager"],
  users: ["super_admin"],
} as const satisfies Record<string, readonly Role[]>;
export type Area = keyof typeof PERMISSIONS;

/** Acciones concretas (más finas que las áreas). */
export const ACTIONS = {
  manageAppointments: ["super_admin", "manager", "receptionist"], // crear, editar, reprogramar, cancelar
  advanceOwn: ["super_admin", "manager", "receptionist", "specialist"], // iniciar / completar
  charge: ["super_admin", "manager", "receptionist"],
  voidOrRefund: ["super_admin", "manager"],
  deleteRecords: ["super_admin", "manager"],
  manageClients: ["super_admin", "manager", "receptionist"],
  seeMoney: ["super_admin", "manager", "receptionist"],
  managePayroll: ["super_admin", "manager"],
} as const satisfies Record<string, readonly Role[]>;
export type ActionKey = keyof typeof ACTIONS;

export const can = (role: Role, area: Area) => (PERMISSIONS[area] as readonly Role[]).includes(role);
export const allowed = (role: Role, action: ActionKey) => (ACTIONS[action] as readonly Role[]).includes(role);
