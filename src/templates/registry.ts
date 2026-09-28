import type { GrapesProjectData } from '../contract/boltDocument';
import { createBoltEditor, getProjectData } from '../engine/createBoltEditor';
import { applyRules, BASE_RULES, DEFAULT_THEME } from '../engine/styles';
import { NIMBUS } from './nimbus';
import type { TemplateDefinition } from './types';
import { VERTICE } from './vertice';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Biblioteca inicial. Congelada: nenhum código pode alterar um template original. */
export const TEMPLATES: readonly TemplateDefinition[] = deepFreeze([NIMBUS, VERTICE]);

export const BLANK_TEMPLATE_ID = 'em-branco';

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templateName(id: string | null): string | null {
  if (id === null) return null;
  if (id === BLANK_TEMPLATE_ID) return 'Em branco';
  return getTemplate(id)?.name ?? null;
}

/**
 * Gera o JSON de projeto de um template (ou em branco). Cada chamada produz uma cópia
 * nova e independente: o template é clonado antes de entrar no motor e o resultado é
 * serializado, sem referências partilhadas.
 */
export function buildProjectData(template: TemplateDefinition | null): GrapesProjectData {
  const editor = createBoltEditor();
  try {
    editor.setComponents(structuredClone(template ? [...template.components] : []));
    applyRules(editor, BASE_RULES);
    applyRules(editor, [{ selector: 'body', style: { ...(template?.theme ?? DEFAULT_THEME) } }]);
    if (template) applyRules(editor, template.rules);
    const copy: GrapesProjectData = JSON.parse(JSON.stringify(getProjectData(editor)));
    return copy;
  } finally {
    editor.destroy();
  }
}
