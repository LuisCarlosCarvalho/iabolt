import { z } from 'zod';

export const BOLT_SCHEMA_VERSION = 1 as const;
export const ENGINE_NAME = 'grapesjs' as const;

/** Nó de componente como sai de `getProjectData()`. Só validamos o que o Bolt IA exige. */
export interface ComponentNode {
  type?: string;
  attributes?: Record<string, unknown>;
  components?: ComponentNode[];
  [key: string]: unknown;
}

const componentNode: z.ZodType<ComponentNode> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
      components: z.array(componentNode).optional(),
    })
    .passthrough(),
);

const frame = z.object({ component: componentNode }).passthrough();
const page = z.object({ id: z.string().optional(), frames: z.array(frame).min(1) }).passthrough();

export const projectDataSchema = z
  .object({
    pages: z.array(page).min(1),
    styles: z.array(z.unknown()).optional(),
    assets: z.array(z.unknown()).optional(),
    symbols: z.array(z.unknown()).optional(),
    dataSources: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type GrapesProjectData = z.infer<typeof projectDataSchema>;

export const boltDocumentSchema = z.object({
  boltSchemaVersion: z.literal(BOLT_SCHEMA_VERSION),
  engine: z.object({ name: z.literal(ENGINE_NAME), version: z.string().min(1) }),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  projectData: projectDataSchema,
});

export type BoltDocument = z.infer<typeof boltDocumentSchema>;

export type ParseResult =
  | { ok: true; doc: BoltDocument }
  | { ok: false; error: string };

/** Valida e migra. Só versões conhecidas; o resto é erro explícito. */
export function parseBoltDocument(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Documento não é um objeto.' };
  }
  const version = (input as { boltSchemaVersion?: unknown }).boltSchemaVersion;
  if (version !== BOLT_SCHEMA_VERSION) {
    return { ok: false, error: `Versão de schema desconhecida: ${String(version)}` };
  }
  const parsed = boltDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const missing = findComponentsWithoutId(parsed.data.projectData);
  if (missing.length > 0) {
    return { ok: false, error: `Componentes sem id estável: ${missing.length}` };
  }
  return { ok: true, doc: parsed.data };
}

/** Tipos que o motor não torna selecionáveis e que por isso não precisam de id. */
const ID_EXEMPT = new Set(['textnode']);

export function findComponentsWithoutId(data: GrapesProjectData): string[] {
  const out: string[] = [];
  const walk = (node: ComponentNode, path: string): void => {
    const type = node.type ?? 'default';
    if (!ID_EXEMPT.has(type) && typeof node.attributes?.id !== 'string') out.push(`${path}<${type}>`);
    (node.components ?? []).forEach((c, i) => walk(c, `${path}/${i}`));
  };
  data.pages.forEach((p, pi) => p.frames.forEach((f, fi) => walk(f.component, `p${pi}f${fi}`)));
  return out;
}
