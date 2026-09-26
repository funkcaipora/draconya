// scripts/catalog/xml.ts — leitor XML genérico para as fontes do Canary (items.xml,
// data-otservbr-global/world/otservbr-monster.xml).
//
// `fast-xml-parser` no modo `preserveOrder` (MIT, JS puro, sem binário nativo — ADR 0013) é o
// que usamos por baixo: nesse modo TODO elemento vira array de filhos, sempre — o modo padrão
// da biblioteca colapsa um filho repetido zero ou uma vez num objeto solto e SÓ vira array a
// partir do segundo, o que faria `<item>` com uma única `<attribute>` produzir uma árvore
// diferente da de duas. É exatamente o tipo de bug que passaria despercebido num arquivo de
// 85 mil linhas. Aqui achatamos esse formato numa árvore própria (`XmlElement`), estável e
// fácil de percorrer, e o `fast-xml-parser` nunca vaza para quem importa este módulo.

import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

export interface XmlElement {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Texto direto do elemento (concatenação dos nós de texto, comentário excluído). */
  readonly text: string;
}

const ATTR_PREFIX = '@_';
const TEXT_KEY = '#text';
const COMMENT_KEY = '#comment';

// O `parse()` do fast-xml-parser devolve `any` (a própria lib não tipa o formato de saída —
// ele muda com as opções). `PreservedNode` é a forma LOCAL que o modo `preserveOrder` produz,
// e é contra ela que `toElement` valida cada campo antes de usar.
type PreservedNode = Record<string, unknown>;

function isAttributesKey(key: string): boolean {
  return key === ':@';
}

/** Converte um nó do modo `preserveOrder` do fast-xml-parser em `XmlElement`. */
function toElement(node: PreservedNode): XmlElement | null {
  const attributesRaw = (node[':@'] as Record<string, unknown> | undefined) ?? {};
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributesRaw)) {
    if (!key.startsWith(ATTR_PREFIX)) continue;
    attributes[key.slice(ATTR_PREFIX.length)] = String(value);
  }
  const tagKey = Object.keys(node).find((key) => !isAttributesKey(key));
  if (tagKey === undefined) return null;
  if (tagKey === TEXT_KEY || tagKey === COMMENT_KEY) return null;
  const childNodes = node[tagKey] as PreservedNode[];
  const children: XmlElement[] = [];
  let text = '';
  for (const child of childNodes) {
    const childTag = Object.keys(child).find((key) => !isAttributesKey(key));
    if (childTag === TEXT_KEY) { text += String(child[TEXT_KEY]); continue; }
    if (childTag === COMMENT_KEY) continue;
    const element = toElement(child);
    if (element !== null) children.push(element);
  }
  return { tag: tagKey, attributes, children, text: text.trim() };
}

/** Analisa uma string XML e devolve o elemento RAIZ (o `<?xml?>` e comentários de topo somem). */
export function parseXml(source: string): XmlElement {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    textNodeName: TEXT_KEY,
    commentPropName: COMMENT_KEY,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });
  const nodes = parser.parse(source) as PreservedNode[];
  for (const node of nodes) {
    // O `<?xml version="1.0"?>` de topo também vira um "elemento" de tag "?xml" neste modo —
    // não é o documento, é o prólogo dele.
    const tagKey = Object.keys(node).find((key) => !isAttributesKey(key));
    if (tagKey?.startsWith('?') === true) continue;
    const element = toElement(node);
    if (element !== null) return element;
  }
  throw new Error('XML sem elemento raiz');
}

export function readXmlFile(path: string): XmlElement {
  try {
    return parseXml(readFileSync(path, 'utf8'));
  } catch (erro) {
    throw new Error(`${path}: ${(erro as Error).message}`);
  }
}

/** Filhos diretos com uma tag específica, na ordem do arquivo. */
export function childrenOf(element: XmlElement, tag: string): readonly XmlElement[] {
  return element.children.filter((child) => child.tag === tag);
}

/** Atributo obrigatório; lança com o nome da tag e do atributo quando ausente. */
export function attr(element: XmlElement, name: string): string {
  const value = element.attributes[name];
  if (value === undefined) throw new Error(`<${element.tag}> sem atributo "${name}"`);
  return value;
}

export function attrOptional(element: XmlElement, name: string): string | undefined {
  return element.attributes[name];
}

/** Atributo numérico obrigatório; lança quando ausente OU quando não é um número. */
export function attrNumber(element: XmlElement, name: string): number {
  const raw = attr(element, name);
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`<${element.tag} ${name}="${raw}"> não é numérico`);
  return value;
}

export function attrNumberOptional(element: XmlElement, name: string): number | undefined {
  const raw = element.attributes[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`<${element.tag} ${name}="${raw}"> não é numérico`);
  return value;
}
